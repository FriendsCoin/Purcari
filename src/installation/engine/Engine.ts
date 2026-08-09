import { WebGLRenderer } from 'three';
import { Ambience } from './Ambience';
import { Pointer } from './Pointer';
import { PostFX } from './PostFX';
import type { Chapter, ChapterId, FrameContext, Readout } from './Scene';

/** Seconds a chapter dissolve takes. */
const TRANSITION_DURATION = 1.4;

/** No touch for this long and the piece returns to the attract chapter. */
const IDLE_TIMEOUT = 75;

/**
 * The attract tour. An untouched panel is not a paused one: after the idle
 * return it holds the prologue for a while, then walks the chapters on its own,
 * in order, around and around — the piece becomes a film until somebody touches
 * it, at which point the tour stops mid-step and the chapter they landed on is
 * theirs.
 */
const TOUR_HOLD = 50;
const TOUR_STEP = 36;

/** A frame longer than this is treated as a stall, not as slow motion. */
const MAX_DELTA = 1 / 20;

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Called once per frame with whatever the active chapter wants shown. */
  onReadout?: (readout: Readout, chapter: ChapterId) => void;
  /** Called when the idle timer returns the piece to the attract chapter. */
  onIdleReturn?: () => void;
  onChapterChange?: (chapter: ChapterId) => void;
}

/**
 * Owns the renderer, the frame loop, the chapter stack and the quality governor.
 *
 * The piece runs unattended for a full day at a time, so the loop is defensive:
 * deltas are clamped, resolution backs off under load, and the whole thing parks
 * itself on the attract chapter when nobody has touched it in a while.
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly pointer: Pointer;
  readonly post: PostFX;
  readonly ambience = new Ambience();

  private readonly chapters = new Map<ChapterId, Chapter>();
  private readonly options: EngineOptions;

  private active: Chapter | null = null;
  private outgoing: Chapter | null = null;
  private transition = 0;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private basePixelRatio = 1;

  private time = 0;
  private chapterElapsed = 0;
  private lastFrame = 0;
  private rafId = 0;
  private running = false;
  private fade = 0;

  /** Rolling average frame cost in ms, used by the quality governor. */
  private frameCost = 16.7;
  private quality = 1;
  private qualityCooldown = 0;

  private homeChapter: ChapterId = 'chorus';
  private disposed = false;

  /** Seconds into the current stop of the attract tour; see TOUR_HOLD. */
  private tourClock = 0;
  /** 0 idle-not-reached, 1 parked home, 2 walking the chapters. */
  private tourStage = 0;

  constructor(options: EngineOptions) {
    this.options = options;

    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: false, // Resolved in post instead; MSAA on a half-float target is not worth the bandwidth.
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    // three resets its render stats at the start of every render() call, and a
    // frame here is a dozen of them. Resetting once per frame instead is what
    // makes the draw-call figure in the commissioning panel the frame's total
    // rather than the cost of the last full-screen blit.
    this.renderer.info.autoReset = false;

    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = this.basePixelRatio;

    this.post = new PostFX(this.renderer);
    this.pointer = new Pointer(options.canvas);

    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.handleResize();
  }

  register(chapter: Chapter): void {
    this.chapters.set(chapter.id, chapter);
    chapter.resize(this.width, this.height);
  }

  setHome(id: ChapterId): void {
    this.homeChapter = id;
  }

  get activeChapter(): ChapterId | null {
    return this.active?.id ?? null;
  }

  get isTransitioning(): boolean {
    return this.outgoing !== null;
  }

  goTo(id: ChapterId, immediate = false): void {
    const next = this.chapters.get(id);
    if (!next || next === this.active) return;

    // Interrupting a dissolve: the half-faded chapter is dropped rather than
    // queued, so rapid taps on the nav always land on the last one pressed.
    // The one exception is tapping back to the chapter currently fading out —
    // it becomes the incoming one again instead of being torn down and rebuilt.
    if (this.outgoing && this.outgoing !== next) this.outgoing.exit();

    const previous = this.active;
    this.outgoing = null;
    if (immediate || !previous) {
      previous?.exit();
      this.transition = 0;
    } else {
      this.outgoing = previous;
      this.transition = 1;
    }

    this.active = next;
    this.chapterElapsed = 0;
    next.enter();
    this.applyLook(next);
    this.options.onChapterChange?.(id);
  }

  /** Hands a configuration choice to whichever chapter is on screen. */
  setMode(id: string): void {
    this.active?.setMode?.(id);
  }

  private applyLook(chapter: Chapter): void {
    this.post.setLook({
      exposure: 1.0,
      bloom: 0.85,
      grain: 0.022,
      aberration: 1.0,
      vignette: 1.0,
      trail: 0,
      ...chapter.look,
    });
    // A chapter never wears its predecessor's wake.
    this.post.clearTrail();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private handleVisibility = (): void => {
    // Coming back from a screensaver or a kiosk lock should not replay hours of
    // accumulated time in one frame.
    if (document.hidden) {
      this.stop();
    } else if (!this.disposed) {
      this.lastFrame = performance.now();
      this.start();
    }
  };

  private handleResize = (): void => {
    const canvas = this.renderer.domElement;
    this.width = canvas.clientWidth || window.innerWidth;
    this.height = canvas.clientHeight || window.innerHeight;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.applyResolution();
    for (const chapter of this.chapters.values()) chapter.resize(this.width, this.height);
  };

  private applyResolution(): void {
    this.pixelRatio = this.basePixelRatio * this.quality;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.post.setSize(this.width, this.height, this.pixelRatio);
  }

  /**
   * Trades resolution for framerate. Cheap panels and hot afternoons both show up
   * as a rising frame cost; dropping to 0.7x render scale is far less visible
   * than dropped frames on slow camera moves.
   */
  private governQuality(delta: number, frameMs: number): void {
    this.frameCost += (frameMs - this.frameCost) * 0.05;
    this.qualityCooldown -= delta;
    if (this.qualityCooldown > 0) return;

    if (this.frameCost > 22 && this.quality > 0.55) {
      this.quality = Math.max(0.55, this.quality - 0.15);
      this.qualityCooldown = 2.5;
      this.applyResolution();
    } else if (this.frameCost < 12 && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.1);
      this.qualityCooldown = 5;
      this.applyResolution();
    }
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    this.renderer.info.reset();

    const rawDelta = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const delta = Math.min(Math.max(rawDelta, 1e-4), MAX_DELTA);
    // Chapter dissolves run on wall-clock time, not on the clamped simulation
    // step. Clamping protects the motion from a stall; applying it to the
    // transition instead stretches a 1.4 s crossfade into twenty seconds on a
    // machine rendering at two frames a second, which is exactly the machine
    // that can least afford to be drawing two chapters at once.
    const wallDelta = Math.min(Math.max(rawDelta, 1e-4), 1);

    this.time += delta;
    this.chapterElapsed += delta;
    this.fade = Math.min(1, this.fade + delta * 0.55);

    const chapter = this.active;
    if (!chapter) return;

    this.pointer.setInteractionPlane(chapter.interactionPlane.normal, chapter.interactionPlane.constant);
    this.pointer.update(delta, chapter.camera);

    // Idle ramps in over 6 s past the threshold so the attract state arrives as a
    // drift, not a cut.
    const idleRaw = (this.pointer.idleTime - IDLE_TIMEOUT * 0.35) / 6;
    const idle = Math.min(1, Math.max(0, idleRaw));

    const ctx: FrameContext = {
      delta,
      elapsed: this.chapterElapsed,
      time: this.time,
      pointer: this.pointer,
      width: this.width,
      height: this.height,
      aspect: this.width / Math.max(1, this.height),
      pixelHeight: this.height * this.pixelRatio,
      idle,
      quality: this.quality,
    };

    if (this.pointer.idleTime <= IDLE_TIMEOUT) {
      this.tourClock = 0;
      this.tourStage = 0;
    } else if (!this.isTransitioning) {
      this.tourClock += delta;
      if (this.tourStage === 0) {
        // First act of the tour: come home to the attract chapter.
        if (chapter.id !== this.homeChapter) {
          this.goTo(this.homeChapter);
          this.options.onIdleReturn?.();
        }
        this.tourStage = 1;
        this.tourClock = 0;
      } else if (this.tourClock >= (this.tourStage === 1 ? TOUR_HOLD : TOUR_STEP)) {
        // Then walk: every chapter in order, prologue included, forever.
        const order = [...this.chapters.keys()];
        const next = order[(order.indexOf(chapter.id) + 1) % order.length];
        this.goTo(next);
        this.tourStage = 2;
        this.tourClock = 0;
      }
    }

    chapter.update(ctx);
    this.post.renderScene(chapter.scene, chapter.camera, this.post.sceneTarget);

    if (this.outgoing) {
      this.transition -= wallDelta / TRANSITION_DURATION;
      if (this.transition <= 0) {
        this.transition = 0;
        this.outgoing.exit();
        this.outgoing = null;
      } else {
        // The outgoing chapter keeps animating; freezing it reads as a glitch.
        this.outgoing.update({ ...ctx, elapsed: ctx.elapsed + TRANSITION_DURATION });
        this.post.renderScene(this.outgoing.scene, this.outgoing.camera, this.post.prevTarget);
      }
    }

    // Ease the dissolve so the wipe accelerates out of the old chapter.
    const t = this.transition;
    const eased = t <= 0 ? 0 : t * t * (3 - 2 * t);
    this.post.composite(this.time, eased, this.fade);

    this.ambience.update(this.time);
    this.options.onReadout?.(chapter.readout(), chapter.id);
    this.governQuality(delta, performance.now() - now);
  };

  dispose(): void {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.pointer.dispose();
    this.ambience.dispose();
    for (const chapter of this.chapters.values()) chapter.dispose();
    this.chapters.clear();
    this.post.dispose();
    this.renderer.dispose();
  }
}
