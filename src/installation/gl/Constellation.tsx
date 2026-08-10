import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstallationData, LandscapeData, Site } from '../core/types';
import { activityAtHour, layoutSites, loadLandscape, logScale, speciesAtSite } from '../core/data';
import type { DayClock } from '../core/dayClock';
import { GUILD_COLORS, PALETTE, toRGB, TYPOLOGY_COLORS, CLASS_COLORS } from '../core/palette';
import { SIMPLEX_3D, DITHER, SPRITE, TONEMAP } from './chunks';
import {
  AREA_HATCHED,
  AREA_PLAIN,
  AREA_WATER,
  CONTOUR_INTERVAL,
  buildAreaLayer,
  buildBuildingLayer,
  buildLineLayer,
  buildTerrain,
  estateProjection,
  terrainHeightAt,
  terrainHeightAtWorld,
  worldXOf,
  worldZOf,
  type EstateProjection,
} from './landscapeGeometry';

/**
 * "The Estate" — the twelve monitoring stations as a constellation standing on
 * the real ground of Purcari, at their true relative positions.
 *
 * The chapter's argument is the one the survey makes: the same land classifies
 * differently depending on which animals you ask. `lens` cross-fades between the
 * mammal reading, the bird reading, and the combined typology, recolouring the
 * stations in place — so the visitor watches one landscape become three.
 *
 * The ground under them is no longer an evocation. It is the estate's own
 * relief, from a 72×72 SRTM grid, with the vineyard blocks, the woods, the farm
 * tracks, the streams, the ponds and every building drawn on it from
 * OpenStreetMap. If that data cannot be fetched the chapter falls back to the
 * abstract noise terrain rather than breaking.
 */

export type Lens = 'both' | 'camera' | 'sound';

/**
 * The estate is a narrow NNE–SSW lozenge, so its long axis sets the scale: sized
 * to fill the frame vertically with north kept up. The terrain uses the same
 * number, so the stations land on their own ground.
 */
const ESTATE_RADIUS = 6.5;

/** How far a station mark floats above the land it stands on, in scene units. */
const STATION_LIFT = 0.55;

/**
 * Each drape sits a little above the surface, in this order, so the layers stack
 * cleanly instead of fighting the terrain for the same depth: parcels lowest,
 * then tracks, then water, then the buildings standing on top of all of it.
 */
const AREA_LIFT = 0.020;
const TRACK_LIFT = 0.030;
const WATER_LIFT = 0.038;
/** Cartographic furniture rides above the water lines, under the stations. */
const FURNITURE_LIFT = 0.048;

/**
 * A named point on the map, projected to CSS pixels for the DOM to caption.
 *
 * Text drawn inside the canvas would need a font file, which this piece cannot
 * fetch; real names deserve real type anyway. Same contract as Refuge's
 * `onLayout`: the scene reports where things are, the parent writes the words.
 */
export interface MapAnchor {
  name: string;
  /** 'winery' | 'village' | 'locality' | 'scale' | 'north'. */
  kind: string;
  x: number;
  y: number;
  /**
   * True when the place itself lies beyond the map sheet and its label was
   * pulled in to the nearest edge — the convention every paper map uses for a
   * town the road continues toward.
   */
  edge: boolean;
}

/** Scratch for per-frame projection, so the loop allocates nothing. */
const ANCHOR_SCRATCH = new THREE.Vector3();

function siteColor(site: Site, lens: Lens): [number, number, number] {
  if (lens === 'camera') return toRGB(CLASS_COLORS[site.cameraClass] ?? PALETTE.ash);
  if (lens === 'sound') return toRGB(CLASS_COLORS[site.soundClass] ?? PALETTE.ash);
  return toRGB(TYPOLOGY_COLORS[site.typology] ?? PALETTE.ash);
}

/* ------------------------------------------------------------------ shared */

/**
 * Time of day. Sunrise and sunset at this latitude sit near 06:00 and 20:00; the
 * land runs cold and blue at night, warms hard through the two twilights, and
 * settles neutral at midday. Multiplicative, so it tints what is there without
 * adding light of its own — and shared by every layer, so the terrain, the
 * vineyard blocks and the château all turn together.
 */
const HOUR_TINT = /* glsl */ `
/* Where the sun is, at this hour. x/z point at it, y is its height above the
 * horizon — negative at night. Sunrise and sunset at this latitude sit near
 * 06:00 and 20:00, so the arc is built around those. */
vec3 sunAt(float hour){
  float phase = (hour - 6.0) / 14.0;            // 0 at sunrise, 1 at sunset
  float az = 3.14159265 * phase;                 // swings east to west
  float el = sin(3.14159265 * phase);            // up over the day, under at night
  return normalize(vec3(-cos(az) * 0.9, el * 0.85 + 0.06, -0.45 - abs(el) * 0.25));
}

vec3 hourTint(float hour){
  float dawn = 1.0 - smoothstep(0.0, 1.7, abs(hour - 6.2));
  float dusk = 1.0 - smoothstep(0.0, 1.9, abs(hour - 19.8));
  float day = smoothstep(5.4, 8.0, hour) * (1.0 - smoothstep(18.4, 21.0, hour));
  // Pushed well past the wash it used to be. A day that a visitor watches loop
  // has to actually *turn*: deep cold blue at night, a hard low amber through
  // both twilights, clean light at noon. Multiplicative still, so it tints what
  // is there rather than adding light of its own.
  vec3 night = vec3(0.30, 0.46, 1.35);
  vec3 noon = vec3(1.06, 1.02, 0.94);
  vec3 twilight = vec3(1.52, 0.74, 0.38);
  vec3 tint = mix(night, noon, day);
  return mix(tint, twilight, clamp(dawn + dusk, 0.0, 1.0) * 0.82);
}

/* How much light there is at all — the difference between noon and 03:00 is not
 * only colour. Never reaches zero: the map has to stay legible at midnight. */
float hourLevel(float hour){
  float day = smoothstep(4.8, 7.6, hour) * (1.0 - smoothstep(18.6, 21.4, hour));
  return mix(0.5, 1.0, day);
}
`;


/* ----------------------------------------------------------------- terrain */

/**
 * The real ground: a plane displaced by the SRTM grid.
 *
 * The heights are baked into the geometry on the CPU (see landscapeGeometry.ts)
 * so that every draped layer can hang on exactly the same surface. The shader's
 * only job with them is `uReveal`, which lifts the relief out of the flat as the
 * chapter arrives.
 */
const TERRAIN_VERT = /* glsl */ `
attribute float aElevation;
uniform float uReveal;
varying vec2 vUv;
varying float vElev;
varying vec3 vWorld;
varying vec3 vNormal;

void main(){
  vUv = uv;
  vElev = aElevation;

  // This is a PlaneGeometry: its vertices lie in LOCAL XY and the mesh is
  // rotated -90 deg about X so local +Z becomes world +Y. The elevation lives in
  // p.z for exactly that reason — displacing p.y would push the land sideways.
  vec3 p = position;
  p.z *= uReveal;

  // No scale in the model matrix, so rotating the baked normal is enough.
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const TERRAIN_FRAG = /* glsl */ `
${DITHER}
${TONEMAP}
${HOUR_TINT}
uniform float uTime;
uniform float uReveal;
uniform float uHour;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uGlow;
uniform vec3 uPulse;   // xy = focus point in world space, z = strength
varying vec2 vUv;
varying float vElev;
varying vec3 vWorld;
varying vec3 vNormal;

void main(){
  // Dissolve toward the edge of the elevation model, so the estate floats in the
  // dark rather than sitting on a visible rectangle. The cubed norm follows the
  // DEM's own footprint instead of cropping it to a circle; edgeFade() in
  // landscapeGeometry.ts evaluates the same expression for the drapes.
  vec2 q = abs(vUv - 0.5) * 2.0;
  float rim = 1.0 - smoothstep(0.80, 1.02, pow(pow(q.x, 3.0) + pow(q.y, 3.0), 1.0 / 3.0));
  if (rim <= 0.001) discard;

  // The estate's three landscape units, now by real altitude: Poale on the
  // Dniester terrace below ~50 m, Coline across the hillslopes, Podiș on the
  // plateau above ~125 m.
  vec3 soil = mix(uLow, uMid, smoothstep(35.0, 80.0, vElev));
  soil = mix(soil, uHigh, smoothstep(105.0, 145.0, vElev));

  // Hillshade. The chapter is framed almost plan-view, where colour alone cannot
  // convey relief; raking a low sun across the real slope is what makes the
  // ground read as land rather than as a stain. The normal is the analytic
  // gradient of the elevation grid, not a screen-space derivative, so the
  // shading stays smooth instead of faceting on the grid's whole-metre steps.
  // No lights in the scene — this is the only shading in the piece.
  // The sun moves. A fixed light made every hour of the day look like the same
  // afternoon with a colour filter over it; swinging it from east to west means
  // the ravines fill with shadow in the morning, the plateau flares at noon and
  // the whole west-facing slope catches fire at dusk. It is the single thing
  // that makes the loop worth watching.
  vec3 sun = sunAt(uHour);
  float shade = clamp(dot(normalize(vNormal), sun) * 0.5 + 0.5, 0.0, 1.0);
  // After dark the raking light is gone and the relief is read by a flat fill,
  // the way a landscape actually looks under a moon.
  shade = mix(0.55, shade, smoothstep(-0.05, 0.22, sun.y));
  // Kept deliberately dim. The contour lines carry the landform, the colour
  // fills are only a wash, and the twelve stations must stay the brightest thing
  // on screen once bloom is applied. A little more body than the abstract ground
  // it replaces, because here the shading is carrying real slope and the
  // hillside is worth seeing.
  soil *= (0.25 + pow(shade, 1.6) * 0.75) * 0.28 * hourLevel(uHour);

  // True contours, ${CONTOUR_INTERVAL.toFixed(0)} m apart, with every fifth — each 50 m — burning
  // brighter, the way a survey sheet indexes its own lines. The screen-space
  // derivative keeps them a constant hairline instead of banding into moiré, and
  // makes them thin out by themselves where the plateau goes flat.
  float c = vElev / ${CONTOUR_INTERVAL.toFixed(1)};
  float minor = abs(fract(c) - 0.5) / max(fwidth(c), 0.0001);
  float index = c / 5.0;
  float major = abs(fract(index) - 0.5) / max(fwidth(index), 0.0001);
  // Held back from where they started: with the landuse washes turned up to
  // presentation strength, contours at equal weight made the whole sheet read
  // as lava. The landform is still there; it just speaks second.
  float lines = (1.0 - smoothstep(0.0, 1.4, minor)) * 0.17
              + (1.0 - smoothstep(0.0, 1.4, major)) * 0.24;

  // A slow ripple outward from wherever the visitor last touched.
  float d = distance(vWorld.xz, uPulse.xy);
  float ripple = sin(d * 1.6 - uTime * 1.7) * exp(-d * 0.28) * uPulse.z;
  soil += uGlow * max(ripple, 0.0) * 0.22;

  vec3 color = (soil + uGlow * lines) * rim * hourTint(uHour);
  gl_FragColor = vec4(dither(aces(color * uReveal), vUv), rim * uReveal * 0.9);
}
`;

/* ------------------------------------------------------------------ drapes */

/**
 * Parcels and water bodies. One merged buffer for all of them: the class only
 * changes the vertex colour and a kind flag, so 199 landuse polygons and 7 water
 * bodies are a single draw call.
 */
const AREA_VERT = /* glsl */ `
attribute vec3 aColor;
attribute vec2 aRow;
attribute float aFade;
attribute float aKind;
uniform float uReveal;
varying vec3 vColor;
varying vec2 vRow;
varying float vFade;
varying float vKind;
varying vec2 vLocal;

void main(){
  vColor = aColor;
  vRow = aRow;
  vFade = aFade;
  vKind = aKind;
  // The drape is built in the land's own frame, so its local xz is what the
  // hatch is locked to — using world xz would let the pattern slide across the
  // vineyard as the group drifts.
  vLocal = position.xz;
  // Ride the relief up with the terrain as the chapter reveals.
  vec3 p = vec3(position.x, position.y * uReveal, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const AREA_FRAG = /* glsl */ `
${HOUR_TINT}
uniform float uTime;
uniform float uReveal;
uniform float uHour;
varying vec3 vColor;
varying vec2 vRow;
varying float vFade;
varying float vKind;
varying vec2 vLocal;

void main(){
  vec3 color = vColor;

  if (vKind > 0.5 && vKind < 1.5) {
    // Vine rows. The spacing is symbolic — real rows are ~2.2 m apart, far below
    // a pixel here — but the direction is not: each block is hatched along its
    // own longest edge, so the vineyard shows its true grain. Faded out where
    // the stripes would alias into moiré.
    float phase = dot(vLocal, vRow) * 62.83;   // one row every 0.1 units, ~24 m
    float legible = 1.0 - smoothstep(1.6, 3.2, fwidth(phase));
    color *= 1.0 + smoothstep(-0.4, 1.0, sin(phase)) * 0.55 * legible;
  } else if (vKind > 1.5) {
    // Open water, breathing very slowly.
    color *= 0.88 + 0.16 * sin(uTime * 0.35 + vLocal.x * 9.0 + vLocal.y * 7.0);
  }

  float a = vFade * uReveal;
  gl_FragColor = vec4(color * hourTint(uHour) * a, a);
}
`;

/**
 * Tracks, streams, water outlines and buildings. Colour and the edge fade are
 * baked per vertex, so one shader serves every line and every wall.
 */
const DRAPE_VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uReveal;
varying vec3 vColor;

void main(){
  vColor = aColor;
  vec3 p = vec3(position.x, position.y * uReveal, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const DRAPE_FRAG = /* glsl */ `
${HOUR_TINT}
uniform float uReveal;
uniform float uHour;
varying vec3 vColor;

void main(){
  gl_FragColor = vec4(vColor * hourTint(uHour) * uReveal, uReveal);
}
`;

/* ------------------------------------------------------------- noise ground */

/**
 * The fallback terroir, kept from before the elevation model existed: a
 * displaced disc whose height field is layered noise biased along the NNE–SSW
 * axis of the Dniester valley. It is only ever seen if landscape.json fails to
 * load — the chapter must never break in front of a visitor.
 */
const NOISE_VERT = /* glsl */ `
${SIMPLEX_3D}
uniform float uTime;
uniform float uReveal;
varying vec2 vUv;
varying float vHeight;
varying vec3 vWorld;

void main(){
  vUv = uv;
  vec3 p = position;

  // This is a PlaneGeometry: its vertices lie in LOCAL XY with z = 0, and the
  // mesh is rotated -90 deg about X so local +Z becomes world +Y. So the noise
  // domain is p.xy and the displacement goes along p.z — sampling p.xz would be
  // constant in one axis, and displacing p.y would push the terrain sideways.
  float axis = p.x * 0.42 + p.y * 0.91;   // valley runs NNE-SSW
  float ridge = sin(axis * 0.34) * 0.75;
  float detail = fbm(vec3(p.xy * 0.16, 0.0)) * 0.85;
  float fine = snoise(vec3(p.xy * 0.55, uTime * 0.008)) * 0.12;
  float h = (ridge + detail + fine) * uReveal;
  p.z += h;

  vHeight = h;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const NOISE_FRAG = /* glsl */ `
${SIMPLEX_3D}
${DITHER}
${TONEMAP}
${HOUR_TINT}
uniform float uTime;
uniform float uReveal;
uniform float uHour;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uGlow;
uniform vec3 uPulse;
varying vec2 vUv;
varying float vHeight;
varying vec3 vWorld;

void main(){
  float radius = length(vUv - 0.5) * 2.0;
  float rim = 1.0 - smoothstep(0.30, 0.86, radius);
  if (rim <= 0.001) discard;

  float t = clamp(vHeight * 0.55 + 0.5, 0.0, 1.0);
  vec3 soil = mix(uLow, uMid, smoothstep(0.25, 0.62, t));
  soil = mix(soil, uHigh, smoothstep(0.62, 0.95, t));

  vec3 dx = dFdx(vWorld);
  vec3 dy = dFdy(vWorld);
  vec3 normal = normalize(cross(dx, dy));
  vec3 sun = normalize(vec3(-0.55, 0.62, -0.55));
  float shade = clamp(dot(normal, sun) * 0.5 + 0.5, 0.0, 1.0);
  soil *= (0.25 + pow(shade, 1.6) * 0.75) * 0.20;

  float h = vHeight * 3.0;
  float grid = abs(fract(h) - 0.5) / max(fwidth(h), 0.0001);
  float lines = (1.0 - smoothstep(0.0, 1.4, grid)) * 0.45;

  float rows = sin((vWorld.x * 0.94 - vWorld.z * 0.34) * 6.0) * 0.5 + 0.5;
  float rowMask = smoothstep(0.25, 0.5, t) * (1.0 - smoothstep(0.68, 0.92, t));
  soil += uGlow * rows * rowMask * 0.035;

  float d = distance(vWorld.xz, uPulse.xy);
  float ripple = sin(d * 1.6 - uTime * 1.7) * exp(-d * 0.28) * uPulse.z;
  soil += uGlow * max(ripple, 0.0) * 0.22;

  vec3 color = (soil + uGlow * lines) * rim * hourTint(uHour);
  gl_FragColor = vec4(dither(aces(color * uReveal), vUv), rim * uReveal * 0.9);
}
`;

/* ---------------------------------------------------------------- stations */

/**
 * One point per station, drawn as an additive sprite. `gl_PointSize` gives
 * camera-facing sprites for free — cheaper and steadier than billboarded quads
 * for twelve marks — and `gl_PointCoord` replaces a uv varying. Size follows
 * log-scaled detection volume so H10's 7,859 songs do not swallow H7's six
 * encounters; the inner core follows species richness.
 */
const STATION_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aScale;
attribute float aRichness;
attribute float aSeed;
attribute float aSelected;
attribute float aActivity;
attribute float aGround;
uniform float uTime;
uniform float uReveal;
varying vec3 vColor;
varying float vRichness;
varying float vSelected;
varying float vActivity;

void main(){
  vColor = aColor;
  vRichness = aRichness;
  vSelected = aSelected;
  vActivity = aActivity;

  // aGround is the station's own elevation on the real terrain; position.y is
  // only the float above it, so the marks rise with the land as it reveals.
  vec3 p = vec3(position.x, position.y + aGround * uReveal, position.z);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float breathe = 1.0 + sin(uTime * 0.7 + aSeed * 6.2831) * 0.06;
  // Selected stations swell and pulse harder so a fingertip has clear feedback.
  float pulse = 1.0 + vSelected * (0.35 + sin(uTime * 3.0) * 0.12);
  // A station never vanishes — it dims to a quarter — so the map of the estate
  // stays readable at 03:00 while the busy stations clearly carry the night.
  float clock = 0.62 + aActivity * 0.58;
  gl_PointSize = aScale * breathe * pulse * clock * uReveal * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const STATION_FRAG = /* glsl */ `
${SPRITE}
varying vec3 vColor;
varying float vRichness;
varying float vSelected;
varying float vActivity;

void main(){
  vec2 coord = gl_PointCoord;
  float d = length(coord - 0.5) * 2.0;
  if (d > 1.0) discard;

  // Bright core sized by richness, wide soft halo by volume.
  float core = 1.0 - smoothstep(0.0, 0.10 + vRichness * 0.20, d);
  float halo = pow(1.0 - d, 3.0);

  // A thin ring that tightens when the station is selected.
  float ringR = 0.62 - vSelected * 0.06;
  float ring = (1.0 - smoothstep(0.0, 0.035, abs(d - ringR))) * (0.22 + vSelected * 0.65);

  float a = (core + halo * 0.55 + ring) * (0.46 + vActivity * 0.54);
  vec3 color = vColor * (0.6 + core * 1.9) + vec3(1.0, 0.92, 0.75) * core * 0.55;
  // Busy stations pick up a warm cast, so the hour reads in colour as well as
  // in size — legible even to a visitor who cannot judge small size changes.
  color += vec3(0.35, 0.24, 0.10) * vActivity * core;
  gl_FragColor = vec4(color * a, a);
}
`;

/* ------------------------------------------------------------------- court */

/**
 * The station's own court: its residents, in orbit.
 *
 * Flying down to a station used to reveal nothing but a bigger view of the
 * same mark — the panel named the residents, the scene stayed mute. Now the
 * species recorded at that station come out and circle it, each in its guild's
 * colour, each sized by how often this station recorded it, and each burning
 * on its own measured schedule: scrub the day and the pheasant's mark hands
 * over to the badger's exactly when the counts say the ground changes hands.
 * Positions are updated from JavaScript — it is at most sixteen marks — so the
 * per-species activity can come straight from `activityAtHour`, the same
 * measured profile everything else in the piece answers to.
 */
const COURT_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAwake;
attribute float aSize;

uniform float uReveal;

varying vec3 vColor;
varying float vAwake;

void main(){
  vColor = aColor;
  vAwake = aAwake;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (0.5 + aAwake * 0.5) * uReveal * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const COURT_FRAG = /* glsl */ `
uniform float uReveal;

varying vec3 vColor;
varying float vAwake;

void main(){
  vec2 coord = gl_PointCoord - 0.5;
  float d = length(coord) * 2.0;
  if (d > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.3, d);
  float halo = pow(1.0 - d, 2.6);
  // Asleep is present but banked — the court is a census of residents, not
  // only of this hour; the hour decides who burns.
  float a = (core + halo * 0.5) * (0.10 + vAwake * 0.52) * uReveal;
  vec3 color = vColor + vec3(1.0, 0.93, 0.78) * core * vAwake * 0.6;
  gl_FragColor = vec4(color * a, a);
}
`;

/** How many residents come out. Enough for a court, few enough to stay one. */
const COURT_SIZE = 14;

/* ------------------------------------------------------------------ shared */

interface ConstellationProps {
  data: InstallationData;
  /** 0..1 chapter fade. */
  reveal?: number;
  /** Which classification of the land to show. */
  lens?: Lens;
  selectedSite?: string | null;
  onSelectSite?: (siteId: string | null) => void;
  /**
   * Reports the screen positions of the map's named anchors — the château, the
   * villages, the scale bar — throttled, in CSS pixels. See `MapAnchor`.
   */
  onMapAnchors?: (marks: MapAnchor[]) => void;
  /**
   * Where the selected station stands, in scene units, or null with nothing
   * chosen. The parent flies the camera with it: the scene knows where its
   * stations are, the parent owns the camera — same division as the captions.
   */
  onFocus?: (point: [number, number, number] | null) => void;
  /**
   * Hour of day, 0..24. Each station brightens and swells in proportion to how
   * much life its own sensors actually recorded at that hour, and the ground
   * shifts from night through dawn to day. Scrubbing it shows the estate change
   * hands: the vineyard blocks empty out after dark while the woodland edge and
   * the pond margin come up.
   */
  hour?: number;
  /**
   * The running day. Read inside the frame loop, so scrubbing and playback
   * never re-render this component — see `core/dayClock.ts` for why that is
   * the difference between a smooth ramp and the judder it replaced.
   */
  clock?: DayClock;
}

/**
 * How busy a station is at a given hour, 0..1 against its own daily peak.
 * Relative to itself, not to the estate, so a quiet station still shows its own
 * rhythm instead of staying dark all day.
 */
function siteActivityAt(site: Site, hour: number): number {
  const peak = Math.max(...site.hourly, 1);
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const next = site.hourly[(h + 1) % 24];
  const frac = hour - Math.floor(hour);
  return (site.hourly[h] * (1 - frac) + next * frac) / peak;
}

export function Constellation({
  data,
  reveal = 1,
  lens = 'both',
  hour = 12,
  clock,
  selectedSite = null,
  onSelectSite,
  onMapAnchors,
  onFocus,
}: ConstellationProps) {
  const groupRef = useRef<THREE.Group>(null);
  const courtRef = useRef<THREE.Points>(null);
  const courtReveal = useRef(0);
  const lastAnchors = useRef(0);
  /** Eased pointer yaw, so the orbit follows the mouse without jitter. */
  const orbitRef = useRef(0);
  const { camera, size } = useThree();
  const groundRef = useRef<THREE.Mesh>(null);
  const stationsRef = useRef<THREE.Points>(null);
  const linksRef = useRef<THREE.LineSegments>(null);
  const pulse = useRef(new THREE.Vector3(0, 0, 0));
  const revealRef = useRef(0);
  const hourRef = useRef(hour);

  /* ---- the real ground, loaded beside the survey ---- */
  /**
   * Optional by design: the survey data is the chapter, the landscape is the
   * table it stands on. A failed fetch drops back to the noise terrain without
   * telling the visitor anything went wrong.
   */
  const [landscape, setLandscape] = useState<LandscapeData | null>(null);
  useEffect(() => {
    let alive = true;
    loadLandscape()
      .then((loaded) => {
        if (alive) setLandscape(loaded);
      })
      .catch(() => {
        // Keep the noise ground.
      });
    return () => {
      alive = false;
    };
  }, []);

  const placed = useMemo(() => layoutSites(data.sites, ESTATE_RADIUS), [data.sites]);

  const projection = useMemo<EstateProjection | null>(
    () => (landscape ? estateProjection(data.sites, ESTATE_RADIUS, landscape.dem) : null),
    [landscape, data.sites],
  );

  /* ---- uniforms, shared by every layer of the land ---- */
  const landUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uHour: { value: 12 },
      // Poale (Dniester terrace) -> Coline (hillslopes) -> Podiș (plateau), the
      // estate's own three landscape units, now keyed to real altitude. Kept
      // low-saturation so the stations stay the brightest thing on screen.
      uLow: { value: new THREE.Color(PALETTE.sediment) },
      uMid: { value: new THREE.Color(PALETTE.brandNavy) },
      uHigh: { value: new THREE.Color(PALETTE.brandBronze) },
      uGlow: { value: new THREE.Color(PALETTE.brandBronze) },
      uPulse: { value: new THREE.Vector3(0, 0, 0) },
    }),
    [],
  );

  const stationUniforms = useMemo(() => ({ uTime: { value: 0 }, uReveal: { value: 0 } }), []);

  /* ---- materials ---- */
  const materials = useMemo(() => {
    const terrain = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: landUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const noise = new THREE.ShaderMaterial({
      vertexShader: NOISE_VERT,
      fragmentShader: NOISE_FRAG,
      uniforms: landUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const areas = new THREE.ShaderMaterial({
      vertexShader: AREA_VERT,
      fragmentShader: AREA_FRAG,
      uniforms: landUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const drape = new THREE.ShaderMaterial({
      vertexShader: DRAPE_VERT,
      fragmentShader: DRAPE_FRAG,
      uniforms: landUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const built = new THREE.ShaderMaterial({
      vertexShader: DRAPE_VERT,
      fragmentShader: DRAPE_FRAG,
      uniforms: landUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // Prisms are wound outward, so only the near walls draw and the far ones
      // do not add a second glow through them.
      side: THREE.FrontSide,
    });
    const stations = new THREE.ShaderMaterial({
      vertexShader: STATION_VERT,
      fragmentShader: STATION_FRAG,
      uniforms: stationUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    return { terrain, noise, areas, drape, built, stations };
  }, [landUniforms, stationUniforms]);

  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose());
    },
    [materials],
  );

  /* ---- the château, named and ringed ---- */
  /**
   * OSM pins a `craft=winery` node inside the winery complex, and the two
   * largest footprints on the sheet — 3,380 m² and 2,385 m² — stand beside it.
   * The ring encloses whichever substantial buildings sit within 250 m of that
   * node, so it draws the complex as one thing without hand-placing anything:
   * if the mapping improves, the ring follows it.
   */
  const chateau = useMemo(() => {
    if (!landscape?.places || !projection) return null;
    const winery = landscape.places.find((place) => place.k === 'winery');
    if (!winery) return null;
    const complex = landscape.buildings.filter(
      (b) =>
        b.a > 1200 &&
        b.p.some(([x, y]) => Math.hypot(x - winery.x, y - winery.y) < 250),
    );
    if (!complex.length) return null;

    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const b of complex)
      for (const [x, y] of b.p) {
        sx += x;
        sy += y;
        n++;
      }
    const cx = sx / n;
    const cy = sy / n;
    let radius = 0;
    for (const b of complex)
      for (const [x, y] of b.p) radius = Math.max(radius, Math.hypot(x - cx, y - cy));
    radius += 35;

    const ring: [number, number][] = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    return { cx, cy, radius, ring, complex };
  }, [landscape, projection]);

  /* ---- the map, merged into one buffer per layer ---- */
  /**
   * This is a stage set, not a cadastre. The chapter has to answer three
   * questions from across a room — where the woods are, where the vine is,
   * where the house is — so the classes that carry those answers are turned up
   * and everything else is context. The one outright omission: of 539 mapped
   * buildings, only the château complex is drawn. Every shed in Purcari village
   * at the same emphasis was noise pretending to be information.
   */
  const layers = useMemo(() => {
    if (!landscape || !projection) return null;
    // Fallback when the bundle predates the winery node: the two footprints
    // over 1,500 m² are the château and its cellar block.
    const complex = chateau?.complex ?? landscape.buildings.filter((b) => b.a > 1500);
    return {
      terrain: buildTerrain(projection),
      areas: buildAreaLayer(
        landscape,
        projection,
        {
          // The estate's own wine tone for the blocks it is planted with…
          vineyard: { color: PALETTE.wine, intensity: 0.34, kind: AREA_HATCHED },
          // …and a living green for the woods, which is where the survey found
          // the richest stations. Bright enough to read as woodland at a
          // glance, not just as "not vineyard".
          forest: { color: PALETTE.vine, intensity: 0.5, kind: AREA_PLAIN },
          orchard: { color: PALETTE.chlorophyll, intensity: 0.2, kind: AREA_PLAIN },
          meadow: { color: PALETTE.moss, intensity: 0.26, kind: AREA_PLAIN },
          farmland: { color: PALETTE.brandBronze, intensity: 0.1, kind: AREA_PLAIN },
          water: { color: PALETTE.water, intensity: 0.42, kind: AREA_WATER },
        },
        { color: PALETTE.brandBronze, intensity: 0.08, kind: AREA_PLAIN },
        AREA_LIFT,
      ),
      // Faint on purpose: the track network is texture here, not wayfinding.
      tracks: buildLineLayer(landscape.tracks, projection, {
        color: PALETTE.brandBronze,
        intensity: 0.2,
        lift: TRACK_LIFT,
      }),
      // Streams and the ponds' own edges read as one water network.
      waterways: buildLineLayer([...landscape.streams, ...landscape.water], projection, {
        color: PALETTE.water,
        intensity: 0.55,
        lift: WATER_LIFT,
      }),
      buildings: buildBuildingLayer({ ...landscape, buildings: complex }, projection, {
        base: PALETTE.brandBronze,
        accent: PALETTE.foil,
        // Both footprints of the complex sit high on this ramp, so the whole
        // house burns in foil.
        minArea: 500,
        maxArea: 2400,
        minHeight: 0.05,
        maxHeight: 0.16,
      }),
    };
  }, [landscape, projection, chateau]);

  useEffect(
    () => () => {
      if (!layers) return;
      Object.values(layers).forEach((geometry) => geometry.dispose());
    },
    [layers],
  );

  /* ---- cartographic furniture: the ring, a scale bar, a north arrow ---- */
  /**
   * What separates "some terrain" from "a map of a real place" is partly the
   * furniture a map carries: a bar that says how big it is, an arrow that says
   * which way it faces. Both are drawn in the scene, draped on the terrain and
   * inside the swaying group, so the bar is always exactly 1 km of this ground
   * and the arrow always points at the map's own north — a DOM overlay would
   * detach from both the moment the camera moved.
   */
  const furniture = useMemo(() => {
    if (!landscape || !projection) return null;
    const p = projection;
    const gold: [number, number][][] = [];
    const bronze: [number, number][][] = [];

    if (chateau) gold.push(chateau.ring);

    // Placement is screen-driven, not compass-driven: under this chapter's
    // camera the sheet's south edge lies along the chapter nav, so furniture
    // there sat on top of the buttons. The east-southeast of the sheet is open
    // farmland with no stations, clear of every control, and far enough from
    // the edge fade that the bar keeps both its ends.
    const x0 = p.west + (p.east - p.west) * 0.57;
    const y0 = p.south + (p.north - p.south) * 0.235;
    bronze.push(
      [
        [x0, y0],
        [x0 + 1000, y0],
      ],
      [
        [x0, y0 - 45],
        [x0, y0 + 45],
      ],
      [
        [x0 + 500, y0 - 26],
        [x0 + 500, y0 + 26],
      ],
      [
        [x0 + 1000, y0 - 45],
        [x0 + 1000, y0 + 45],
      ],
    );

    const xa = x0 - 330;
    const ya = y0 - 40;
    bronze.push(
      [
        [xa, ya],
        [xa, ya + 300],
      ],
      [
        [xa - 58, ya + 210],
        [xa, ya + 300],
        [xa + 58, ya + 210],
      ],
    );

    return {
      gold: buildLineLayer(gold, p, { color: PALETTE.foil, intensity: 0.9, lift: FURNITURE_LIFT }),
      bronze: buildLineLayer(bronze, p, {
        color: PALETTE.parchment,
        intensity: 0.62,
        lift: FURNITURE_LIFT,
      }),
      scaleAt: [x0 + 500, y0 - 130] as [number, number],
      northAt: [xa, ya + 420] as [number, number],
    };
  }, [landscape, projection, chateau]);

  useEffect(
    () => () => {
      if (!furniture) return;
      furniture.gold.dispose();
      furniture.bronze.dispose();
    },
    [furniture],
  );

  /* ---- the station's court ---- */
  /**
   * Everything static about the selected station's residents. Orbit positions
   * are written per frame — at most sixteen marks, and JavaScript is where
   * `activityAtHour` lives — but colours, sizes and orbital elements are baked
   * here once per selection. Speed and phase come from each species' own name,
   * so the same court always turns the same way.
   */
  const court = useMemo(() => {
    if (!selectedSite) return null;
    const entry = placed.find((item) => item.site.id === selectedSite);
    if (!entry) return null;
    const residents = speciesAtSite(data, selectedSite).slice(0, COURT_SIZE);
    if (!residents.length) return null;

    const n = residents.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const awake = new Float32Array(n);
    const most = residents[0].sites[selectedSite] ?? 1;

    residents.forEach((species, i) => {
      const [r, g, b] = toRGB(GUILD_COLORS[species.guild] ?? PALETTE.foil);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      // Log-scaled against the station's own most-recorded resident: the court
      // shows this station's proportions, not the estate's.
      const share = (species.sites[selectedSite] ?? 0) / most;
      // Small on purpose: the fly-in camera stands close, the marks sit under
      // bloom, and at the first size the whole court fused into one fireball.
      sizes[i] = 2.6 + logScale(1 + share * 9, 10) * 3.6;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAwake', new THREE.BufferAttribute(awake, 1));
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(entry.position[0], 1, entry.position[2]),
      4
    );

    const ground = projection
      ? terrainHeightAt(projection, entry.site.x, entry.site.y)
      : 0;

    // Orbital elements per resident, derived from the name so they are stable.
    const seeds = residents.map((species) => {
      let h = 0;
      for (let i = 0; i < species.sci.length; i++) h = (h * 31 + species.sci.charCodeAt(i)) >>> 0;
      return (h % 1000) / 1000;
    });

    return { entry, residents, geometry, ground, seeds };
  }, [selectedSite, data, placed, projection]);

  useEffect(
    () => () => {
      court?.geometry.dispose();
    },
    [court]
  );

  const courtUniforms = useMemo(() => ({ uReveal: { value: 0 } }), []);
  const courtMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: COURT_VERT,
        fragmentShader: COURT_FRAG,
        uniforms: courtUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [courtUniforms]
  );

  /* ---- the anchors the DOM will caption ---- */
  const anchorPoints = useMemo((): {
    name: string;
    kind: string;
    edge: boolean;
    local: THREE.Vector3;
  }[] => {
    if (!projection) return [];
    const p = projection;
    const points: { name: string; kind: string; edge: boolean; local: THREE.Vector3 }[] = [];
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const at = (mx: number, my: number, lift: number) =>
      new THREE.Vector3(worldXOf(p, mx), terrainHeightAt(p, mx, my) + lift, worldZOf(p, my));

    for (const place of landscape?.places ?? []) {
      // Purcari's own village node sits 80 m past the north edge of the DEM,
      // Antonești 300 m past the south — pulled to the margin, as any sheet
      // labels the town its road leaves toward. Label placement is layout, not
      // a coordinate claim.
      const margin = 120;
      let mx = clamp(place.x, p.west + margin, p.east - margin);
      let my = clamp(place.y, p.south + margin, p.north - margin);
      const edge = mx !== place.x || my !== place.y;
      let lift = 0.14;
      if (place.k === 'winery' && chateau) {
        // The name hangs under the ring like a plaque, on quiet vineyard
        // ground: above the roof it sat in the thick of the station filaments,
        // which is the busiest air on the whole sheet.
        // A shade west of centre: dead-centre the year "1827" sat inside a
        // station's bloom.
        mx = chateau.cx - 150;
        my = chateau.cy - chateau.radius - 170;
        lift = 0.1;
      }
      points.push({ name: place.n, kind: place.k, edge, local: at(mx, my, lift) });
    }
    if (furniture) {
      points.push({
        name: '1 km',
        kind: 'scale',
        edge: false,
        local: at(furniture.scaleAt[0], furniture.scaleAt[1], 0.05),
      });
      points.push({
        name: 'N',
        kind: 'north',
        edge: false,
        local: at(furniture.northAt[0], furniture.northAt[1], 0.05),
      });
    }

    /*
     * The two land covers the chapter is about, each named on one of its own
     * blocks. A legend asks the visitor to look away and translate; a word
     * lying on the woods does not.
     *
     * Which block gets the word is picked by rule, not by size alone: the
     * largest forest grove hugs the château and its centroid landed inside the
     * plaque, and the largest vineyard rows sit past the sheet's southern edge
     * under this chapter's camera. The word is placed on the biggest block
     * that is clear of the other captions — a label chooses legible ground the
     * way any cartographer places one, and claims nothing more than "this
     * green is woodland, this red is vine", which is true of every block.
     */
    if (landscape) {
      const centroidOfBest = (
        kind: string,
        fits: (cx: number, cy: number) => boolean,
      ): [number, number] | null => {
        let best: [number, number] | null = null;
        let bestArea = 0;
        for (const parcel of landscape.parcels) {
          if (parcel.k !== kind) continue;
          const pts = parcel.p;
          let area = 0;
          let sx = 0;
          let sy = 0;
          for (let i = 0; i < pts.length; i++) {
            const [x1, y1] = pts[i];
            const [x2, y2] = pts[(i + 1) % pts.length];
            area += x1 * y2 - x2 * y1;
            sx += x1;
            sy += y1;
          }
          area = Math.abs(area) / 2;
          const cx = sx / pts.length;
          const cy = sy / pts.length;
          if (area > bestArea && fits(cx, cy)) {
            bestArea = area;
            best = [cx, cy];
          }
        }
        return best;
      };

      // South of the ravine cluster: the groves beside the château already
      // live inside the plaque's air.
      const wood = centroidOfBest(
        'forest',
        (cx, cy) => cy < 150 && (chateau ? Math.hypot(cx - chateau.cx, cy - chateau.cy) > 500 : true),
      );
      if (wood)
        points.push({ name: 'Woodland', kind: 'forest', edge: false, local: at(wood[0], wood[1], 0.12) });
      // The western planted mass, mid-sheet: south of the ravine, clear of the
      // Hamza caption to the east and of the nav along the sheet's south edge.
      const vine = centroidOfBest(
        'vineyard',
        (cx, cy) => cx < 400 && cy > -1400 && cy < -700,
      );
      if (vine)
        points.push({
          name: 'Vineyards',
          kind: 'vineyard',
          edge: false,
          local: at(vine[0], vine[1], 0.12),
        });
    }
    return points;
  }, [landscape, projection, furniture, chateau]);

  /**
   * The fallback ground: a densely tessellated plane, not a CircleGeometry — a
   * circle is a triangle fan with a single centre vertex and no interior
   * tessellation, so displacing it in the vertex shader produces radial spikes
   * rather than terrain. Only built while the real landscape is missing.
   */
  const noiseGeometry = useMemo(
    () => (landscape ? null : new THREE.PlaneGeometry(24, 24, 200, 200)),
    [landscape],
  );

  useEffect(
    () => () => {
      noiseGeometry?.dispose();
    },
    [noiseGeometry],
  );

  /* ---- stations, as a single Points draw ---- */
  const { stationGeometry, stationOrder } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const n = placed.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const scales = new Float32Array(n);
    const richness = new Float32Array(n);
    const seeds = new Float32Array(n);
    const selected = new Float32Array(n);
    const ground = new Float32Array(n);

    const maxDetections = Math.max(...data.sites.map((s) => s.detections));
    const maxRichness = Math.max(...data.sites.map((s) => s.richness));

    placed.forEach((entry, i) => {
      positions[i * 3] = entry.position[0];
      positions[i * 3 + 1] = STATION_LIFT;
      positions[i * 3 + 2] = entry.position[2];
      // Every station stands on its own elevation — H10 down at 35 m in the
      // woodland by the river, H6 up at 156 m on the ridge.
      ground[i] = projection ? terrainHeightAt(projection, entry.site.x, entry.site.y) : 0;

      const [r, g, b] = siteColor(entry.site, lens);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // Size is in world units; the vertex shader converts to pixels by distance.
      // Log-scaled so H10's 7,981 detections don't erase H7's six.
      scales[i] = 1.0 + logScale(entry.site.detections, maxDetections) * 3.2;
      richness[i] = entry.site.richness / maxRichness;
      seeds[i] = i / n;
      selected[i] = entry.site.id === selectedSite ? 1 : 0;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute('aRichness', new THREE.BufferAttribute(richness, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSelected', new THREE.BufferAttribute(selected, 1));
    geometry.setAttribute('aGround', new THREE.BufferAttribute(ground, 1));
    // Filled every frame from the smoothed clock; seeded here so the first
    // frame is not blank.
    geometry.setAttribute('aActivity', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    return { stationGeometry: geometry, stationOrder: placed.map((p) => p.site.id) };
  }, [placed, data.sites, lens, selectedSite, projection]);

  useEffect(
    () => () => {
      stationGeometry.dispose();
    },
    [stationGeometry],
  );

  /* ---- filaments between stations ---- */
  /**
   * Every pair that shares more than half its species list. Thickness is not
   * available on WebGL lines, so shared-species weight rides on vertex alpha
   * instead — the strongest ties simply burn brighter.
   */
  const linkGeometry = useMemo(() => {
    const byId = new Map(placed.map((p) => [p.site.id, p.position]));
    const positions: number[] = [];
    const colors: number[] = [];
    const base = new THREE.Color(PALETTE.foil);
    const strong = new THREE.Color(PALETTE.candle);

    data.links
      .filter((link) => link.jaccard > 0.5)
      .forEach((link) => {
        const a = byId.get(link.a);
        const b = byId.get(link.b);
        if (!a || !b) return;
        // Bow each filament gently so the web reads as volume without becoming
        // vertical streaks — the chapter is framed nearly plan-view, where a tall
        // arc projects as a spike rather than a curve.
        const lift = 0.12 + link.jaccard * 0.5;
        const segments = 24;
        for (let s = 0; s < segments; s++) {
          for (const t of [s / segments, (s + 1) / segments]) {
            const x = a[0] + (b[0] - a[0]) * t;
            const z = a[2] + (b[2] - a[2]) * t;
            // The filament follows the ground it crosses, so a tie between the
            // ridge and the floodplain visibly spans the drop.
            const ground = projection ? terrainHeightAtWorld(projection, x, z) : 0;
            const y = ground + STATION_LIFT + Math.sin(t * Math.PI) * lift;
            positions.push(x, y, z);
            // Floors at 0.4 so even the weakest kept filament stays legible
            // against the ground; the strongest ties reach full foil.
            const weight = 0.4 + Math.min(1, (link.jaccard - 0.5) / 0.25) * 0.6;
            const color = base.clone().lerp(strong, Math.min(1, weight));
            const fade = Math.sin(t * Math.PI) * 0.7 + 0.3;
            colors.push(color.r * fade * weight, color.g * fade * weight, color.b * fade * weight);
          }
        }
      });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [placed, data.links, projection]);

  useEffect(
    () => () => {
      linkGeometry.dispose();
    },
    [linkGeometry],
  );

  /* ---- interaction ---- */
  const handlePointer = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    pulse.current.set(event.point.x, event.point.z, 1);

    // Into the group's own frame first. The stations are stored in local
    // coordinates, and with the mouse orbit the group can stand a dozen degrees
    // away from world axes — comparing world point against local marks was
    // already slightly off under the idle sway, and under the orbit it would
    // miss by more than the touch radius.
    const local = groupRef.current
      ? groupRef.current.worldToLocal(event.point.clone())
      : event.point;

    // Nearest station within a generous touch radius — fingers are imprecise.
    let nearest: string | null = null;
    let best = 1.9;
    placed.forEach((entry) => {
      const dx = entry.position[0] - local.x;
      const dz = entry.position[2] - local.z;
      const distance = Math.hypot(dx, dz);
      if (distance < best) {
        best = distance;
        nearest = entry.site.id;
      }
    });
    onSelectSite?.(nearest);
  };

  /* ---- the camera's mark ---- */
  /**
   * Where the chosen station stands: its mark in local scene units, halfway up
   * its own lift so the camera aims between the light and the ground it names.
   * Local, not world: the idle sway and the mouse orbit rotate the group a few
   * degrees, and a camera chasing the swayed point would never settle.
   */
  useEffect(() => {
    if (!onFocus) return;
    if (!selectedSite) {
      onFocus(null);
      return;
    }
    const entry = placed.find((item) => item.site.id === selectedSite);
    if (!entry) {
      onFocus(null);
      return;
    }
    const ground = projection
      ? terrainHeightAt(projection, entry.site.x, entry.site.y)
      : 0;
    onFocus([entry.position[0], ground + STATION_LIFT * 0.5, entry.position[2]]);
  }, [onFocus, selectedSite, placed, projection]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    revealRef.current += (reveal - revealRef.current) * Math.min(1, delta * 2.2);
    const r = revealRef.current;

    /* ---- clock ---- */
    // Eased across the 24h wrap so scrubbing past midnight does not run the
    // whole day backwards.
    const target = clock ? clock.hour : hour;
    let diff = target - hourRef.current;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    hourRef.current = (hourRef.current + diff * Math.min(1, delta * (clock && !clock.scrubbing ? 14 : 5)) + 24) % 24;

    const attr = stationGeometry.getAttribute('aActivity') as THREE.BufferAttribute;
    const values = attr.array as Float32Array;
    for (let i = 0; i < placed.length; i++) {
      values[i] = siteActivityAt(placed[i].site, hourRef.current);
    }
    attr.needsUpdate = true;

    landUniforms.uTime.value = t;
    landUniforms.uReveal.value = r;
    landUniforms.uHour.value = hourRef.current;
    landUniforms.uPulse.value.set(pulse.current.x, pulse.current.y, pulse.current.z);
    pulse.current.z *= 1 - Math.min(1, delta * 0.75);

    stationUniforms.uTime.value = t;
    stationUniforms.uReveal.value = r;

    if (linksRef.current) {
      const material = linksRef.current.material as THREE.LineBasicMaterial;
      // Filaments breathe slightly out of phase with the stations.
      material.opacity = r * (0.82 + Math.sin(t * 0.4) * 0.14);
    }

    if (groupRef.current) {
      // A very slow drift keeps the tableau alive without inducing motion
      // sickness on a screen someone stands in front of for twenty minutes —
      // plus a small hand-driven orbit: the pointer leads the map around by up
      // to ~9°, eased hard so it feels like weight, not like a cursor. On a
      // touch kiosk the pointer rests wherever the last tap left it, which
      // parks the orbit rather than fighting it.
      orbitRef.current +=
        (state.pointer.x * -0.16 - orbitRef.current) * Math.min(1, delta * 1.6);
      groupRef.current.rotation.y = Math.sin(t * 0.035) * 0.09 + orbitRef.current;
    }

    /* ---- the court turns ---- */
    // Ease the court in a beat after the camera starts its descent, out as soon
    // as the choice clears; positions and wakefulness are written every frame.
    courtReveal.current +=
      ((court ? 1 : 0) - courtReveal.current) * Math.min(1, delta * (court ? 1.4 : 3));
    courtUniforms.uReveal.value = courtReveal.current * r;
    if (court && courtRef.current) {
      const position = court.geometry.getAttribute('position') as THREE.BufferAttribute;
      const awake = court.geometry.getAttribute('aAwake') as THREE.BufferAttribute;
      const [sx, , sz] = court.entry.position;
      for (let i = 0; i < court.residents.length; i++) {
        const seed = court.seeds[i];
        // Inner orbits for the most-recorded, spreading outward down the list;
        // each resident keeps its own pace and starting bearing.
        const radius = 0.62 + (i / Math.max(1, court.residents.length - 1)) * 1.25;
        const angle = seed * Math.PI * 2 + t * (0.10 + seed * 0.16) * (seed > 0.5 ? 1 : -1);
        const bob = Math.sin(t * 0.7 + seed * 12.6) * 0.05;
        position.setXYZ(
          i,
          sx + Math.cos(angle) * radius,
          court.ground + 0.34 + bob + (i % 3) * 0.09,
          sz + Math.sin(angle) * radius * 0.82
        );
        // The measured schedule, against the same looping day as everything
        // else: this is who is genuinely awake at this station at this hour.
        awake.setX(i, activityAtHour(court.residents[i], hourRef.current));
      }
      position.needsUpdate = true;
      awake.needsUpdate = true;
    }

    /* ---- caption anchors, ~11 Hz ---- */
    // Through the group's own matrixWorld, so the labels ride the sway instead
    // of drifting off their marks. Same cadence as Refuge's captions: fast
    // enough to track the drift, far too slow to matter to the render loop.
    if (onMapAnchors && anchorPoints.length && groupRef.current && t - lastAnchors.current > 0.09) {
      lastAnchors.current = t;
      const matrix = groupRef.current.matrixWorld;
      const marks: MapAnchor[] = [];
      for (const point of anchorPoints) {
        ANCHOR_SCRATCH.copy(point.local).applyMatrix4(matrix).project(camera);
        if (ANCHOR_SCRATCH.z > 1) continue;
        marks.push({
          name: point.name,
          kind: point.kind,
          edge: point.edge,
          x: (ANCHOR_SCRATCH.x * 0.5 + 0.5) * size.width,
          y: (-ANCHOR_SCRATCH.y * 0.5 + 0.5) * size.height,
        });
      }
      onMapAnchors(marks);
    }
  });

  return (
    <group ref={groupRef}>
      {layers ? (
        <>
          <mesh
            ref={groundRef}
            geometry={layers.terrain}
            material={materials.terrain}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={0}
            onPointerDown={handlePointer}
          />
          {/* Every drape is already in the land's frame, so none of them rotate. */}
          <mesh geometry={layers.areas} material={materials.areas} renderOrder={1} />
          <lineSegments geometry={layers.tracks} material={materials.drape} renderOrder={2} />
          <lineSegments geometry={layers.waterways} material={materials.drape} renderOrder={3} />
          <mesh geometry={layers.buildings} material={materials.built} renderOrder={4} />
          {furniture && (
            <>
              <lineSegments geometry={furniture.gold} material={materials.drape} renderOrder={4} />
              <lineSegments
                geometry={furniture.bronze}
                material={materials.drape}
                renderOrder={4}
              />
            </>
          )}
        </>
      ) : (
        noiseGeometry && (
          <mesh
            ref={groundRef}
            geometry={noiseGeometry}
            material={materials.noise}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerDown={handlePointer}
          />
        )
      )}

      <lineSegments ref={linksRef} geometry={linkGeometry} renderOrder={5}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      <points
        ref={stationsRef}
        geometry={stationGeometry}
        material={materials.stations}
        renderOrder={6}
        userData={{ stationOrder }}
      />

      {/* The chosen station's residents, in orbit around its mark. */}
      {court && (
        <points
          ref={courtRef}
          geometry={court.geometry}
          material={courtMaterial}
          renderOrder={7}
        />
      )}
    </group>
  );
}
