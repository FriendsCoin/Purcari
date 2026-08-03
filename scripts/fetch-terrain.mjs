#!/usr/bin/env node
/**
 * Fetches the real elevation of the Purcari survey area and bakes it into a
 * heightfield the installation renders as terrain.
 *
 *   node scripts/fetch-terrain.mjs
 *
 * The result is committed, so this only needs re-running if the area of interest
 * changes. It hits a public SRTM endpoint at one request per second and takes
 * about a minute.
 *
 * The landform turned out to be the reason the survey looks the way it does: the
 * vineyard sits on a plateau around 150 m, and the ground falls away to roughly
 * 5 m at the northern end, which is the Dniester floodplain. The two stations
 * that recorded the most — and every heron, bittern, crake and crane in the
 * dataset — are the two at the bottom of that drop.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TARGET = resolve(ROOT, 'src/installation/data/terrain.json');

/**
 * Bounds around the five recording stations, widened so the composition has
 * landscape beyond the survey strip rather than ending at its own edge.
 */
const BOUNDS = { south: 46.4925, north: 46.5415, west: 29.8525, east: 29.8985 };

/** Samples per side. 72 is the most detail the endpoint's daily budget allows. */
const GRID = 72;

const ENDPOINT = 'https://api.opentopodata.org/v1/srtm30m';
const BATCH = 100;
const DELAY_MS = 1100;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildGrid() {
  const locations = [];
  for (let row = 0; row < GRID; row += 1) {
    // Row 0 is the north edge, so the array reads like the map does.
    const lat = BOUNDS.north - (row / (GRID - 1)) * (BOUNDS.north - BOUNDS.south);
    for (let col = 0; col < GRID; col += 1) {
      const lon = BOUNDS.west + (col / (GRID - 1)) * (BOUNDS.east - BOUNDS.west);
      locations.push([lat, lon]);
    }
  }
  return locations;
}

async function fetchBatch(batch, attempt = 0) {
  const query = batch.map(([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|');
  const response = await fetch(`${ENDPOINT}?locations=${encodeURIComponent(query)}`);

  if (!response.ok) {
    // The public endpoint rate-limits rather than queueing; back off and retry.
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await sleep(DELAY_MS * (attempt + 2));
      return fetchBatch(batch, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (body.status !== 'OK') throw new Error(`API: ${body.error ?? body.status}`);
  // Voids over water come back as null; sea level is the right reading here.
  return body.results.map(r => (r.elevation === null ? 0 : r.elevation));
}

const locations = buildGrid();
const elevations = [];

process.stdout.write(`fetching ${locations.length} samples (${GRID}x${GRID})\n`);
for (let i = 0; i < locations.length; i += BATCH) {
  const batch = locations.slice(i, i + BATCH);
  elevations.push(...(await fetchBatch(batch)));
  process.stdout.write(`\r  ${elevations.length}/${locations.length}`);
  if (i + BATCH < locations.length) await sleep(DELAY_MS);
}
process.stdout.write('\n');

const min = Math.min(...elevations);
const max = Math.max(...elevations);

const terrain = {
  meta: {
    bounds: BOUNDS,
    grid: GRID,
    minElevation: min,
    maxElevation: max,
    dataset: 'srtm30m',
    attribution: 'NASA SRTM 30 m via opentopodata.org',
    generatedFrom: 'scripts/fetch-terrain.mjs',
  },
  // Row-major from the north-west corner, metres above sea level, whole numbers.
  elevations: elevations.map(v => Math.round(v)),
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(terrain)}\n`);

const kb = (Buffer.byteLength(JSON.stringify(terrain)) / 1024).toFixed(1);
process.stdout.write(
  `terrain → ${TARGET.replace(`${ROOT}/`, '')}  ${kb} KB\n` +
    `  ${GRID}x${GRID} samples · ${min} m to ${max} m · ${(max - min).toFixed(0)} m of relief\n`
);
