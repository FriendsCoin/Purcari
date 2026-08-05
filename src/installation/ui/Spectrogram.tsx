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

/** Columns kept on screen. At ~60 fps this is about four seconds of sound. */
const COLUMNS = 240;
/**
 * Top of the drawn band, as a fraction of Nyquist. Above ~11 kHz there is
 * nothing in these voices but the reverb's own hiss, and including it wastes
 * two-thirds of the height on an empty grey field.
 */
const CEILING = 0.5;

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

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const analyser = soundField.spectrum;
      if (!analyser) return;

      const width = canvas.width;
      const tall = canvas.height;
      const step = Math.max(1, Math.round(width / COLUMNS));

      // Scroll left by one column, then draw the newest slice at the right edge.
      // Cheaper and smoother than keeping a ring buffer of every past column and
      // repainting the lot each frame.
      context.globalCompositeOperation = 'copy';
      context.drawImage(canvas, -step, 0);
      context.globalCompositeOperation = 'source-over';
      context.clearRect(width - step, 0, step, tall);

      if (!bins || bins.length !== analyser.frequencyBinCount) {
        bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(bins);

      const used = Math.max(1, Math.floor(bins.length * CEILING));
      for (let y = 0; y < tall; y++) {
        // Low frequencies at the bottom, and on a square-root axis: linear bins
        // put every voice in this piece into the bottom fifth of the panel.
        const norm = 1 - y / tall;
        const bin = Math.min(used - 1, Math.floor(norm * norm * used));
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
