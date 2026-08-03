/**
 * One projection for the whole piece.
 *
 * Both the detection cloud and the basemap have to agree on where a coordinate
 * lands, or the stations drift off their own hillsides. Everything geographic
 * goes through here: metres per scene unit is fixed, and ground height comes
 * from the real DEM baked into public/landscape.json rather than from an
 * interpolation between station altitudes.
 */

export interface GeoBox {
  lat0: number;
  lat1: number;
  lng0: number;
  lng1: number;
}

export interface TerrainGrid {
  w: number;
  h: number;
  min: number;
  max: number;
  /** Row 0 is the northern edge; elevation in metres. */
  data: number[];
}

/** Scene units spanning the landscape's full north–south extent. */
export const LANDSCAPE_SPAN = 112;

/**
 * Relief is exaggerated. The estate drops 170 m across five kilometres — true
 * to scale that is a two-unit bump on a hundred-unit field, and the valley the
 * low stations sit in would simply not be visible.
 */
export const VERTICAL_EXAGGERATION = 5.5;

const METRES_PER_DEG_LAT = 111320;

export interface Projection {
  bbox: GeoBox;
  /** Scene units per metre on the ground. */
  scale: number;
  project(lat: number, lng: number): [number, number];
  /** Ground height in scene units at a coordinate. */
  ground(lat: number, lng: number): number;
  /** Ground height in scene units at a scene position. */
  groundAt(x: number, z: number): number;
  /** Raw DEM elevation in metres, un-exaggerated. */
  metres(lat: number, lng: number): number;
  metresToUnits(m: number): number;
  extent: { width: number; depth: number };
}

export function makeProjection(bbox: GeoBox, terrain: TerrainGrid | null): Projection {
  const midLat = (bbox.lat0 + bbox.lat1) / 2;
  const metresPerLng = METRES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const depthMetres = (bbox.lat1 - bbox.lat0) * METRES_PER_DEG_LAT;
  const widthMetres = (bbox.lng1 - bbox.lng0) * metresPerLng;
  const scale = LANDSCAPE_SPAN / depthMetres;
  const centreLng = (bbox.lng0 + bbox.lng1) / 2;

  const base = terrain ? terrain.min : 0;

  /** Bilinear DEM lookup; clamped at the edges. */
  function metres(lat: number, lng: number): number {
    if (!terrain) return base;
    const u = ((lng - bbox.lng0) / (bbox.lng1 - bbox.lng0)) * (terrain.w - 1);
    const v = ((bbox.lat1 - lat) / (bbox.lat1 - bbox.lat0)) * (terrain.h - 1);

    const x0 = Math.max(0, Math.min(terrain.w - 1, Math.floor(u)));
    const y0 = Math.max(0, Math.min(terrain.h - 1, Math.floor(v)));
    const x1 = Math.min(terrain.w - 1, x0 + 1);
    const y1 = Math.min(terrain.h - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, u - x0));
    const fy = Math.max(0, Math.min(1, v - y0));

    const a = terrain.data[y0 * terrain.w + x0];
    const b = terrain.data[y0 * terrain.w + x1];
    const c = terrain.data[y1 * terrain.w + x0];
    const d = terrain.data[y1 * terrain.w + x1];

    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  function project(lat: number, lng: number): [number, number] {
    return [(lng - centreLng) * metresPerLng * scale, -(lat - midLat) * METRES_PER_DEG_LAT * scale];
  }

  function unproject(x: number, z: number): [number, number] {
    return [midLat - z / (METRES_PER_DEG_LAT * scale), centreLng + x / (metresPerLng * scale)];
  }

  return {
    bbox,
    scale,
    project,
    metres,
    ground: (lat, lng) => (metres(lat, lng) - base) * scale * VERTICAL_EXAGGERATION,
    groundAt: (x, z) => {
      const [lat, lng] = unproject(x, z);
      return (metres(lat, lng) - base) * scale * VERTICAL_EXAGGERATION;
    },
    metresToUnits: (m) => m * scale,
    extent: { width: widthMetres * scale, depth: depthMetres * scale },
  };
}

/** Used before landscape.json resolves, and if it never does. */
export const FALLBACK_BBOX: GeoBox = { lat0: 46.498, lat1: 46.545, lng0: 29.85, lng1: 29.9 };
