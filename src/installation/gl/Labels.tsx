/**
 * Projects label anchors from world space onto the DOM overlay each frame.
 *
 * Runs inside the canvas so it shares the render loop, but touches only the
 * registered DOM nodes — no React state, no re-renders while the camera moves.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { LabelAnchor } from '../labels';

export type LabelRegistry = Map<string, HTMLElement>;

interface Props {
  anchors: LabelAnchor[];
  registry: React.MutableRefObject<LabelRegistry>;
  /** Fades all labels together, e.g. while an act transition is in flight. */
  opacity: React.MutableRefObject<number>;
}

export function Labels({ anchors, registry, opacity }: Props) {
  const { camera, size } = useThree();
  const scratch = useRef(new Vector3());
  const forward = useRef(new Vector3());

  // Anything left over from the previous act must not stay stuck on screen.
  useEffect(() => {
    for (const [id, el] of registry.current) {
      if (!anchors.some((a) => a.id === id)) el.style.opacity = '0';
    }
  }, [anchors, registry]);

  useFrame(() => {
    camera.getWorldDirection(forward.current);

    for (const anchor of anchors) {
      const el = registry.current.get(anchor.id);
      if (!el) continue;

      const v = scratch.current.set(anchor.world[0], anchor.world[1], anchor.world[2]);
      const distance = v.distanceTo(camera.position);
      v.project(camera);

      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;

      // Keep labels inside the safe area: clear of the masthead, the transport
      // bar and the readout panel, and never half-clipped at an edge.
      const rightEdge = size.width > 860 ? size.width * 0.72 : size.width - 40;
      const inSafeArea = x > 36 && x < rightEdge && y > 96 && y < size.height - 132;

      // Fade with distance so far labels recede instead of crowding.
      const fade = Math.max(0, Math.min(1, 1.9 - distance / 78));
      const alpha = behind || !inSafeArea ? 0 : fade * opacity.current;

      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.opacity = alpha.toFixed(3);
      el.style.visibility = alpha < 0.01 ? 'hidden' : 'visible';
    }
  });

  return null;
}
