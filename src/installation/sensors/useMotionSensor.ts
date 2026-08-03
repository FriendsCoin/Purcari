import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/**
 * Camera motion sensing for the outdoor piece.
 *
 * The camera is never shown and no frame ever leaves the machine — it is read at
 * 96x72 into an offscreen canvas purely to derive three scalars. That resolution
 * is deliberate: it is below the threshold at which a face is recoverable, it
 * costs nothing per frame, and 8x8 blocks of it still resolve a person at 6 m.
 *
 * All continuous outputs are refs, not React state: scenes sample them inside
 * `useFrame` at 60fps and a `setState` per frame would re-render the whole tree.
 */

/** Analysis raster. Small enough to be free, large enough to localise a body. */
const W = 96;
const H = 72;

/** Occupancy grid over the raster — 8x8 pixel blocks. */
const BLOCK = 8;
const COLS = W / BLOCK;
const ROWS = H / BLOCK;

/** ~15fps. Motion energy is a low-frequency signal; 60fps only adds sensor noise. */
const FRAME_MS = 1000 / 15;

/**
 * Mean absolute luma difference that counts as "fully in motion". A person
 * crossing the frame lands around 0.03-0.06 in normalised luma, so the span is
 * set just above that rather than at 1.0, which would keep `motion` near zero.
 */
const MOTION_SPAN = 0.05;

/** Per-block mean difference above which a block counts as occupied. */
const BLOCK_THRESHOLD = 0.035;

/** ~200 samples at 15fps ≈ 13s of rolling history for the noise floor. */
const NOISE_WINDOW = 200;

/**
 * Asymmetric time constants, in seconds. Presence rises quickly so the piece
 * answers immediately, and falls over ~8s (3 time constants) so a visitor who
 * stops moving to watch is still counted as present rather than blinking out.
 */
const PRESENCE_ATTACK_TAU = 0.25;
const PRESENCE_RELEASE_TAU = 2.6;
const CENTROID_TAU = 0.35;

export interface Vec2 {
  x: number;
  y: number;
}

export interface MotionSensor {
  /** 0..1 normalised frame difference, noise-floor corrected. Read per frame. */
  motion: MutableRefObject<number>;
  /** 0..1 smoothed occupancy — holds for ~8s after a visitor goes still. */
  presence: MutableRefObject<number>;
  /** Difference-weighted centre of motion in 0..1 screen space; {0.5,0.5} when still. */
  centroid: MutableRefObject<Vec2>;
  /** True while a camera stream is live. */
  active: boolean;
  /** Human-readable failure reason; never thrown. */
  error: string | null;
  /** Must be called from a user gesture — browsers gate getUserMedia on one. */
  start: () => Promise<void>;
  stop: () => void;
}

/** Exponential smoothing coefficient for a given time constant, framerate independent. */
function coefficient(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function useMotionSensor(): MotionSensor {
  const motion = useRef(0);
  const presence = useRef(0);
  const centroid = useRef<Vec2>({ x: 0.5, y: 0.5 });

  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  const prevLuma = useRef<Float32Array | null>(null);
  const blocks = useRef(new Float32Array(COLS * ROWS));

  /** Ring of raw difference samples; its running minimum is the sensor noise floor. */
  const noiseRing = useRef(new Float32Array(NOISE_WINDOW).fill(1));
  const noiseIndex = useRef(0);
  const noiseFilled = useRef(0);

  const lastSample = useRef(0);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    }
    videoRef.current = null;
    canvasRef.current = null;
    ctxRef.current = null;
    prevLuma.current = null;
    noiseRing.current.fill(1);
    noiseIndex.current = 0;
    noiseFilled.current = 0;
    motion.current = 0;
    presence.current = 0;
    centroid.current = { x: 0.5, y: 0.5 };
    if (mounted.current) setActive(false);
  }, []);

  const sample = useCallback((now: number) => {
    const video = videoRef.current;
    const ctx = ctxRef.current;
    if (!video || !ctx || video.readyState < 2) return;

    const dt = lastSample.current
      ? Math.min(0.5, (now - lastSample.current) / 1000)
      : FRAME_MS / 1000;
    lastSample.current = now;

    ctx.drawImage(video, 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H).data;

    let luma = prevLuma.current;
    if (!luma) {
      luma = new Float32Array(W * H);
      prevLuma.current = luma;
      for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
        luma[i] = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255;
      }
      return; // No previous frame to difference against yet.
    }

    const grid = blocks.current;
    grid.fill(0);

    let total = 0;
    let weightX = 0;
    let weightY = 0;
    let weight = 0;

    for (let y = 0; y < H; y++) {
      const blockRow = (y / BLOCK) | 0;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const p = i * 4;
        const current = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255;
        const diff = Math.abs(current - luma[i]);
        luma[i] = current;
        total += diff;
        grid[blockRow * COLS + ((x / BLOCK) | 0)] += diff;
        // Weighting the centroid by the difference itself, not by a binary mask,
        // keeps it stable: a wall of low-level sensor noise contributes almost
        // nothing next to a single genuinely moving limb.
        weight += diff;
        weightX += diff * x;
        weightY += diff * y;
      }
    }

    const raw = total / (W * H);

    // Rolling noise floor. Every camera has a per-pixel noise carpet that scales
    // with gain, so an outdoor sensor at dusk reads a permanent non-zero
    // difference. Subtracting the recent minimum re-zeroes the signal whenever
    // the scene has been empty for a few seconds, which is what "static camera
    // reads ~0" actually requires — a fixed threshold would drift all night.
    noiseRing.current[noiseIndex.current] = raw;
    noiseIndex.current = (noiseIndex.current + 1) % NOISE_WINDOW;
    noiseFilled.current = Math.min(NOISE_WINDOW, noiseFilled.current + 1);
    let floor = Infinity;
    for (let i = 0; i < noiseFilled.current; i++) {
      if (noiseRing.current[i] < floor) floor = noiseRing.current[i];
    }

    motion.current = clamp01((raw - floor) / MOTION_SPAN);

    const blockPixels = BLOCK * BLOCK;
    let occupied = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] / blockPixels - floor > BLOCK_THRESHOLD) occupied++;
    }
    // Square-root response: apparent area falls off with the square of distance,
    // so a linear reading would say a visitor at 6 m is a third as present as the
    // same visitor at 2 m. They are equally present; only the pixels disagree.
    const occupancy = clamp01(Math.sqrt(occupied / grid.length) * 1.9);

    const target = occupancy > presence.current ? PRESENCE_ATTACK_TAU : PRESENCE_RELEASE_TAU;
    presence.current += (occupancy - presence.current) * coefficient(dt, target);

    // Below this the centroid is being computed from noise alone, so it snaps to
    // centre rather than wandering the frame and dragging the scene with it.
    const meaningful = weight > (floor + 0.004) * W * H;
    const cx = meaningful ? weightX / weight / (W - 1) : 0.5;
    const cy = meaningful ? weightY / weight / (H - 1) : 0.5;
    const k = coefficient(dt, CENTROID_TAU);
    centroid.current = {
      x: centroid.current.x + (cx - centroid.current.x) * k,
      y: centroid.current.y + (cy - centroid.current.y) * k,
    };
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser has no camera API.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'environment' },
      });
      if (!mounted.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      // getImageData every frame is the whole point of this canvas, so opt out of
      // GPU-backed storage and keep the readback off the synchronisation path.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        stop();
        setError('Could not open a 2D context for motion analysis.');
        return;
      }
      canvasRef.current = canvas;
      ctxRef.current = ctx;

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
      // Permission denial is an expected outcome in a public installation, not a
      // crash: the bus simply falls back to synthesised motion.
      setError(err instanceof Error ? err.message : 'Camera unavailable.');
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

  return { motion, presence, centroid, active, error, start, stop };
}
