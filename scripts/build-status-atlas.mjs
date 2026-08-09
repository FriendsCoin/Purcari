#!/usr/bin/env node
/**
 * Bakes the conservation-status layer: which of the species recorded at Purcari
 * carry protection, where and when they were recorded, and how sure the machine
 * that identified them was.
 *
 *   node scripts/build-status-atlas.mjs
 *
 * Nothing here is written from memory. Two source snapshots sit in
 * `scripts/sources/`, each carrying its own URL and retrieval date, and this
 * script only joins them to the survey:
 *
 * - `wikidata-taxa.json` — scientific name and global IUCN Red List category for
 *   every vernacular name in the two surveys, from Wikidata's SPARQL endpoint.
 * - `redbook-md.json` — the national list, Cartea Roșie a Republicii Moldova,
 *   transcribed from the tables on Romanian Wikipedia.
 *
 * **The national layer is partial and the chapter says so on screen.** The
 * transcription carries 39 birds and 14 mammals; the third edition of the book
 * (Știința, 2015) lists 62 and 30. So this under-reports the national list and
 * cannot over-report it — a species shown here as unlisted may simply be missing
 * from the transcription. If the official annex becomes available, drop it in
 * and rebuild; nothing else changes.
 *
 * The confidence figures come from the raw export, where every acoustic
 * detection carries the BirdNET score that produced it. They are in the data for
 * a reason: a category is a statement about a species, not about a recording.
 * One booted eagle at 0.97 is still one three-second clip, and fourteen barn
 * owls at a median of 0.57 are fourteen coin flips. The chapter shows both.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TARGET = resolve(ROOT, 'src/installation/data/status.json');

const read = path => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

const atlas = read('src/installation/data/atlas.json');
const passages = read('src/installation/data/passages.json');
const redbook = read('scripts/sources/redbook-md.json');
const redbookFr = read('scripts/sources/redbook-fr.json');
const taxa = read('scripts/sources/wikidata-taxa.json');
const raw = read('data.geojson');

/**
 * The book's range notes, in French.
 *
 * The Red Book is a Romanian-language work and the transcription keeps its
 * wording; this is the reading, phrase by phrase, for a panel whose language is
 * French. Only the vocabulary is translated — the toponyms stand (Codri, Prut,
 * Nistru as its French exonym Dniestr, Pădurea Domnească) — and the Romanian
 * original travels with every entry as `where` so the source is never lost.
 * A phrase with no entry here is shown in Romanian rather than guessed at.
 */
const WHERE_FR = {
  'Codri, cursul inferior al Prutului și Nistrului': 'Codri, cours inférieur du Prut et du Dniestr',
  'Codri, luncile Prutului și Nistrului': 'Codri, plaines alluviales du Prut et du Dniestr',
  'Codri, pădurile din lucinile Prutului și Nistrului':
    'Codri, forêts des plaines alluviales du Prut et du Dniestr',
  'Codri, pădurile din lunca Prutului,  în Rezervația „Pădurea Domnească”':
    'Codri, forêts de la plaine du Prut, réserve « Pădurea Domnească »',
  'Codri, văile Nistrului și Prutului': 'Codri, vallées du Dniestr et du Prut',
  'Codrii Centrali': 'Codrii Centraux',
  'Codrii Centrali, pădurile din cursurile mijlociu  și inferior al Prutului și  din cursul inferior la Nistrului':
    'Codrii Centraux, forêts des cours moyen et inférieur du Prut et du cours inférieur du Dniestr',
  'centrul și sudul țării': 'centre et sud du pays',
  'centrul și sudul țării ultima oară semnalată în 1963':
    'centre et sud du pays ; signalée pour la dernière fois en 1963',
  'centrul țării': 'centre du pays',
  'cursul inferior al Nistrului și al Prutului': 'cours inférieur du Dniestr et du Prut',
  'cursul inferior al Nistrului,  pădurea Cuhnești pe malul Prutului':
    'cours inférieur du Dniestr, forêt de Cuhnești sur la rive du Prut',
  'cursul inferior al Nistrului, în timpul migrației':
    'cours inférieur du Dniestr, pendant la migration',
  'cursul inferior al Prutului': 'cours inférieur du Prut',
  'cursul inferior al Prutului și al Nistrului': 'cours inférieur du Prut et du Dniestr',
  'cursul superior și de mijloc al Nistrului': 'cours supérieur et moyen du Dniestr',
  'luncile Nistrului, Prutului și Răutului': 'plaines alluviales du Dniestr, du Prut et du Răut',
  'malurile stâncoase al Nistrului  din raionul Orhei':
    'rives rocheuses du Dniestr, district d’Orhei',
  'nordul și centrul țării': 'nord et centre du pays',
  'nordul, centrul și sud-estul țării ultima oară semnalată în 1962':
    'nord, centre et sud-est du pays ; signalée pour la dernière fois en 1962',
  'parcurile din Chișinău și Tiraspol': 'parcs de Chișinău et de Tiraspol',
  'pretutindeni, dar are o densitate mică': 'partout, mais en faible densité',
  'pădurile Orheiului și Corneștiului (?)': 'forêts d’Orhei et de Cornești (?)',
  'pădurile din centrul țării': 'forêts du centre du pays',
  'pădurile din centrul țării (r. Sângerei, Telenști)':
    'forêts du centre du pays (districts de Sângerei, Telenești)',
  'pădurile din luncile Prutului (r. Glodeni, Leova),  Nistrului (r. Căușeni), Codri (r. Hânceșit)':
    'forêts des plaines du Prut (districts de Glodeni, Leova) et du Dniestr (district de Căușeni), Codri (district de Hâncești)',
  'rar, pe tot teritoriul țării': 'rare, sur tout le territoire du pays',
  'stepa Bălțiului, stepa Bugeacului (1962)': 'steppe de Bălți, steppe du Boudjak (1962)',
  'stepa Bălțului și stepa Bugeacului,  zonele neîmpădurite din centrul țării':
    'steppe de Bălți et steppe du Boudjak, zones non boisées du centre du pays',
  'sudul țării (1982)': 'sud du pays (1982)',
  'sudul țării ultima oară semnalată în 1965':
    'sud du pays ; signalée pour la dernière fois en 1965',
  'terasele superioare și versantele Nistrului și Răutului':
    'terrasses hautes et versants du Dniestr et du Răut',
  'tot teritoriul țării': 'tout le territoire du pays',
  'valea Prutului, Codri': 'vallée du Prut, Codri',
  'în apropiere de Nistru, în raioanele Soroca și Grigoriopol':
    'à proximité du Dniestr, districts de Soroca et Grigoriopol',
  'în cursurile inferioare ale Nistrului și Prutului':
    'cours inférieurs du Dniestr et du Prut',
  'în lunca Prutlui și în cursul inferior al Nistrului':
    'plaine du Prut et cours inférieur du Dniestr',
  'în luncile Prutului, Nistrului și râurilor interioare':
    'plaines du Prut, du Dniestr et des rivières intérieures',
  'în luncile inundabile din cursurile inferioare  ale Nistrului și Prutului, în Codri':
    'plaines inondables des cours inférieurs du Dniestr et du Prut, Codri',
  'în raioanele Orhei și Strășeni': 'districts d’Orhei et Strășeni',
  'în unele peșteri sau mine de extragere  a pietrei din [[raionul Orhei]]':
    'quelques grottes et carrières de pierre du district d’Orhei',
};

const whereFr = where => WHERE_FR[where.trim()] ?? WHERE_FR[where] ?? null;

/** Severity, worst first. The order the chapter stacks its tiers in. */
const RANK = { CR: 0, EN: 1, VU: 2, NT: 3 };

/** IUCN's own wording, as Wikidata returns it, mapped to the usual codes. */
const IUCN_CODE = {
  'critically endangered': 'CR',
  endangered: 'EN',
  vulnerable: 'VU',
  'near threatened': 'NT',
  'least concern': 'LC',
  'data deficient': 'DD',
};

const nationalByScientific = new Map(
  [...redbook.birds, ...redbook.mammals].map(entry => [entry.scientific, entry])
);

// --------------------------------------------------------------- confidence --

/**
 * BirdNET scores per species, from the raw export.
 *
 * The export mixes two instruments — 2,649 sound rows and 16 camera rows — and
 * only the sound rows carry a score, because only they were classified by a
 * model. The camera rows were identified by a person.
 */
const scores = new Map();
for (const item of raw.items) {
  if (item.datatype !== 'sound') continue;
  const confidence = item.properties?.confidence;
  if (typeof confidence !== 'number') continue;
  if (!scores.has(item.title)) scores.set(item.title, []);
  scores.get(item.title).push(confidence);
}

function confidenceOf(name) {
  const values = scores.get(name);
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: round(sorted[0], 3),
    median: round(sorted[Math.floor(sorted.length / 2)], 3),
    max: round(sorted[sorted.length - 1], 3),
  };
}

// ------------------------------------------------------------------ species --

const entries = [];

for (const species of atlas.species) {
  const taxon = taxa.byVernacular[species.name];
  if (!taxon) continue;

  const national = nationalByScientific.get(taxon.sci) ?? null;
  const global = IUCN_CODE[(taxon.iucn ?? '').toLowerCase()] ?? null;
  if (!national && !(global && RANK[global] !== undefined)) continue;

  entries.push({
    fr: species.name,
    scientific: taxon.sci,
    kind: taxon.class,
    survey: 'acoustic',
    national: national
      ? { category: national.category, where: national.where, whereFr: whereFr(national.where) }
      : null,
    global: global && RANK[global] !== undefined ? global : null,
    globalLabel: taxon.iucn ?? null,
    count: species.count,
    hourly: species.hourly,
    stations: species.stations.map(i => atlas.stations[i].code.toUpperCase()),
    firstDay: species.firstDay,
    lastDay: species.lastDay,
    nocturnality: species.nocturnality,
    confidence: confidenceOf(species.name),
  });
}

for (const species of passages.species) {
  const taxon = taxa.byScientific[species.scientific];
  const national = nationalByScientific.get(species.scientific) ?? null;
  const global = IUCN_CODE[(taxon?.iucn ?? '').toLowerCase()] ?? null;
  if (!national && !(global && RANK[global] !== undefined)) continue;

  entries.push({
    fr: species.fr,
    scientific: species.scientific,
    kind: species.kind === 'bird' ? 'bird' : 'mammal',
    survey: 'camera',
    national: national
      ? { category: national.category, where: national.where, whereFr: whereFr(national.where) }
      : null,
    global: global && RANK[global] !== undefined ? global : null,
    globalLabel: taxon?.iucn ?? null,
    count: species.count,
    hourly: species.hourly,
    stations: species.cameras.map(i => passages.cameras[i].code),
    firstDay: species.firstDay,
    lastDay: species.lastDay,
    nocturnality: species.nightShare,
    // A camera record was identified by eye, so there is no score to show.
    confidence: null,
  });
}

/** Worst category a species carries, from either list. */
function worst(entry) {
  const codes = [entry.national?.category, entry.global].filter(Boolean);
  return codes.sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0] ?? 'NT';
}

entries.forEach(entry => {
  entry.tier = worst(entry);
});
entries.sort((a, b) => (RANK[a.tier] - RANK[b.tier]) || b.count - a.count);

// ----------------------------------------------------------- national list --

/**
 * The whole transcribed national list, not only the part of it the surveys
 * found.
 *
 * This is what makes the chapter a section about the Red Book rather than a
 * list of eight lucky detections: the estate's records stand inside the book
 * they belong to, and most of that book stays dark. One transcribed entry —
 * Circus macrourus, the pallid harrier, last reported in Moldova in 1962 —
 * carries no category in the published table, and is left out rather than
 * assigned one.
 */
const foundScientific = new Set(entries.map(entry => entry.scientific));
const nationalList = [...redbook.birds, ...redbook.mammals]
  .filter(entry => RANK[entry.category] !== undefined)
  .map(entry => {
    const wiki = redbookFr.names[entry.scientific] ?? null;
    return {
      ro: entry.ro,
      scientific: entry.scientific,
      // The accepted spelling, where the transcription carries a variant.
      accepted: wiki?.accepted ?? null,
      fr: wiki?.fr ?? null,
      kind: wiki?.class ?? null,
      category: entry.category,
      where: entry.where.trim(),
      whereFr: whereFr(entry.where),
      found: foundScientific.has(entry.scientific),
    };
  })
  .sort(
    (a, b) => RANK[a.category] - RANK[b.category] || (a.fr ?? a.ro).localeCompare(b.fr ?? b.ro)
  );

const listCounts = nationalList.reduce(
  (acc, entry) => ((acc[entry.category] = (acc[entry.category] ?? 0) + 1), acc),
  {}
);

// ---------------------------------------------------------------- histogram --

/** The whole run of BirdNET scores, in tenths — the chapter draws it as a bar. */
const histogram = new Array(5).fill(0);
let scored = 0;
for (const values of scores.values()) {
  for (const value of values) {
    histogram[Math.min(4, Math.max(0, Math.floor(value * 10) - 5))] += 1;
    scored += 1;
  }
}

const all = [...scores.values()].flat().sort((a, b) => a - b);

const status = {
  meta: {
    generatedFrom: 'scripts/build-status-atlas.mjs',
    national: {
      ...redbook.source,
      names: redbookFr.source,
      /** How many transcribed entries stand on each category's ring. */
      counts: listCounts,
      listed: nationalList.length,
      found: nationalList.filter(entry => entry.found).length,
      /** Circus macrourus, transcribed without a category. */
      uncategorised: [...redbook.birds, ...redbook.mammals].filter(
        entry => RANK[entry.category] === undefined
      ).length,
    },
    global: taxa.source,
    tiers: ['CR', 'EN', 'VU', 'NT'],
    // What the acoustic half of the survey was scored at, for the chapter's own
    // caveat: nothing below 0.5 is in the export at all.
    confidence: {
      scored,
      threshold: round(all[0], 3),
      median: round(all[Math.floor(all.length / 2)], 3),
      histogram,
      buckets: ['0.5–0.6', '0.6–0.7', '0.7–0.8', '0.8–0.9', '0.9–1.0'],
    },
    counted: {
      acousticSpecies: atlas.species.length,
      cameraSpecies: passages.species.length,
      resolved: Object.keys(taxa.byVernacular).length + Object.keys(taxa.byScientific).length,
    },
  },
  species: entries,
  redbook: nationalList,
};

writeFileSync(TARGET, JSON.stringify(status));

const byTier = entries.reduce((acc, e) => ((acc[e.tier] = (acc[e.tier] ?? 0) + 1), acc), {});
console.log(
  `status.json  ${(Buffer.byteLength(JSON.stringify(status)) / 1024).toFixed(1)} KB — ` +
    `${entries.length} species carrying a status ` +
    `(${Object.entries(byTier).map(([k, v]) => `${k}:${v}`).join(' ')}), ` +
    `${entries.filter(e => e.national).length} on the national list, ` +
    `${entries.filter(e => e.global).length} on the global one; ` +
    `national list ${nationalList.length} entries ` +
    `(${Object.entries(listCounts).map(([k, v]) => `${k}:${v}`).join(' ')}), ` +
    `${nationalList.filter(e => e.found).length} of them found here, ` +
    `${nationalList.filter(e => !e.whereFr).length} without a French range note`
);

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
