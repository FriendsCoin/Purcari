/**
 * Turns the baked OSM + DEM payload into buffers.
 *
 * All of this runs once, off the render loop. Everything is draped: a line on
 * the ground samples the DEM at every vertex, because the relief is exaggerated
 * five and a half times and anything drawn flat would float above the hills or
 * sink into them.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import type { GeoShape, Landscape } from './data';
import type { Projection } from './projection';

/** Lift for anything drawn on the surface, to stay clear of z-fighting. */
const DRAPE = 0.12;

function attr(geometry: BufferGeometry, name: string, data: number[], size: number) {
  geometry.setAttribute(name, new BufferAttribute(Float32Array.from(data), size));
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function buildTerrain(projection: Projection, landscape: Landscape): BufferGeometry | null {
  const grid = landscape.terrain;
  if (!grid) return null;

  const { bbox } = projection;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const latAt = (j: number) => bbox.lat1 - ((bbox.lat1 - bbox.lat0) * j) / (grid.h - 1);
  const lngAt = (i: number) => bbox.lng0 + ((bbox.lng1 - bbox.lng0) * i) / (grid.w - 1);

  for (let j = 0; j < grid.h; j += 1) {
    for (let i = 0; i < grid.w; i += 1) {
      const lat = latAt(j);
      const lng = lngAt(i);
      const [x, z] = projection.project(lat, lng);
      positions.push(x, projection.ground(lat, lng), z);
      uvs.push(i / (grid.w - 1), j / (grid.h - 1));
      normals.push(0, 1, 0);
    }
  }

  for (let j = 0; j < grid.h - 1; j += 1) {
    for (let i = 0; i < grid.w - 1; i += 1) {
      const a = j * grid.w + i;
      const b = a + 1;
      const c = a + grid.w;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  attr(geometry, 'position', positions, 3);
  attr(geometry, 'normal', normals, 3);
  attr(geometry, 'uv', uvs, 2);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------------------

type Point2 = [number, number];

function ringToScene(projection: Projection, pts: Array<[number, number]>): Point2[] {
  const out: Point2[] = [];
  for (const [lat, lng] of pts) out.push(projection.project(lat, lng));
  // OSM closes its rings; a duplicate final vertex upsets the triangulator.
  if (out.length > 1) {
    const [fx, fz] = out[0];
    const [lx, lz] = out[out.length - 1];
    if (Math.abs(fx - lx) < 1e-6 && Math.abs(fz - lz) < 1e-6) out.pop();
  }
  return out;
}

function signedArea(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

/** Ear clipping. Simple polygons only, which is all OSM landcover needs here. */
function triangulate(ring: Point2[]): number[] {
  const n = ring.length;
  if (n < 3) return [];

  const indices = [...Array(n).keys()];
  if (signedArea(ring) < 0) indices.reverse();

  const inTriangle = (p: Point2, a: Point2, b: Point2, c: Point2) => {
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-12) return false;
    const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
    const v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
    return u >= 0 && v >= 0 && u + v <= 1;
  };

  const out: number[] = [];
  let guard = n * n;

  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i += 1) {
      const ia = indices[(i + indices.length - 1) % indices.length];
      const ib = indices[i];
      const ic = indices[(i + 1) % indices.length];
      const a = ring[ia];
      const b = ring[ib];
      const c = ring[ic];

      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 0) continue; // reflex

      let clean = true;
      for (const ip of indices) {
        if (ip === ia || ip === ib || ip === ic) continue;
        if (inTriangle(ring[ip], a, b, c)) {
          clean = false;
          break;
        }
      }
      if (!clean) continue;

      out.push(ia, ib, ic);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }

  if (indices.length === 3) out.push(indices[0], indices[1], indices[2]);
  return out;
}

/**
 * Filled landcover, draped on the relief. Returns one merged geometry with a
 * per-vertex `aShade` carrying the polygon's own random seed, so the shader can
 * vary parcels without a draw call each.
 */
export function buildAreas(
  projection: Projection,
  shapes: GeoShape[],
  lift = DRAPE
): BufferGeometry | null {
  const positions: number[] = [];
  const seeds: number[] = [];
  let seed = 0;

  for (const shape of shapes) {
    const ring = ringToScene(projection, shape.pts);
    if (ring.length < 3) continue;
    const tris = triangulate(ring);
    if (!tris.length) continue;
    seed = (seed * 9301 + 49297) % 233280;
    const s = seed / 233280;

    for (const index of tris) {
      const [x, z] = ring[index];
      positions.push(x, projection.groundAt(x, z) + lift, z);
      seeds.push(s);
    }
  }

  if (!positions.length) return null;
  const geometry = new BufferGeometry();
  attr(geometry, 'position', positions, 3);
  attr(geometry, 'aShade', seeds, 1);
  return geometry;
}

// ---------------------------------------------------------------------------
// Vineyard rows — the signature texture of the estate
// ---------------------------------------------------------------------------

/**
 * Fills every vineyard parcel with parallel rows along its own long axis, the
 * way the vines actually run, then drapes them over the hillside.
 */
export function buildVineyardRows(
  projection: Projection,
  parcels: GeoShape[],
  spacingMetres = 18
): BufferGeometry | null {
  const positions: number[] = [];
  const seeds: number[] = [];
  const spacing = projection.metresToUnits(spacingMetres);
  let parcelSeed = 0;

  for (const parcel of parcels) {
    const ring = ringToScene(projection, parcel.pts);
    if (ring.length < 3) continue;

    // Principal axis by covariance — rows follow the parcel's long direction.
    let cx = 0;
    let cz = 0;
    for (const [x, z] of ring) {
      cx += x;
      cz += z;
    }
    cx /= ring.length;
    cz /= ring.length;

    let sxx = 0;
    let szz = 0;
    let sxz = 0;
    for (const [x, z] of ring) {
      const dx = x - cx;
      const dz = z - cz;
      sxx += dx * dx;
      szz += dz * dz;
      sxz += dx * dz;
    }
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ux = Math.cos(angle);
    const uz = Math.sin(angle);
    const vx = -uz;
    const vz = ux;

    // Project the ring into (u, v); rows are lines of constant v.
    const local = ring.map(([x, z]) => {
      const dx = x - cx;
      const dz = z - cz;
      return [dx * ux + dz * uz, dx * vx + dz * vz] as Point2;
    });

    let vMin = Infinity;
    let vMax = -Infinity;
    for (const [, v] of local) {
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    if (!Number.isFinite(vMin) || vMax - vMin < spacing) continue;

    parcelSeed = (parcelSeed * 9301 + 49297) % 233280;
    const parcelRandom = parcelSeed / 233280;

    const first = vMin + spacing * (0.5 + parcelRandom * 0.4);
    for (let v = first; v < vMax; v += spacing) {
      // Scanline crossings against every edge.
      const crossings: number[] = [];
      for (let i = 0; i < local.length; i += 1) {
        const [u1, v1] = local[i];
        const [u2, v2] = local[(i + 1) % local.length];
        if (v1 === v2) continue;
        if (v >= Math.min(v1, v2) && v < Math.max(v1, v2)) {
          crossings.push(u1 + ((v - v1) / (v2 - v1)) * (u2 - u1));
        }
      }
      crossings.sort((a, b) => a - b);

      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const uStart = crossings[k];
        const uEnd = crossings[k + 1];
        const span = uEnd - uStart;
        if (span < spacing * 0.4) continue;

        // Subdivide so the row follows the ground instead of cutting through it.
        const steps = Math.max(2, Math.min(24, Math.round(span / 2)));
        let prev: [number, number, number] | null = null;
        for (let s = 0; s <= steps; s += 1) {
          const u = uStart + (span * s) / steps;
          const x = cx + u * ux + v * vx;
          const z = cz + u * uz + v * vz;
          const point: [number, number, number] = [x, projection.groundAt(x, z) + DRAPE, z];
          if (prev) {
            positions.push(...prev, ...point);
            seeds.push(parcelRandom, parcelRandom);
          }
          prev = point;
        }
      }
    }
  }

  if (!positions.length) return null;
  const geometry = new BufferGeometry();
  attr(geometry, 'position', positions, 3);
  attr(geometry, 'aShade', seeds, 1);
  return geometry;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingBuffers {
  walls: BufferGeometry | null;
  crowns: BufferGeometry | null;
}

/**
 * Extrudes footprints into wall bands with a bright crown line at the eaves.
 * Anything within `estateRadius` of the château is flagged so the winery reads
 * as the centre of the estate rather than as one more village house.
 */
export function buildBuildings(
  projection: Projection,
  buildings: GeoShape[],
  chateau: { lat: number; lng: number } | null,
  estateRadiusMetres = 260
): BuildingBuffers {
  const wallPos: number[] = [];
  const wallRatio: number[] = [];
  const wallEstate: number[] = [];
  const wallU: number[] = [];
  const crownPos: number[] = [];
  const crownEstate: number[] = [];

  const [ecx, ecz] = chateau ? projection.project(chateau.lat, chateau.lng) : [NaN, NaN];
  const estateRadius = projection.metresToUnits(estateRadiusMetres);

  for (const building of buildings) {
    const ring = ringToScene(projection, building.pts);
    if (ring.length < 3) continue;

    let baseY = Infinity;
    let cx = 0;
    let cz = 0;
    for (const [x, z] of ring) {
      baseY = Math.min(baseY, projection.groundAt(x, z));
      cx += x;
      cz += z;
    }
    cx /= ring.length;
    cz /= ring.length;

    const isEstate = chateau ? Math.hypot(cx - ecx, cz - ecz) < estateRadius : false;

    // Footprint area stands in for importance: the winery halls are big.
    const area = Math.abs(signedArea(ring));
    const levels = building.levels ?? (area > 400 ? 2 : 1);
    const metres = Math.max(4, levels * 3.4) * (isEstate ? 1.5 : 1);
    // Pushed past the relief's own exaggeration: at true scale a ten-metre
    // winery is a single unit on a hundred-unit field and reads as nothing.
    const height = projection.metresToUnits(metres) * 9;

    const flag = isEstate ? 1 : 0;

    for (let i = 0; i < ring.length; i += 1) {
      const [x1, z1] = ring[i];
      const [x2, z2] = ring[(i + 1) % ring.length];
      const top = baseY + height;

      wallPos.push(x1, baseY, z1, x2, baseY, z2, x2, top, z2);
      wallPos.push(x1, baseY, z1, x2, top, z2, x1, top, z1);
      wallRatio.push(0, 0, 1, 0, 1, 1);
      // Running length along the façade, so the shader can lay windows on it.
      const span = Math.hypot(x2 - x1, z2 - z1);
      wallU.push(0, span, span, 0, span, 0);
      for (let k = 0; k < 6; k += 1) wallEstate.push(flag);

      crownPos.push(x1, top, z1, x2, top, z2);
      crownEstate.push(flag, flag);
    }
  }

  const make = (positions: number[], extras: Array<[string, number[], number]>) => {
    if (!positions.length) return null;
    const geometry = new BufferGeometry();
    attr(geometry, 'position', positions, 3);
    for (const [name, data, size] of extras) attr(geometry, name, data, size);
    return geometry;
  };

  return {
    walls: make(wallPos, [
      ['aRatio', wallRatio, 1],
      ['aEstate', wallEstate, 1],
      ['aWallU', wallU, 1],
    ]),
    crowns: make(crownPos, [['aEstate', crownEstate, 1]]),
  };
}

// ---------------------------------------------------------------------------
// Draped polylines: roads and watercourses
// ---------------------------------------------------------------------------

const ROAD_WEIGHT: Record<string, number> = {
  motorway: 1,
  trunk: 0.9,
  primary: 0.8,
  secondary: 0.68,
  tertiary: 0.55,
  unclassified: 0.36,
  residential: 0.32,
  service: 0.2,
  track: 0.16,
};

export function buildPolylines(
  projection: Projection,
  shapes: GeoShape[],
  weightOf: (shape: GeoShape) => number,
  lift = DRAPE * 1.6
): BufferGeometry | null {
  const positions: number[] = [];
  const weights: number[] = [];
  const along: number[] = [];

  for (const shape of shapes) {
    const line = ringToScene(projection, shape.pts);
    if (line.length < 2) continue;
    const weight = weightOf(shape);
    let travelled = 0;

    for (let i = 0; i + 1 < line.length; i += 1) {
      const [x1, z1] = line[i];
      const [x2, z2] = line[i + 1];
      const length = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(1, Math.min(20, Math.round(length / 1.5)));

      for (let s = 0; s < steps; s += 1) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const ax = x1 + (x2 - x1) * t0;
        const az = z1 + (z2 - z1) * t0;
        const bx = x1 + (x2 - x1) * t1;
        const bz = z1 + (z2 - z1) * t1;

        positions.push(ax, projection.groundAt(ax, az) + lift, az);
        positions.push(bx, projection.groundAt(bx, bz) + lift, bz);
        weights.push(weight, weight);
        along.push(travelled + length * t0, travelled + length * t1);
      }
      travelled += length;
    }
  }

  if (!positions.length) return null;
  const geometry = new BufferGeometry();
  attr(geometry, 'position', positions, 3);
  attr(geometry, 'aWeight', weights, 1);
  attr(geometry, 'aAlong', along, 1);
  return geometry;
}

export const roadWeight = (shape: GeoShape) => ROAD_WEIGHT[shape.kind ?? 'track'] ?? 0.2;
export const riverWeight = (shape: GeoShape) =>
  shape.kind === 'river' ? 1 : shape.kind === 'canal' ? 0.6 : 0.35;
