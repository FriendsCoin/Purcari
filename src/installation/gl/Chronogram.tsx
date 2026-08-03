/**
 * Chapter — "The Year".
 *
 * One year of wildlife at Château Purcari wound onto a disc. The angle is the
 * month (January at the top, the year running clockwise), the radius is the hour
 * of the day (midnight at the inner rim, noon half-way out, midnight again at
 * the outer rim), and the light is how much was detected in that hour of that
 * month. Every concentric ring is one hour; every sector is one month.
 *
 * Laid over it are the two solar ribbons — sunrise and sunset — read straight
 * from the survey's own solar table. Everything between them is daylight,
 * everything outside them is night (dimmed and cooled in the shader), and the
 * bright band that hugs the sunrise ribbon from March to June is the dawn
 * chorus. That coincidence is the payoff of the whole chapter.
 *
 * Geometry note: this is ONE polar BufferGeometry — 145 × 121 vertices, a single
 * draw call — rather than 576 instanced quads. The cells stay legible because
 * the fragment shader engraves the 12 × 24 seams, but the interpolated field
 * lets the dawn ridge read as a continuous crest instead of a staircase, and it
 * lets the camera/sound blend cross-fade per vertex instead of swapping data.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import { sunAt } from '../core/data';
import { ACTIVITY_RAMP, PALETTE, toRGB } from '../core/palette';
import type { InstallationData } from '../core/types';
import { DITHER, SIMPLEX_3D, TONEMAP, VIGNETTE } from './chunks';

/* ------------------------------------------------------------------ layout */

const TAU = Math.PI * 2;
const MONTHS = 12;
const HOURS = 24;

/** Midnight sits on the inner rim, the next midnight on the outer one. */
const INNER_RADIUS = 1.2;
const OUTER_RADIUS = 5.0;

/** 12 sub-steps per month, 5 per hour — smooth enough to hide the tessellation. */
const ANGULAR_STEPS = MONTHS * 12;
const RADIAL_STEPS = HOURS * 5;

/** The record turns once every 40 seconds. */
const PLAYHEAD_PERIOD = 40;
const PLAYHEAD_HEIGHT = 0.82;
const RIBBON_HEIGHT = 0.42;
const STRUCTURE_HEIGHT = 0.015;

/** Counts are heavy-tailed; a mild gamma keeps January from collapsing to zero. */
const GLOBAL_GAMMA = 0.7;

const RING_SEGMENTS = 192;

/** Hour of day → radius on the disc. The inverse lives in `readCell`. */
function radiusForHour(hour: number): number {
  return INNER_RADIUS + (hour / HOURS) * (OUTER_RADIUS - INNER_RADIUS);
}

/**
 * Year fraction (0 = 1 January) → position on the disc.
 * x = sin θ · r, z = −cos θ · r puts θ = 0 at −Z (screen top when the disc is
 * viewed from above) and makes increasing θ run clockwise on screen.
 */
function discPoint(yearFrac: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const theta = yearFrac * TAU;
  return out.set(Math.sin(theta) * radius, 0, -Math.cos(theta) * radius);
}

const hexColor = (hex: string): THREE.Color => new THREE.Color().fromArray(toRGB(hex));

/* -------------------------------------------------------------- data → mesh */

/** Cell centres sit at index + 0.5, and both axes wrap: the year and the day are cycles. */
function cyclicWeights(coord: number, length: number): { a: number; b: number; f: number } {
  const shifted = coord - 0.5;
  const floor = Math.floor(shifted);
  const f = shifted - floor;
  const a = ((floor % length) + length) % length;
  return { a, b: (a + 1) % length, f };
}

/** Bilinear sample of a [month][hour] grid at continuous (0..12, 0..24) coordinates. */
function sampleGrid(grid: number[][], monthCoord: number, hourCoord: number): number {
  const m = cyclicWeights(monthCoord, MONTHS);
  const h = cyclicWeights(hourCoord, HOURS);
  const top = grid[m.a][h.a] * (1 - h.f) + grid[m.a][h.b] * h.f;
  const bottom = grid[m.b][h.a] * (1 - h.f) + grid[m.b][h.b] * h.f;
  return top * (1 - m.f) + bottom * m.f;
}

/** Cyclic sample of a per-month series (the solar table) at a continuous month. */
function sampleMonthly(values: number[], monthCoord: number): number {
  const m = cyclicWeights(monthCoord, MONTHS);
  return values[m.a] * (1 - m.f) + values[m.b] * m.f;
}

/** Normalised against the busiest cell of the whole year — keeps the season honest. */
function normaliseGlobal(grid: number[][]): number[][] {
  let max = 0;
  for (const row of grid) for (const v of row) max = Math.max(max, v);
  const inv = max > 0 ? 1 / max : 0;
  return grid.map(row => row.map(v => Math.pow(Math.max(0, v) * inv, GLOBAL_GAMMA)));
}

/** Normalised inside each month — this is what keeps a December dawn visible at all. */
function normaliseByMonth(grid: number[][]): number[][] {
  return grid.map(row => {
    const max = Math.max(...row, 1);
    return row.map(v => Math.max(0, v) / max);
  });
}

function buildFieldGeometry(data: InstallationData): THREE.BufferGeometry {
  const cameraGlobal = normaliseGlobal(data.surface.camera);
  const soundGlobal = normaliseGlobal(data.surface.sound);
  const cameraLocal = normaliseByMonth(data.surface.camera);
  const soundLocal = normaliseByMonth(data.surface.sound);
  const sunrise = Array.from({ length: MONTHS }, (_, m) => sunAt(data, m).sunrise);
  const sunset = Array.from({ length: MONTHS }, (_, m) => sunAt(data, m).sunset);

  const cols = ANGULAR_STEPS + 1;
  const rows = RADIAL_STEPS + 1;
  const count = cols * rows;

  const positions = new Float32Array(count * 3);
  const polar = new Float32Array(count * 2);
  const activity = new Float32Array(count * 2);
  const relative = new Float32Array(count * 2);
  const solar = new Float32Array(count * 2);

  const scratch = new THREE.Vector3();

  for (let ai = 0; ai < cols; ai++) {
    // The seam column (ai === ANGULAR_STEPS) duplicates January so the ring closes
    // without a lighting or data discontinuity.
    const yearFrac = ai / ANGULAR_STEPS;
    const monthCoord = yearFrac * MONTHS;
    const rise = sampleMonthly(sunrise, monthCoord);
    const set = sampleMonthly(sunset, monthCoord);

    for (let ri = 0; ri < rows; ri++) {
      const hourCoord = (ri / RADIAL_STEPS) * HOURS;
      const i = ai * rows + ri;
      discPoint(yearFrac, radiusForHour(hourCoord), scratch);

      positions[i * 3 + 0] = scratch.x;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = scratch.z;

      polar[i * 2 + 0] = monthCoord;
      polar[i * 2 + 1] = hourCoord;

      activity[i * 2 + 0] = sampleGrid(cameraGlobal, monthCoord, hourCoord);
      activity[i * 2 + 1] = sampleGrid(soundGlobal, monthCoord, hourCoord);
      relative[i * 2 + 0] = sampleGrid(cameraLocal, monthCoord, hourCoord);
      relative[i * 2 + 1] = sampleGrid(soundLocal, monthCoord, hourCoord);

      solar[i * 2 + 0] = rise;
      solar[i * 2 + 1] = set;
    }
  }

  const indices = new Uint32Array(ANGULAR_STEPS * RADIAL_STEPS * 6);
  let k = 0;
  for (let ai = 0; ai < ANGULAR_STEPS; ai++) {
    for (let ri = 0; ri < RADIAL_STEPS; ri++) {
      const a0 = ai * rows + ri;
      const a1 = a0 + 1;
      const b0 = (ai + 1) * rows + ri;
      const b1 = b0 + 1;
      indices[k++] = a0;
      indices[k++] = b0;
      indices[k++] = b1;
      indices[k++] = a0;
      indices[k++] = b1;
      indices[k++] = a1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  geometry.setAttribute('aActivity', new THREE.BufferAttribute(activity, 2));
  geometry.setAttribute('aRelative', new THREE.BufferAttribute(relative, 2));
  geometry.setAttribute('aSun', new THREE.BufferAttribute(solar, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * One solar ribbon. Twelve monthly samples become a closed Catmull-Rom loop so
 * December runs into January without a corner, then a thin tube so the line has
 * real width at any zoom (GL line width is not portable).
 */
function buildSolarRibbon(data: InstallationData, key: 'sunrise' | 'sunset'): THREE.TubeGeometry {
  const points: THREE.Vector3[] = [];
  for (let m = 0; m < MONTHS; m++) {
    // Each month's value belongs at the centre of its sector, not its edge.
    const p = discPoint(
      (m + 0.5) / MONTHS,
      radiusForHour(sunAt(data, m)[key]),
      new THREE.Vector3()
    );
    p.y = RIBBON_HEIGHT;
    points.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, 320, 0.032, 8, true);
}

/**
 * Hairline scaffolding, all in one buffer: the two rims, the twelve month
 * spokes, and an outer collar of 53 weekly ticks whose length is that week's
 * species richness — the year's phenology read as a ring of grass.
 */
function buildStructureGeometry(data: InstallationData): THREE.BufferGeometry {
  const positions: number[] = [];
  const alphas: number[] = [];
  const tints: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  const segment = (
    fracA: number,
    radiusA: number,
    fracB: number,
    radiusB: number,
    alpha: number,
    tint: number
  ) => {
    discPoint(fracA, radiusA, a);
    discPoint(fracB, radiusB, b);
    positions.push(a.x, STRUCTURE_HEIGHT, a.z, b.x, STRUCTURE_HEIGHT, b.z);
    alphas.push(alpha, alpha);
    tints.push(tint, tint);
  };

  for (let m = 0; m < MONTHS; m++) {
    segment(m / MONTHS, INNER_RADIUS, m / MONTHS, OUTER_RADIUS, 0.1, 0);
  }

  for (const [radius, alpha] of [
    [INNER_RADIUS, 0.22],
    [OUTER_RADIUS, 0.18],
  ] as const) {
    for (let i = 0; i < RING_SEGMENTS; i++) {
      segment(i / RING_SEGMENTS, radius, (i + 1) / RING_SEGMENTS, radius, alpha, 0);
    }
  }

  const richnessMax = Math.max(...data.weekly.map(w => w.richness), 1);
  for (const week of data.weekly) {
    const date = new Date(`${week.week}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    // Sectors are equal-width, so place a week by month + fraction of that month
    // rather than by day-of-year — otherwise the collar drifts off its sector.
    const month = date.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
    const frac = (month + (date.getUTCDate() - 1) / daysInMonth) / MONTHS;
    const norm = week.richness / richnessMax;
    segment(
      frac,
      OUTER_RADIUS + 0.16,
      frac,
      OUTER_RADIUS + 0.16 + 0.42 * norm,
      0.12 + 0.4 * norm,
      1
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
  geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** The sweep arm, built pointing at −Z (January) and rotated about +Y each frame. */
function buildPlayheadGeometry(): THREE.BufferGeometry {
  const inner = INNER_RADIUS - 0.12;
  const outer = OUTER_RADIUS + 0.5;
  const y = PLAYHEAD_HEIGHT;
  const positions = new Float32Array([
    -0.03,
    y,
    -inner,
    0.03,
    y,
    -inner,
    0.1,
    y,
    -outer,
    -0.1,
    y,
    -outer,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------- shaders */

/** Shared scalar helpers; injected only into the shaders that need them. */
const HELPERS = /* glsl */ `
/** Shortest distance between two positions on a unit ring, 0..0.5. */
float ringDist(float a, float b){ return abs(fract(a - b + 0.5) - 0.5); }
float gauss(float d, float s){ return exp(-(d * d) / (2.0 * s * s)); }
`;

const FIELD_VERT = /* glsl */ `
attribute vec2 aPolar;     // (month 0..12, hour 0..24) of this vertex
attribute vec2 aActivity;  // (camera, sound) normalised across the whole year
attribute vec2 aRelative;  // (camera, sound) normalised inside this month
attribute vec2 aSun;       // (sunrise, sunset) in decimal hours at this angle

uniform float uTime;
uniform float uReveal;
uniform float uPlay;
uniform vec2  uMix;
uniform vec3  uHover;      // (month 0..1, hour 0..1, strength)
uniform float uFocusFrac;
uniform float uFocusAmt;
uniform float uLift;

varying float vAct;
varying float vRel;
varying float vDay;
varying float vDawn;
varying float vPlay;
varying float vHover;
varying float vFocus;
varying vec2  vPolar;
varying vec2  vScreen;

${SIMPLEX_3D}
${HELPERS}

void main(){
  vPolar = aPolar;

  float monthFrac = aPolar.x / 12.0;  // 0..1 clockwise around the disc
  float hourNorm  = aPolar.y / 24.0;  // 0 at the inner rim, 1 at the outer rim

  // uMix always sums to 1, so 'both' is a true blend rather than a sum.
  float act = clamp(dot(aActivity, uMix), 0.0, 1.0);
  float rel = clamp(dot(aRelative, uMix), 0.0, 1.0);

  // A sector is 1/12 = 0.083 wide, so these sigmas are all sub-sector.
  float play  = gauss(ringDist(monthFrac, uPlay), 0.020);
  float focus = uFocusAmt * (1.0 - smoothstep(0.034, 0.047, ringDist(monthFrac, uFocusFrac)));
  float dm = ringDist(monthFrac, uHover.x);
  float hover = uHover.z * (
      gauss(dm, 0.017) * gauss(abs(hourNorm - uHover.y), 0.016)      // the cell
    + 0.18 * (1.0 - smoothstep(0.030, 0.045, dm))                    // its sector
  );

  // Low-amplitude fbm sampled in the disc's own plane and scrolled through the
  // noise's third axis by clock time — never by frame count.
  float shimmer = fbm(vec3(position.xz * 0.55, uTime * 0.06));

  // Day / night straight from the solar table, with a half-hour soft terminator.
  float day  = smoothstep(aSun.x - 0.5, aSun.x + 0.5, aPolar.y)
             * (1.0 - smoothstep(aSun.y - 0.5, aSun.y + 0.5, aPolar.y));
  float dawn = gauss(aPolar.y - aSun.x, 1.0);

  float lift = act * 0.60 + rel * 0.26;
  lift += play * (0.10 + act * 0.55);
  lift += hover * 0.22 + focus * 0.12 * (0.3 + act);
  lift += shimmer * 0.045 * (0.3 + act);
  lift *= uLift * uReveal;

  vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, lift, 0.0), 1.0);
  gl_Position = projectionMatrix * mv;

  vAct = act + shimmer * 0.05;
  vRel = rel;
  vDay = day;
  vDawn = dawn;
  vPlay = play;
  vHover = hover;
  vFocus = focus;
  vScreen = gl_Position.xy / max(gl_Position.w, 1e-4) * 0.5 + 0.5;
}
`;

const FIELD_FRAG = /* glsl */ `
#define RAMP_N ${ACTIVITY_RAMP.length}

uniform vec3  uRamp[RAMP_N];
uniform vec3  uDawn;
uniform vec3  uNightShift;
uniform float uReveal;
uniform float uNightDim;
uniform float uExposure;

varying float vAct;
varying float vRel;
varying float vDay;
varying float vDawn;
varying float vPlay;
varying float vHover;
varying float vFocus;
varying vec2  vPolar;
varying vec2  vScreen;

${DITHER}
${TONEMAP}
${VIGNETTE}

/** ACTIVITY_RAMP, sampled with a fixed loop so it stays portable. */
vec3 rampSample(float t){
  float x = clamp(t, 0.0, 1.0) * float(RAMP_N - 1);
  vec3 c = uRamp[0];
  for (int i = 0; i < RAMP_N - 1; i++){
    c = mix(c, uRamp[i + 1], clamp(x - float(i), 0.0, 1.0));
  }
  return c;
}

void main(){
  float energy = clamp(vAct, 0.0, 1.0);
  float relief = clamp(vRel, 0.0, 1.0);

  // Colour is carried mostly by the year-wide value, so June really does out-glow
  // January; the per-month value only lends a crest, which is what keeps a winter
  // dawn legible instead of crushed to black.
  float tone = clamp(energy * 0.82 + relief * 0.18, 0.0, 1.0);
  vec3 col = rampSample(pow(tone, 0.82));

  // Night is dimmed and cooled, never clipped — the ramp still carries the value.
  col = mix(col * uNightShift, col, vDay);
  float night = mix(uNightDim, 1.0, vDay);

  // Warm the band that hugs the sunrise ribbon toward the ribbon's own foil, but
  // only where there is activity to warm: a legibility device, not invented data.
  col = mix(col, uDawn, vDawn * 0.30 * smoothstep(0.10, 0.65, tone));

  float glow = (0.06 + energy * 0.62 + relief * 0.14) * night;
  glow *= 1.0 + vPlay * 0.65 + vHover * 1.2 + vFocus * 0.40;

  // Engrave the 12 × 24 cell seams at a constant screen width, so the disc still
  // reads as a chronogram rather than a smear.
  vec2 grid = abs(fract(vPolar - 0.5) - 0.5) / max(fwidth(vPolar), vec2(1e-4));
  float seam = 1.0 - clamp(min(grid.x, grid.y), 0.0, 1.0);
  glow *= 1.0 - 0.35 * seam;

  vec3 rgb = aces(col * glow * uExposure * uReveal);
  rgb *= vignette(vScreen, 0.45);
  rgb = dither(rgb, gl_FragCoord.xy);

  gl_FragColor = vec4(rgb, clamp(glow * 1.05, 0.0, 1.0) * uReveal);
}
`;

const RIBBON_VERT = /* glsl */ `
uniform float uTime;

varying float vYear;
varying float vFacing;
varying vec2  vScreen;

${SIMPLEX_3D}

void main(){
  // Recover the year fraction from the vertex itself — exact, and independent of
  // how the tube happened to parameterise the curve.
  vYear = fract(atan(position.x, -position.z) / 6.2831853);
  vFacing = normal.y;

  // A slow vertical breath so the solar line is never a dead stroke.
  float wob = snoise(vec3(position.xz * 0.35, uTime * 0.08)) * 0.03;
  vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, wob, 0.0), 1.0);
  gl_Position = projectionMatrix * mv;
  vScreen = gl_Position.xy / max(gl_Position.w, 1e-4) * 0.5 + 0.5;
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uReveal;
uniform float uPlay;
uniform float uIntensity;

varying float vYear;
varying float vFacing;
varying vec2  vScreen;

${DITHER}
${TONEMAP}
${VIGNETTE}
${HELPERS}

void main(){
  // Brightest on the upper face of the cord, so it reads as lit from the sky.
  float top = 0.55 + 0.45 * clamp(vFacing * 0.5 + 0.5, 0.0, 1.0);
  float play = gauss(ringDist(vYear, uPlay), 0.030);
  float glow = uIntensity * top * (0.6 + 0.9 * play);

  vec3 rgb = aces(uColor * glow);
  rgb *= vignette(vScreen, 0.35);
  rgb = dither(rgb, gl_FragCoord.xy);
  gl_FragColor = vec4(rgb, clamp(glow, 0.0, 1.0) * uReveal);
}
`;

const STRUCTURE_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aTint;

uniform vec3 uColorA;
uniform vec3 uColorB;

varying float vAlpha;
varying vec3  vColor;

void main(){
  vAlpha = aAlpha;
  vColor = mix(uColorA, uColorB, aTint);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STRUCTURE_FRAG = /* glsl */ `
uniform float uReveal;

varying float vAlpha;
varying vec3  vColor;

${DITHER}

void main(){
  float a = vAlpha * uReveal;
  gl_FragColor = vec4(dither(vColor, gl_FragCoord.xy), a);
}
`;

const PLAYHEAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PLAYHEAD_FRAG = /* glsl */ `
uniform vec3  uColor;
uniform float uReveal;
uniform float uTime;
uniform float uIntensity;

varying vec2 vUv;

${DITHER}
${TONEMAP}
${HELPERS}

void main(){
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float body = pow(clamp(across, 0.0, 1.0), 2.2);
  float along = smoothstep(0.0, 0.10, vUv.y) * (1.0 - smoothstep(0.70, 1.0, vUv.y));
  // A slow head running outward along the arm: midnight out to midnight.
  float head = gauss(vUv.y - fract(uTime * 0.14), 0.10);
  float glow = body * (along * 0.45 + head * 0.75) * uIntensity;

  vec3 rgb = dither(aces(uColor * glow), gl_FragCoord.xy);
  gl_FragColor = vec4(rgb, clamp(glow, 0.0, 1.0) * uReveal);
}
`;

/* ----------------------------------------------------------------- materials */

type Uniform<T> = { value: T };

/** Object types (not interfaces) so they satisfy ShaderMaterial's index signature. */
type FieldUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uPlay: Uniform<number>;
  uMix: Uniform<THREE.Vector2>;
  uHover: Uniform<THREE.Vector3>;
  uFocusFrac: Uniform<number>;
  uFocusAmt: Uniform<number>;
  uLift: Uniform<number>;
  uNightDim: Uniform<number>;
  uExposure: Uniform<number>;
  uRamp: Uniform<THREE.Color[]>;
  uDawn: Uniform<THREE.Color>;
  uNightShift: Uniform<THREE.Color>;
};

type RibbonUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uPlay: Uniform<number>;
  uColor: Uniform<THREE.Color>;
  uIntensity: Uniform<number>;
};

type StructureUniforms = {
  uReveal: Uniform<number>;
  uColorA: Uniform<THREE.Color>;
  uColorB: Uniform<THREE.Color>;
};

type PlayheadUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uColor: Uniform<THREE.Color>;
  uIntensity: Uniform<number>;
};

interface Shaded<U> {
  material: THREE.ShaderMaterial;
  uniforms: U;
}

/** Everything in this chapter is emissive: additive, no depth writes, no lights. */
const GLOW_DEFAULTS = {
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
} as const;

function createFieldMaterial(): Shaded<FieldUniforms> {
  const uniforms: FieldUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uPlay: { value: 0 },
    uMix: { value: new THREE.Vector2(0.5, 0.5) },
    uHover: { value: new THREE.Vector3(0, 0, 0) },
    uFocusFrac: { value: 0 },
    uFocusAmt: { value: 0 },
    uLift: { value: 0.45 },
    uNightDim: { value: 0.55 },
    // The surface is additively blended and then bloomed, so it has to sit well
    // under 1.0 before either stage — above ~0.7 the whole disc clips to white
    // and the ramp's hues drift to magenta.
    uExposure: { value: 0.62 },
    uRamp: { value: ACTIVITY_RAMP.map(hexColor) },
    uDawn: { value: hexColor(PALETTE.foil) },
    // A cool multiplier, not a new hue — the night side stays inside the palette.
    uNightShift: { value: new THREE.Color(0.8, 0.86, 1.08) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    side: THREE.DoubleSide,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

function createRibbonMaterial(hex: string, intensity: number): Shaded<RibbonUniforms> {
  const uniforms: RibbonUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uPlay: { value: 0 },
    uColor: { value: hexColor(hex) },
    uIntensity: { value: intensity },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

function createStructureMaterial(): Shaded<StructureUniforms> {
  const uniforms: StructureUniforms = {
    uReveal: { value: 0 },
    uColorA: { value: hexColor(PALETTE.gold) },
    uColorB: { value: hexColor(PALETTE.parchment) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STRUCTURE_VERT,
    fragmentShader: STRUCTURE_FRAG,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

function createPlayheadMaterial(): Shaded<PlayheadUniforms> {
  const uniforms: PlayheadUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uColor: { value: hexColor(PALETTE.candle) },
    uIntensity: { value: 0.7 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PLAYHEAD_VERT,
    fragmentShader: PLAYHEAD_FRAG,
    side: THREE.DoubleSide,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

/* ---------------------------------------------------------------- component */

export interface ChronogramProps {
  data: InstallationData;
  /** 0..1 fade-in used by the chapter transition; 0 = fully invisible. */
  reveal?: number;
  /** Which modality to emphasise; 'both' blends them. */
  modality?: 'camera' | 'sound' | 'both';
  /** Highlight a specific month 0-11, or null. */
  focusMonth?: number | null;
  /** Called when the visitor taps a cell. */
  onSelectMonth?: (month: number) => void;
}

interface HoverState {
  month: number;
  hour: number;
  strength: number;
}

export function Chronogram({
  data,
  reveal = 1,
  modality = 'both',
  focusMonth = null,
  onSelectMonth,
}: ChronogramProps) {
  const groupRef = useRef<THREE.Group>(null);
  const fieldRef = useRef<THREE.Mesh>(null);
  const armRef = useRef<THREE.Group>(null);

  /** Pointer state lives in a ref and reaches the GPU as a uniform — never as React state. */
  const hoverRef = useRef<HoverState>({ month: -1, hour: -1, strength: 0 });
  const revealRef = useRef(0);
  const mixRef = useRef(0.5);

  const fieldGeometry = useMemo(() => buildFieldGeometry(data), [data]);
  const structureGeometry = useMemo(() => buildStructureGeometry(data), [data]);
  const sunriseGeometry = useMemo(() => buildSolarRibbon(data, 'sunrise'), [data]);
  const sunsetGeometry = useMemo(() => buildSolarRibbon(data, 'sunset'), [data]);
  const playheadGeometry = useMemo(() => buildPlayheadGeometry(), []);

  const field = useMemo(() => createFieldMaterial(), []);
  const sunriseRibbon = useMemo(() => createRibbonMaterial(PALETTE.foil, 0.9), []);
  const sunsetRibbon = useMemo(() => createRibbonMaterial(PALETTE.dusk, 0.75), []);
  const structure = useMemo(() => createStructureMaterial(), []);
  const playhead = useMemo(() => createPlayheadMaterial(), []);

  useEffect(() => {
    const geometries = [
      fieldGeometry,
      structureGeometry,
      sunriseGeometry,
      sunsetGeometry,
      playheadGeometry,
    ];
    const materials = [field, sunriseRibbon, sunsetRibbon, structure, playhead];
    return () => {
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.material.dispose());
    };
  }, [
    fieldGeometry,
    structureGeometry,
    sunriseGeometry,
    sunsetGeometry,
    playheadGeometry,
    field,
    sunriseRibbon,
    sunsetRibbon,
    structure,
    playhead,
  ]);

  /** World hit point → (month, hour), or null if the pointer missed the annulus. */
  const readCell = useCallback((event: ThreeEvent<PointerEvent>) => {
    const mesh = fieldRef.current;
    if (!mesh) return null;
    // The group is scaled by the reveal transition, so go back through the mesh's
    // own matrix rather than assuming the disc sits at unit scale.
    const local = mesh.worldToLocal(event.point.clone());
    const radius = Math.hypot(local.x, local.z);
    const hourNorm = (radius - INNER_RADIUS) / (OUTER_RADIUS - INNER_RADIUS);
    if (hourNorm < 0 || hourNorm > 1) return null;
    // Inverse of discPoint(): x = sin θ · r, z = −cos θ · r.
    const yearFrac = (Math.atan2(local.x, -local.z) / TAU + 1) % 1;
    return {
      month: Math.min(MONTHS - 1, Math.floor(yearFrac * MONTHS)),
      hour: Math.min(HOURS - 1, Math.floor(hourNorm * HOURS)),
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const cell = readCell(event);
      const hover = hoverRef.current;
      if (!cell) {
        hover.month = -1;
        return;
      }
      hover.month = cell.month;
      hover.hour = cell.hour;
    },
    [readCell]
  );

  const handlePointerOut = useCallback(() => {
    hoverRef.current.month = -1;
  }, []);

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const cell = readCell(event);
      if (!cell) return;
      hoverRef.current.month = cell.month;
      hoverRef.current.hour = cell.hour;
      onSelectMonth?.(cell.month);
    },
    [readCell, onSelectMonth]
  );

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    // Clamp the step so a tab-switch stall cannot snap every transition open.
    const dt = Math.min(delta, 1 / 15);
    // Time-based exponential smoothing: identical response at 30 or 144 fps.
    const ease = (current: number, target: number, rate: number) =>
      current + (target - current) * (1 - Math.exp(-dt * rate));

    revealRef.current = ease(revealRef.current, THREE.MathUtils.clamp(reveal, 0, 1), 3.2);
    const r = revealRef.current;
    const eased = r * r * (3 - 2 * r);

    const group = groupRef.current;
    if (group) {
      group.visible = r > 0.002;
      // A genuine arrival: the disc grows in and settles as it brightens.
      group.scale.setScalar(0.9 + 0.1 * eased);
      group.position.y = (1 - eased) * -0.3;
    }

    const play = (time / PLAYHEAD_PERIOD) % 1;

    const targetCamera = modality === 'camera' ? 1 : modality === 'sound' ? 0 : 0.5;
    mixRef.current = ease(mixRef.current, targetCamera, 2.6);

    const focus = focusMonth === null ? -1 : Math.round(focusMonth);
    const focusValid = focus >= 0 && focus < MONTHS;

    const hover = hoverRef.current;
    hover.strength = ease(hover.strength, hover.month >= 0 ? 1 : 0, 8);

    const u = field.uniforms;
    u.uTime.value = time;
    u.uReveal.value = eased;
    u.uPlay.value = play;
    u.uMix.value.set(mixRef.current, 1 - mixRef.current);
    if (hover.month >= 0) {
      // Snap the highlight to the centre of the hovered cell so it lights a cell,
      // not a blur under the cursor.
      u.uHover.value.x = (hover.month + 0.5) / MONTHS;
      u.uHover.value.y = (hover.hour + 0.5) / HOURS;
    }
    u.uHover.value.z = hover.strength;
    if (focusValid) u.uFocusFrac.value = (focus + 0.5) / MONTHS;
    u.uFocusAmt.value = ease(u.uFocusAmt.value, focusValid ? 1 : 0, 4);

    for (const ribbon of [sunriseRibbon, sunsetRibbon]) {
      ribbon.uniforms.uTime.value = time;
      ribbon.uniforms.uReveal.value = eased;
      ribbon.uniforms.uPlay.value = play;
    }

    structure.uniforms.uReveal.value = eased;
    playhead.uniforms.uTime.value = time;
    playhead.uniforms.uReveal.value = eased;

    // The arm is modelled pointing at −Z (January); +Y rotation runs clockwise on
    // screen, hence the negative angle.
    if (armRef.current) armRef.current.rotation.y = -play * TAU;
  });

  return (
    <group ref={groupRef} name="chronogram">
      <mesh
        ref={fieldRef}
        geometry={fieldGeometry}
        material={field.material}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
      />
      <lineSegments geometry={structureGeometry} material={structure.material} renderOrder={1} />
      <mesh geometry={sunriseGeometry} material={sunriseRibbon.material} renderOrder={2} />
      <mesh geometry={sunsetGeometry} material={sunsetRibbon.material} renderOrder={2} />
      <group ref={armRef}>
        <mesh geometry={playheadGeometry} material={playhead.material} renderOrder={3} />
      </group>
    </group>
  );
}
