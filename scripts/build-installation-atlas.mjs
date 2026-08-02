#!/usr/bin/env node
/**
 * Bakes the raw Every1Counts export (data.geojson) into a compact atlas that the
 * touchscreen installation loads at boot.
 *
 * The raw export is ~3.4 MB and needs a full parse plus aggregation before the
 * first frame can be drawn. The kiosk has to be on screen instantly, so the
 * aggregation happens here, once, and ships as ~120 KB of flat arrays.
 *
 *   node scripts/build-installation-atlas.mjs
 *
 * Timestamps carry a `Z` suffix but the hourly histogram peaks at 04:00-06:00,
 * which is the dawn chorus for Moldova in August (sunrise ~06:10). Treating them
 * as UTC and shifting to UTC+3 would put the chorus at 07:00-08:00, well after
 * full daylight. The recorder therefore wrote local time, and every hour in this
 * atlas is local time, used as-is.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SOURCE = resolve(ROOT, 'data.geojson');
const TARGET = resolve(ROOT, 'src/installation/data/atlas.json');

/** Night runs 21:00 -> 05:00 local. */
const NIGHT_START = 21;
const NIGHT_END = 5;

/**
 * Ecological guilds, matched against the French vernacular names in the export.
 * Order matters: the first guild whose pattern matches wins, so the narrow
 * groups (mammals, owls, waterbirds) are tested before the songbird default.
 */
const GUILDS = [
  {
    id: 'mammal',
    label: 'Mammifères',
    patterns: ['renard', 'lievre', 'lièvre', 'chien', 'chevreuil', 'sanglier', 'blaireau', 'martre', 'fouine'],
  },
  {
    id: 'nocturnal',
    label: 'Rapaces nocturnes',
    patterns: ['chouette', 'hibou', 'duc', 'effraie', 'chevêche', 'chevêchette', 'nyctale', 'engoulevent'],
  },
  {
    id: 'raptor',
    label: 'Rapaces diurnes',
    patterns: ['buse', 'aigle', 'faucon', 'milan', 'busard', 'épervier', 'autour', 'balbuzard'],
  },
  {
    id: 'water',
    label: 'Oiseaux d’eau',
    patterns: [
      'héron', 'bihoreau', 'butor', 'blongios', 'cygne', 'oie', 'foulque', 'râle', 'marouette',
      'grèbe', 'sarcelle', 'avocette', 'bécasseau', 'bécasse', 'chevalier', 'courlis', 'sterne',
      'tadorne', 'gallinule', 'macreuse', 'garrot', 'eider', 'cigogne', 'grue', 'pluvier',
      'mouette', 'goéland', 'canard', 'harle',
    ],
  },
];

const DEFAULT_GUILD = { id: 'songbird', label: 'Passereaux' };

function classify(name) {
  const lower = name.toLowerCase();
  for (const guild of GUILDS) {
    if (guild.patterns.some(p => lower.includes(p))) return guild.id;
  }
  if (lower.includes('inconnu') || lower.includes('unknown')) return 'unknown';
  return DEFAULT_GUILD.id;
}

/** Equirectangular projection around a reference point, in metres. */
function project(lon, lat, refLon, refLat) {
  const R = 6378137;
  const rad = Math.PI / 180;
  return {
    x: (lon - refLon) * rad * R * Math.cos(refLat * rad),
    z: -(lat - refLat) * rad * R,
  };
}

const round = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
const items = raw.items ?? [];
if (items.length === 0) throw new Error(`No items found in ${SOURCE}`);

// ---------------------------------------------------------------- stations --
// The four acoustic recorders and the camera trap line sit at five fixed
// coordinates; every detection belongs to exactly one of them.
const stationIndex = new Map();
const stations = [];
for (const item of items) {
  const [lon, lat] = item.geojson.coordinates;
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  if (!stationIndex.has(key)) {
    stationIndex.set(key, stations.length);
    stations.push({ key, lon, lat, total: 0, species: new Set(), sensors: new Set(), hourly: new Array(24).fill(0) });
  }
  const station = stations[stationIndex.get(key)];
  station.total += 1;
  station.species.add(item.title);
  const sensor = item.properties?.sensor?.ref;
  if (sensor) station.sensors.add(sensor);
}

const refLon = stations.reduce((s, st) => s + st.lon, 0) / stations.length;
const refLat = stations.reduce((s, st) => s + st.lat, 0) / stations.length;

// ------------------------------------------------------------------ species --
const speciesIndex = new Map();
const species = [];
for (const item of items) {
  const name = item.title || 'Inconnu';
  if (!speciesIndex.has(name)) {
    speciesIndex.set(name, species.length);
    species.push({
      name,
      guild: classify(name),
      count: 0,
      hourly: new Array(24).fill(0),
      stations: new Set(),
      firstDay: Infinity,
      lastDay: -Infinity,
      night: 0,
    });
  }
  speciesIndex.get(name);
}

// -------------------------------------------------------------------- days --
const dayKeys = [...new Set(items.map(i => i.startdate.slice(0, 10)))].sort();
const dayIndexOf = new Map(dayKeys.map((d, i) => [d, i]));
const days = dayKeys.map(date => ({ date, count: 0, species: new Set(), night: 0 }));

// ------------------------------------------------------------------ points --
const pointStation = [];
const pointSpecies = [];
const pointMinute = [];
const pointDay = [];
const hourly = new Array(24).fill(0);
const guildTotals = {};
let nightTotal = 0;

for (const item of items) {
  const [lon, lat] = item.geojson.coordinates;
  const st = stationIndex.get(`${lon.toFixed(5)},${lat.toFixed(5)}`);
  const sp = speciesIndex.get(item.title || 'Inconnu');
  const dayKey = item.startdate.slice(0, 10);
  const day = dayIndexOf.get(dayKey);
  const hour = Number(item.startdate.slice(11, 13));
  const minute = hour * 60 + Number(item.startdate.slice(14, 16));
  const isNight = hour >= NIGHT_START || hour < NIGHT_END;

  pointStation.push(st);
  pointSpecies.push(sp);
  pointMinute.push(minute);
  pointDay.push(day);

  hourly[hour] += 1;
  stations[st].hourly[hour] += 1;

  const record = species[sp];
  record.count += 1;
  record.hourly[hour] += 1;
  record.stations.add(st);
  record.firstDay = Math.min(record.firstDay, day);
  record.lastDay = Math.max(record.lastDay, day);

  days[day].count += 1;
  days[day].species.add(sp);

  guildTotals[record.guild] = (guildTotals[record.guild] ?? 0) + 1;

  if (isNight) {
    nightTotal += 1;
    record.night += 1;
    days[day].night += 1;
  }
}

// Ranking by abundance keeps the species constellation stable between builds and
// lets the scenes take "top N" slices without re-sorting at runtime.
const order = species
  .map((s, i) => i)
  .sort((a, b) => species[b].count - species[a].count || species[a].name.localeCompare(species[b].name));
const remap = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
const sortedSpecies = order.map(i => species[i]);
for (let i = 0; i < pointSpecies.length; i += 1) pointSpecies[i] = remap.get(pointSpecies[i]);
for (const day of days) day.species = new Set([...day.species].map(i => remap.get(i)));

const atlas = {
  meta: {
    total: items.length,
    speciesCount: sortedSpecies.length,
    stationCount: stations.length,
    start: items.reduce((min, i) => (i.startdate < min ? i.startdate : min), items[0].startdate),
    end: items.reduce((max, i) => (i.startdate > max ? i.startdate : max), items[0].startdate),
    nightShare: round(nightTotal / items.length, 4),
    origin: { lon: round(refLon, 6), lat: round(refLat, 6) },
    source: raw.items ? 'data.geojson' : 'unknown',
    generatedFrom: 'scripts/build-installation-atlas.mjs',
  },
  guilds: [...GUILDS, DEFAULT_GUILD, { id: 'unknown', label: 'Non identifié' }].map(g => ({
    id: g.id,
    label: g.label,
    count: guildTotals[g.id] ?? 0,
  })),
  hourly,
  stations: stations.map((s, i) => {
    const { x, z } = project(s.lon, s.lat, refLon, refLat);
    return {
      id: i,
      code: s.sensors.size > 0 ? [...s.sensors].sort().join('/') : `AU-${String(i + 1).padStart(2, '0')}`,
      lon: round(s.lon, 5),
      lat: round(s.lat, 5),
      x: round(x, 1),
      z: round(z, 1),
      total: s.total,
      species: s.species.size,
      hourly: s.hourly,
    };
  }),
  species: sortedSpecies.map(s => ({
    name: s.name,
    guild: s.guild,
    count: s.count,
    hourly: s.hourly,
    stations: [...s.stations].sort((a, b) => a - b),
    firstDay: s.firstDay,
    lastDay: s.lastDay,
    nocturnality: round(s.night / s.count, 3),
  })),
  days: days.map(d => ({ date: d.date, count: d.count, species: d.species.size, night: d.night })),
  points: {
    station: pointStation,
    species: pointSpecies,
    minute: pointMinute,
    day: pointDay,
  },
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(atlas)}\n`);

const kb = (Buffer.byteLength(JSON.stringify(atlas)) / 1024).toFixed(1);
process.stdout.write(
  `atlas → ${TARGET.replace(`${ROOT}/`, '')}  ${kb} KB\n` +
    `  ${atlas.meta.total} detections · ${atlas.meta.speciesCount} species · ` +
    `${atlas.meta.stationCount} stations · ${atlas.days.length} days\n`
);
