import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from 'three';
import raw from './terrain.json';
import { atlas } from './atlas';

interface TerrainFile {
  meta: {
    bounds: { south: number; north: number; west: number; east: number };
    grid: number;
    minElevation: number;
    maxElevation: number;
    dataset: string;
    attribution: string;
  };
  elevations: number[];
}

const file = raw as unknown as TerrainFile;

/**
 * Scene units per metre. The survey area is 3.5 x 5.5 km; at this scale it is a
 * 58 x 90 box, which frames comfortably at the camera distances the chapter uses.
 */
export const METRES_TO_SCENE = 0.0165;

/**
 * Vertical exaggeration. The real relief is 169 m over 5.5 km — true to scale it
 * would be a barely perceptible ramp, and the escarpment between the vineyard
 * plateau and the floodplain is the whole point of the composition. Seven times
 * is within normal cartographic practice and keeps the slope readable.
 */
export const VERTICAL_EXAGGERATION = 7;

/**
 * The Dniester floodplain bottoms out around 0 m and the plateau starts climbing
 * past 10 m; 4 m puts the waterline in the flat of that gap.
 */
export const WATER_LEVEL_METRES = 4;

const RAD = Math.PI / 180;
const EARTH_R = 6378137;

/** Same equirectangular projection the atlas uses, so the two agree exactly. */
export function lonLatToMetres(lon: number, lat: number): { x: number; z: number } {
  const { lon: refLon, lat: refLat } = atlas.meta.origin;
  return {
    x: (lon - refLon) * RAD * EARTH_R * Math.cos(refLat * RAD),
    z: -(lat - refLat) * RAD * EARTH_R,
  };
}

const { bounds, grid } = file.meta;

const nw = lonLatToMetres(bounds.west, bounds.north);
const se = lonLatToMetres(bounds.east, bounds.south);

/** Terrain extent in scene units. */
export const terrain = {
  grid,
  minElevation: file.meta.minElevation,
  maxElevation: file.meta.maxElevation,
  attribution: file.meta.attribution,

  minX: nw.x * METRES_TO_SCENE,
  maxX: se.x * METRES_TO_SCENE,
  minZ: nw.z * METRES_TO_SCENE,
  maxZ: se.z * METRES_TO_SCENE,

  get width(): number {
    return this.maxX - this.minX;
  },
  get depth(): number {
    return this.maxZ - this.minZ;
  },
  get centerX(): number {
    return (this.minX + this.maxX) / 2;
  },
  get centerZ(): number {
    return (this.minZ + this.maxZ) / 2;
  },
};

/** Elevation in metres converted to a scene-space Y. */
export function elevationToY(metres: number): number {
  return metres * METRES_TO_SCENE * VERTICAL_EXAGGERATION;
}

export const waterY = elevationToY(WATER_LEVEL_METRES);

const heights = Float32Array.from(file.elevations);

/**
 * Bilinear elevation lookup, in metres, from a scene-space position.
 *
 * Used on the CPU to sit objects on the ground — the beacons, the château, the
 * vine rows. The terrain mesh itself samples the same data as a texture, and the
 * two must agree or things float and sink.
 */
export function elevationAt(x: number, z: number): number {
  // Row 0 of the file is the north edge, which is minZ here.
  const u = ((x - terrain.minX) / terrain.width) * (grid - 1);
  const v = ((z - terrain.minZ) / terrain.depth) * (grid - 1);

  const c0 = Math.max(0, Math.min(grid - 1, Math.floor(u)));
  const r0 = Math.max(0, Math.min(grid - 1, Math.floor(v)));
  const c1 = Math.min(grid - 1, c0 + 1);
  const r1 = Math.min(grid - 1, r0 + 1);
  const fx = Math.max(0, Math.min(1, u - c0));
  const fz = Math.max(0, Math.min(1, v - r0));

  const h00 = heights[r0 * grid + c0];
  const h10 = heights[r0 * grid + c1];
  const h01 = heights[r1 * grid + c0];
  const h11 = heights[r1 * grid + c1];

  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** Ground height in scene units. */
export function groundY(x: number, z: number): number {
  return elevationToY(elevationAt(x, z));
}

/** Steepness at a point, 0 = flat, rising with slope. Used to mask the vineyard. */
export function slopeAt(x: number, z: number): number {
  const step = terrain.width / grid;
  const dx = elevationAt(x + step, z) - elevationAt(x - step, z);
  const dz = elevationAt(x, z + step) - elevationAt(x, z - step);
  return Math.hypot(dx, dz) / (2 * step);
}

/**
 * The DEM as a single-channel texture. Linear filtering is what smooths the 30 m
 * SRTM posts into a continuous surface at render resolution.
 *
 * Half float rather than full: WebGL2 filters half-float textures natively,
 * while linear filtering of 32-bit floats still depends on an extension. Eleven
 * bits of mantissa resolves this terrain to about 6 cm, far finer than the 30 m
 * source posts.
 */
export function createHeightTexture(): DataTexture {
  const packed = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i += 1) packed[i] = DataUtils.toHalfFloat(heights[i]);
  const texture = new DataTexture(packed, grid, grid, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Elevation in metres at a coordinate.
 *
 * The landform is no longer drawn — Chapter I is aerial imagery now — but the
 * numbers are still worth quoting: the difference between a recorder at 157 m on
 * the plateau and one at 27 m by the water is the whole reason their species
 * lists differ.
 */
export function elevationAtLonLat(lon: number, lat: number): number {
  const m = lonLatToMetres(lon, lat);
  return elevationAt(m.x * METRES_TO_SCENE, m.z * METRES_TO_SCENE);
}

/** Scene position of a lon/lat, sitting on the ground. */
export function siteToScene(lon: number, lat: number): { x: number; y: number; z: number } {
  const m = lonLatToMetres(lon, lat);
  const x = m.x * METRES_TO_SCENE;
  const z = m.z * METRES_TO_SCENE;
  return { x, y: groundY(x, z), z };
}

/**
 * Château Purcari itself, at its real coordinates.
 *
 * It sits at the break of slope where the vineyard plateau falls to the Dniester
 * floodplain — and about 120 m from the recorder that logged more than any other
 * (1,082 detections). That the richest listening point in the survey is on the
 * château's doorstep is a fact about the place, not a composition choice.
 */
export const CHATEAU = {
  lon: 29.871919,
  lat: 46.5294968,
  name: 'Château Purcari',
  founded: 1827,
};

export const chateauScene = siteToScene(CHATEAU.lon, CHATEAU.lat);

/** Station positions on the real terrain, in scene units. */
export const stationSites = atlas.stations.map(station => {
  const p = siteToScene(station.lon, station.lat);
  return { ...station, scene: p, elevation: elevationAt(p.x, p.z) };
});
