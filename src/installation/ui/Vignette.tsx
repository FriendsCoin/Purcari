import { useEffect, useRef } from 'react';
import { PALETTE, toRGB } from '../core/palette';
import plates from './vignettes.json';
import type { VignetteKind } from './vignetteData';

/**
 * A small moving diagram, drawn in the piece's own marks.
 *
 * Three things in this installation are asserted and never shown: that the
 * mammals came from cameras, that the birds came from microphones, and what a
 * practice like drip irrigation actually does to a vine. Each is one sentence
 * of caption doing work a picture does better — so each gets a vignette, played
 * where the visitor asks the question.
 *
 * The shape comes from a generated still, sampled into ~700 marks at build time
 * (`scripts/build_vignettes.py`). The *motion* is procedural and lives here: a
 * camera trap fires, sound spreads in rings, water descends to the roots. That
 * split is deliberate. A generated video would be megabytes in a 1.4 MB offline
 * build, would need a codec this kiosk may not have, and — being shaded footage
 * — would read as a different work pasted over this one. A cloud of marks that
 * moves is the same thing said in the language everything else here speaks.
 *
 * These are diagrams, not records, and the caption beside them says so: no
 * frame here is a photograph of this estate or of an animal recorded on it.
 */

export interface VignetteProps {
  kind: VignetteKind;
  /** Stops the loop when the vignette is off screen. */
  active?: boolean;
  height?: number;
  className?: string;
}

/** One loop of each diagram's motion, in seconds. */
const PERIOD: Record<string, number> = { camera: 4.6, sound: 3.8, drip: 5.2 };

export function Vignette({ kind, active = true, height = 152, className }: VignetteProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  /**
   * Time carried across kind changes rather than reset, so switching the lens
   * cross-fades one diagram into the next instead of restarting the clock.
   */
  const clockRef = useRef(0);
  const kindRef = useRef(kind);
  /** 0..1 fade of the outgoing plate while a new kind takes over. */
  const swapRef = useRef(1);

  useEffect(() => {
    kindRef.current = kind;
    swapRef.current = 0;
  }, [kind]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();

    const [gr, gg, gb] = toRGB(PALETTE.gold);
    const [wr, wg, wb] = toRGB(PALETTE.candle);
    let last = 0;

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0.016;
      last = now;
      clockRef.current += dt;
      swapRef.current = Math.min(1, swapRef.current + dt * 2.2);

      const width = canvas.width;
      const tall = canvas.height;
      context.clearRect(0, 0, width, tall);

      const cloud = plates.plates[kindRef.current] as number[];
      if (!cloud) return;
      const t = clockRef.current;
      const period = PERIOD[kindRef.current] ?? 4;
      // 0..1 through this diagram's own loop.
      const cycle = (t % period) / period;

      // Each plate carries its own shape, so the drawing is letterboxed into
      // the panel rather than squeezed to it: a wide deer-over-ground and a
      // tall mic-on-a-post both fill their box without being stretched.
      const ratio = (plates.aspects as Record<string, number>)[kindRef.current] ?? 1;
      const boxW = Math.min(width, tall * ratio);
      const boxH = boxW / ratio;
      const ox = (width - boxW) / 2;
      const oy = (tall - boxH) / 2;
      const dot = Math.max(1.4, Math.min(boxW, boxH) * 0.02);

      for (let i = 0; i < cloud.length; i += 3) {
        const px = cloud[i] / 255;
        const py = cloud[i + 1] / 255;
        const bright = cloud[i + 2] / 255;
        // A stable per-mark seed, so a mark's drift and its place in the
        // travelling wave are its own and do not shimmer frame to frame.
        const seed = (i * 0.6180339887) % 1;

        let energy = bright;
        let dx = 0;
        let dy = 0;

        if (kindRef.current === 'camera') {
          // The trap fires: a hard flash near the start of the loop, then a
          // long dark wait — which is what a camera trap's night actually is.
          const flash = Math.exp(-Math.pow((cycle - 0.12) * 9, 2));
          const settle = 1 - Math.exp(-cycle * 6);
          energy *= 0.24 + settle * 0.5 + flash * 1.5;
          // Marks kick outward from the centre on the flash.
          dx = (px - 0.5) * flash * 0.05;
          dy = (py - 0.5) * flash * 0.05;
        } else if (kindRef.current === 'sound') {
          // The instrument itself only pulses; the rings it sends out are drawn
          // separately below. Modulating the plate's own marks was the first
          // attempt and it showed nothing: the generated rings sit under any
          // usable sampling floor, so there were no marks out at radius for a
          // ring to travel through. A diagram may draw its own diagram.
          energy *= 0.55 + 0.45 * Math.max(0, Math.sin(cycle * Math.PI * 2));
        } else {
          // Water travelling down: a band descending the plate, brightest at
          // the roots where it arrives.
          const band = Math.exp(-Math.pow((py - (cycle * 1.5 - 0.2)) * 5.5, 2));
          const roots = py > 0.62 ? 0.35 : 0;
          energy *= 0.34 + band * 1.3 + roots * Math.max(0, Math.sin(cycle * Math.PI * 2));
          dy = band * 0.006;
        }

        // A slow living drift on every mark, so the diagram breathes rather
        // than sitting still between beats.
        dx += Math.sin(t * 0.5 + seed * 31.4) * 0.0025;
        dy += Math.cos(t * 0.43 + seed * 17.7) * 0.0025;

        const a = Math.min(1, energy) * swapRef.current;
        if (a <= 0.02) continue;
        // Gold through the body of the drawing, near-white at its peaks — the
        // same ramp the rest of the piece reads energy with.
        const k = Math.min(1, energy);
        const r = gr + (wr - gr) * k;
        const g = gg + (wg - gg) * k;
        const b = gb + (wb - gb) * k;
        context.fillStyle = `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0}, ${a.toFixed(3)})`;
        context.fillRect(
          ox + (px + dx) * boxW - dot / 2,
          oy + (py + dy) * boxH - dot / 2,
          dot,
          dot,
        );
      }

      if (kindRef.current === 'sound') {
        // Three rings leaving the microphone, each a third of a loop behind the
        // last, fading as they widen — sound going out and not coming back.
        const cx = ox + boxW * 0.5;
        const cy = oy + boxH * 0.34;
        for (let r = 0; r < 3; r++) {
          const phase = (cycle + r / 3) % 1;
          const radius = phase * boxH * 0.62;
          const a = (1 - phase) * 0.5 * swapRef.current;
          if (a <= 0.02 || radius < 2) continue;
          context.strokeStyle = `rgba(${(gr * 255) | 0}, ${(gg * 255) | 0}, ${(gb * 255) | 0}, ${a.toFixed(3)})`;
          context.lineWidth = Math.max(1, dot * 0.5);
          context.beginPath();
          context.arc(cx, cy, radius, 0, Math.PI * 2);
          context.stroke();
        }
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
      aria-hidden="true"
    />
  );
}
