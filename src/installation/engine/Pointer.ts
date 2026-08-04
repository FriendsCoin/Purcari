import { Camera, Plane, Raycaster, Vector2, Vector3, Vector4 } from 'three';

export const MAX_TOUCHES = 6;
export const MAX_RIPPLES = 5;

/** A ripple lives this long, in seconds, then frees its slot. */
const RIPPLE_LIFE = 2.6;

/** Pointer travel above this (in NDC) turns a tap into a drag. */
const TAP_SLOP = 0.035;

/** And a tap has to be released within this many seconds. */
const TAP_TIME = 0.45;

export interface TouchPoint {
  id: number;
  /** Normalised device coordinates, -1..1, y up. */
  ndc: Vector2;
  /** Same, projected onto the interaction plane in world space. */
  world: Vector3;
  /** NDC delta accumulated since the last frame. */
  delta: Vector2;
  /** 1 while held, decaying to 0 over ~0.6 s after release. */
  strength: number;
  down: boolean;
  age: number;
  travel: number;
  startNdc: Vector2;
}

export interface TapEvent {
  ndc: Vector2;
  world: Vector3;
}

/**
 * Normalises mouse and multi-touch into a single set of pointers, keeps them in
 * both screen and world space, and turns releases into taps.
 *
 * Kiosk-specific behaviour: nothing here depends on hover, because a wall-mounted
 * touchscreen has no cursor. Everything is press / drag / release.
 */
export class Pointer {
  readonly touches = new Map<number, TouchPoint>();

  /** Smoothed centroid of all active pointers, in NDC. Drives parallax. */
  readonly centroid = new Vector2();

  /** Drag delta of the primary pointer this frame, in NDC. */
  readonly drag = new Vector2();

  /** Momentum left over after release, decaying exponentially. */
  readonly inertia = new Vector2();

  /** xyz = world origin, w = age in seconds. */
  readonly ripples: Vector4[] = Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, 0, 999));

  /** Seconds since the last touch of any kind — drives the idle attract mode. */
  idleTime = 0;

  /**
   * Accumulated wheel notches since the last read, positive to zoom in.
   *
   * The panel in the château has no wheel and never will. This is here so the
   * piece can be reviewed on a laptop, where pinching is not available and a map
   * you cannot zoom is a map you cannot judge.
   */
  private wheel = 0;

  /** True on the frame a tap is recognised. */
  private pendingTaps: TapEvent[] = [];

  private readonly element: HTMLElement;
  private readonly raycaster = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 0, 1), 0);
  private readonly scratch = new Vector3();
  private nextRipple = 0;
  private primaryId: number | null = null;
  private disposed = false;

  constructor(element: HTMLElement) {
    this.element = element;
    element.addEventListener('pointerdown', this.onDown, { passive: false });
    element.addEventListener('pointermove', this.onMove, { passive: false });
    element.addEventListener('pointerup', this.onUp, { passive: false });
    element.addEventListener('pointercancel', this.onUp, { passive: false });
    element.addEventListener('pointerleave', this.onUp, { passive: false });
    element.addEventListener('contextmenu', this.preventDefault);
    element.addEventListener('touchstart', this.preventDefault, { passive: false });
    element.addEventListener('touchmove', this.preventDefault, { passive: false });
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /**
   * The world-space plane that pointers are projected onto. Scenes set this to
   * whatever surface their content lives on, so a finger lands where it looks
   * like it lands.
   */
  setInteractionPlane(normal: Vector3, constant: number): void {
    this.plane.set(normal, constant);
  }

  private preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Trackpads report pixels and mice report lines; normalising to notches keeps
    // one gesture from zooming a hundred times further than the other.
    const notches = event.deltaMode === 0 ? event.deltaY / 100 : event.deltaY;
    this.wheel -= Math.max(-3, Math.min(3, notches));
    this.idleTime = 0;
  };

  /** Reads and clears the accumulated wheel input. */
  consumeWheel(): number {
    const value = this.wheel;
    this.wheel = 0;
    return value;
  }

  private toNdc(event: PointerEvent, out: Vector2): Vector2 {
    const rect = this.element.getBoundingClientRect();
    return out.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
  }

  private onDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.touches.size >= MAX_TOUCHES) return;
    const ndc = this.toNdc(event, new Vector2());
    this.touches.set(event.pointerId, {
      id: event.pointerId,
      ndc,
      world: new Vector3(),
      delta: new Vector2(),
      strength: 1,
      down: true,
      age: 0,
      travel: 0,
      startNdc: ndc.clone(),
    });
    if (this.primaryId === null) this.primaryId = event.pointerId;
    this.idleTime = 0;
    this.inertia.set(0, 0);
    if (this.element.setPointerCapture) {
      try {
        this.element.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort; some kiosk drivers reject it mid-gesture.
      }
    }
  };

  private onMove = (event: PointerEvent): void => {
    const touch = this.touches.get(event.pointerId);
    if (!touch) return;
    event.preventDefault();
    const next = this.toNdc(event, new Vector2());
    touch.delta.add(next.clone().sub(touch.ndc));
    touch.travel += next.distanceTo(touch.ndc);
    touch.ndc.copy(next);
    this.idleTime = 0;
  };

  private onUp = (event: PointerEvent): void => {
    const touch = this.touches.get(event.pointerId);
    if (!touch) return;
    event.preventDefault();
    touch.down = false;
    // Short press that barely moved: the visitor meant to select something.
    if (touch.travel < TAP_SLOP && touch.age < TAP_TIME) {
      this.pendingTaps.push({ ndc: touch.ndc.clone(), world: touch.world.clone() });
      this.spawnRipple(touch.world);
    }
    if (this.primaryId === event.pointerId) this.primaryId = null;
    this.idleTime = 0;
  };

  private spawnRipple(world: Vector3): void {
    this.ripples[this.nextRipple].set(world.x, world.y, world.z, 0);
    this.nextRipple = (this.nextRipple + 1) % MAX_RIPPLES;
  }

  /** Taps recognised since the last call. Drains the queue. */
  consumeTaps(): TapEvent[] {
    if (this.pendingTaps.length === 0) return [];
    const taps = this.pendingTaps;
    this.pendingTaps = [];
    return taps;
  }

  update(delta: number, camera: Camera): void {
    if (this.disposed) return;

    this.drag.set(0, 0);
    let activeCount = 0;
    const sum = new Vector2();

    for (const [id, touch] of this.touches) {
      touch.age += delta;

      // Project onto the interaction plane so shaders can work in world space.
      this.raycaster.setFromCamera(touch.ndc, camera);
      if (this.raycaster.ray.intersectPlane(this.plane, this.scratch)) {
        touch.world.copy(this.scratch);
      }

      if (touch.down) {
        activeCount += 1;
        sum.add(touch.ndc);
        touch.strength = Math.min(1, touch.strength + delta * 6);
        if (this.primaryId === null) this.primaryId = id;
        if (this.primaryId === id) this.drag.add(touch.delta);
      } else {
        touch.strength -= delta * 1.7;
        if (touch.strength <= 0) this.touches.delete(id);
      }
      touch.delta.set(0, 0);
    }

    if (activeCount > 0) {
      sum.divideScalar(activeCount);
      this.centroid.lerp(sum, 1 - Math.exp(-delta * 8));
      this.idleTime = 0;
      // Hand momentum over to inertia so a flick keeps spinning after release.
      this.inertia.lerp(this.drag.clone().divideScalar(Math.max(delta, 1e-3) * 60), 0.35);
    } else {
      this.centroid.lerp(new Vector2(0, 0), 1 - Math.exp(-delta * 1.2));
      this.inertia.multiplyScalar(Math.exp(-delta * 2.6));
      if (this.inertia.lengthSq() < 1e-8) this.inertia.set(0, 0);
      this.idleTime += delta;
    }

    for (const ripple of this.ripples) {
      if (ripple.w < RIPPLE_LIFE) ripple.w += delta;
    }
  }

  /** Combined drag for this frame: live movement plus post-release momentum. */
  get dragWithInertia(): Vector2 {
    return this.drag.lengthSq() > 0 ? this.drag : this.inertia.clone().multiplyScalar(1 / 60);
  }

  get activeCount(): number {
    let n = 0;
    for (const touch of this.touches.values()) if (touch.down) n += 1;
    return n;
  }

  get rippleCount(): number {
    return this.ripples.filter(r => r.w < RIPPLE_LIFE).length;
  }

  /** Flat world positions for the touch uniform array. */
  writeTouchUniforms(positions: Vector3[], strengths: number[]): number {
    let i = 0;
    for (const touch of this.touches.values()) {
      if (i >= MAX_TOUCHES) break;
      positions[i].copy(touch.world);
      strengths[i] = touch.strength;
      i += 1;
    }
    for (let j = i; j < MAX_TOUCHES; j += 1) strengths[j] = 0;
    return i;
  }

  dispose(): void {
    this.disposed = true;
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup', this.onUp);
    this.element.removeEventListener('pointercancel', this.onUp);
    this.element.removeEventListener('pointerleave', this.onUp);
    this.element.removeEventListener('contextmenu', this.preventDefault);
    this.element.removeEventListener('touchstart', this.preventDefault);
    this.element.removeEventListener('touchmove', this.preventDefault);
    this.element.removeEventListener('wheel', this.onWheel);
    this.touches.clear();
  }
}
