#!/usr/bin/env node
/**
 * Builds the aerial basemap for Chapter I.
 *
 *   npm run basemap        (needs sharp:  npm install --no-save sharp)
 *
 * Stitches Web Mercator tiles into images covering the recording stations and
 * the estate, and writes the exact geographic bounds beside them so the scene
 * can place a lat/lon anywhere on the picture without guessing.
 *
 * Two levels, for the same reason a slippy map has a tile pyramid: one image
 * cannot be both wide enough to zoom out to the whole survey and sharp enough to
 * read vine rows at the estate without becoming a texture no GPU wants.
 *
 *   context — zoom 16, about 6.7 x 5.0 km. What you see when you pinch out.
 *   detail  — zoom 17, the station corridor. Twice the resolution, and what the
 *             chapter opens on. It fades into the context layer at its edges.
 *
 * The first version of this chapter drew the landform from a 30 m elevation
 * model with the relief exaggerated seven times. The data was right and the
 * picture was wrong: the real fall from the vineyard plateau to the river is
 * about 130 m over 3.1 km, a four percent grade you would barely notice on foot,
 * and multiplying it by seven turned a gentle slope into a cliff. A photograph
 * cannot lie about the shape of the ground in that way, which is the main reason
 * this replaced it.
 *
 * Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics). Free to use
 * with attribution, which the installation shows. For a permanent commercial
 * installation, licensed imagery — or, better, the estate's own drone
 * orthophoto — should be dropped in here instead; only TILE_URL changes.
 */

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const IMAGE_DIR = resolve(ROOT, 'public/installation');
const META_TARGET = resolve(ROOT, 'src/installation/data/basemap.json');

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION = 'Esri · Maxar · Earthstar Geographics';

const TILE_SIZE = 256;
const MAX_CONCURRENT = 6;

/**
 * Guard rail on the texture budget. WebGL2 only guarantees 2048, but every GPU
 * that has shipped in a decade reports at least 8192, and the two layers
 * together already cost about 130 MB of video memory with mipmaps. Anything
 * larger than this and the area wants narrowing, not the limit raising.
 */
const MAX_TEXTURE = 8192;

const LAYERS = [
  {
    name: 'context',
    file: 'basemap-context.jpg',
    zoom: 16,
    /**
     * 6.3 x 5.0 km. Sized so that pinching all the way out still lands inside
     * the imagery: the chapter caps its altitude at the point where the frame
     * would run off the west and east edges of this.
     */
    area: { south: 46.4950, north: 46.5390, west: 29.8340, east: 29.9150 },
  },
  {
    name: 'detail',
    file: 'basemap.jpg',
    zoom: 17,
    /** The station corridor and the estate, at twice the resolution. */
    area: { south: 46.4995, north: 46.5355, west: 29.8615, east: 29.8875 },
  },
];

function lonToTileX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z;
}
function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180;
}
function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function fetchTile(z, x, y, attempt = 0) {
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'purcari-installation/1.0' } });
    if (!response.ok) throw new Error(`${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      return fetchTile(z, x, y, attempt + 1);
    }
    throw new Error(`tile ${z}/${x}/${y}: ${error.message}`);
  }
}

// Stitching needs a raster library. sharp is not a dependency of the project —
// it pulls platform binaries that every install would otherwise pay for, and
// this script runs by hand, rarely.
let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  process.stderr.write('this script needs sharp:  npm install --no-save sharp\n');
  process.exit(1);
}

mkdirSync(IMAGE_DIR, { recursive: true });
const built = {};

for (const layer of LAYERS) {
  const { zoom, area } = layer;
  const x0 = Math.floor(lonToTileX(area.west, zoom));
  const x1 = Math.ceil(lonToTileX(area.east, zoom));
  const y0 = Math.floor(latToTileY(area.north, zoom));
  const y1 = Math.ceil(latToTileY(area.south, zoom));

  const cols = x1 - x0;
  const rows = y1 - y0;
  const width = cols * TILE_SIZE;
  const height = rows * TILE_SIZE;

  if (width > MAX_TEXTURE || height > MAX_TEXTURE) {
    process.stderr.write(
      `${layer.name}: ${width}x${height} exceeds the ${MAX_TEXTURE} px texture budget — ` +
        'narrow the area or drop a zoom level\n'
    );
    process.exit(1);
  }

  process.stdout.write(`${layer.name}: ${cols}x${rows} = ${cols * rows} tiles at z${zoom} (${width}x${height} px)\n`);

  const jobs = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) jobs.push({ col, row, x: x0 + col, y: y0 + row });
  }

  const tiles = new Array(jobs.length);
  let done = 0;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: MAX_CONCURRENT }, async () => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= jobs.length) return;
        tiles[i] = await fetchTile(zoom, jobs[i].x, jobs[i].y);
        done += 1;
        if (done % 20 === 0) process.stdout.write(`\r  ${done}/${jobs.length}`);
      }
    })
  );
  process.stdout.write(`\r  ${done}/${jobs.length}\n`);

  const target = resolve(IMAGE_DIR, layer.file);
  await sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(jobs.map((job, i) => ({ input: tiles[i], left: job.col * TILE_SIZE, top: job.row * TILE_SIZE })))
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(target);

  const bounds = {
    west: tileXToLon(x0, zoom),
    east: tileXToLon(x1, zoom),
    north: tileYToLat(y0, zoom),
    south: tileYToLat(y1, zoom),
  };
  const metresPerPixel =
    (156543.03392 * Math.cos(((bounds.north + bounds.south) / 2) * (Math.PI / 180))) / 2 ** zoom;

  built[layer.name] = {
    file: `/installation/${layer.file}`,
    width,
    height,
    zoom,
    bounds,
    metresPerPixel: Math.round(metresPerPixel * 1000) / 1000,
  };

  const size = statSync(target).size;
  process.stdout.write(
    `  → public/installation/${layer.file}  ${(size / 1024 / 1024).toFixed(2)} MB · ` +
      `${metresPerPixel.toFixed(2)} m/px · ` +
      `${((width * metresPerPixel) / 1000).toFixed(2)} x ${((height * metresPerPixel) / 1000).toFixed(2)} km\n` +
      `    ${bounds.south.toFixed(5)}..${bounds.north.toFixed(5)} N, ${bounds.west.toFixed(5)}..${bounds.east.toFixed(5)} E\n`
  );
}

mkdirSync(dirname(META_TARGET), { recursive: true });
writeFileSync(
  META_TARGET,
  `${JSON.stringify({ ...built, attribution: ATTRIBUTION, generatedFrom: 'scripts/fetch-basemap.mjs' })}\n`
);
process.stdout.write(`meta → ${META_TARGET.replace(`${ROOT}/`, '')}\n`);
