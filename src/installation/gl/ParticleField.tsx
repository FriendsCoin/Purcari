/**
 * The cloud itself: 3015 grains of light, one per recorded detection.
 *
 * The component owns two sets of buffers — where each grain is coming from and
 * where it is going — and drives a single `uMorph` uniform between them. When an
 * act change interrupts a transition, the current interpolated state is snapped
 * back into the "from" buffers using the same easing the shader uses, so the
 * cloud redirects mid-flight instead of jumping.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Archive } from '../data';
import type { Layout } from '../layouts';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './particleShader';

const MORPH_SPREAD = 0.55;

/** Mirrors `staggered()` in the vertex shader. */
function staggered(morph: number, seed: number): number {
  const t = Math.min(1, Math.max(0, morph * (1 + MORPH_SPREAD) - seed * MORPH_SPREAD));
  return t * t * (3 - 2 * t);
}

export interface FieldControls {
  pointer: Vector3;
  pointerStrength: number;
  window: [number, number];
  dayCursor: number;
  focusSpecies: number;
  focusStation: number;
  /** Minute-of-day the chronos hand is passing, or -1 when it is parked. */
  sweep: number;
  drift: number;
  opacity: number;
}

interface Props {
  archive: Archive;
  layout: Layout;
  controls: React.MutableRefObject<FieldControls>;
  morphSeconds?: number;
  onMorphProgress?: (t: number) => void;
}

export function ParticleField({ archive, layout, controls, morphSeconds = 2.4, onMorphProgress }: Props) {
  const { size } = useThree();
  const n = archive.count;

  const { points, material, geometry, buffers } = useMemo(() => {
    const geo = new BufferGeometry();

    const from = new Float32Array(layout.position);
    const to = new Float32Array(layout.position);
    const colorFrom = new Float32Array(layout.color);
    const colorTo = new Float32Array(layout.color);
    const sizeFrom = new Float32Array(layout.size);
    const sizeTo = new Float32Array(layout.size);
    const seed = new Float32Array(n);
    const jitter = new Float32Array(n * 3);

    for (let i = 0; i < n; i += 1) {
      seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      if (seed[i] < 0) seed[i] += 1;
      const a = i * 0.7351;
      jitter[i * 3] = Math.cos(a * 3.1) * (0.4 + seed[i]);
      jitter[i * 3 + 1] = 0.6 + seed[i] * 1.4;
      jitter[i * 3 + 2] = Math.sin(a * 2.7) * (0.4 + seed[i]);
    }

    geo.setAttribute('position', new BufferAttribute(from, 3));
    geo.setAttribute('aTo', new BufferAttribute(to, 3));
    geo.setAttribute('aColorFrom', new BufferAttribute(colorFrom, 3));
    geo.setAttribute('aColorTo', new BufferAttribute(colorTo, 3));
    geo.setAttribute('aSizeFrom', new BufferAttribute(sizeFrom, 1));
    geo.setAttribute('aSizeTo', new BufferAttribute(sizeTo, 1));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geo.setAttribute('aJitter', new BufferAttribute(jitter, 3));
    geo.setAttribute('aMinute', new BufferAttribute(Float32Array.from(archive.minute), 1));
    geo.setAttribute('aDay', new BufferAttribute(Float32Array.from(archive.day), 1));
    geo.setAttribute('aSpecies', new BufferAttribute(Float32Array.from(archive.sp), 1));
    geo.setAttribute('aStation', new BufferAttribute(Float32Array.from(archive.st), 1));
    geo.boundingSphere = null;

    const mat = new ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uMorph: { value: 1 },
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uSizeScale: { value: 1 },
        uPerspective: { value: 500 },
        uDrift: { value: 0.5 },
        uPointer: { value: new Vector3(0, -999, 0) },
        uPointerStrength: { value: 0 },
        uPointerRadius: { value: 7 },
        uWindowMin: { value: 0 },
        uWindowMax: { value: 1439 },
        uDayCursor: { value: -1 },
        uFocusSpecies: { value: -1 },
        uFocusStation: { value: -1 },
        uArc: { value: 3.2 },
        uSweep: { value: -1 },
        uOpacity: { value: 1 },
      },
    });

    const pts = new Points(geo, mat);
    pts.frustumCulled = false;

    return {
      points: pts,
      material: mat,
      geometry: geo,
      buffers: { from, to, colorFrom, colorTo, sizeFrom, sizeTo, seed, jitter },
    };
    // Buffers are allocated once for the lifetime of the field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  const morph = useRef({ t: 1, arc: 3.2 });

  // Retarget: snapshot the visible state, then aim at the new layout.
  useEffect(() => {
    const { from, to, colorFrom, colorTo, sizeFrom, sizeTo, seed, jitter } = buffers;
    const t = morph.current.t;
    const arc = morph.current.arc;

    if (t < 1) {
      for (let i = 0; i < n; i += 1) {
        const e = staggered(t, seed[i]);
        const bow = Math.sin(e * Math.PI) * arc;
        for (let k = 0; k < 3; k += 1) {
          const j = i * 3 + k;
          from[j] = from[j] + (to[j] - from[j]) * e + jitter[j] * bow;
          colorFrom[j] = colorFrom[j] + (colorTo[j] - colorFrom[j]) * e;
        }
        sizeFrom[i] = sizeFrom[i] + (sizeTo[i] - sizeFrom[i]) * e;
      }
    } else {
      from.set(to);
      colorFrom.set(colorTo);
      sizeFrom.set(sizeTo);
    }

    to.set(layout.position);
    colorTo.set(layout.color);
    sizeTo.set(layout.size);

    for (const name of ['position', 'aTo', 'aColorFrom', 'aColorTo', 'aSizeFrom', 'aSizeTo']) {
      (geometry.getAttribute(name) as BufferAttribute).needsUpdate = true;
    }

    morph.current.t = 0;
    material.uniforms.uMorph.value = 0;
  }, [layout, buffers, geometry, material, n]);

  useEffect(() => {
    material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
    // Perspective divisor in CSS pixels: a grain of size 1 covers roughly half a
    // world unit at the camera's working distance, whatever the viewport.
    material.uniforms.uPerspective.value = size.height * 0.34;
    material.uniforms.uSizeScale.value = size.height < 600 ? 0.85 : 1;
  }, [material, size.height]);

  useFrame((_, delta) => {
    const u = material.uniforms;
    const c = controls.current;

    if (morph.current.t < 1) {
      morph.current.t = Math.min(1, morph.current.t + delta / morphSeconds);
      u.uMorph.value = morph.current.t;
      onMorphProgress?.(morph.current.t);
    }

    u.uTime.value += delta;
    u.uPointer.value.copy(c.pointer);
    u.uPointerStrength.value += (c.pointerStrength - u.uPointerStrength.value) * Math.min(1, delta * 4);
    u.uWindowMin.value = c.window[0];
    u.uWindowMax.value = c.window[1];
    u.uDayCursor.value = c.dayCursor;
    u.uFocusSpecies.value = c.focusSpecies;
    u.uFocusStation.value = c.focusStation;
    u.uSweep.value = c.sweep;
    u.uDrift.value += (c.drift - u.uDrift.value) * Math.min(1, delta * 2);
    u.uOpacity.value += (c.opacity - u.uOpacity.value) * Math.min(1, delta * 3);
  });

  return <primitive object={points} />;
}
