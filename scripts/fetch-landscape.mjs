#!/usr/bin/env node
/**
 * Fetches the real landscape around the Purcari estate and bakes it into
 * public/landscape.json for the installation to render.
 *
 * Two sources, both open:
 *   - Terrarium DEM tiles (AWS elevation-tiles-prod) → a real height grid
 *   - OpenStreetMap via Overpass → the château, the vineyard parcels, the
 *     Dniester, the villages and the roads
 *
 * Run with `npm run landscape`. Output is committed, so the app never needs the
 * network; re-run only when you want to refresh the basemap. If every mirror is
 * down the existing landscape.json is left untouched rather than truncated.
 *
 * PNG decoding is done here by hand (zlib + the five PNG filters) to keep the
 * project dependency-free.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'landscape.json');
const CACHE = join(ROOT, 'scripts', '.cache');

/** The frame of the piece: the station network, the château, a reach of the Dniester. */
const BBOX = { lat0: 46.498, lat1: 46.545, lng0: 29.85, lng1: 29.9 };

const DEM_ZOOM = 14;
const GRID_W = 132;
const GRID_H = 168;

const OVERPASS_MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// ---------------------------------------------------------------- tile maths

const lngToTileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

// ------------------------------------------------------------- PNG decoding

/** Minimal decoder: 8-bit RGB/RGBA, non-interlaced — all terrarium tiles are. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 3;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colorType = body[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (body[12] !== 0) throw new Error('interlaced PNG unsupported');
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
      if (!channels) throw new Error(`unsupported colour type ${colorType}`);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const dst = out.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? dst[x - channels] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= channels ? up[x - channels] : 0;
      const v = line[x];

      switch (filter) {
        case 0:
          dst[x] = v;
          break;
        case 1:
          dst[x] = (v + a) & 0xff;
          break;
        case 2:
          dst[x] = (v + b) & 0xff;
          break;
        case 3:
          dst[x] = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          dst[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
    }
  }

  return { width, height, channels, data: out };
}

async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw lastError;
}

async function loadTile(z, x, y) {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, `terrarium-${z}-${x}-${y}.png`);
  if (existsSync(cached)) return decodePng(readFileSync(cached));

  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const res = await fetchWithRetry(url, {});
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(cached, buf);
  return decodePng(buf);
}

// --------------------------------------------------------------- elevation

async function buildTerrain() {
  const x0 = Math.floor(lngToTileX(BBOX.lng0, DEM_ZOOM));
  const x1 = Math.floor(lngToTileX(BBOX.lng1, DEM_ZOOM));
  const y0 = Math.floor(latToTileY(BBOX.lat1, DEM_ZOOM));
  const y1 = Math.floor(latToTileY(BBOX.lat0, DEM_ZOOM));

  const tiles = new Map();
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      tiles.set(`${x}/${y}`, await loadTile(DEM_ZOOM, x, y));
    }
  }
  console.log(`  DEM: ${tiles.size} tiles at z${DEM_ZOOM}`);

  /** Bilinear-free point sample; the grid is coarser than the tiles anyway. */
  const sample = (lat, lng) => {
    const tx = lngToTileX(lng, DEM_ZOOM);
    const ty = latToTileY(lat, DEM_ZOOM);
    const tile = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
    if (!tile) return null;
    const px = Math.min(tile.width - 1, Math.floor((tx % 1) * tile.width));
    const py = Math.min(tile.height - 1, Math.floor((ty % 1) * tile.height));
    const i = (py * tile.width + px) * tile.channels;
    return tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256 - 32768;
  };

  const grid = new Array(GRID_W * GRID_H);
  let min = Infinity;
  let max = -Infinity;

  for (let j = 0; j < GRID_H; j += 1) {
    // Row 0 is the northern edge, matching how the mesh is built at runtime.
    const lat = BBOX.lat1 - ((BBOX.lat1 - BBOX.lat0) * j) / (GRID_H - 1);
    for (let i = 0; i < GRID_W; i += 1) {
      const lng = BBOX.lng0 + ((BBOX.lng1 - BBOX.lng0) * i) / (GRID_W - 1);
      const h = sample(lat, lng) ?? 0;
      grid[j * GRID_W + i] = Math.round(h * 10) / 10;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  return { w: GRID_W, h: GRID_H, min: Math.round(min), max: Math.round(max), data: grid };
}

// ------------------------------------------------------------------- vector

const OVERPASS_QUERY = `[out:json][timeout:150];
(
  way["building"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
  way["landuse"~"^(vineyard|orchard|forest|farmland|meadow|grass|reservoir|basin)$"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
  way["natural"~"^(water|wood|scrub|grassland|wetland)$"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
  way["waterway"~"^(river|stream|canal|ditch)$"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service)$"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
  node["craft"="winery"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
  node["place"~"^(village|hamlet|locality|town)$"](${BBOX.lat0},${BBOX.lng0},${BBOX.lat1},${BBOX.lng1});
);
out geom;`;

async function fetchOverpass() {
  const cached = join(CACHE, 'overpass.json');
  if (existsSync(cached)) {
    console.log('  OSM: using cached response');
    return JSON.parse(readFileSync(cached, 'utf8'));
  }

  for (const mirror of OVERPASS_MIRRORS) {
    try {
      const res = await fetchWithRetry(
        mirror,
        {
          method: 'POST',
          body: new URLSearchParams({ data: OVERPASS_QUERY }),
        },
        2
      );
      const json = await res.json();
      if (!json.elements?.length) throw new Error('empty response');
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cached, JSON.stringify(json));
      console.log(`  OSM: ${json.elements.length} elements from ${new URL(mirror).host}`);
      return json;
    } catch (e) {
      console.warn(`  OSM: ${new URL(mirror).host} failed — ${e.message}`);
    }
  }
  throw new Error('every Overpass mirror failed');
}

/**
 * Douglas–Peucker on an open polyline.
 *
 * Closed rings must not be passed here directly: their first and last points
 * coincide, the baseline is degenerate, every perpendicular distance comes out
 * zero and the whole ring collapses to two points. `simplifyRing` splits them
 * first.
 */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

/** Splits a ring at its most distant vertex and simplifies each arc separately. */
function simplifyRing(points, tolerance) {
  const closed =
    points.length > 2 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1];
  if (!closed) return simplify(points, tolerance);

  const ring = points.slice(0, -1);
  if (ring.length < 5) return points;

  let far = 1;
  let farDist = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }

  const head = simplify(ring.slice(0, far + 1), tolerance);
  const tail = simplify([...ring.slice(far), ring[0]], tolerance);
  const merged = [...head.slice(0, -1), ...tail.slice(0, -1)];
  return merged.length >= 3 ? [...merged, merged[0]] : points;
}

/** Overpass returns whole ways, so trim the parts that run off the map. */
function clipToBox(points, margin = 0.004) {
  const inside = ([lat, lng]) =>
    lat >= BBOX.lat0 - margin &&
    lat <= BBOX.lat1 + margin &&
    lng >= BBOX.lng0 - margin &&
    lng <= BBOX.lng1 + margin;

  const runs = [];
  let run = [];
  for (const point of points) {
    if (inside(point)) {
      run.push(point);
    } else {
      // Keep the first point outside so the line reaches the edge of the frame.
      if (run.length) {
        run.push(point);
        runs.push(run);
        run = [];
      }
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

const round = (points) => points.map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]);

function classify(tags = {}) {
  if (tags.building) return { group: 'buildings', kind: tags.building };
  if (tags.landuse === 'vineyard') return { group: 'vineyards', kind: 'vineyard' };
  if (tags.landuse === 'orchard') return { group: 'vineyards', kind: 'orchard' };
  if (tags.landuse === 'forest' || tags.natural === 'wood') return { group: 'wood', kind: 'wood' };
  if (tags.natural === 'scrub' || tags.natural === 'grassland' || tags.landuse === 'meadow')
    return { group: 'scrub', kind: tags.natural ?? tags.landuse };
  if (tags.natural === 'water' || tags.landuse === 'reservoir' || tags.landuse === 'basin')
    return { group: 'water', kind: 'water' };
  if (tags.waterway) return { group: 'rivers', kind: tags.waterway };
  if (tags.highway) return { group: 'roads', kind: tags.highway };
  if (tags.landuse === 'farmland') return { group: 'farmland', kind: 'farmland' };
  return null;
}

function processOsm(osm) {
  const out = {
    buildings: [],
    vineyards: [],
    wood: [],
    scrub: [],
    farmland: [],
    water: [],
    rivers: [],
    roads: [],
    places: [],
  };

  for (const el of osm.elements) {
    if (el.type === 'node') {
      if (el.tags?.craft === 'winery' || el.tags?.place) {
        out.places.push({
          lat: el.lat,
          lng: el.lon,
          name: el.tags.name ?? '',
          kind: el.tags.craft === 'winery' ? 'winery' : el.tags.place,
        });
      }
      continue;
    }

    if (!el.geometry?.length) continue;
    const bucket = classify(el.tags);
    if (!bucket) continue;

    const isArea = !['roads', 'rivers'].includes(bucket.group);
    // Buildings keep their corners; landcover can afford to be loose.
    const tolerance = bucket.group === 'buildings' ? 0.000012 : isArea ? 0.00006 : 0.00005;
    const raw = el.geometry.map((g) => [g.lat, g.lon]);

    const pieces = isArea
      ? [simplifyRing(raw, tolerance)]
      : clipToBox(raw).map((run) => simplify(run, tolerance));

    for (const points of pieces) {
      if (points.length < (isArea ? 4 : 2)) continue;
      const entry = { pts: round(points) };
      if (el.tags.name) entry.name = el.tags.name;
      if (bucket.kind && bucket.kind !== true) entry.kind = bucket.kind;
      if (el.tags['building:levels']) entry.levels = Number(el.tags['building:levels']) || undefined;
      out[bucket.group].push(entry);
    }
  }

  return out;
}

// ---------------------------------------------------------------------- main

console.log('Fetching landscape…');

let terrain = null;
let vectors = null;

try {
  terrain = await buildTerrain();
} catch (e) {
  console.warn(`  DEM failed — ${e.message}`);
}

try {
  vectors = processOsm(await fetchOverpass());
} catch (e) {
  console.warn(`  OSM failed — ${e.message}`);
}

if (!terrain && !vectors) {
  console.error('Nothing fetched; leaving public/landscape.json as it is.');
  process.exit(1);
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

const payload = {
  bbox: BBOX,
  terrain: terrain ?? previous.terrain ?? null,
  ...(vectors ?? {
    buildings: previous.buildings ?? [],
    vineyards: previous.vineyards ?? [],
    wood: previous.wood ?? [],
    scrub: previous.scrub ?? [],
    farmland: previous.farmland ?? [],
    water: previous.water ?? [],
    rivers: previous.rivers ?? [],
    roads: previous.roads ?? [],
    places: previous.places ?? [],
  }),
};

/** The château is the anchor of act I, so surface it explicitly. */
payload.chateau =
  payload.places.find((p) => p.kind === 'winery' && /purcari/i.test(p.name)) ??
  payload.places.find((p) => p.kind === 'winery') ??
  null;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));

const kb = (JSON.stringify(payload).length / 1024).toFixed(0);
console.log(`landscape.json  ${kb} KB`);
if (payload.terrain) console.log(`  relief ${payload.terrain.min}–${payload.terrain.max} m`);
for (const key of ['buildings', 'vineyards', 'wood', 'scrub', 'farmland', 'water', 'rivers', 'roads', 'places']) {
  if (payload[key]?.length) console.log(`  ${key}: ${payload[key].length}`);
}
if (payload.chateau) console.log(`  château: ${payload.chateau.name} @ ${payload.chateau.lat}, ${payload.chateau.lng}`);
