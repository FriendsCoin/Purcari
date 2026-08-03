/**
 * Camera choreography.
 *
 * The camera never cuts. Between acts it flies a curve — a quadratic Bézier
 * bowed outward and lifted, so the move reads as travel through the scene
 * rather than a dissolve between two viewpoints — while a slow orbit around the
 * current subject and a little pointer parallax keep the frame alive when
 * nobody is driving.
 *
 * It also publishes how far through a move it is; bloom, exposure and the
 * landscape wipe all hang off that one number.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { ActDefinition } from '../acts';

export interface TransitionState {
  /** 0 at rest, ramping 0→1 across a move. */
  progress: number;
  /** sin(πt): peaks mid-flight, zero at both ends. */
  bell: number;
  travelling: boolean;
}

interface Props {
  act: ActDefinition;
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  pointerWorld: Vector3;
  transition: React.MutableRefObject<TransitionState>;
  enabled?: boolean;
  seconds?: number;
}

const EASE = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function Rig({ act, pointer, pointerWorld, transition, enabled = true, seconds = 2.8 }: Props) {
  const { camera, size } = useThree();

  const orbit = useRef(0);
  const previous = useRef<ActDefinition>(act);
  const travel = useRef(1);

  const smoothed = useRef(new Vector3(...act.camera.position));
  const lookAt = useRef(new Vector3(...act.camera.target));

  // Scratch vectors, so the frame loop never allocates.
  const scratch = useRef({
    from: new Vector3(),
    to: new Vector3(),
    control: new Vector3(),
    desired: new Vector3(),
    target: new Vector3(),
    dir: new Vector3(),
    normal: new Vector3(),
  }).current;

  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.near = 0.1;
    cam.far = 900;
    cam.updateProjectionMatrix();
  }, [camera]);

  useEffect(() => {
    if (act.id === previous.current.id) return;
    // Restart the flight from wherever the last one got to.
    travel.current = 0;
  }, [act]);

  /** Where an act's camera rests, carried around its own subject by the orbit. */
  function resting(definition: ActDefinition, out: Vector3): Vector3 {
    const [px, py, pz] = definition.camera.position;
    const [tx, , tz] = definition.camera.target;
    const relX = px - tx;
    const relZ = pz - tz;
    const radius = Math.hypot(relX, relZ);
    const phase = Math.atan2(relZ, relX) + orbit.current * definition.orbit;
    return out.set(tx + Math.cos(phase) * radius, py, tz + Math.sin(phase) * radius);
  }

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05);
    orbit.current += d;

    if (travel.current < 1) {
      travel.current = Math.min(1, travel.current + d / seconds);
      if (travel.current >= 1) previous.current = act;
    }

    const t = EASE(travel.current);
    const bell = Math.sin(Math.PI * travel.current);

    transition.current.progress = travel.current;
    transition.current.bell = bell;
    transition.current.travelling = travel.current < 1;

    resting(previous.current, scratch.from);
    resting(act, scratch.to);

    if (travel.current < 1) {
      // Bow the path away from the midpoint so the camera swings wide.
      scratch.control.copy(scratch.from).add(scratch.to).multiplyScalar(0.5);
      const spread = scratch.from.distanceTo(scratch.to);
      scratch.control.y += spread * 0.16;
      scratch.control.multiplyScalar(1.09);

      const inv = 1 - t;
      scratch.desired
        .copy(scratch.from)
        .multiplyScalar(inv * inv)
        .addScaledVector(scratch.control, 2 * inv * t)
        .addScaledVector(scratch.to, t * t);
    } else {
      scratch.desired.copy(scratch.to);
    }

    const parallax = enabled ? 1 : 0;
    scratch.desired.x += pointer.current.x * 5.5 * parallax;
    scratch.desired.y += pointer.current.y * 3.4 * parallax;

    // Settle harder while travelling so the curve is actually followed.
    const follow = travel.current < 1 ? 6.5 : 1.6;
    smoothed.current.lerp(scratch.desired, 1 - Math.exp(-d * follow));
    camera.position.copy(smoothed.current);

    const a = previous.current.camera.target;
    const b = act.camera.target;
    scratch.target.set(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
    lookAt.current.lerp(scratch.target, 1 - Math.exp(-d * 3.2));
    camera.lookAt(lookAt.current);

    const cam = camera as PerspectiveCamera;
    const narrow = size.width < 760 ? 1.28 : 1;
    // A slight widening mid-flight reads as the camera drawing breath.
    const fov =
      (previous.current.camera.fov + (act.camera.fov - previous.current.camera.fov) * t) * narrow +
      bell * 3.5;
    if (Math.abs(cam.fov - fov) > 0.005) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-d * 5));
      cam.updateProjectionMatrix();
    }

    // Pointer projected onto the plane through the look-at point.
    scratch.dir
      .set(pointer.current.x, pointer.current.y, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    scratch.normal.subVectors(camera.position, lookAt.current).normalize();
    const denom = scratch.dir.dot(scratch.normal);
    if (Math.abs(denom) > 1e-4) {
      const distance =
        scratch.target.subVectors(lookAt.current, camera.position).dot(scratch.normal) / denom;
      if (distance > 0) pointerWorld.copy(camera.position).addScaledVector(scratch.dir, distance);
    }

    state.invalidate?.();
  });

  return null;
}
