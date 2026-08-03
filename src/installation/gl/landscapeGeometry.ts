import * as THREE from 'three';
import { sampleElevation } from '../core/data';
import type { LandscapeData, LandscapeDem, Site } from '../core/types';

/**
 * The real ground of Purcari, turned into geometry.
 *
 * Everything here is built once on the CPU and merged into one BufferGeometry
 * per layer: 199 landuse parcels, 235 tracks, 44 streams, 7 water bodies and
 * 533 building footprints become four draw calls plus the terrain, instead of
 * a thousand. Nothing animates in these buffers — the layers ride the same
 * `uReveal` in their vertex shaders, so the whole landscape rises together.
 *
 * Sources are public: SRTM 30 m elevation, OpenStreetMap map data (ODbL).
 */

/* ------------------------------------------------------------- projection */

/**
 * The estate origin. These mirror `sampleElevation()` in core/data.ts, which
 * hard-codes them; they must not drift apart or the map would sit beside its
 * own elevation model rather than on it.
 */
const ORIGIN_LAT = 46.52;
const ORIGIN_LON = 29.872;
const METRES_PER_DEG_LAT = 110540;
const METRES_PER_DEG_LON = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

/**
 * Vertical exaggeration of the relief.
 *
 * The estate carries about 170 m of real relief (−4 m on the Dniester
 * floodplain to 164 m on the southern ridge) across roughly 4 km. At this
 * scene's horizontal scale that is 0.7 scene units of height against a 13-unit
 * map — a dinner plate. Multiplying relief by three is ordinary practice for a
 * physical relief model, and it is what makes the river terrace, the ravine at
 * H11 and the plateau read at all under the chapter's near-plan camera. Shape
 * is honest; gradients are not, and are never quoted as degrees anywhere in
 * the piece.
 */
export const VERTICAL_EXAGGERATION = 3;

/** Contour interval in real metres. About seventeen lines across the estate. */
export const CONTOUR_INTERVAL = 10;

/** Longest edge, in real metres, of a draped triangle or line segment. */
const MAX_DRAPE_EDGE = 40;
/** Hard stop on the recursive split, so a malformed ring cannot run away. */
const MAX_SUBDIVISION_DEPTH = 6;
/** Below this the map sheet has faded to nothing, so the geometry is dropped. */
const MIN_FADE = 0.02;

export interface EstateProjection {
  readonly dem: LandscapeDem;
  /** Scene units per estate metre. */
  readonly scale: number;
  /** Centre of the station bounding box, in estate metres. */
  readonly cx: number;
  readonly cy: number;
  /** Elevation in metres that maps to y = 0. */
  readonly datum: number;
  /** The DEM footprint, in estate metres. */
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

/**
 * Metres east/north of the estate origin → scene units.
 *
 * This has to agree with `layoutSites(data.sites, radius)` in core/data.ts
 * exactly, or the twelve stations would stand somewhere other than their own
 * ground. The centring and scale are mirrored here because `layoutSites`
 * returns placed sites rather than the transform it used.
 */
export function estateProjection(
  sites: Site[],
  radius: number,
  dem: LandscapeDem,
): EstateProjection {
  const xs = sites.map((s) => s.x);
  const ys = sites.map((s) => s.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  return {
    dem,
    scale: (radius * 2) / extent,
    cx,
    cy,
    // Mid-relief sits at y = 0, so the estate hovers around the origin the way
    // the abstract ground it replaces did, and the camera framing is unchanged.
    datum: (dem.min + dem.max) / 2,
    west: (dem.bbox.west - ORIGIN_LON) * METRES_PER_DEG_LON,
    east: (dem.bbox.east - ORIGIN_LON) * METRES_PER_DEG_LON,
    south: (dem.bbox.south - ORIGIN_LAT) * METRES_PER_DEG_LAT,
    north: (dem.bbox.north - ORIGIN_LAT) * METRES_PER_DEG_LAT,
  };
}

/** East in metres → scene x. */
export function worldXOf(p: EstateProjection, mx: number): number {
  return (mx - p.cx) * p.scale;
}

/** North in metres → scene z. North is −z, so the map keeps north up. */
export function worldZOf(p: EstateProjection, my: number): number {
  return -(my - p.cy) * p.scale;
}

/** Metres above sea level → scene y, exaggerated. */
export function elevationToWorld(p: EstateProjection, metres: number): number {
  return (metres - p.datum) * p.scale * VERTICAL_EXAGGERATION;
}

/** Scene y of the terrain at a point given in estate metres. */
export function terrainHeightAt(p: EstateProjection, mx: number, my: number): number {
  return elevationToWorld(p, sampleElevation(p.dem, mx, my));
}

/** Scene y of the terrain under a point given in scene units. */
export function terrainHeightAtWorld(p: EstateProjection, x: number, z: number): number {
  return terrainHeightAt(p, x / p.scale + p.cx, -z / p.scale + p.cy);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of the map sheet survives at a point, 0..1.
 *
 * The estate has to float in the dark rather than sit on a visible rectangle,
 * so every layer dissolves toward the edge of the elevation model. The cubed
 * norm gives a rounded-rectangle falloff that follows the DEM's own footprint
 * instead of cropping it to a circle — the same expression the terrain shader
 * evaluates per fragment from its uv, so drapes and ground fade as one.
 */
export function edgeFade(p: EstateProjection, mx: number, my: number): number {
  const u = Math.abs((mx - (p.west + p.east) / 2) / ((p.east - p.west) / 2));
  const v = Math.abs((my - (p.south + p.north) / 2) / ((p.north - p.south) / 2));
  const r = Math.cbrt(u * u * u + v * v * v);
  return 1 - smoothstep(0.8, 1.02, r);
}

/* ---------------------------------------------------------------- terrain */

export interface TerrainOptions {
  segmentsX?: number;
  segmentsY?: number;
}

/**
 * The DEM as a displaced plane.
 *
 * A PlaneGeometry's vertices lie in LOCAL XY with z = 0, and the mesh is
 * rotated −90° about X so that local +Z becomes world +Y. So the grid is
 * sampled with the vertex's own x and y, and the elevation goes into z:
 * sampling p.xz would be constant along one axis, and displacing p.y would
 * push the land sideways instead of lifting it.
 *
 * Displacing here rather than in the vertex shader means the drapes can be
 * hung on exactly the same surface, through the same bilinear sample, and that
 * the hillshade can use a real analytic slope rather than screen-space
 * derivatives of a faceted surface.
 */
export function buildTerrain(p: EstateProjection, options: TerrainOptions = {}): THREE.BufferGeometry {
  // ~22 m between vertices: twice the resolution of the 30 m grid, so the
  // bilinear surface is fully resolved and nothing is invented on top of it.
  const { segmentsX = 144, segmentsY = 192 } = options;
  const width = (p.east - p.west) * p.scale;
  const height = (p.north - p.south) * p.scale;
  const geometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY);
  // PlaneGeometry is centred on its own origin; slide it so that local (0, 0)
  // is the origin layoutSites places the stations around.
  geometry.translate(
    ((p.west + p.east) / 2 - p.cx) * p.scale,
    ((p.south + p.north) / 2 - p.cy) * p.scale,
    0,
  );

  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const count = position.count;
  const elevation = new Float32Array(count);

  // Central-difference step for the slope, ~1.5 SRTM cells. Anything finer and
  // the grid's whole-metre quantisation shows up as terracing in the hillshade.
  const step = 45;

  for (let i = 0; i < count; i++) {
    const mx = position.getX(i) / p.scale + p.cx;
    const my = position.getY(i) / p.scale + p.cy;
    const metres = sampleElevation(p.dem, mx, my);
    elevation[i] = metres;
    position.setZ(i, elevationToWorld(p, metres));

    // Real slope, in metres per metre, then exaggerated to match the surface.
    const dzdx =
      ((sampleElevation(p.dem, mx + step, my) - sampleElevation(p.dem, mx - step, my)) /
        (2 * step)) *
      VERTICAL_EXAGGERATION;
    const dzdy =
      ((sampleElevation(p.dem, mx, my + step) - sampleElevation(p.dem, mx, my - step)) /
        (2 * step)) *
      VERTICAL_EXAGGERATION;
    // Still in the plane's local frame, where +Z is the displacement axis.
    const length = Math.hypot(dzdx, dzdy, 1);
    normal.setXYZ(i, -dzdx / length, -dzdy / length, 1 / length);
  }

  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.setAttribute('aElevation', new THREE.BufferAttribute(elevation, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/* ------------------------------------------------------------------ rings */

type Point = [number, number];

/** Drop the repeated closing vertex OSM rings carry. */
function openRing(ring: Point[]): Point[] {
  if (ring.length < 2) return ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring.slice();
}

function signedArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

/** Counter-clockwise in estate metres, which is what the wall winding assumes. */
function toCCW(pts: Point[]): Point[] {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

/**
 * Direction along which a hatch phase advances, so the stripes themselves run
 * parallel to the parcel's longest edge — vine rows follow the block, they do
 * not follow the compass. Returned in scene xz, where north is −z.
 */
function hatchAxis(pts: Point[]): [number, number] {
  let bx = 1;
  let by = 0;
  let best = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = dx * dx + dy * dy;
    if (d > best) {
      best = d;
      bx = dx;
      by = dy;
    }
  }
  // Metric (u, v) maps to scene (u, −v); the phase axis is the perpendicular.
  const length = Math.hypot(bx, by) || 1;
  return [by / length, bx / length];
}

/**
 * Split until every edge is shorter than `maxEdge`, so a 200 m parcel follows
 * the hillside instead of cutting through it.
 *
 * The test is on the longest edge and the split is the uniform 1→4 midpoint
 * split, which is conforming: two triangles sharing an edge longer than the
 * threshold both split it, and both split it at the same midpoint, so no
 * cracks open along the seam.
 */
function subdivideTriangle(
  a: Point,
  b: Point,
  c: Point,
  maxEdge: number,
  depth: number,
  emit: (a: Point, b: Point, c: Point) => void,
): void {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  if (depth <= 0 || Math.max(ab, bc, ca) <= maxEdge) {
    emit(a, b, c);
    return;
  }
  const ma: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const mb: Point = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const mc: Point = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
  subdivideTriangle(a, ma, mc, maxEdge, depth - 1, emit);
  subdivideTriangle(ma, b, mb, maxEdge, depth - 1, emit);
  subdivideTriangle(mc, mb, c, maxEdge, depth - 1, emit);
  subdivideTriangle(ma, mb, mc, maxEdge, depth - 1, emit);
}

/* ------------------------------------------------------------------ areas */

/** Flat wash. */
export const AREA_PLAIN = 0;
/** Hatched along its own longest edge — the vineyard blocks. */
export const AREA_HATCHED = 1;
/** Open water, which gets a slow sheen. */
export const AREA_WATER = 2;

export interface AreaStyle {
  /** Palette hex. */
  color: string;
  /** How hard the wash burns. This is context: keep it well under the stations. */
  intensity: number;
  /** One of AREA_PLAIN / AREA_HATCHED / AREA_WATER. */
  kind: number;
}

/**
 * Landuse parcels and water bodies, draped and merged into one geometry.
 *
 * Vineyard, forest, farmland and water differ only by their per-vertex colour
 * and kind, so the whole map of surfaces is a single draw call rather than one
 * per class.
 */
export function buildAreaLayer(
  landscape: LandscapeData,
  p: EstateProjection,
  styles: Record<string, AreaStyle>,
  fallback: AreaStyle,
  lift: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const rows: number[] = [];
  const fades: number[] = [];
  const kinds: number[] = [];
  const tint = new THREE.Color();

  const addRing = (ring: Point[], style: AreaStyle) => {
    const pts = openRing(ring);
    if (pts.length < 3) return;
    if (pts.every((q) => edgeFade(p, q[0], q[1]) < MIN_FADE)) return;

    tint.set(style.color).multiplyScalar(style.intensity);
    const axis = hatchAxis(pts);
    const faces = THREE.ShapeUtils.triangulateShape(
      pts.map(([x, y]) => ({ x, y })),
      [],
    );

    const push = (q: Point) => {
      positions.push(worldXOf(p, q[0]), terrainHeightAt(p, q[0], q[1]) + lift, worldZOf(p, q[1]));
      colors.push(tint.r, tint.g, tint.b);
      rows.push(axis[0], axis[1]);
      fades.push(edgeFade(p, q[0], q[1]));
      kinds.push(style.kind);
    };

    for (const face of faces) {
      const a = pts[face[0]];
      const b = pts[face[1]];
      const c = pts[face[2]];
      if (!a || !b || !c) continue;
      // Earcut normalises winding internally, so orient each face here: a
      // counter-clockwise triangle in metres faces up once east/north maps to
      // scene x/−z.
      const ordered: [Point, Point, Point] = signedArea([a, b, c]) < 0 ? [a, c, b] : [a, b, c];
      subdivideTriangle(
        ordered[0],
        ordered[1],
        ordered[2],
        MAX_DRAPE_EDGE,
        MAX_SUBDIVISION_DEPTH,
        (v0, v1, v2) => {
          push(v0);
          push(v1);
          push(v2);
        },
      );
    }
  };

  for (const parcel of landscape.parcels) {
    addRing(parcel.p, styles[parcel.k] ?? fallback);
  }
  for (const body of landscape.water) {
    addRing(body, styles.water ?? fallback);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aRow', new THREE.Float32BufferAttribute(rows, 2));
  geometry.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ lines */

export interface LineStyle {
  color: string;
  intensity: number;
  /** Height above the terrain, in scene units. */
  lift: number;
  /** Close each path back to its first point — for water body outlines. */
  closed?: boolean;
}

/**
 * Tracks, streams or ring outlines, merged into one LineSegments buffer.
 *
 * Long segments are cut at `MAX_DRAPE_EDGE` so a farm track climbing the ravine
 * bends with the slope instead of spanning it. The edge fade is baked into the
 * vertex colour: these buffers never change, and the material is additive, so
 * a dark vertex is an absent one.
 */
export function buildLineLayer(
  paths: Point[][],
  p: EstateProjection,
  style: LineStyle,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const tint = new THREE.Color(style.color).multiplyScalar(style.intensity);

  const push = (q: Point) => {
    positions.push(
      worldXOf(p, q[0]),
      terrainHeightAt(p, q[0], q[1]) + style.lift,
      worldZOf(p, q[1]),
    );
    const fade = edgeFade(p, q[0], q[1]);
    colors.push(tint.r * fade, tint.g * fade, tint.b * fade);
  };

  for (const raw of paths) {
    const path = style.closed ? openRing(raw) : raw;
    if (path.length < 2) continue;
    const last = style.closed ? path.length : path.length - 1;
    for (let i = 0; i < last; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      if (edgeFade(p, a[0], a[1]) < MIN_FADE && edgeFade(p, b[0], b[1]) < MIN_FADE) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / MAX_DRAPE_EDGE));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
        push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

/* -------------------------------------------------------------- buildings */

export interface BuildingStyle {
  /** Sheds, houses, the winery's outbuildings. */
  base: string;
  /** The château and its cellars. */
  accent: string;
  /** Footprint area in m² at which a building starts to matter… */
  minArea: number;
  /** …and at which it is unmistakably the château. */
  maxArea: number;
  /** Extrusion of the smallest and largest footprints, in scene units. */
  minHeight: number;
  maxHeight: number;
}

/**
 * Every footprint extruded into a prism, merged into one geometry.
 *
 * Height and colour both follow footprint area, so the two largest buildings on
 * the estate — the château at 3,380 m² and the cellar block at 2,385 m² — burn
 * in foil while the village around them stays a dim bronze. Extrusion is
 * deliberately generous: a 10 m roof would be 0.04 scene units, invisible under
 * a plan camera, so height here reads as importance rather than as metres.
 */
export function buildBuildingLayer(
  landscape: LandscapeData,
  p: EstateProjection,
  style: BuildingStyle,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const base = new THREE.Color(style.base);
  const accent = new THREE.Color(style.accent);
  const roof = new THREE.Color();
  const wall = new THREE.Color();

  for (const building of landscape.buildings) {
    const pts = toCCW(openRing(building.p));
    if (pts.length < 3) continue;
    const fade = edgeFade(p, pts[0][0], pts[0][1]);
    if (fade < MIN_FADE) continue;

    const emphasis = smoothstep(style.minArea, style.maxArea, building.a);
    roof.copy(base).lerp(accent, emphasis).multiplyScalar((0.30 + emphasis * 0.95) * fade);
    // Walls are the same colour held back, which gives the mass a lit top
    // without a light in the scene.
    wall.copy(roof).multiplyScalar(0.42);

    let floor = Infinity;
    for (const q of pts) floor = Math.min(floor, terrainHeightAt(p, q[0], q[1]));
    // Sink the base slightly so no wall hangs over a hollow in the ground.
    floor -= 0.006;
    const top = floor + style.minHeight + (style.maxHeight - style.minHeight) * emphasis;

    const pushVertex = (q: Point, y: number, c: THREE.Color) => {
      positions.push(worldXOf(p, q[0]), y, worldZOf(p, q[1]));
      colors.push(c.r, c.g, c.b);
    };

    // Walls. The ring is counter-clockwise in metres, so (a-floor, b-floor,
    // a-top) and (b-floor, b-top, a-top) both face outward.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      pushVertex(a, floor, wall);
      pushVertex(b, floor, wall);
      pushVertex(a, top, roof);
      pushVertex(b, floor, wall);
      pushVertex(b, top, roof);
      pushVertex(a, top, roof);
    }

    // Roof.
    const faces = THREE.ShapeUtils.triangulateShape(
      pts.map(([x, y]) => ({ x, y })),
      [],
    );
    for (const face of faces) {
      const a = pts[face[0]];
      const b = pts[face[1]];
      const c = pts[face[2]];
      if (!a || !b || !c) continue;
      const ordered: [Point, Point, Point] = signedArea([a, b, c]) < 0 ? [a, c, b] : [a, b, c];
      pushVertex(ordered[0], top, roof);
      pushVertex(ordered[1], top, roof);
      pushVertex(ordered[2], top, roof);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
