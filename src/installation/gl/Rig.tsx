/**
 * Camera choreography.
 *
 * The camera never cuts. It eases toward the current act's mark while a slow
 * orbit and a little pointer parallax keep the frame alive, so a visitor who
 * stops touching the piece still sees a moving image — the installation case.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { ActDefinition } from '../acts';

interface Props {
  act: ActDefinition;
  /** Normalised pointer, -1..1 on both axes. */
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  /** World-space pointer projection, written for the particle repulsion field. */
  pointerWorld: Vector3;
  enabled?: boolean;
}

export function Rig({ act, pointer, pointerWorld, enabled = true }: Props) {
  const { camera, size } = useThree();
  const orbit = useRef(0);
  const current = useRef(new Vector3(...act.camera.position));
  const target = useRef(new Vector3(...act.camera.target));
  const lookAt = useRef(new Vector3(...act.camera.target));

  useEffect(() => {
    (camera as PerspectiveCamera).near = 0.1;
    (camera as PerspectiveCamera).far = 600;
    camera.position.copy(current.current);
  }, [camera]);

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05);
    orbit.current += d * act.orbit;

    const base = act.camera.position;
    const radius = Math.hypot(base[0], base[2]);
    const phase = Math.atan2(base[2], base[0]) + orbit.current;

    const parallax = enabled ? 1 : 0;
    const desired = new Vector3(
      Math.cos(phase) * radius + pointer.current.x * 5.5 * parallax,
      base[1] + pointer.current.y * 3.2 * parallax,
      Math.sin(phase) * radius
    );

    current.current.lerp(desired, 1 - Math.exp(-d * 1.5));
    camera.position.copy(current.current);

    target.current.set(...act.camera.target);
    lookAt.current.lerp(target.current, 1 - Math.exp(-d * 2));
    camera.lookAt(lookAt.current);

    const cam = camera as PerspectiveCamera;
    const fov = act.camera.fov * (size.width < 760 ? 1.28 : 1);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-d * 2));
      cam.updateProjectionMatrix();
    }

    // Project the pointer onto the plane through the look-at point that faces
    // the camera; grains near it get pushed aside.
    const dir = new Vector3(pointer.current.x, pointer.current.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const planeNormal = new Vector3().subVectors(camera.position, lookAt.current).normalize();
    const denom = dir.dot(planeNormal);
    if (Math.abs(denom) > 1e-4) {
      const t = new Vector3().subVectors(lookAt.current, camera.position).dot(planeNormal) / denom;
      if (t > 0) pointerWorld.copy(camera.position).addScaledVector(dir, t);
    }

    state.invalidate?.();
  });

  return null;
}
