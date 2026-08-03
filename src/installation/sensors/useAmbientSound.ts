import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/**
 * Ambient microphone analysis.
 *
 * Nothing is recorded and nothing is transmitted — the stream feeds an
 * AnalyserNode and is discarded frame by frame. Echo cancellation, AGC and noise
 * suppression are all switched off on purpose: they are tuned for speech and
 * would flatten exactly the thing the piece listens for, which is how loud and
 * how bright a *place* is.
 *
 * Continuous outputs are refs; `spectrum` is one Float32Array mutated in place
 * for the lifetime of the hook so scenes can bind it straight to an attribute.
 */

const FFT_SIZE = 1024;
const BANDS = 32;

/** ~30fps. Faster than the eye needs and slower than the FFT hop, so nothing aliases. */
const FRAME_MS = 1000 / 30;

/** dB window mapped onto 0..1 — a quiet vineyard sits near the floor, a shout at the top. */
const DB_FLOOR = -70;
const DB_CEIL = -20;

/** ~300 samples at 30fps ≈ 10s of rolling history for the noise floor. */
const NOISE_WINDOW = 300;

/** Lowest frequency the log band-split and the centroid consider. */
const MIN_HZ = 40;

const LOUDNESS_ATTACK_TAU = 0.05;
const LOUDNESS_RELEASE_TAU = 0.28;
const BRIGHTNESS_TAU = 0.2;
const BAND_ATTACK_TAU = 0.03;
const BAND_RELEASE_TAU = 0.16;

/** Onset detector: the moving average it is measured against, and its own decay. */
const ONSET_AVERAGE_TAU = 0.6;
const ONSET_DECAY_TAU = 0.12;
/** Rise above the moving average that counts as a full-strength transient. */
const ONSET_SPAN = 0.22;
const ONSET_GATE = 0.05;

export interface AmbientSound {
  /** 0..1 smoothed RMS through a dB curve, noise-floor corrected. Read per frame. */
  loudness: MutableRefObject<number>;
  /** 0..1 spectral centroid — 0 is rumble, 1 is hiss. */
  brightness: MutableRefObject<number>;
  /** 32 log-spaced band magnitudes, 0..1. Same instance for the hook's lifetime. */
  spectrum: Float32Array;
  /** 0..1 onset strength; spikes on a sharp rise and decays in ~0.4s. */
  transient: MutableRefObject<number>;
  active: boolean;
  error: string | null;
  /** Must be called from a user gesture — both getUserMedia and AudioContext need one. */
  start: () => Promise<void>;
  stop: () => void;
}

function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function useAmbientSound(): AmbientSound {
  const loudness = useRef(0);
  const brightness = useRef(0.5);
  const transient = useRef(0);
  const spectrumRef = useRef(new Float32Array(BANDS));

  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);

  // These start empty and are sized once the sample rate is known. Their types are
  // left to inference so they keep whatever ArrayBuffer generic the installed
  // lib.dom expects for the AnalyserNode read methods.
  const timeData = useRef(new Float32Array(0));
  const freqData = useRef(new Float32Array(0));
  /** [startBin, endBin) per output band. */
  const bandEdges = useRef(new Int32Array(0));
  /** Log position 0..1 of every FFT bin, precomputed for the centroid. */
  const binPosition = useRef(new Float32Array(0));

  const noiseRing = useRef(new Float32Array(NOISE_WINDOW).fill(1));
  const noiseIndex = useRef(0);
  const noiseFilled = useRef(0);

  const onsetAverage = useRef(0);
  const lastSample = useRef(0);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    timeData.current = new Float32Array(0);
    freqData.current = new Float32Array(0);
    bandEdges.current = new Int32Array(0);
    binPosition.current = new Float32Array(0);
    noiseRing.current.fill(1);
    noiseIndex.current = 0;
    noiseFilled.current = 0;
    onsetAverage.current = 0;
    loudness.current = 0;
    brightness.current = 0.5;
    transient.current = 0;
    spectrumRef.current.fill(0);
    if (mounted.current) setActive(false);
  }, []);

  const sample = useCallback((now: number) => {
    const analyser = analyserRef.current;
    const time = timeData.current;
    const freq = freqData.current;
    const edges = bandEdges.current;
    const positions = binPosition.current;
    if (!analyser || !time.length || !freq.length || !edges.length || !positions.length) return;

    const dt = lastSample.current
      ? Math.min(0.5, (now - lastSample.current) / 1000)
      : FRAME_MS / 1000;
    lastSample.current = now;

    analyser.getFloatTimeDomainData(time);
    let sum = 0;
    for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
    const rms = Math.sqrt(sum / time.length);
    // -Infinity for digital silence, so the dB is floored before normalising.
    const db = rms > 0 ? 20 * Math.log10(rms) : DB_FLOOR;
    const raw = clamp01((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR));

    // Same reasoning as the camera: an outdoor site has a permanent bed of wind,
    // traffic and preamp hiss that would otherwise read as constant loudness.
    // The rolling minimum is the quietest the last ~10s got, which is the best
    // available estimate of "nothing is happening here".
    noiseRing.current[noiseIndex.current] = raw;
    noiseIndex.current = (noiseIndex.current + 1) % NOISE_WINDOW;
    noiseFilled.current = Math.min(NOISE_WINDOW, noiseFilled.current + 1);
    let floor = Infinity;
    for (let i = 0; i < noiseFilled.current; i++) {
      if (noiseRing.current[i] < floor) floor = noiseRing.current[i];
    }
    const corrected = clamp01((raw - floor) / Math.max(0.15, 1 - floor));

    // Fast attack, slow release: a clap should register on the frame it happens,
    // but the visual response should not strobe on every syllable.
    const tau = corrected > loudness.current ? LOUDNESS_ATTACK_TAU : LOUDNESS_RELEASE_TAU;
    loudness.current += (corrected - loudness.current) * coefficient(dt, tau);

    analyser.getFloatFrequencyData(freq);

    let weighted = 0;
    let magnitude = 0;
    for (let i = 1; i < freq.length; i++) {
      // getFloatFrequencyData is dBFS; back to linear so loud bins actually dominate.
      const m = freq[i] > -140 ? Math.pow(10, freq[i] / 20) : 0;
      magnitude += m;
      weighted += m * positions[i];
    }
    // The centroid is taken in log-frequency space. A linear-Hz centroid over a
    // 24 kHz analyser range parks every real-world sound between 0.02 and 0.08
    // and is useless as a control signal; hearing is logarithmic, so the octave
    // position across the analyser's range is both truer and actually usable.
    const centroid = magnitude > 1e-7 ? clamp01(weighted / magnitude) : 0.5;
    brightness.current += (centroid - brightness.current) * coefficient(dt, BRIGHTNESS_TAU);

    const bands = spectrumRef.current;
    const bandAttack = coefficient(dt, BAND_ATTACK_TAU);
    const bandRelease = coefficient(dt, BAND_RELEASE_TAU);
    for (let b = 0; b < BANDS; b++) {
      const from = edges[b];
      const to = edges[b + 1];
      let peak = -Infinity;
      for (let i = from; i < to; i++) if (freq[i] > peak) peak = freq[i];
      // Peak rather than mean per band: log-spaced bands get progressively wider,
      // and averaging would bury a narrow bird call under its own empty neighbours.
      const value =
        peak === -Infinity
          ? 0
          : clamp01((peak - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels));
      bands[b] += (value - bands[b]) * (value > bands[b] ? bandAttack : bandRelease);
    }

    // Onset = how far loudness has jumped above its own recent average. Comparing
    // against a moving average rather than a fixed threshold makes it work at any
    // ambient level: a door slam in a quiet field and a shout over a crowd both
    // read as transients.
    const excess = loudness.current - onsetAverage.current;
    onsetAverage.current +=
      (loudness.current - onsetAverage.current) * coefficient(dt, ONSET_AVERAGE_TAU);
    const decayed = transient.current * (1 - coefficient(dt, ONSET_DECAY_TAU));
    const spike = excess > ONSET_GATE ? clamp01((excess - ONSET_GATE) / ONSET_SPAN) : 0;
    transient.current = Math.max(decayed, spike);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setError('This browser has no microphone API.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      });
      if (!mounted.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;

      const context = new AudioContext();
      contextRef.current = context;
      // Autoplay policy leaves a fresh context suspended until a gesture resumes it.
      if (context.state === 'suspended') await context.resume();

      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      // The analyser's own smoothing is kept low; all temporal shaping here is
      // asymmetric and done by hand, and a symmetric IIR on top would smear onsets.
      analyser.smoothingTimeConstant = 0.4;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      // Deliberately not connected to the destination — this is a listener, and
      // routing a live outdoor microphone to the speakers would feed back.
      analyserRef.current = analyser;
      sourceRef.current = source;

      const bins = analyser.frequencyBinCount;
      timeData.current = new Float32Array(analyser.fftSize);
      freqData.current = new Float32Array(bins);

      const nyquist = context.sampleRate / 2;
      const binHz = nyquist / bins;
      const logMin = Math.log(MIN_HZ);
      const logSpan = Math.log(nyquist) - logMin;

      const positions = new Float32Array(bins);
      for (let i = 0; i < bins; i++) {
        const hz = Math.max(MIN_HZ, i * binHz);
        positions[i] = (Math.log(hz) - logMin) / logSpan;
      }
      binPosition.current = positions;

      const edges = new Int32Array(BANDS + 1);
      for (let b = 0; b <= BANDS; b++) {
        const hz = Math.exp(logMin + logSpan * (b / BANDS));
        edges[b] = Math.min(bins, Math.max(1, Math.round(hz / binHz)));
      }
      // Log spacing collapses the lowest bands onto the same bin; widen them so
      // every band owns at least one bin and none of the 32 outputs is dead.
      for (let b = 1; b <= BANDS; b++) {
        if (edges[b] <= edges[b - 1]) edges[b] = Math.min(bins, edges[b - 1] + 1);
      }
      bandEdges.current = edges;

      if (!mounted.current) {
        stop();
        return;
      }

      lastSample.current = 0;
      setError(null);
      setActive(true);

      let lastFrame = 0;
      const loop = (now: number) => {
        rafRef.current = requestAnimationFrame(loop);
        if (now - lastFrame < FRAME_MS) return;
        lastFrame = now;
        sample(now);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable.');
      stop();
    }
  }, [sample, stop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  return {
    loudness,
    brightness,
    spectrum: spectrumRef.current,
    transient,
    active,
    error,
    start,
    stop,
  };
}
