import { PerspectiveCamera, Scene, Spherical, Vector3, Vector4 } from 'three';
import { MAX_RIPPLES, MAX_TOUCHES } from '../engine/Pointer';
import type { Chapter, ChapterId, FrameContext, Readout } from '../engine/Scene';

export interface TouchUniforms {
  uHalfHeight: { value: number };
  uTouchPos: { value: Vector3[] };
  uTouchStrength: { value: number[] };
  uTouchCount: { value: number };
  uRipples: { value: Vector4[] };
  uRippleCount: { value: number };
}

export function createTouchUniforms(): TouchUniforms {
  return {
    uHalfHeight: { value: 540 },
    uTouchPos: { value: Array.from({ length: MAX_TOUCHES }, () => new Vector3(0, 0, 0)) },
    uTouchStrength: { value: new Array(MAX_TOUCHES).fill(0) },
    uTouchCount: { value: 0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, 0, 999)) },
    uRippleCount: { value: 0 },
  };
}

/** Exponential smoothing that behaves the same at any framerate. */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Shared scaffolding: a spherical camera rig with drag, inertia and an idle
 * drift, plus the touch uniform plumbing every chapter needs.
 *
 * The rig is deliberately not OrbitControls — a wall panel needs the camera to
 * always be recovering toward a composed frame, so a visitor who spins it and
 * walks away leaves the piece looking intentional for the next one.
 */
export abstract class ChapterBase implements Chapter {
  abstract readonly id: ChapterId;

  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly interactionPlane = { normal: new Vector3(0, 1, 0), constant: 0 };

  protected readonly touch = createTouchUniforms();
  protected readonly target = new Vector3();

  /** Where the camera returns to when nobody is touching it. */
  protected readonly restSpherical = new Spherical(30, Math.PI * 0.42, 0);
  protected readonly spherical = new Spherical(30, Math.PI * 0.42, 0);
  protected readonly desired = new Spherical(30, Math.PI * 0.42, 0);

  /** Radians per second of automatic rotation when idle. */
  protected idleSpin = 0.03;
  protected minPolar = Math.PI * 0.12;
  protected maxPolar = Math.PI * 0.86;
  protected dragSensitivity = 2.6;

  /** Set true by chapters that want the rig to stop recentring (e.g. after a focus). */
  protected recentres = true;

  private readonly cameraPosition = new Vector3();
  private readonly lookTarget = new Vector3();
  protected readonly desiredTarget = new Vector3();

  protected entered = false;

  constructor(fov = 42) {
    this.camera = new PerspectiveCamera(fov, 1, 0.1, 4000);
    this.camera.position.set(0, 10, 30);
  }

  enter(): void {
    this.entered = true;
  }

  exit(): void {
    this.entered = false;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Feeds live touch and ripple state into the shared uniform block. */
  protected syncTouchUniforms(ctx: FrameContext): void {
    this.touch.uHalfHeight.value = ctx.pixelHeight * 0.5;
    this.touch.uTouchCount.value = ctx.pointer.writeTouchUniforms(
      this.touch.uTouchPos.value,
      this.touch.uTouchStrength.value
    );
    for (let i = 0; i < MAX_RIPPLES; i += 1) {
      this.touch.uRipples.value[i].copy(ctx.pointer.ripples[i]);
    }
    this.touch.uRippleCount.value = MAX_RIPPLES;
  }

  /**
   * Applies drag, inertia and idle drift, then damps the camera toward the
   * result. Chapters that want a different framing move `restSpherical` and
   * `desiredTarget` instead of touching the camera directly.
   */
  protected updateCameraRig(ctx: FrameContext): void {
    const drag = ctx.pointer.dragWithInertia;
    if (drag.lengthSq() > 0) {
      this.desired.theta -= drag.x * this.dragSensitivity;
      this.desired.phi = clamp(this.desired.phi - drag.y * this.dragSensitivity * 0.6, this.minPolar, this.maxPolar);
    }

    // Idle: keep turning, and reel the framing back toward the composed one.
    this.desired.theta += this.idleSpin * ctx.delta * (0.35 + ctx.idle * 0.65);
    if (this.recentres) {
      const pull = ctx.idle * 0.5;
      this.desired.phi = damp(this.desired.phi, this.restSpherical.phi, pull, ctx.delta);
      this.desired.radius = damp(this.desired.radius, this.restSpherical.radius, 1.4, ctx.delta);
    }

    this.spherical.theta = damp(this.spherical.theta, this.desired.theta, 3.2, ctx.delta);
    this.spherical.phi = damp(this.spherical.phi, this.desired.phi, 3.2, ctx.delta);
    this.spherical.radius = damp(this.spherical.radius, this.desired.radius, 2.4, ctx.delta);

    this.target.lerp(this.desiredTarget, 1 - Math.exp(-2.4 * ctx.delta));

    this.cameraPosition.setFromSpherical(this.spherical).add(this.target);
    this.camera.position.copy(this.cameraPosition);

    // A hint of parallax toward the last touch, so the frame reacts even when
    // the visitor is not dragging.
    this.lookTarget.copy(this.target);
    this.lookTarget.x += ctx.pointer.centroid.x * this.spherical.radius * 0.035;
    this.lookTarget.y += ctx.pointer.centroid.y * this.spherical.radius * 0.025;
    this.camera.lookAt(this.lookTarget);
  }

  abstract update(ctx: FrameContext): void;
  abstract readout(): Readout;

  dispose(): void {
    this.scene.traverse(object => {
      const mesh = object as unknown as {
        geometry?: { dispose(): void };
        material?: { dispose(): void } | { dispose(): void }[];
      };
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach(m => m.dispose());
      else material?.dispose?.();
    });
    this.scene.clear();
  }
}
