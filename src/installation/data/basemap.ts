import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace, TextureLoader } from 'three';
import type { Texture } from 'three';
import raw from './basemap.json';
import { atlas } from './atlas';

interface Layer {
  file: string;
  width: number;
  height: number;
  zoom: number;
  bounds: { west: number; east: number; north: number; south: number };
  metresPerPixel: number;
}

interface BasemapFile {
  /** Wide, coarse. Covers everything the camera can reach. */
  context: Layer;
  /** Narrow, twice the resolution. Covers the station corridor and the estate. */
  detail: Layer;
  attribution: string;
}

export const basemap = raw as unknown as BasemapFile;

/**
 * Scene units per metre on the ground.
 *
 * One unit is thirty metres, which puts the 6.3 x 5.0 km context layer in a
 * 210 x 168 box — small enough to frame comfortably and large enough that the
 * camera can drop to a couple of hundred metres across without the near plane
 * biting.
 */
export const METRES_PER_UNIT = 30;

const RAD = Math.PI / 180;
const EARTH_R = 6378137;

/** Equirectangular metres from the survey origin; x east, z south. */
export function lonLatToMetres(lon: number, lat: number): { x: number; z: number } {
  const { lon: refLon, lat: refLat } = atlas.meta.origin;
  return {
    x: (lon - refLon) * RAD * EARTH_R * Math.cos(refLat * RAD),
    z: -(lat - refLat) * RAD * EARTH_R,
  };
}

/** Scene position of a coordinate, on the map plane. */
export function lonLatToScene(lon: number, lat: number): { x: number; z: number } {
  const m = lonLatToMetres(lon, lat);
  return { x: m.x / METRES_PER_UNIT, z: m.z / METRES_PER_UNIT };
}

/** Web Mercator y, normalised 0..1 over the whole world. */
function mercatorY(lat: number): number {
  return (1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2;
}

/**
 * Texture coordinate of a lon/lat within one layer.
 *
 * The tiles are Web Mercator and the scene is equirectangular, so the two
 * disagree slightly across five kilometres of latitude. Rather than ignoring it,
 * the map mesh carries a UV per layer per vertex computed with this, which makes
 * the imagery land exactly where the coordinates say it should — and makes the
 * two layers land on each other.
 */
export function lonLatToUv(layer: Layer, lon: number, lat: number): { u: number; v: number } {
  const { bounds } = layer;
  const top = mercatorY(bounds.north);
  const bottom = mercatorY(bounds.south);
  return {
    u: (lon - bounds.west) / (bounds.east - bounds.west),
    v: 1 - (mercatorY(lat) - top) / (bottom - top),
  };
}

function extentOf(layer: Layer): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
} {
  const { bounds } = layer;
  const nw = lonLatToScene(bounds.west, bounds.north);
  const se = lonLatToScene(bounds.east, bounds.south);
  return {
    minX: nw.x,
    maxX: se.x,
    minZ: nw.z,
    maxZ: se.z,
    width: se.x - nw.x,
    depth: se.z - nw.z,
    centerX: (nw.x + se.x) / 2,
    centerZ: (nw.z + se.z) / 2,
  };
}

/**
 * Extent of the imagery in scene units, as an axis-aligned box — the wide layer,
 * because that is the map's outer limit and how far the camera may travel.
 */
export const mapExtent = extentOf(basemap.context);

export function loadLayerTexture(layer: Layer): Texture {
  const texture = new TextureLoader().load(layer.file, t => {
    t.colorSpace = SRGBColorSpace;
  });
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  // The map is looked at from a shallow angle at low altitude; without this the
  // vine rows in the distance turn to mush.
  texture.anisotropy = 8;
  return texture;
}

/**
 * The estate itself.
 *
 * Coordinate from OpenStreetMap. In the imagery this lands on the manor range
 * beside the two ponds in the park — which matters, because the recorder that
 * logged more than any other in the survey stands at those ponds.
 */
export const CHATEAU = {
  lon: 29.871919,
  lat: 46.5294968,
  name: 'Château Purcari',
  founded: 1827,
};
