import { useEffect, useRef } from 'react';
import { soundField } from '../core/audio';
import { PALETTE, toRGB } from '../core/palette';

/**
 * A scrolling spectrogram of the sound actually leaving the speakers.
 *
 * This is the one figure in the piece that is a picture of the audio, and that
 * makes its honesty a live question. It is drawn from an AnalyserNode tapped off
 * the master bus *after* the limiter — so it is the finished signal, not a
 * second synthesis run rendered alongside the first, and not a stock image of a
 * bird call. When the field is silent the panel is empty, because there is
 * nothing to draw.
 *
 * It is not a recording of an animal. The survey ships detections, not audio:
 * every voice in this piece is synthesised from the species' own measured
 * parameters, and this is that synthesis seen rather than heard. The caption
 * beside it says so, and must keep saying so.
 *
 * Drawn on a 2D canvas rather than in the WebGL scene: it belongs to the panel,
 * it is small, and a second GL context for eighty columns of grey would cost
 * more than it returns.
 */

/**
 * How long a full width of the strip represents, in seconds.
 *
 * The scroll advances by elapsed time rather than by one column per frame. That
 * distinction is the difference between a spectrogram and a decoration: a
 * per-frame scroll makes the horizontal axis "frames", so the same call is drawn
 * wide on a fast machine and narrow on a slow one, and on a kiosk dropping to
 * 12 fps the strip nearly stops moving while the sound plays on. Advancing by
 * dt means an inch of strip is always the same number of seconds.
 */
const SPAN_SECONDS = 4;
/**
 * The drawn band, in hertz, on a logarithmic axis.
 *
 * Log rather than linear, for the same reason every published spectrogram of
 * animal sound is log: on a linear axis the bed of low sound under this piece
 * sits on top of the calls, and the whole strip collapses into one bright bar
 * across the bottom while the two octaves that carry a song get four pixels.
 * A log axis gives 100–200 Hz the same height as 4–8 kHz, which is how hearing
 * divides it up too.
 *
 * The bounds are fixed and stated in the caption rather than fitted to whatever
 * is playing. An axis that silently rescales per species would make two voices
 * look alike when they are an octave apart.
 */
const FLOOR_HZ = 80;
const CEILING_HZ = 12000;

/**
 * The two axes in words, for the caption beside the strip.
 *
 * A spectrogram with no stated scales is a texture. These are the only numbers
 * that let a visitor read height and width as anything, so they travel with the
 * component rather than being retyped wherever it is placed.
 */
export const SPECTROGRAM_AXES = `${FLOOR_HZ} Hz – ${CEILING_HZ / 1000} kHz · ${SPAN_SECONDS}s`;

export interface SpectrogramProps {
  /** Stops the render loop when the panel is not on screen. */
  active?: boolean;
  height?: number;
  className?: string;
}

export function Spectrogram({ active = true, height = 86, className }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    // Backing store at device resolution; the CSS box stays in layout pixels.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
    resize();

    // Explicitly backed by an ArrayBuffer: the DOM typings now distinguish that
    // from a SharedArrayBuffer, and getByteFrequencyData accepts only the former.
    let bins: Uint8Array<ArrayBuffer> | null = null;
    const [wr, wg, wb] = toRGB(PALETTE.candle);
    const [gr, gg, gb] = toRGB(PALETTE.gold);
    const [dr, dg, db] = toRGB(PALETTE.dusk);

    // Fractional pixels of scroll owed but not yet drawn. drawImage works in
    // whole pixels, so at 60 fps on a narrow strip the debt is what keeps the
    // scroll rate honest instead of rounding every frame up to 1 px.
    let owed = 0;
    let last = 0;

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const analyser = soundField.spectrum;
      if (!analyser) return;

      const width = canvas.width;
      const tall = canvas.height;
      // First frame after a resume: take one column, not the whole gap.
      const dt = last ? Math.min((now - last) / 1000, 0.25) : 1 / 60;
      last = now;
      owed += (width / SPAN_SECONDS) * dt;
      const step = Math.floor(owed);
      if (step < 1) return;
      owed -= step;

      // Scroll left by the elapsed span, then draw the newest slice at the right
      // edge. Cheaper and smoother than keeping a ring buffer of every past
      // column and repainting the lot each frame.
      context.globalCompositeOperation = 'copy';
      context.drawImage(canvas, -step, 0);
      context.globalCompositeOperation = 'source-over';
      context.clearRect(width - step, 0, step, tall);

      if (!bins || bins.length !== analyser.frequencyBinCount) {
        bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(bins);

      // Hertz per bin: bin n covers n * (sampleRate / fftSize).
      const nyquist = analyser.context.sampleRate / 2;
      const perBin = nyquist / bins.length;
      const ceiling = Math.min(CEILING_HZ, nyquist);
      const decades = Math.log2(ceiling / FLOOR_HZ);

      for (let y = 0; y < tall; y++) {
        // Low frequencies at the bottom, spaced by octave.
        const norm = 1 - y / tall;
        const hz = FLOOR_HZ * Math.pow(2, norm * decades);
        // The low octaves are narrower than one FFT bin, so several rows read
        // the same bin — a stair rather than a smooth ramp, which is honest:
        // a 2048-point window genuinely cannot resolve 80 Hz from 100 Hz.
        const bin = Math.min(bins.length - 1, Math.round(hz / perBin));
        const v = bins[bin] / 255;
        if (v <= 0.04) continue;

        // Cold at the noise floor, gold through the body of a call, near-white
        // at its peak — the same ramp the rest of the piece reads energy with.
        const t = Math.min(1, v * 1.15);
        const r = t < 0.5 ? dr + (gr - dr) * (t * 2) : gr + (wr - gr) * ((t - 0.5) * 2);
        const g = t < 0.5 ? dg + (gg - dg) * (t * 2) : gg + (wg - gg) * ((t - 0.5) * 2);
        const b = t < 0.5 ? db + (gb - db) * (t * 2) : gb + (wb - gb) * ((t - 0.5) * 2);
        context.fillStyle = `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0}, ${(
          0.15 +
          t * 0.85
        ).toFixed(3)})`;
        context.fillRect(width - step, y, step, 1);
      }

      // A hairline laid down under every column, silent or not. Without it an
      // empty strip is an empty rectangle and reads as a panel that failed to
      // load; with it, silence reads as a flat line — which is what silence
      // looks like, and is true.
      context.fillStyle = 'rgba(201, 162, 39, 0.16)';
      context.fillRect(width - step, tall - 1, step, 1);
    };

    rafRef.current = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height, display: 'block' }}
      aria-label="Spectrogram of the synthesised voice currently playing"
    />
  );
}
