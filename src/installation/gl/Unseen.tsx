/**
 * Chapter — "The Unseen".
 *
 * Every other chapter shows what the survey found. This one shows what it
 * estimates it missed.
 *
 * Chao1 estimates the true species richness of a place from how many species
 * were recorded exactly once or twice: a community whose rare tail is still full
 * of singletons is a community you have not finished counting. The survey
 * publishes it for the estate and for every station, and it had never been shown.
 *
 * One ring per station, nested, ordered with the least complete innermost. Each
 * ring is filled through the fraction of its own Chao1 estimate that was
 * actually recorded, and then breaks: the rest of the circle is a cold dashed
 * arc, and the marks drifting in it never resolve. The outermost ring is the
 * estate as a whole.
 *
 * The finding is in the nesting. The estate is 94% counted while its stations
 * sit between 50% and 85% — because the stations share species, and what one
 * missed another caught. That is an argument for the array, not against it, and
 * it is only visible when the whole and its parts are drawn on the same figure.
 *
 * Nothing here is a prediction of which species are missing. The gap is a count,
 * not a list, and the marks in it are deliberately unresolved.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import { PALETTE, toRGB } from '../core/palette';
import type { InstallationData } from '../core/types';
import { DITHER, SIMPLEX_3D, SPRITE, TONEMAP } from './chunks';
import { MAX_RINGS, buildRings, type RingLayout } from './unseenRings';

/* ------------------------------------------------------------------ layout */

/** Segments per ring. Enough that the dashes in the gap stay crisp. */
const RING_SEGMENTS = 220;
/**
 * Half-width of a ring, in world units.
 *
 * Rings are ribbons, not lines. Drawn as GL lines they are a hairline, and a
 * hairline through this piece's grade pass — which spreads the channels apart
 * at the frame edge, the way a real lens does — comes out fringed red on one
 * side and green on the other. On a wall that reads as a broken screen. A stroke
 * with actual width takes the same spread as a warm edge, which is what it is
 * there for.
 */
const RING_HALF_WIDTH = 0.03;

/** Motes travelling the recorded arc, at the busiest ring. */
const MOTES_PER_RING = 90;
/** Marks adrift in the gap — the count that was missed, never a list of it. */
const GHOSTS_PER_RING = 26;

const MOTE_SIZE = 0.30;
const GHOST_SIZE = 0.42;

/** Finger-sized pick tolerance on the ring radius, in world units. */
const PICK_RADIUS = 0.34;

const hexColor = (hex: string): THREE.Color => new THREE.Color().fromArray(toRGB(hex));

/* -------------------------------------------------------------- data → row */

/* --------------------------------------------------------------- geometries */

/**
 * All rings in one buffer. The radius is baked — rings do not move — and only
 * the fill, the selection and the colour reach the shader as per-ring uniforms.
 */
function buildRingGeometry(rings: RingLayout[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const ringIndex: number[] = [];
  const angles: number[] = [];
  const sides: number[] = [];

  rings.forEach((ring, ri) => {
    const push = (frac: number, side: number) => {
      // Twelve o'clock, running clockwise on screen — the same sense as the
      // Year's disc, so a visitor reads both figures the same way.
      const theta = frac * Math.PI * 2;
      const radius = ring.radius + side * RING_HALF_WIDTH;
      positions.push(Math.sin(theta) * radius, Math.cos(theta) * radius, 0);
      ringIndex.push(ri);
      angles.push(frac);
      sides.push(side);
    };

    for (let s = 0; s < RING_SEGMENTS; s++) {
      const a = s / RING_SEGMENTS;
      const b = (s + 1) / RING_SEGMENTS;
      push(a, -1);
      push(b, -1);
      push(b, 1);
      push(a, -1);
      push(b, 1);
      push(a, 1);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(ringIndex, 1));
  geometry.setAttribute('aAngle', new THREE.Float32BufferAttribute(angles, 1));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Motes travelling the recorded arc.
 *
 * Their count per ring is that ring's observed richness against the richest, so
 * the thickness of the light is the count — and they are confined to the closed
 * part of the circle, because that is the part the survey has.
 */
function buildMoteGeometry(rings: RingLayout[]): THREE.BufferGeometry {
  const maxObserved = Math.max(...rings.map(ring => ring.observed), 1);
  const positions: number[] = [];
  const ringIndex: number[] = [];
  const phases: number[] = [];
  const seeds: number[] = [];

  rings.forEach((ring, ri) => {
    const count = Math.max(8, Math.round(MOTES_PER_RING * (ring.observed / maxObserved)));
    for (let i = 0; i < count; i++) {
      positions.push(0, 0, 0);
      ringIndex.push(ri);
      // Low-discrepancy rather than random: an even bead of light around the
      // arc instead of clumps and gaps that read as data.
      phases.push((i * 0.6180339887498949) % 1);
      seeds.push((i * 0.7548776662466927) % 1);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(ringIndex, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Marks adrift in the gap.
 *
 * How many a ring gets is its own estimated shortfall against the largest, so
 * the drift is the size of what is missing. They never hold still and never
 * brighten past a smudge: Chao1 gives a count, not a list, and a mark that
 * settled into a definite thing would be claiming to know which species it is.
 */
function buildGhostGeometry(rings: RingLayout[]): THREE.BufferGeometry {
  const maxGap = Math.max(...rings.map(ring => ring.estimated - ring.observed), 1);
  const positions: number[] = [];
  const ringIndex: number[] = [];
  const phases: number[] = [];
  const seeds: number[] = [];

  rings.forEach((ring, ri) => {
    const gap = Math.max(0, ring.estimated - ring.observed);
    const count = Math.max(3, Math.round(GHOSTS_PER_RING * (gap / maxGap)));
    for (let i = 0; i < count; i++) {
      positions.push(0, 0, 0);
      ringIndex.push(ri);
      phases.push((i * 0.6180339887498949) % 1);
      seeds.push((i * 0.5698402909980532) % 1);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(ringIndex, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ shaders */

/** Shared per-ring lookup, injected into every program in this chapter. */
const RING_UNIFORMS = /* glsl */ `
uniform float uFill[MAX_RINGS];      // completeness, 0..1 of the circle
uniform float uRadius[MAX_RINGS];
uniform float uSelect[MAX_RINGS];
uniform float uDim[MAX_RINGS];       // pushed back while another ring is chosen
uniform float uEstate[MAX_RINGS];    // 1 on the ring that is the whole estate
`;

const RING_VERT = /* glsl */ `
#define MAX_RINGS ${MAX_RINGS}

attribute float aRing;
attribute float aAngle;
attribute float aSide;

uniform float uTime;
uniform float uReveal;
${RING_UNIFORMS}

varying float vSide;
varying float vAngle;
varying float vFill;
varying float vSelect;
varying float vDim;
varying float vEstate;
varying float vReveal;

void main(){
  int idx = int(aRing + 0.5);
  vAngle = aAngle;
  vSide = aSide;
  vFill = uFill[idx];
  vSelect = uSelect[idx];
  vDim = uDim[idx];
  vEstate = uEstate[idx];

  // Rings arrive from the inside out, so the figure draws itself outward and the
  // estate ring — the one that closes furthest — lands last.
  float order = aRing / float(MAX_RINGS - 1);
  vReveal = clamp(uReveal * 1.5 - order * 0.5, 0.0, 1.0);
  vReveal = vReveal * vReveal * (3.0 - 2.0 * vReveal);

  // A selected ring lifts toward the viewer and thickens; it never changes
  // radius, because the radii are the ordering and must not move.
  vec3 p = vec3(position.xy * (1.0 + vSelect * 0.004 * aSide), position.z + vSelect * 0.35);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uSeen;
uniform vec3 uGap;
uniform float uTime;

varying float vSide;
varying float vAngle;
varying float vFill;
varying float vSelect;
varying float vDim;
varying float vEstate;
varying float vReveal;

void main(){
  // Soft across the width, so the ribbon reads as a drawn stroke rather than a
  // rectangle with two hard edges.
  float across = 1.0 - abs(vSide);
  float stroke = pow(clamp(across, 0.0, 1.0), 0.55);

  // Where the ring stops being knowledge.
  float seen = 1.0 - smoothstep(vFill - 0.0015, vFill + 0.0015, vAngle);

  // The recorded arc is a solid stroke; the gap is a cold dashed one, and the
  // dashes drift so the unknown never reads as settled.
  float dash = step(0.42, fract(vAngle * 84.0 - uTime * 0.03));
  float alpha = seen * (0.62 + vEstate * 0.38) + (1.0 - seen) * dash * 0.20;

  // A slow bead of brightness running the closed arc, so a ring reads as a
  // count being taken rather than as a drawn circle.
  float sweep = exp(-pow((fract(vAngle - fract(uTime * 0.035)) - 0.0) * 5.0, 2.0));
  alpha += seen * sweep * 0.35;

  alpha *= stroke * vReveal * mix(1.0, 0.22, vDim) * (1.0 + vSelect * 1.1);
  if (alpha <= 0.003) discard;

  vec3 color = mix(uGap, uSeen, seen);
  color += vec3(1.0, 0.94, 0.80) * vSelect * 0.35;
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

const MOTE_VERT = /* glsl */ `
#define MAX_RINGS ${MAX_RINGS}
${SIMPLEX_3D}

attribute float aRing;
attribute float aPhase;
attribute float aSeed;

uniform float uTime;
uniform float uReveal;
uniform float uSize;
${RING_UNIFORMS}

varying float vSelect;
varying float vDim;
varying float vReveal;

void main(){
  int idx = int(aRing + 0.5);
  float fill = uFill[idx];
  float radius = uRadius[idx];
  vSelect = uSelect[idx];
  vDim = uDim[idx];

  float order = aRing / float(MAX_RINGS - 1);
  vReveal = clamp(uReveal * 1.5 - order * 0.5, 0.0, 1.0);
  vReveal = vReveal * vReveal * (3.0 - 2.0 * vReveal);

  // Confined to the recorded arc — the inner rings run faster, so the figure
  // turns like a mechanism rather than a single disc.
  float speed = 0.018 + (1.0 - order) * 0.012;
  float along = fract(aPhase + uTime * speed) * fill;
  float theta = along * 6.2831853;
  float wobble = snoise(vec3(aSeed * 30.0, along * 6.0, uTime * 0.15)) * 0.035;

  vec3 p = vec3(
    sin(theta) * (radius + wobble),
    cos(theta) * (radius + wobble),
    vSelect * 0.35
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float breathe = 1.0 + sin(uTime * 1.4 + aSeed * 6.2831) * 0.12;
  gl_PointSize = uSize * breathe * (1.0 + vSelect * 0.5) * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = /* glsl */ `
${SPRITE}
uniform vec3 uSeen;

varying float vSelect;
varying float vDim;
varying float vReveal;

void main(){
  float mask = spriteAlpha(gl_PointCoord, 0.55);
  float a = mask * 0.5 * vReveal * mix(1.0, 0.18, vDim) * (1.0 + vSelect * 0.8);
  if (a <= 0.003) discard;
  vec3 color = uSeen + vec3(1.0, 0.94, 0.80) * (0.2 + vSelect * 0.5);
  gl_FragColor = vec4(color * a, a);
}
`;

const GHOST_VERT = /* glsl */ `
#define MAX_RINGS ${MAX_RINGS}
${SIMPLEX_3D}

attribute float aRing;
attribute float aPhase;
attribute float aSeed;

uniform float uTime;
uniform float uReveal;
uniform float uGhostSize;
${RING_UNIFORMS}

varying float vSelect;
varying float vDim;
varying float vReveal;
varying float vSettle;

void main(){
  int idx = int(aRing + 0.5);
  float fill = uFill[idx];
  float radius = uRadius[idx];
  vSelect = uSelect[idx];
  vDim = uDim[idx];

  float order = aRing / float(MAX_RINGS - 1);
  vReveal = clamp(uReveal * 1.5 - order * 0.5, 0.0, 1.0);
  vReveal = vReveal * vReveal * (3.0 - 2.0 * vReveal);

  // Adrift in the open arc only, and wandering off the line: nothing here sits
  // on the ring, because nothing here was measured.
  float span = max(0.0, 1.0 - fill);
  float along = fill + fract(aPhase + uTime * 0.004 + aSeed * 0.3) * span;
  float theta = along * 6.2831853;
  float drift = snoise(vec3(aSeed * 40.0, along * 3.0, uTime * 0.08)) * 0.16;

  vec3 p = vec3(
    sin(theta) * (radius + drift),
    cos(theta) * (radius + drift),
    vSelect * 0.35
  );
  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  // Never steady: each mark fades up and out on its own slow cycle and is at
  // full strength for only a moment of it.
  vSettle = 0.5 + 0.5 * sin(uTime * 0.5 + aSeed * 6.2831 + aRing);
  gl_PointSize = uGhostSize * (0.6 + vSettle * 0.7) * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const GHOST_FRAG = /* glsl */ `
${SPRITE}
${DITHER}
${TONEMAP}
uniform vec3 uGap;

varying float vSelect;
varying float vDim;
varying float vReveal;
varying float vSettle;

void main(){
  // Soft to the point of having no core. A mark with a bright centre reads as a
  // thing identified, and none of these is.
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float smudge = pow(1.0 - d, 2.2) * 0.55;

  float a = smudge * (0.25 + vSettle * 0.45) * vReveal
          * mix(1.0, 0.2, vDim) * (1.0 + vSelect * 1.2);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(dither(aces(uGap * a * 1.6), gl_FragCoord.xy), a);
}
`;

/* ---------------------------------------------------------------- materials */

type Uniform<T> = { value: T };

type RingUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uSize: Uniform<number>;
  uGhostSize: Uniform<number>;
  uFill: Uniform<number[]>;
  uRadius: Uniform<number[]>;
  uSelect: Uniform<number[]>;
  uDim: Uniform<number[]>;
  uEstate: Uniform<number[]>;
  uSeen: Uniform<THREE.Color>;
  uGap: Uniform<THREE.Color>;
};

const GLOW_DEFAULTS = {
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
} as const;

/**
 * One uniform record for all three layers. Sharing the object rather than its
 * values is what guarantees the ring, the light on it and the marks beyond it
 * can never disagree about where the knowledge stops.
 */
function createUniforms(rings: RingLayout[]): RingUniforms {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uSize: { value: MOTE_SIZE },
    uGhostSize: { value: GHOST_SIZE },
    uFill: { value: new Array<number>(MAX_RINGS).fill(0) },
    uRadius: {
      value: Array.from({ length: MAX_RINGS }, (_, i) => rings[i]?.radius ?? 0),
    },
    uSelect: { value: new Array<number>(MAX_RINGS).fill(0) },
    uDim: { value: new Array<number>(MAX_RINGS).fill(0) },
    uEstate: {
      value: Array.from({ length: MAX_RINGS }, (_, i) => (rings[i]?.estate ? 1 : 0)),
    },
    uSeen: { value: hexColor(PALETTE.foil) },
    uGap: { value: hexColor(PALETTE.dusk) },
  };
}

/* ---------------------------------------------------------------- component */

export interface UnseenProps {
  data: InstallationData;
  reveal?: number;
  /** Station id, 'ESTATE', or null. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}

export function Unseen({ data, reveal = 1, selected = null, onSelect }: UnseenProps) {
  const groupRef = useRef<THREE.Group>(null);
  const revealRef = useRef(0);
  const { camera, size } = useThree();

  const rings = useMemo(() => buildRings(data), [data]);

  const ringGeometry = useMemo(() => buildRingGeometry(rings), [rings]);
  const moteGeometry = useMemo(() => buildMoteGeometry(rings), [rings]);
  const ghostGeometry = useMemo(() => buildGhostGeometry(rings), [rings]);
  const backdropGeometry = useMemo(() => new THREE.PlaneGeometry(60, 40), []);

  const uniforms = useMemo(() => createUniforms(rings), [rings]);

  const materials = useMemo(() => {
    const make = (vertexShader: string, fragmentShader: string) =>
      new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, ...GLOW_DEFAULTS });
    return {
      // Double-sided: the ribbons lie in the screen plane and the figure turns.
      ring: (() => {
        const material = make(RING_VERT, RING_FRAG);
        material.side = THREE.DoubleSide;
        return material;
      })(),
      motes: make(MOTE_VERT, MOTE_FRAG),
      ghosts: make(GHOST_VERT, GHOST_FRAG),
    };
  }, [uniforms]);

  const backdropMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    []
  );

  useEffect(() => {
    const geometries = [ringGeometry, moteGeometry, ghostGeometry, backdropGeometry];
    return () => {
      geometries.forEach(geometry => geometry.dispose());
      Object.values(materials).forEach(material => material.dispose());
      backdropMaterial.dispose();
    };
  }, [ringGeometry, moteGeometry, ghostGeometry, backdropGeometry, materials, backdropMaterial]);

  /**
   * Picking by radius rather than by proximity to the stroke: the rings are
   * concentric and a quarter of every one of them is a dashed gap with nothing
   * to hit. Projecting the pointer back into the figure's own plane and taking
   * the nearest radius means the open part of a ring is as touchable as the
   * closed part — which it must be, since the gap is the subject.
   */
  const pick = (clientX: number, clientY: number): string | null => {
    const group = groupRef.current;
    if (!group) return null;
    const probe = new THREE.Vector3();
    let best: string | null = null;
    let bestDistance = PICK_RADIUS;

    // One point per ring at the pointer's own bearing, projected to screen, is
    // exact under any camera without needing an inverse projection.
    const bearing = Math.atan2(clientX - size.width / 2, -(clientY - size.height / 2));
    for (const ring of rings) {
      probe
        .set(Math.sin(bearing) * ring.radius, Math.cos(bearing) * ring.radius, 0)
        .applyMatrix4(group.matrixWorld)
        .project(camera);
      const sx = (probe.x * 0.5 + 0.5) * size.width;
      const sy = (-probe.y * 0.5 + 0.5) * size.height;
      // Compare in world units by scaling the screen miss back through the
      // ring's own on-screen radius.
      const onScreenRadius = Math.hypot(sx - size.width / 2, sy - size.height / 2);
      const pointerRadius = Math.hypot(clientX - size.width / 2, clientY - size.height / 2);
      const miss = (Math.abs(pointerRadius - onScreenRadius) / Math.max(1, onScreenRadius)) * ring.radius;
      if (miss < bestDistance) {
        bestDistance = miss;
        best = ring.id;
      }
    }
    return best;
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect?.(pick(event.nativeEvent.offsetX, event.nativeEvent.offsetY));
  };

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const dt = Math.min(delta, 1 / 15);
    const ease = (current: number, target: number, rate: number) =>
      current + (target - current) * (1 - Math.exp(-dt * rate));

    revealRef.current = ease(revealRef.current, THREE.MathUtils.clamp(reveal, 0, 1), 2.6);
    const r = revealRef.current;
    const eased = r * r * (3 - 2 * r);

    uniforms.uTime.value = time;
    uniforms.uReveal.value = eased;

    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = rings[i];
      const isSelected = ring != null && ring.id === selected;
      // The fill eases up from nothing, so the figure counts itself in rather
      // than appearing already counted.
      uniforms.uFill.value[i] = ease(
        uniforms.uFill.value[i],
        ring ? ring.completeness * eased : 0,
        3
      );
      uniforms.uSelect.value[i] = ease(uniforms.uSelect.value[i], isSelected ? 1 : 0, 5.5);
      uniforms.uDim.value[i] = ease(
        uniforms.uDim.value[i],
        selected !== null && !isSelected ? 1 : 0,
        4.5
      );
    }

    const group = groupRef.current;
    if (group) {
      group.visible = eased > 0.002;
      group.scale.setScalar(0.92 + 0.08 * eased);
      // A very slow turn. The rings are concentric, so rotation costs the figure
      // nothing in legibility and gives the dashes somewhere to go.
      group.rotation.z = time * 0.008;
    }
  });

  return (
    <group ref={groupRef} name="unseen">
      <mesh
        geometry={backdropGeometry}
        material={backdropMaterial}
        position={[0, 0, -4]}
        onPointerDown={handlePointerDown}
      />
      <mesh geometry={ringGeometry} material={materials.ring} renderOrder={1} />
      <points geometry={ghostGeometry} material={materials.ghosts} renderOrder={2} />
      <points geometry={moteGeometry} material={materials.motes} renderOrder={3} />
    </group>
  );
}
