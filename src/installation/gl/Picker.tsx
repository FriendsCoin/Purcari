/**
 * Picking: turns the cloud from something you watch into something you can ask.
 *
 * Nothing is raycast against geometry — the grains are GL points with no mesh to
 * hit. Instead each act's layout positions are projected to the screen and the
 * nearest one to the pointer wins, which is both cheaper and more forgiving than
 * a true hit test on a two-pixel sprite.
 *
 * Positions come from the layout rather than from the shader, so the drift and
 * the mid-flight bow are not accounted for. The tolerance below is wide enough
 * to swallow that, and picking is suppressed while an act change is in flight.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Layout } from '../layouts';

const CLICK_RADIUS = 30;
const HOVER_RADIUS = 22;
/** Hover picking is throttled: it is a nicety, not worth a scan every frame. */
const HOVER_INTERVAL = 0.09;

interface Props {
  layout: Layout;
  count: number;
  /** True while the cloud is settling; picking a moving target is a lie. */
  settled: React.MutableRefObject<boolean>;
  onPick: (index: number | null) => void;
  onHover: (index: number | null) => void;
}

export function Picker({ layout, count, settled, onPick, onHover }: Props) {
  const { camera, gl, size } = useThree();
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hovered = useRef<number | null>(null);
  const clock = useRef(0);
  const scratch = useRef(new Vector3()).current;

  /** Nearest grain to a screen point, or null if nothing is close enough. */
  function nearest(clientX: number, clientY: number, radius: number): number | null {
    const rect = gl.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    let best = -1;
    let bestDistance = radius * radius;

    for (let i = 0; i < count; i += 1) {
      scratch
        .set(layout.position[i * 3], layout.position[i * 3 + 1], layout.position[i * 3 + 2])
        .project(camera);
      if (scratch.z > 1) continue; // behind the camera

      const sx = (scratch.x * 0.5 + 0.5) * size.width;
      const sy = (-scratch.y * 0.5 + 0.5) * size.height;
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  useEffect(() => {
    const canvas = gl.domElement;
    let downAt: { x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!downAt) return;
      const travelled = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      // A drag is a camera gesture, not a selection.
      if (travelled > 6 || !settled.current) return;
      onPick(nearest(e.clientX, e.clientY, CLICK_RADIUS));
    };

    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };

    const onLeave = () => {
      pointer.current = null;
      if (hovered.current !== null) {
        hovered.current = null;
        onHover(null);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, size, layout, count, onPick, onHover]);

  useFrame((_, delta) => {
    clock.current += delta;
    if (clock.current < HOVER_INTERVAL) return;
    clock.current = 0;

    const p = pointer.current;
    const found = p && settled.current ? nearest(p.x, p.y, HOVER_RADIUS) : null;
    if (found !== hovered.current) {
      hovered.current = found;
      onHover(found);
    }
  });

  return null;
}
