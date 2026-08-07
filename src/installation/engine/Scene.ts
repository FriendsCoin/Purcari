import type { PerspectiveCamera, Scene, Vector3 } from 'three';
import type { Pointer } from './Pointer';

export type ChapterId =
  | 'chorus'
  | 'terroir'
  | 'circadian'
  | 'species'
  | 'flux'
  | 'overlap'
  | 'passages'
  | 'tail'
  | 'status';

/** What the WebGL layer wants the DOM overlay to display right now. */
export interface Readout {
  /** Small letterspaced label above the title. */
  eyebrow?: string;
  /** Large display-type line. */
  title?: string;
  /** Supporting sentence. */
  body?: string;
  /** Label/value pairs rendered as a compact table. */
  stats?: { label: string; value: string }[];
  /** 24 normalised values, drawn as an activity sparkline. */
  spark?: number[];
  /** Accent colour, as CSS. */
  accent?: string;
  /**
   * Where the overlay should anchor a pointer line, in 0..1 screen coordinates
   * with y down. Set when a chapter has a selected object on screen.
   */
  marker?: { x: number; y: number };
  /**
   * Provenance for the chapter currently on screen. Chapters drawn from a
   * different survey than the acoustic default set these so the masthead and
   * footer never label a chapter with the wrong dates or the wrong source.
   */
  period?: string;
  source?: string;
  /** Replaces the guild legend when a chapter colours by something else. */
  legend?: { label: string; color: string }[];
  /**
   * Map scale bar: a round number of metres, and the fraction of the viewport
   * width it spans. Set by chapters that show real ground.
   */
  scale?: { metres: number; fraction: number };
  /**
   * Labelled ticks along the top edge, positioned in 0..1 of the viewport width.
   * Set by chapters whose horizontal axis carries a unit a visitor has to be
   * able to name — the eighty-night wall is unreadable without knowing where
   * midnight is. Positions are recomputed every frame, so they track the camera.
   */
  axis?: { label: string; x: number }[];
}

export interface FrameContext {
  /** Seconds since the previous frame, clamped so a stall cannot slingshot motion. */
  delta: number;
  /** Seconds since the scene was entered. */
  elapsed: number;
  /** Seconds since the engine started. */
  time: number;
  pointer: Pointer;
  width: number;
  height: number;
  /** Portrait panels get different framing than landscape ones. */
  aspect: number;
  /**
   * Height of the actual framebuffer in device pixels, after the pixel ratio and
   * the quality governor. Point sizes are derived from this so a sprite covers
   * the same fraction of the screen on a 1080p panel and a 4K one.
   */
  pixelHeight: number;
  /** 0 while the visitor is interacting, easing to 1 after the idle threshold. */
  idle: number;
  /** Rendering quality, 0.5 (struggling) to 1 (comfortable). */
  quality: number;
}

/**
 * A chapter of the installation. Each owns its scene graph and camera so the
 * engine can render two of them at once during a dissolve.
 */
export interface Chapter {
  readonly id: ChapterId;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;

  /** Plane that touches are projected onto, as (normal, constant). */
  readonly interactionPlane: { normal: Vector3; constant: number };

  /** Look overrides handed to the post chain while this chapter is on screen. */
  readonly look?: { exposure?: number; bloom?: number; grain?: number; aberration?: number; vignette?: number };

  enter(): void;
  exit(): void;
  resize(width: number, height: number): void;
  update(ctx: FrameContext): void;

  /** Current overlay content. Polled once per frame; return the same object when nothing changed. */
  readout(): Readout;

  dispose(): void;
}
