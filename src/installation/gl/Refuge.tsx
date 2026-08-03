/**
 * Chapter — "Refuge".
 *
 * Every chapter before this one describes the estate. This one makes the survey's
 * argument: Purcari holds far more life than the farmland around it, and not one
 * hectare of it is protected.
 *
 * One luminous column per land use, in a row, like cores drawn from the ground or
 * bottles standing in a cellar. Height is how much diversity the land carries;
 * the count of motes inside is how many species were found there, so a column's
 * total light is both readings at once. The estate's own column is gold and
 * stands on a ring; the rest are parchment fading to ash. Industrial land is a
 * stub. That contrast is the whole chapter.
 *
 * `metric` cross-fades the row between the two surveys — camera-trap mammals and
 * BirdNET birds — in place, without reordering: the mammal reading is a jagged
 * skyline, the bird reading a high plateau with the estate on top, and industrial
 * land (which the bird survey never visited) fades out rather than pops.
 *
 * Beneath everything runs the protection line: a cold sheet whose filled height
 * is `protection.protConn` of the tallest column. That figure is 0.0%, so the
 * sheet fills nothing and all that remains is a hairline with no height at all.
 * It is drawn from the data, not drawn to look like an argument.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import { PALETTE, toRGB } from '../core/palette';
import type { InstallationData } from '../core/types';
import { DITHER, SIMPLEX_3D, SPRITE, TONEMAP } from './chunks';

/* ------------------------------------------------------------------ layout */

/**
 * Compile-time bound on the per-column uniform arrays. The survey ships seven
 * land uses; anything beyond this is dropped rather than silently overflowing
 * the arrays, which on some drivers is a black screen instead of an error.
 */
const MAX_COLUMNS = 8;

/** Capacity of one column. The density gate lights a fraction of these. */
const MOTES_PER_COLUMN = 300;

const COLUMN_GAP = 1.74;
const COLUMN_RADIUS = 0.32;
const MAX_HEIGHT = 5.0;
/** Mote size in WORLD units — the vertex shader converts to pixels by depth. */
const MOTE_SIZE = 0.42;

/** The row stands on y = 0; the group is dropped so it frames a camera aimed at the origin. */
const BASE_Y = -1.85;

const HERO_RING_INNER = 0.46;
const HERO_RING_OUTER = 0.92;

/** How far above and below the baseline the protection sheet reaches. */
const PROT_BAND = 0.74;
const PROT_BELOW = 0.14;

/** Finger-sized pick radius, in CSS pixels. */
const PICK_RADIUS = 70;

const hexColor = (hex: string): THREE.Color => new THREE.Color().fromArray(toRGB(hex));

/**
 * Deterministic pseudo-random from a land-use name — the same column always
 * grows the same way, so a returning visitor sees the same estate.
 */
function rand(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/* -------------------------------------------------------------- data → row */

/** One metric's reading of a land use: how tall its column stands, how full it is. */
interface Reading {
  /** World units. */
  height: number;
  /** 0..1 fraction of the column's mote capacity that is alive. */
  fill: number;
}

interface ColumnLayout {
  landUse: string;
  self: boolean;
  x: number;
  /** null when the land use is missing from that survey — it fades out, never pops. */
  camera: Reading | null;
  bird: Reading | null;
  color: THREE.Color;
}

/**
 * Density floor: the sparsest column still has to read as a column rather than
 * as a handful of stray sparks.
 */
function density(richness: number, max: number): number {
  return 0.16 + 0.84 * (richness / Math.max(1, max));
}

/**
 * Motes are laid out along the column's height, so the count that fills a column
 * is the linear density times the height — richness sets how thick the light is
 * per metre, diversity sets how far up it goes.
 */
function reading(heightNorm: number, richness: number, maxRichness: number): Reading {
  return {
    height: heightNorm * MAX_HEIGHT,
    fill: Math.min(1, heightNorm * density(richness, maxRichness)),
  };
}

function buildColumns(data: InstallationData): ColumnLayout[] {
  const bench = data.narrative.benchmark;
  const birds = data.narrative.birdBenchmark;

  /**
   * Shannon is converted to its effective number of species (exp H, the Hill
   * number N1) before it becomes a height. This is not decoration: a Shannon of
   * 1.00 is land behaving like 2.7 equally common species and 2.32 is land
   * behaving like 10, and only the exponential says so. Mapping the raw index
   * would put industrial land at 43% of the vineyard's height, which is not what
   * the survey found. It also puts both metrics in the same unit — species — so
   * the cross-fade compares like with like.
   */
  const effective = new Map(bench.map((entry) => [entry.landUse, Math.exp(entry.shannon)]));
  const maxEffective = Math.max(...effective.values(), 1);
  const maxCameraRichness = Math.max(...bench.map((entry) => entry.richness), 1);
  const maxBirdRichness = Math.max(...birds.map((entry) => entry.richness), 1);

  const cameraByUse = new Map(bench.map((entry) => [entry.landUse, entry]));
  const birdByUse = new Map(birds.map((entry) => [entry.landUse, entry]));

  /**
   * Row order is the camera survey's own ranking, richest first, and it never
   * changes with `metric`. Re-sorting on the cross-fade would slide every column
   * sideways and destroy the one thing the row is for — watching a fixed set of
   * places rise and fall as you change who you ask. The cost is that the bird
   * reading is not monotonic left to right, which is honest: wooded park is
   * fourth for mammals and last for birds.
   */
  const order = [...bench].sort((a, b) => b.shannon - a.shannon).map((entry) => entry.landUse);
  for (const entry of birds) if (!order.includes(entry.landUse)) order.push(entry.landUse);

  const kept = order.slice(0, MAX_COLUMNS);
  const span = (kept.length - 1) * COLUMN_GAP;

  const hero = hexColor(PALETTE.foil);
  const rich = hexColor(PALETTE.parchment);
  const poor = hexColor(PALETTE.ash);

  return kept.map((landUse, i) => {
    const cam = cameraByUse.get(landUse);
    const bird = birdByUse.get(landUse);
    const self = cam?.self ?? bird?.self ?? false;
    return {
      landUse,
      self,
      x: i * COLUMN_GAP - span / 2,
      camera: cam
        ? reading((effective.get(landUse) ?? 1) / maxEffective, cam.richness, maxCameraRichness)
        : null,
      bird: bird ? reading(bird.richness / maxBirdRichness, bird.richness, maxBirdRichness) : null,
      // Everything that is not the estate is drained toward ash down the row, so
      // the gold column is legible in the first half-second.
      color: self ? hero.clone() : rich.clone().lerp(poor, i / Math.max(1, kept.length - 1)),
    };
  });
}

/* --------------------------------------------------------------- geometries */

/**
 * All columns in ONE Points buffer — a single draw call for the whole row.
 * `position` carries only the column's axis; the offset inside the column and
 * the height along it are attributes the vertex shader resolves per frame, which
 * is what lets height and density change without touching the buffer.
 */
function buildMoteGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const count = columns.length * MOTES_PER_COLUMN;
  const positions = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 2);
  const columnIndex = new Float32Array(count);
  const phases = new Float32Array(count);
  const ranks = new Float32Array(count);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const scales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const heroes = new Float32Array(count);

  let k = 0;
  columns.forEach((column, ci) => {
    const radius = column.self ? COLUMN_RADIUS * 1.15 : COLUMN_RADIUS;
    for (let m = 0; m < MOTES_PER_COLUMN; m++) {
      const salt = m * 8;
      // sqrt of a uniform sample fills the disc evenly instead of crowding the axis.
      const r = radius * Math.sqrt(rand(column.landUse, salt + 1));
      const theta = rand(column.landUse, salt + 2) * Math.PI * 2;

      positions[k * 3] = column.x;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = 0;
      offsets[k * 2] = Math.cos(theta) * r;
      offsets[k * 2 + 1] = Math.sin(theta) * r;

      columnIndex[k] = ci;
      phases[k] = rand(column.landUse, salt + 3);
      // The density gate keeps motes whose rank falls under the current fill.
      // A random rank rather than a sequential one means the motes that drop out
      // are scattered through the column instead of shearing off its top.
      ranks[k] = rand(column.landUse, salt + 4);
      speeds[k] = 0.55 + rand(column.landUse, salt + 5) * 0.9;
      seeds[k] = rand(column.landUse, salt + 6);
      scales[k] = MOTE_SIZE * (0.7 + rand(column.landUse, salt + 7) * 0.7) * (column.self ? 1.3 : 1);

      colors[k * 3] = column.color.r;
      colors[k * 3 + 1] = column.color.g;
      colors[k * 3 + 2] = column.color.b;
      heroes[k] = column.self ? 1 : 0;
      k++;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2));
  geometry.setAttribute('aColumn', new THREE.BufferAttribute(columnIndex, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aHero', new THREE.BufferAttribute(heroes, 1));

  // Every mote's stored position sits on the baseline; the rise happens in the
  // shader, so an automatic bounding sphere would be a flat line and the row
  // would cull itself away the moment the camera looked slightly down.
  const half = (columns.length - 1) * COLUMN_GAP * 0.5 + COLUMN_RADIUS;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, MAX_HEIGHT * 0.5, 0),
    Math.hypot(half, MAX_HEIGHT * 0.5) + 1,
  );
  return geometry;
}

/** Row half-width, including the margin the baseline and sheet run out to. */
function rowExtent(columns: ColumnLayout[]): number {
  return (columns.length - 1) * COLUMN_GAP * 0.5 + COLUMN_GAP * 0.85;
}

/**
 * The ground the columns stand on: one hairline rule across the row, plus a
 * short cross tick in depth under each column so the cores read as standing on
 * something rather than floating.
 */
function buildBaselineGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const half = rowExtent(columns);
  const positions: number[] = [];
  const colors: number[] = [];
  const rule = hexColor(PALETTE.ash);
  const tick = hexColor(PALETTE.parchment);

  const segments = 120;
  for (let i = 0; i < segments; i++) {
    for (const t of [i / segments, (i + 1) / segments]) {
      // Both ends fade out, so the rule has no visible termination.
      const fade = Math.pow(Math.sin(t * Math.PI), 0.55) * 0.34;
      positions.push(-half + t * half * 2, 0, 0);
      colors.push(rule.r * fade, rule.g * fade, rule.b * fade);
    }
  }

  // Two segments meeting under the column centre, so the tick can fade at both
  // ends — a single segment has only two vertices and cannot.
  for (const column of columns) {
    for (const sign of [-1, 1]) {
      positions.push(column.x, 0, 0.5 * sign);
      colors.push(0, 0, 0);
      positions.push(column.x, 0, 0);
      colors.push(tick.r * 0.3, tick.g * 0.3, tick.b * 0.3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildProtectionGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(rowExtent(columns) * 2 + 0.6, PROT_BAND);
  // Sit the sheet so y = 0 falls just inside its lower edge: the hairline needs a
  // little room to bleed downward or it clips against its own boundary.
  geometry.translate(0, PROT_BAND * 0.5 - PROT_BELOW, 0);
  return geometry;
}

/* ------------------------------------------------------------------ shaders */

const MOTE_VERT = /* glsl */ `
${SIMPLEX_3D}
#define MAX_COLUMNS ${MAX_COLUMNS}

attribute vec2 aOffset;    // where this mote sits inside its column's disc
attribute float aColumn;
attribute float aPhase;    // start height, 0..1 of the column
attribute float aRank;     // 0..1 rank used by the density gate
attribute float aSeed;
attribute float aSpeed;
attribute float aScale;    // world units
attribute vec3 aColor;
attribute float aHero;

uniform float uTime;
uniform float uReveal;
uniform float uFocus;      // 0 = nothing selected, 1 = something is
uniform float uCount;
uniform float uRise;       // column heights per second
uniform float uSway;
uniform float uHeight[MAX_COLUMNS];
uniform float uFill[MAX_COLUMNS];
uniform float uPresence[MAX_COLUMNS];
uniform float uSelect[MAX_COLUMNS];

varying vec3 vColor;
varying float vGlow;
varying float vAlpha;
varying float vHero;

void main(){
  // Uniform arrays are indexed here and nowhere else: GLSL ES 1.00 allows a
  // non-constant index into a uniform array in the vertex stage only, so every
  // per-column value reaches the fragment stage as a varying.
  int idx = int(aColumn + 0.5);
  float height = uHeight[idx];
  float fill = uFill[idx];
  float presence = uPresence[idx];
  float sel = uSelect[idx];

  // The row arrives left to right rather than all at once — a lag of 0.3 across
  // the whole reveal, which is a beat, not a queue.
  float order = aColumn / max(uCount - 1.0, 1.0);
  float rv = clamp(uReveal * 1.3 - order * 0.3, 0.0, 1.0);
  rv = rv * rv * (3.0 - 2.0 * rv);

  // Motes drift up the column and recycle at its foot.
  float rise = fract(aPhase + uTime * uRise * aSpeed);
  float y = rise * height * rv;

  // Fade at both ends so the recycle is a disappearance, not a jump; the top
  // fade also gives the core a soft tip instead of a cut edge.
  float ends = smoothstep(0.0, 0.05, rise) * (1.0 - smoothstep(0.88, 1.0, rise));

  // Density. The upper bound overshoots 1.0 so a completely full column keeps
  // its top decile of motes instead of dimming them.
  float alive = 1.0 - smoothstep(fill - 0.08, fill + 0.06, aRank);

  // A slow spindle: the light narrows as it climbs, and wanders as it goes.
  float taper = 1.0 - 0.20 * smoothstep(0.35, 1.0, rise);
  float t = uTime * 0.05 + aSeed * 40.0;
  vec2 wander = vec2(
    snoise(vec3(aOffset.x * 1.4, y * 0.45, t)),
    snoise(vec3(aOffset.y * 1.4, y * 0.45, t + 13.0))
  );
  vec3 p = vec3(
    position.x + aOffset.x * taper + wander.x * uSway,
    y,
    position.z + aOffset.y * taper + wander.y * uSway
  );

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float breathe = 1.0 + sin(uTime * 0.9 + aSeed * 6.2831) * 0.10;
  float size = aScale * breathe * (1.0 + sel * 0.35) * (0.62 + 0.38 * rv);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;

  vColor = aColor;
  vHero = aHero;
  // The estate burns brighter than its neighbours before any selection happens;
  // a selection then lifts one column and drops the rest well below it.
  vGlow = mix(0.52, 1.0, aHero) * mix(1.0, mix(0.26, 1.55, sel), uFocus);
  vAlpha = alive * ends * presence * rv;
}
`;

const MOTE_FRAG = /* glsl */ `
${SPRITE}
varying vec3 vColor;
varying float vGlow;
varying float vAlpha;
varying float vHero;

void main(){
  float mask = spriteAlpha(gl_PointCoord, 0.6);
  float a = mask * vAlpha * 0.62;
  if (a <= 0.002) discard;

  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.40, d);

  // Kept well under 1.0 before blending: several hundred additive motes overlap
  // inside the densest column and the bloom pass sits downstream of all of them.
  vec3 color = vColor * vGlow;
  color += vec3(1.0, 0.94, 0.80) * core * (0.14 + vHero * 0.34) * vGlow;

  gl_FragColor = vec4(color * a, a);
}
`;

const PROTECTION_VERT = /* glsl */ `
varying vec2 vUv;
varying float vY;

void main(){
  vUv = uv;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PROTECTION_FRAG = /* glsl */ `
${DITHER}
${TONEMAP}
uniform vec3 uColor;
uniform float uTime;
uniform float uReveal;
uniform float uProtected;   // world height of the protected share of the row

varying vec2 vUv;
varying float vY;

void main(){
  // The sheet fills from the baseline up to uProtected, which is protConn of
  // the tallest column. protConn is 0.0%, so this term evaluates to nothing
  // anywhere and the fill is never drawn. The absence is computed, not staged.
  float fill = (1.0 - smoothstep(uProtected - 0.02, uProtected + 0.02, vY)) * step(0.0, vY);

  float line = exp(-abs(vY) * 30.0);
  float haze = exp(-max(vY, 0.0) * 5.0) * 0.10;
  float ends = smoothstep(0.0, 0.10, vUv.x) * (1.0 - smoothstep(0.90, 1.0, vUv.x));
  // A slow brightening travelling along the line, so it is cold but not dead.
  float travel = 0.76 + 0.24 * sin(vUv.x * 9.0 - uTime * 0.32);

  float glow = (line * 0.42 * travel + haze + fill * 0.35) * ends * uReveal;
  gl_FragColor = vec4(dither(aces(uColor * glow), gl_FragCoord.xy), clamp(glow, 0.0, 1.0));
}
`;

const RING_VERT = /* glsl */ `
varying float vRadius;

void main(){
  // RingGeometry is built in its local XY plane, so the radius is available
  // before the mesh is laid flat.
  vRadius = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uReveal;
uniform float uInner;
uniform float uOuter;

varying float vRadius;

void main(){
  float t = clamp((vRadius - uInner) / max(uOuter - uInner, 1e-4), 0.0, 1.0);
  // A crest in the middle of the band: no hard edge on either side.
  float band = pow(sin(t * 3.14159265), 1.6);
  float pulse = 0.74 + 0.26 * sin(uTime * 0.55);
  float glow = band * 0.30 * pulse * uReveal;
  gl_FragColor = vec4(uColor * glow, glow);
}
`;

/* ---------------------------------------------------------------- materials */

type Uniform<T> = { value: T };

/** Object types (not interfaces) so they satisfy ShaderMaterial's index signature. */
type MoteUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uFocus: Uniform<number>;
  uCount: Uniform<number>;
  uRise: Uniform<number>;
  uSway: Uniform<number>;
  uHeight: Uniform<number[]>;
  uFill: Uniform<number[]>;
  uPresence: Uniform<number[]>;
  uSelect: Uniform<number[]>;
};

type ProtectionUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uProtected: Uniform<number>;
  uColor: Uniform<THREE.Color>;
};

type RingUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uInner: Uniform<number>;
  uOuter: Uniform<number>;
  uColor: Uniform<THREE.Color>;
};

interface Shaded<U> {
  material: THREE.ShaderMaterial;
  uniforms: U;
}

/** Nothing in this chapter is lit; everything is emissive. */
const GLOW_DEFAULTS = {
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
} as const;

function createMoteMaterial(): Shaded<MoteUniforms> {
  const uniforms: MoteUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uFocus: { value: 0 },
    uCount: { value: 1 },
    // One full pass up a column takes roughly twenty seconds at the slowest.
    uRise: { value: 0.055 },
    uSway: { value: 0.085 },
    uHeight: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uFill: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uPresence: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uSelect: { value: new Array<number>(MAX_COLUMNS).fill(0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

function createProtectionMaterial(protectedHeight: number): Shaded<ProtectionUniforms> {
  const uniforms: ProtectionUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uProtected: { value: protectedHeight },
    // The one cold colour in a chapter otherwise made of candlelight.
    uColor: { value: hexColor(PALETTE.dusk) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PROTECTION_VERT,
    fragmentShader: PROTECTION_FRAG,
    side: THREE.DoubleSide,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

function createRingMaterial(): Shaded<RingUniforms> {
  const uniforms: RingUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uInner: { value: HERO_RING_INNER },
    uOuter: { value: HERO_RING_OUTER },
    uColor: { value: hexColor(PALETTE.foil) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    side: THREE.DoubleSide,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

/* ---------------------------------------------------------------- component */

/** Screen-space distance from a point to a segment, in pixels. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export interface RefugeProps {
  data: InstallationData;
  reveal?: number;
  /** 0 = camera/mammal Shannon comparison, 1 = bird richness comparison. Cross-fade between them. */
  metric?: number;
  /** Which land use is selected, by `landUse` string, or null. */
  selected?: string | null;
  onSelect?: (landUse: string | null) => void;
}

export function Refuge({ data, reveal = 1, metric = 0, selected = null, onSelect }: RefugeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const revealRef = useRef(0);
  /** Seeded from the prop so the first frame is already the requested metric. */
  const metricRef = useRef(THREE.MathUtils.clamp(metric, 0, 1));
  const focusRef = useRef(0);
  const { camera, size } = useThree();

  const columns = useMemo(() => buildColumns(data), [data]);
  const hero = useMemo(() => columns.find((column) => column.self) ?? null, [columns]);

  /** protConn is a percentage; at 0.0% the sheet's fill has no height whatsoever. */
  const protectedHeight = useMemo(
    () => (data.narrative.protection.protConn / 100) * MAX_HEIGHT,
    [data.narrative.protection.protConn],
  );

  const moteGeometry = useMemo(() => buildMoteGeometry(columns), [columns]);
  const baselineGeometry = useMemo(() => buildBaselineGeometry(columns), [columns]);
  const protectionGeometry = useMemo(() => buildProtectionGeometry(columns), [columns]);
  const ringGeometry = useMemo(
    () => new THREE.RingGeometry(HERO_RING_INNER, HERO_RING_OUTER, 96),
    [],
  );
  /** Invisible catcher, so a tap anywhere in the frame can pick or clear. */
  const backdropGeometry = useMemo(() => new THREE.PlaneGeometry(60, 40), []);

  const motes = useMemo(() => createMoteMaterial(), []);
  const protection = useMemo(() => createProtectionMaterial(protectedHeight), [protectedHeight]);
  const ring = useMemo(() => createRingMaterial(), []);
  const baselineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        opacity: 0,
        ...GLOW_DEFAULTS,
      }),
    [],
  );
  const backdropMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [],
  );

  useEffect(() => {
    const geometries = [
      moteGeometry,
      baselineGeometry,
      protectionGeometry,
      ringGeometry,
      backdropGeometry,
    ];
    const materials = [
      motes.material,
      protection.material,
      ring.material,
      baselineMaterial,
      backdropMaterial,
    ];
    return () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    };
  }, [
    moteGeometry,
    baselineGeometry,
    protectionGeometry,
    ringGeometry,
    backdropGeometry,
    motes,
    protection,
    ring,
    baselineMaterial,
    backdropMaterial,
  ]);

  /**
   * Nearest column in screen space. A column is a tall stroke, not a dot, so the
   * test is against its projected axis — a radius around its centre would miss
   * the top of the vineyard and the whole of the industrial stub.
   *
   * Reads the live uniform arrays rather than the data, so mid-cross-fade the
   * pick matches what is actually on screen.
   */
  const pick = (clientX: number, clientY: number): string | null => {
    const group = groupRef.current;
    if (!group) return null;
    const heights = motes.uniforms.uHeight.value;
    const presence = motes.uniforms.uPresence.value;
    const foot = new THREE.Vector3();
    const head = new THREE.Vector3();
    let best: string | null = null;
    let bestDistance = PICK_RADIUS;

    for (let i = 0; i < columns.length; i++) {
      // A column that has faded out is not there to be touched.
      if (presence[i] < 0.25) continue;
      foot.set(columns[i].x, 0, 0).applyMatrix4(group.matrixWorld).project(camera);
      head.set(columns[i].x, heights[i], 0).applyMatrix4(group.matrixWorld).project(camera);
      const distance = distanceToSegment(
        clientX,
        clientY,
        (foot.x * 0.5 + 0.5) * size.width,
        (-foot.y * 0.5 + 0.5) * size.height,
        (head.x * 0.5 + 0.5) * size.width,
        (-head.y * 0.5 + 0.5) * size.height,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = columns[i].landUse;
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
    // Clamp the step so a tab-switch stall cannot snap every transition open.
    const dt = Math.min(delta, 1 / 15);
    // Time-based exponential smoothing: identical response at 30 or 144 fps.
    const ease = (current: number, target: number, rate: number) =>
      current + (target - current) * (1 - Math.exp(-dt * rate));

    revealRef.current = ease(revealRef.current, THREE.MathUtils.clamp(reveal, 0, 1), 2.6);
    metricRef.current = ease(metricRef.current, THREE.MathUtils.clamp(metric, 0, 1), 1.5);
    focusRef.current = ease(focusRef.current, selected === null ? 0 : 1, 4.5);

    const r = revealRef.current;
    const eased = r * r * (3 - 2 * r);
    const m = metricRef.current;

    const u = motes.uniforms;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      // A land use missing from one survey borrows the other's shape, so it holds
      // its form while `uPresence` fades it out — nothing collapses to zero height.
      const cam = column.camera ?? column.bird;
      const bird = column.bird ?? column.camera;
      if (!cam || !bird) continue;
      // `m` is already eased, so the blended targets are smooth without a second
      // filter — and on the first frame they are exactly right, not zero.
      u.uHeight.value[i] = cam.height * (1 - m) + bird.height * m;
      u.uFill.value[i] = cam.fill * (1 - m) + bird.fill * m;
      u.uPresence.value[i] = (column.camera ? 1 - m : 0) + (column.bird ? m : 0);
      // Selection is a prop change rather than a continuous control, so this one
      // gets its own ease. It never touches React state.
      u.uSelect.value[i] = ease(u.uSelect.value[i], column.landUse === selected ? 1 : 0, 5.5);
    }

    u.uTime.value = time;
    u.uReveal.value = eased;
    u.uFocus.value = focusRef.current;
    u.uCount.value = columns.length;

    protection.uniforms.uTime.value = time;
    protection.uniforms.uReveal.value = eased;
    ring.uniforms.uTime.value = time;
    ring.uniforms.uReveal.value = eased * (1 - focusRef.current * 0.35);
    baselineMaterial.opacity = eased * 0.9;

    const group = groupRef.current;
    if (group) {
      group.visible = eased > 0.002;
      // The row lifts into place as it brightens, and then keeps a barely
      // perceptible sway — enough parallax to give the cores depth, far too
      // little to notice on a screen someone stands in front of for an hour.
      group.position.y = BASE_Y - (1 - eased) * 0.3;
      group.rotation.y = Math.sin(time * 0.05) * 0.045;
    }
  });

  return (
    <group ref={groupRef} name="refuge" position={[0, BASE_Y, 0]}>
      <mesh
        geometry={backdropGeometry}
        material={backdropMaterial}
        position={[0, MAX_HEIGHT * 0.5, -4]}
        onPointerDown={handlePointerDown}
      />

      <mesh geometry={protectionGeometry} material={protection.material} renderOrder={1} />
      <lineSegments geometry={baselineGeometry} material={baselineMaterial} renderOrder={2} />

      {hero && (
        <mesh
          geometry={ringGeometry}
          material={ring.material}
          position={[hero.x, 0.012, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={2}
        />
      )}

      <points geometry={moteGeometry} material={motes.material} renderOrder={3} />
    </group>
  );
}
