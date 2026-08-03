import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { SensorState } from '../core/types';
import { useAmbientSound } from './useAmbientSound';
import { useMotionSensor } from './useMotionSensor';
import { useSerialSensors } from './useSerialSensors';

/**
 * The single bus every scene reads.
 *
 * Two hard rules shape this file:
 *
 * 1. The sensor state is a **ref, mutated in place each frame**. Scenes sample it
 *    from inside `useFrame` at 60fps; putting it in React state would re-render
 *    the entire tree sixty times a second and cost more than the rendering does.
 *    A separate, deliberately coarse React object exists for the UI readouts.
 * 2. There is always a signal. A gallery laptop with no permissions granted, a
 *    kiosk whose camera was unplugged overnight, a demo on a train — all of them
 *    must still show a living piece, so every missing channel is synthesised.
 */

/** Simulated clock speed: a full day every two minutes. */
const SIMULATED_DAY_SECONDS = 120;

/** How often the low-frequency React mirror is published, in ms. */
const READOUT_MS = 250;

/** Stillness hysteresis — see the accumulator below for why there are two limits. */
const STILL_ENTER = 0.12;
const STILL_BREAK = 0.3;

const DISTURBANCE_TAU = 0.35;
const SIM_TAU = 0.25;

/**
 * Length of one simulated visitor cycle, in seconds. Long enough that the quiet
 * tail (55% of it, ~25s) actually lets `stillnessSeconds` climb far enough for
 * the wildlife to return, so an unattended demo shows the whole mechanic.
 */
const VISITOR_CYCLE = 46;
const VISITOR_DUTY = 0.45;

export interface SensorReadout {
  presence: number;
  disturbance: number;
  stillnessSeconds: number;
  loudness: number;
  brightness: number;
  clockHour: number;
  temperature: number | null;
  wind: number | null;
  lux: number | null;
  sources: { camera: boolean; microphone: boolean; serial: boolean };
}

export interface SensorBus {
  /** Per-frame truth. Read `state.current` inside `useFrame`; never put it in state. */
  state: MutableRefObject<SensorState>;
  /** Which channels are genuinely live. Changes rarely, so plain React state. */
  sources: { camera: boolean; microphone: boolean; serial: boolean };
  /** Coarse mirror of the bus for HUD text — updated 4x/second, safe to render. */
  readout: SensorReadout;
  /** True when nothing real is driving the bus. */
  simulated: boolean;
  /** Web Serial exists in this browser. */
  serialSupported: boolean;
  errors: { camera: string | null; microphone: string | null; serial: string | null };
  enableCamera: () => Promise<void>;
  enableMicrophone: () => Promise<void>;
  enableSerial: () => Promise<void>;
  disableAll: () => void;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/**
 * Cheap smooth pseudo-noise in 0..1. Three sines on incommensurate periods never
 * repeat over an exhibition's run, and unlike real value noise it costs nothing
 * and is continuous in every derivative, which matters because these numbers
 * drive positions rather than colours.
 */
function drift(t: number, seed: number): number {
  return clamp01(
    0.5 +
      0.5 *
        (Math.sin(t * 0.37 + seed) * 0.5 +
          Math.sin(t * 0.91 + seed * 2.3) * 0.3 +
          Math.sin(t * 2.13 + seed * 4.1) * 0.2)
  );
}

/** Raised-cosine arrival envelope: visitors approach, linger, and leave. */
function visitorEnvelope(t: number): number {
  const phase = (t % VISITOR_CYCLE) / VISITOR_CYCLE;
  if (phase > VISITOR_DUTY) return 0;
  return 0.5 - 0.5 * Math.cos((phase / VISITOR_DUTY) * Math.PI * 2);
}

function realClockHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

export function useSensorBus({ simulate }: { simulate: boolean }): SensorBus {
  const camera = useMotionSensor();
  const microphone = useAmbientSound();
  const serial = useSerialSensors();

  const state = useRef<SensorState>({
    presence: 0,
    disturbance: 0,
    stillnessSeconds: 0,
    loudness: 0,
    brightness: 0.5,
    spectrum: new Float32Array(32),
    focus: { x: 0.5, y: 0.5 },
    clockHour: realClockHour(),
    temperature: null,
    wind: null,
    lux: null,
    sources: { camera: false, microphone: false, serial: false },
  });

  const [readout, setReadout] = useState<SensorReadout>(() => ({
    presence: 0,
    disturbance: 0,
    stillnessSeconds: 0,
    loudness: 0,
    brightness: 0.5,
    clockHour: state.current.clockHour,
    temperature: null,
    wind: null,
    lux: null,
    sources: { camera: false, microphone: false, serial: false },
  }));

  const rafRef = useRef(0);
  const lastFrame = useRef(0);
  const elapsed = useRef(0);
  const clockCheckedAt = useRef(-1);
  /** Simulated channels are smoothed through their own EMAs so switching sources never jumps. */
  const simMotion = useRef(0);
  const simPresence = useRef(0);
  const simLoudness = useRef(0);

  // The loop reads live-ness through a ref so that granting a permission does not
  // have to tear down and restart the animation frame loop.
  const live = useRef({ camera: false, microphone: false, serial: false, simulate });
  live.current = {
    camera: !simulate && camera.active,
    microphone: !simulate && microphone.active,
    serial: !simulate && serial.connected,
    simulate,
  };

  const sensors = useRef({ camera, microphone, serial });
  sensors.current = { camera, microphone, serial };

  useEffect(() => {
    lastFrame.current = 0;

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      // Clamp dt: a backgrounded tab returns with a multi-second gap that would
      // otherwise dump minutes of fake stillness into the accumulator at once.
      const dt = lastFrame.current ? Math.min(0.1, (now - lastFrame.current) / 1000) : 1 / 60;
      lastFrame.current = now;
      elapsed.current += dt;

      const t = elapsed.current;
      const s = state.current;
      const { camera: cam, microphone: mic, serial: ser } = sensors.current;
      const flags = live.current;

      const envelope = visitorEnvelope(t);
      const simK = coefficient(dt, SIM_TAU);

      /* -------------------------------------------------------- motion */
      const targetSimMotion = envelope * (0.25 + 0.55 * drift(t * 1.7, 1.3));
      simMotion.current += (targetSimMotion - simMotion.current) * simK;
      const motion = flags.camera ? cam.motion.current : simMotion.current;

      /* ------------------------------------------------------ presence */
      // Presence trails the envelope: simulated visitors are "there" a little
      // before and well after they are loud, exactly like the camera's release.
      const targetSimPresence = envelope > 0.02 ? Math.min(1, envelope * 1.6) : 0;
      simPresence.current +=
        (targetSimPresence - simPresence.current) *
        coefficient(dt, targetSimPresence > simPresence.current ? 0.4 : 2.6);
      s.presence = flags.camera ? cam.presence.current : simPresence.current;

      /* ---------------------------------------------------------- sound */
      // A synthetic field never falls fully silent — there is always some wind in
      // the vines — but it stays well under the stillness threshold.
      const targetSimLoudness = 0.03 + drift(t * 0.6, 5.1) * 0.05 + envelope * 0.45;
      simLoudness.current += (targetSimLoudness - simLoudness.current) * simK;
      s.loudness = flags.microphone ? mic.loudness.current : simLoudness.current;
      s.brightness = flags.microphone
        ? mic.brightness.current
        : 0.32 + drift(t * 0.4, 9.7) * 0.3 + s.loudness * 0.2;

      // Transients are what make a simulated crowd feel like people rather than a
      // sine: a few sharp events scattered through each visit.
      const simTransient =
        envelope > 0.15 ? Math.max(0, Math.sin(t * 5.3 + Math.sin(t * 1.9) * 3) - 0.86) * 7 : 0;
      const transient = flags.microphone ? mic.transient.current : clamp01(simTransient);

      const bands = s.spectrum;
      if (flags.microphone) {
        bands.set(mic.spectrum);
      } else {
        // A plausible ambient spectrum: energy sloping off with frequency, tilted
        // upward by brightness, so spectrum-driven geometry still breathes.
        for (let b = 0; b < bands.length; b++) {
          const f = b / (bands.length - 1);
          const tilt = 1 - Math.abs(f - s.brightness) * 1.4;
          const value = clamp01(tilt) * (0.25 + s.loudness) * drift(t * 2 + b * 0.7, b);
          bands[b] += (clamp01(value) - bands[b]) * simK;
        }
      }

      /* ---------------------------------------------------- disturbance */
      const raw = clamp01(motion * 0.65 + s.loudness * 0.5 + transient * 0.3);
      s.disturbance += (raw - s.disturbance) * coefficient(dt, DISTURBANCE_TAU);

      // The piece's central mechanic. Two thresholds rather than one: stillness
      // only accumulates below 0.12 and is only destroyed above 0.3, so the band
      // between them is a hold. Without that gap a visitor breathing at the edge
      // of the threshold would flicker the whole ecology in and out.
      if (s.disturbance > STILL_BREAK) s.stillnessSeconds = 0;
      else if (s.disturbance < STILL_ENTER) s.stillnessSeconds += dt;

      /* ---------------------------------------------------------- focus */
      if (flags.camera) {
        s.focus.x = cam.centroid.current.x;
        s.focus.y = cam.centroid.current.y;
      } else {
        // Lissajous with irrational-ish frequency ratio: the path never closes,
        // so the attention point wanders indefinitely without visible looping.
        const target = {
          x: 0.5 + 0.3 * Math.sin(t * 0.17),
          y: 0.5 + 0.22 * Math.sin(t * 0.241 + 1.1),
        };
        const k = coefficient(dt, 0.6);
        s.focus.x += (target.x - s.focus.x) * k;
        s.focus.y += (target.y - s.focus.y) * k;
      }

      /* ---------------------------------------------------------- clock */
      if (flags.simulate) {
        // A full diurnal cycle every two minutes, so the piece demonstrates dawn,
        // noon and the nocturnal chorus without an audience waiting a day for it.
        s.clockHour = ((t / SIMULATED_DAY_SECONDS) * 24) % 24;
      } else if (t - clockCheckedAt.current > 0.5) {
        // The wall clock is re-read twice a second and advanced by dt in between:
        // allocating a Date every frame for weeks of uptime is pure GC churn.
        clockCheckedAt.current = t;
        s.clockHour = realClockHour();
      } else {
        s.clockHour = (s.clockHour + dt / 3600) % 24;
      }

      /* -------------------------------------------------------- weather */
      if (flags.serial) {
        s.temperature = ser.temperature.current;
        s.wind = ser.wind.current;
        s.lux = ser.lux.current;
      } else if (flags.simulate) {
        // Only invented when explicitly simulating. On a real site with no serial
        // board these stay null, because a fabricated temperature on a wall label
        // would be a lie rather than a fallback.
        const day = Math.cos(((s.clockHour - 15) / 24) * Math.PI * 2);
        s.temperature = 14 + day * 8 + drift(t * 0.2, 2.2) * 2;
        s.wind = 0.4 + drift(t * 0.35, 7.7) * 4.2;
        s.lux = Math.max(0, Math.cos(((s.clockHour - 13) / 24) * Math.PI * 2)) ** 2 * 42000;
      } else {
        s.temperature = null;
        s.wind = null;
        s.lux = null;
      }

      s.sources.camera = flags.camera;
      s.sources.microphone = flags.microphone;
      s.sources.serial = flags.serial;
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    const publish = () => {
      const s = state.current;
      setReadout({
        presence: s.presence,
        disturbance: s.disturbance,
        stillnessSeconds: s.stillnessSeconds,
        loudness: s.loudness,
        brightness: s.brightness,
        clockHour: s.clockHour,
        temperature: s.temperature,
        wind: s.wind,
        lux: s.lux,
        sources: { ...s.sources },
      });
    };
    publish();
    const timer = window.setInterval(publish, READOUT_MS);
    return () => window.clearInterval(timer);
  }, []);

  const disableAll = useCallback(() => {
    camera.stop();
    microphone.stop();
    void serial.disconnect();
  }, [camera, microphone, serial]);

  const sources = useMemo(
    () => ({
      camera: !simulate && camera.active,
      microphone: !simulate && microphone.active,
      serial: !simulate && serial.connected,
    }),
    [camera.active, microphone.active, serial.connected, simulate]
  );

  const errors = useMemo(
    () => ({ camera: camera.error, microphone: microphone.error, serial: serial.error }),
    [camera.error, microphone.error, serial.error]
  );

  return {
    state,
    sources,
    readout,
    simulated: simulate || (!sources.camera && !sources.microphone),
    serialSupported: serial.supported,
    errors,
    enableCamera: camera.start,
    enableMicrophone: microphone.start,
    enableSerial: serial.connect,
    disableAll,
  };
}
