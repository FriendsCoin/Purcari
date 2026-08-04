#!/usr/bin/env node
/**
 * Bakes the camera-trap export into the atlas Chapter VI reads.
 *
 *   node scripts/build-passages-atlas.mjs [export.csv]
 *
 * The acoustic atlas (`build-installation-atlas.mjs`) covers seventeen days of
 * microphones. This is the other half of the survey: eight camera traps on the
 * same estate, 29 May to 16 August 2025, which record the animals the recorders
 * never hear — fox, hare, jackal, boar, badger — and record them as *passages*,
 * a body crossing a lens at a moment.
 *
 * Three decisions worth keeping:
 *
 * 1. **Timestamps are local time, used as-is.** The export carries no offset.
 *    Read raw, the badger peaks at 02:00 and is 91 % nocturnal, the pheasant
 *    peaks at 14:00 and is 4 % nocturnal — both exactly right for the species.
 *    Shifting by Moldova's +3 would put the badger's peak at 05:00, around
 *    sunrise, when it is already back in the sett. The acoustic atlas reached
 *    the same conclusion for the same site and the same operator.
 *
 * 2. **The day grid spans the whole deployment, empty days included.** Sixty-nine
 *    of the eighty days carry a passage. The eleven that do not are not missing
 *    data — nothing walked past — and Chapter VI draws them as the dark rows
 *    they are.
 *
 * 3. **`detection_count` is honoured.** Fourteen records carry more than one
 *    animal, 367 passages across 350 records. Totals use the count; the event
 *    list carries it too, so a group crossing reads heavier than a single fox.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEFAULT_SOURCE = resolve(ROOT, '20251110_100018.csv');
const TARGET = resolve(ROOT, 'src/installation/data/passages.json');

/** Night runs 21:00 -> 05:00 local, the same window the acoustic atlas uses. */
const NIGHT_START = 21;
const NIGHT_END = 5;

/**
 * Vernacular names for the panel, which is French throughout.
 *
 * The export names species in English. Where a species also appears in the
 * published camera-trap correlation table (`overlap.json`) the French name is
 * copied from it verbatim, so the same animal is never called two different
 * things in two chapters. Scientific names come from the export itself.
 */
const FRENCH = {
  'Red fox': 'Renard roux',
  'Brown Hare': 'Lièvre d’Europe',
  'Common Pheasant': 'Faisan de Colchide',
  'Golden jackal': 'Chacal doré',
  'Eurasian Wild Pig': 'Sanglier',
  Badger: 'Blaireau européen',
  'European Roe': 'Chevreuil',
  Dog: 'Chien',
  'Great Tit': 'Mésange charbonnière',
  'European Pine Marten': 'Martre des pins',
  'Red-backed Shrike': 'Pie-grièche écorcheur',
  Cat: 'Chat',
  Horse: 'Cheval',
  Wildcat: 'Chat forestier',
  'European Robin': 'Rougegorge familier',
};

/**
 * Wild mammal, bird, or an animal that belongs to somebody.
 *
 * The distinction is not cosmetic: the dog, the cat and the horse are the
 * estate's own traffic, and a chapter that coloured them like wildlife would be
 * claiming fifteen wild species where the data holds twelve.
 */
const KIND = {
  'Red fox': 'mammal',
  'Brown Hare': 'mammal',
  'Golden jackal': 'mammal',
  'Eurasian Wild Pig': 'mammal',
  Badger: 'mammal',
  'European Roe': 'mammal',
  'European Pine Marten': 'mammal',
  Wildcat: 'mammal',
  'Common Pheasant': 'bird',
  'Great Tit': 'bird',
  'Red-backed Shrike': 'bird',
  'European Robin': 'bird',
  Dog: 'domestic',
  Cat: 'domestic',
  Horse: 'domestic',
};

const RAD = Math.PI / 180;
const EARTH_R = 6378137;

/** Same origin and projection as the acoustic atlas, so the two surveys agree. */
const ORIGIN = JSON.parse(readFileSync(resolve(ROOT, 'src/installation/data/atlas.json'), 'utf8')).meta.origin;

function lonLatToMetres(lon, lat) {
  return {
    x: (lon - ORIGIN.lon) * RAD * EARTH_R * Math.cos(ORIGIN.lat * RAD),
    z: -(lat - ORIGIN.lat) * RAD * EARTH_R,
  };
}

/** Local wall-clock parts of a `YYYY-MM-DD HH:MM:SS` stamp, without a timezone in sight. */
function parseLocal(stamp) {
  const [date, clock = '00:00:00'] = stamp.trim().split(' ');
  const [hh, mm] = clock.split(':').map(Number);
  return { date, hour: hh, minute: hh * 60 + mm };
}

function dayIndex(date, start) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000);
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------- parse --

const source = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_SOURCE;
const lines = readFileSync(source, 'utf8').trim().split(/\r?\n/);
const header = lines[0].split(',').map(h => h.trim());
const columns = Object.fromEntries(header.map((name, i) => [name, i]));

for (const required of ['Common Name', 'Hotspot', 'startdate', 'latitude', 'longitude', 'detection_count']) {
  if (columns[required] === undefined) throw new Error(`${source}: missing column "${required}"`);
}

const records = lines.slice(1).map(line => {
  const cells = line.split(',');
  return {
    name: cells[columns['Common Name']].trim(),
    camera: cells[columns.Hotspot].trim(),
    scientific: cells[columns['Scientific name']]?.trim() ?? '',
    start: cells[columns.startdate].trim(),
    lat: Number(cells[columns.latitude]),
    lon: Number(cells[columns.longitude]),
    count: Number(cells[columns.detection_count]) || 1,
  };
});

const unnamed = [...new Set(records.map(r => r.name))].filter(name => !FRENCH[name]);
if (unnamed.length > 0) throw new Error(`No French name for: ${unnamed.join(', ')}`);

// ---------------------------------------------------------------- aggregate --

const dates = records.map(r => parseLocal(r.start).date).sort();
const firstDate = dates[0];
const lastDate = dates[dates.length - 1];
const dayCount = dayIndex(lastDate, firstDate) + 1;

const cameras = new Map();
const species = new Map();
const days = Array.from({ length: dayCount }, (_, i) => ({
  date: addDays(firstDate, i),
  count: 0,
  species: 0,
  night: 0,
}));
const dailySpecies = Array.from({ length: dayCount }, () => new Set());

const events = { species: [], camera: [], day: [], minute: [], count: [] };
const hourly = new Array(24).fill(0);
let total = 0;
let night = 0;

for (const record of records) {
  const { date, hour, minute } = parseLocal(record.start);
  const day = dayIndex(date, firstDate);
  const isNight = hour >= NIGHT_START || hour < NIGHT_END;

  if (!cameras.has(record.camera)) {
    const { x, z } = lonLatToMetres(record.lon, record.lat);
    cameras.set(record.camera, {
      code: record.camera,
      lon: record.lon,
      lat: record.lat,
      x: round(x, 1),
      z: round(z, 1),
      total: 0,
      species: new Set(),
      hourly: new Array(24).fill(0),
      night: 0,
    });
  }
  if (!species.has(record.name)) {
    species.set(record.name, {
      en: record.name,
      fr: FRENCH[record.name],
      scientific: record.scientific,
      kind: KIND[record.name] ?? 'mammal',
      count: 0,
      hourly: new Array(24).fill(0),
      cameras: new Set(),
      night: 0,
      firstDay: day,
      lastDay: day,
    });
  }

  const camera = cameras.get(record.camera);
  const taxon = species.get(record.name);

  camera.total += record.count;
  camera.species.add(record.name);
  camera.hourly[hour] += record.count;

  taxon.count += record.count;
  taxon.hourly[hour] += record.count;
  taxon.cameras.add(record.camera);
  taxon.firstDay = Math.min(taxon.firstDay, day);
  taxon.lastDay = Math.max(taxon.lastDay, day);

  hourly[hour] += record.count;
  total += record.count;
  days[day].count += record.count;
  dailySpecies[day].add(record.name);

  if (isNight) {
    night += record.count;
    camera.night += record.count;
    taxon.night += record.count;
    days[day].night += record.count;
  }

  events.species.push(record.name);
  events.camera.push(record.camera);
  events.day.push(day);
  events.minute.push(minute);
  events.count.push(record.count);
}

days.forEach((day, i) => {
  day.species = dailySpecies[i].size;
});

// Cameras north to south: the corridor runs down the escarpment, so the order is
// the walk a visitor would take, not the order the export happened to list.
const cameraList = [...cameras.values()]
  .sort((a, b) => b.lat - a.lat)
  .map(camera => ({
    code: camera.code,
    lon: camera.lon,
    lat: camera.lat,
    x: camera.x,
    z: camera.z,
    total: camera.total,
    species: camera.species.size,
    hourly: camera.hourly,
    nightShare: round(camera.night / camera.total, 4),
  }));

const speciesList = [...species.values()]
  .sort((a, b) => b.count - a.count)
  .map(taxon => ({
    en: taxon.en,
    fr: taxon.fr,
    scientific: taxon.scientific,
    kind: taxon.kind,
    count: taxon.count,
    hourly: taxon.hourly,
    cameras: [...taxon.cameras].map(code => cameraList.findIndex(c => c.code === code)).sort((a, b) => a - b),
    nightShare: round(taxon.night / taxon.count, 4),
    firstDay: taxon.firstDay,
    lastDay: taxon.lastDay,
  }));

const speciesIndex = new Map(speciesList.map((s, i) => [s.en, i]));
const cameraIndex = new Map(cameraList.map((c, i) => [c.code, i]));

const atlas = {
  meta: {
    total,
    records: records.length,
    speciesCount: speciesList.length,
    wildSpeciesCount: speciesList.filter(s => s.kind !== 'domestic').length,
    cameraCount: cameraList.length,
    start: firstDate,
    end: lastDate,
    dayCount,
    activeDays: days.filter(d => d.count > 0).length,
    nightShare: round(night / total, 4),
    origin: ORIGIN,
    source: 'Every1Counts camera-trap export, 10 Nov 2025',
    generatedFrom: 'scripts/build-passages-atlas.mjs',
  },
  hourly,
  cameras: cameraList,
  species: speciesList,
  days,
  events: {
    species: events.species.map(name => speciesIndex.get(name)),
    camera: events.camera.map(code => cameraIndex.get(code)),
    day: events.day,
    minute: events.minute,
    count: events.count,
  },
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, JSON.stringify(atlas));

const kb = (Buffer.byteLength(JSON.stringify(atlas)) / 1024).toFixed(1);
console.log(
  `passages.json  ${kb} KB — ${total} passages, ${records.length} records, ` +
    `${speciesList.length} species, ${cameraList.length} cameras, ` +
    `${atlas.meta.activeDays}/${dayCount} days with a passage, ` +
    `${Math.round(atlas.meta.nightShare * 100)} % at night`
);

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
