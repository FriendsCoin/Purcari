#!/usr/bin/env node
/**
 * Builds the runtime payload for the Living Archive installation.
 *
 * Sources:
 *   data.geojson            E1C export: 2649 BirdNET acoustic + 16 camera detections
 *   20251110_100018.csv     camera trap detections (mammals, 8 stations)
 *   20251110_100109.csv     monthly richness trend
 *   20251110_100135.csv     Shannon per site
 *   20251110_100150.csv     Shannon / Simpson / richness per site and filter
 *   STATIONS (below)        field reference: altitude, biodiversity zone, equipment status
 *
 * Outputs:
 *   public/installation.json  compact payload consumed by the WebGL runtime
 *   public/data.geojson       slimmed copy so the legacy dashboard loader resolves
 *
 * Timestamps are treated as station-local wall clock (Europe/Chisinau). The E1C
 * acoustic export carries a "Z" suffix but the camera CSV from the same platform
 * is naive local time; reading both as local keeps them on one comparable 24h
 * clock, which every act of the installation depends on.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public');

/** Field reference for the monitoring network (see vineyard analysis protocol). */
const STATIONS = {
  CT41: { plot: 'H1', lat: 46.5229, lng: 29.87434, alt: 105, zone: 'core', status: 'active' },
  CT42: { plot: 'H10', lat: 46.52783, lng: 29.86744, alt: 129, zone: 'edge', status: 'lost', lostAt: '2025-06' },
  CT43: { plot: 'H12', lat: 46.51911, lng: 29.86366, alt: 168, zone: 'core', status: 'lost', lostAt: '2025-08' },
  CT44: { plot: 'H13', lat: 46.53128, lng: 29.86926, alt: 64, zone: 'core', status: 'active' },
  CT45: { plot: 'H6', lat: 46.50326, lng: 29.8767, alt: 190, zone: 'matrix', status: 'active' },
  CT46: { plot: 'H7', lat: 46.51381, lng: 29.87948, alt: 127, zone: 'edge', status: 'active' },
  CT47: { plot: 'HC', lat: 46.53061, lng: 29.87206, alt: 53, zone: 'matrix', status: 'moved', lostAt: '2025-08' },
  CT48: { plot: 'H5', lat: 46.50836, lng: 29.87452, alt: 171, zone: 'edge', status: 'active' },
  CT49: { plot: 'H9', lat: 46.51642, lng: 29.87586, alt: 79, zone: 'core', status: 'lost', lostAt: '2025-08' },
  CT50: { plot: 'H4', lat: 46.52168, lng: 29.85947, alt: 174, zone: 'matrix', status: 'lost', lostAt: '2025-06' },
};

/**
 * Curated names for the species the installation labels on screen. The source
 * export only carries a French common name; the long tail falls back to it.
 * `sci` is filled from the camera CSV where that export provides it.
 */
const SPECIES_BOOK = {
  "Verdier d'Europe": ['Обыкновенная зеленушка', 'European Greenfinch', 'Chloris chloris', 'bird'],
  'Tourterelle turque': ['Кольчатая горлица', 'Eurasian Collared Dove', 'Streptopelia decaocto', 'bird'],
  'Hirondelle rustique': ['Деревенская ласточка', 'Barn Swallow', 'Hirundo rustica', 'bird'],
  'Hirondelle de fenêtre': ['Городская ласточка', 'Common House Martin', 'Delichon urbicum', 'bird'],
  'Chardonneret élégant': ['Черноголовый щегол', 'European Goldfinch', 'Carduelis carduelis', 'bird'],
  "Guêpier d'Europe": ['Золотистая щурка', 'European Bee-eater', 'Merops apiaster', 'bird'],
  "Loriot d'Europe": ['Обыкновенная иволга', 'Eurasian Golden Oriole', 'Oriolus oriolus', 'bird'],
  'Gobemouche gris': ['Серая мухоловка', 'Spotted Flycatcher', 'Muscicapa striata', 'bird'],
  'Pigeon ramier': ['Вяхирь', 'Common Wood Pigeon', 'Columba palumbus', 'bird'],
  "Engoulevent d'Europe": ['Обыкновенный козодой', 'European Nightjar', 'Caprimulgus europaeus', 'bird'],
  'Chouette hulotte': ['Серая неясыть', 'Tawny Owl', 'Strix aluco', 'bird'],
  'Petit-duc scops': ['Обыкновенная сплюшка', 'Eurasian Scops Owl', 'Otus scops', 'bird'],
  'Pic syriaque': ['Сирийский дятел', 'Syrian Woodpecker', 'Dendrocopos syriacus', 'bird'],
  'Tourterelle des bois': ['Обыкновенная горлица', 'European Turtle Dove', 'Streptopelia turtur', 'bird'],
  'Linotte mélodieuse': ['Коноплянка', 'Common Linnet', 'Linaria cannabina', 'bird'],
  'Pic épeiche': ['Большой пёстрый дятел', 'Great Spotted Woodpecker', 'Dendrocopos major', 'bird'],
  'Gobemouche noir': ['Мухоловка-пеструшка', 'European Pied Flycatcher', 'Ficedula hypoleuca', 'bird'],
  'Bihoreau gris': ['Кваква', 'Black-crowned Night Heron', 'Nycticorax nycticorax', 'bird'],
  'Coucou gris': ['Обыкновенная кукушка', 'Common Cuckoo', 'Cuculus canorus', 'bird'],
  'Pouillot véloce': ['Пеночка-теньковка', 'Common Chiffchaff', 'Phylloscopus collybita', 'bird'],
  'Faisan de Colchide': ['Обыкновенный фазан', 'Common Pheasant', 'Phasianus colchicus', 'bird'],
  'Blongios nain': ['Малая выпь', 'Little Bittern', 'Ixobrychus minutus', 'bird'],
  'Rougequeue à front blanc': ['Обыкновенная горихвостка', 'Common Redstart', 'Phoenicurus phoenicurus', 'bird'],
  'Buse variable': ['Обыкновенный канюк', 'Common Buzzard', 'Buteo buteo', 'bird'],
  'Merle noir': ['Чёрный дрозд', 'Common Blackbird', 'Turdus merula', 'bird'],
  'Bergeronnette printanière': ['Жёлтая трясогузка', 'Western Yellow Wagtail', 'Motacilla flava', 'bird'],
  'Pinson des arbres': ['Зяблик', 'Common Chaffinch', 'Fringilla coelebs', 'bird'],
  'Rossignol progné': ['Южный соловей', 'Thrush Nightingale', 'Luscinia luscinia', 'bird'],
  'Cygne chanteur': ['Лебедь-кликун', 'Whooper Swan', 'Cygnus cygnus', 'bird'],
  "Chevêche d'Athéna": ['Домовый сыч', 'Little Owl', 'Athene noctua', 'bird'],
  'Gros-bec casse-noyaux': ['Обыкновенный дубонос', 'Hawfinch', 'Coccothraustes coccothraustes', 'bird'],
  'Mésange charbonnière': ['Большая синица', 'Great Tit', 'Parus major', 'bird'],
  'Grand Corbeau': ['Ворон', 'Northern Raven', 'Corvus corax', 'bird'],
  'Effraie des clochers': ['Сипуха', 'Western Barn Owl', 'Tyto alba', 'bird'],
  'Sizerin flammé': ['Обыкновенная чечётка', 'Common Redpoll', 'Acanthis flammea', 'bird'],
  'Chevalier cul-blanc': ['Черныш', 'Green Sandpiper', 'Tringa ochropus', 'bird'],
  'Huppe fasciée': ['Удод', 'Eurasian Hoopoe', 'Upupa epops', 'bird'],
  'Grue cendrée': ['Серый журавль', 'Common Crane', 'Grus grus', 'bird'],
  'Butor étoilé': ['Большая выпь', 'Eurasian Bittern', 'Botaurus stellaris', 'bird'],
  "Grand-duc d'Europe": ['Филин', 'Eurasian Eagle-Owl', 'Bubo bubo', 'bird'],
  'Pie-grièche écorcheur': ['Обыкновенный жулан', 'Red-backed Shrike', 'Lanius collurio', 'bird'],
  'Courlis cendré': ['Большой кроншнеп', 'Eurasian Curlew', 'Numenius arquata', 'bird'],
  'Cigogne blanche': ['Белый аист', 'White Stork', 'Ciconia ciconia', 'bird'],
  'Aigle botté': ['Орёл-карлик', 'Booted Eagle', 'Hieraaetus pennatus', 'bird'],
  'Héron cendré': ['Серая цапля', 'Grey Heron', 'Ardea cinerea', 'bird'],
  'Mésange bleue': ['Лазоревка', 'Eurasian Blue Tit', 'Cyanistes caeruleus', 'bird'],
  'Rougegorge familier': ['Зарянка', 'European Robin', 'Erithacus rubecula', 'bird'],
  'Pie bavarde': ['Сорока', 'Eurasian Magpie', 'Pica pica', 'bird'],
  'Geai des chênes': ['Сойка', 'Eurasian Jay', 'Garrulus glandarius', 'bird'],
  'Rossignol philomèle': ['Западный соловей', 'Common Nightingale', 'Luscinia megarhynchos', 'bird'],
  'Grive musicienne': ['Певчий дрозд', 'Song Thrush', 'Turdus philomelos', 'bird'],
  'Caille des blés': ['Перепел', 'Common Quail', 'Coturnix coturnix', 'bird'],
  'Hibou moyen-duc': ['Ушастая сова', 'Long-eared Owl', 'Asio otus', 'bird'],
  // Mammals — appear in both exports, French in the acoustic file, English in the CSV.
  Renard: ['Обыкновенная лисица', 'Red Fox', 'Vulpes vulpes', 'mammal'],
  Lievre: ['Заяц-русак', 'Brown Hare', 'Lepus europaeus', 'mammal'],
  'Red fox': ['Обыкновенная лисица', 'Red Fox', 'Vulpes vulpes', 'mammal'],
  'Brown Hare': ['Заяц-русак', 'Brown Hare', 'Lepus europaeus', 'mammal'],
  'Common Pheasant': ['Обыкновенный фазан', 'Common Pheasant', 'Phasianus colchicus', 'bird'],
  'Golden jackal': ['Обыкновенный шакал', 'Golden Jackal', 'Canis aureus', 'mammal'],
  'Eurasian Wild Pig': ['Кабан', 'Wild Boar', 'Sus scrofa', 'mammal'],
  Badger: ['Барсук', 'European Badger', 'Meles meles', 'mammal'],
  'European Roe': ['Европейская косуля', 'Roe Deer', 'Capreolus capreolus', 'mammal'],
  'European Pine Marten': ['Лесная куница', 'European Pine Marten', 'Martes martes', 'mammal'],
  Wildcat: ['Лесной кот', 'European Wildcat', 'Felis silvestris', 'mammal'],
  'Great Tit': ['Большая синица', 'Great Tit', 'Parus major', 'bird'],
  'Red-backed Shrike': ['Обыкновенный жулан', 'Red-backed Shrike', 'Lanius collurio', 'bird'],
  'European Robin': ['Зарянка', 'European Robin', 'Erithacus rubecula', 'bird'],
  Dog: ['Собака', 'Domestic Dog', 'Canis familiaris', 'domestic'],
  '3 Chiens': ['Собаки', 'Domestic Dogs', 'Canis familiaris', 'domestic'],
  '2 Chiens': ['Собаки', 'Domestic Dogs', 'Canis familiaris', 'domestic'],
  Cat: ['Домашняя кошка', 'Domestic Cat', 'Felis catus', 'domestic'],
  Horse: ['Лошадь', 'Horse', 'Equus caballus', 'domestic'],
  Inconnu: ['Не определён', 'Unidentified', '', 'unknown'],
};

/** Conservation flags worth surfacing on screen. */
const IUCN = {
  'Tourterelle des bois': { status: 'VU', note: 'Уязвимый вид, глобальное сокращение популяции' },
  'Courlis cendré': { status: 'NT', note: 'Близок к уязвимому положению' },
  Wildcat: { status: 'LC*', note: 'Локально редок — индикатор качества местообитаний' },
  'Grue cendrée': { status: 'LC', note: 'Пролётный вид, редкая регистрация на винограднике' },
  'Butor étoilé': { status: 'LC', note: 'Скрытный вид тростниковых зарослей' },
  'Aigle botté': { status: 'LC', note: 'Единственная регистрация за весь период' },
  'Cigogne blanche': { status: 'LC', note: 'Индикатор открытых влажных лугов' },
};

const MAMMAL_HINTS = ['renard', 'lievre', 'fox', 'hare', 'jackal', 'boar', 'pig', 'badger', 'roe', 'marten', 'wildcat', 'deer'];
const DOMESTIC_HINTS = ['chien', 'dog', 'cat', 'horse', 'chat', 'cheval'];

/** Reads a naive wall-clock timestamp, ignoring any timezone suffix. */
function parseLocal(raw) {
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return {
    y, mo, d, h, mi, s,
    dayKey: `${m[1]}-${m[2]}-${m[3]}`,
    monthKey: `${m[1]}-${m[2]}`,
    minuteOfDay: h * 60 + mi,
    ordinal: Date.UTC(y, mo - 1, d) / 86400000,
  };
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(head.map((k, i) => [k.trim(), cells[i]]));
  });
}

function classify(name) {
  const known = SPECIES_BOOK[name];
  if (known) return known[3];
  const lower = name.toLowerCase();
  if (DOMESTIC_HINTS.some((h) => lower.includes(h))) return 'domestic';
  if (MAMMAL_HINTS.some((h) => lower.includes(h))) return 'mammal';
  return 'bird';
}

function shannon(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  return -counts.filter((n) => n > 0).reduce((acc, n) => acc + (n / total) * Math.log(n / total), 0);
}

function simpson(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 1) return 0;
  return 1 - counts.reduce((acc, n) => acc + n * (n - 1), 0) / (total * (total - 1));
}

// ---------------------------------------------------------------------------

const geo = JSON.parse(readFileSync(join(ROOT, 'data.geojson'), 'utf8'));
const cameraCsv = parseCsv(readFileSync(join(ROOT, '20251110_100018.csv'), 'utf8'));
const monthlyCsv = parseCsv(readFileSync(join(ROOT, '20251110_100109.csv'), 'utf8'));
const diversityCsv = parseCsv(readFileSync(join(ROOT, '20251110_100150.csv'), 'utf8'));

/** Acoustic stations are identified by coordinate, not by a sensor ref. */
const stationByCoord = new Map(
  Object.entries(STATIONS).map(([id, s]) => [`${s.lng.toFixed(5)},${s.lat.toFixed(5)}`, id])
);

function stationAt(lng, lat) {
  const exact = stationByCoord.get(`${Number(lng).toFixed(5)},${Number(lat).toFixed(5)}`);
  if (exact) return exact;
  let best = null;
  let bestDist = Infinity;
  for (const [id, s] of Object.entries(STATIONS)) {
    const d = (s.lng - lng) ** 2 + (s.lat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return bestDist < 1e-6 ? best : null;
}

const speciesIndex = new Map();
const speciesRows = [];
const detections = [];
const sciFromCsv = new Map();

for (const row of cameraCsv) {
  if (row['Scientific name']) sciFromCsv.set(row['Common Name'], row['Scientific name']);
}

function speciesId(name) {
  if (speciesIndex.has(name)) return speciesIndex.get(name);
  const book = SPECIES_BOOK[name] ?? [];
  const id = speciesRows.length;
  speciesIndex.set(name, id);
  speciesRows.push({
    id,
    name,
    ru: book[0] ?? name,
    en: book[1] ?? name,
    sci: book[2] || sciFromCsv.get(name) || '',
    kind: classify(name),
    audio: 0,
    camera: 0,
    count: 0,
    stations: new Set(),
    firstMinute: null,
    iucn: IUCN[name] ?? null,
  });
  return id;
}

// --- acoustic + in-export camera detections -------------------------------
for (const item of geo.items) {
  const when = parseLocal(item.startdate);
  if (!when) continue;
  const [lng, lat] = item.geojson.coordinates;
  const station = item.properties?.sensor?.ref?.toUpperCase() ?? stationAt(lng, lat);
  const source = item.datatype === 'sound' ? 0 : 1;
  const sid = speciesId(item.title || 'Inconnu');
  const sp = speciesRows[sid];
  sp[source === 0 ? 'audio' : 'camera'] += 1;
  sp.count += 1;
  if (station) sp.stations.add(station);
  detections.push({
    sp: sid,
    st: station,
    lat,
    lng,
    min: when.minuteOfDay,
    ord: when.ordinal,
    day: when.dayKey,
    month: when.monthKey,
    src: source,
    night: item.properties?.isnight ? 1 : 0,
  });
}

// --- camera trap CSV ------------------------------------------------------
for (const row of cameraCsv) {
  const when = parseLocal(row.startdate);
  if (!when) continue;
  const station = (row.Hotspot || '').toUpperCase();
  const sid = speciesId(row['Common Name']);
  const sp = speciesRows[sid];
  const n = Number(row.detection_count) || 1;
  sp.camera += n;
  sp.count += n;
  if (station) sp.stations.add(station);
  detections.push({
    sp: sid,
    st: station || null,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    min: when.minuteOfDay,
    ord: when.ordinal,
    day: when.dayKey,
    month: when.monthKey,
    src: 1,
    night: when.h >= 21 || when.h < 5 ? 1 : 0,
  });
}

detections.sort((a, b) => a.ord - b.ord || a.min - b.min);

// --- aggregates -----------------------------------------------------------
const ordinals = detections.map((d) => d.ord);
const ordMin = Math.min(...ordinals);
const ordMax = Math.max(...ordinals);

const hourly = { audio: Array(24).fill(0), camera: Array(24).fill(0) };
const stationTally = {};
const dailyMap = new Map();

for (const d of detections) {
  hourly[d.src === 0 ? 'audio' : 'camera'][Math.floor(d.min / 60)] += 1;
  if (d.st) {
    const t = (stationTally[d.st] ??= { audio: 0, camera: 0, species: new Set() });
    t[d.src === 0 ? 'audio' : 'camera'] += 1;
    t.species.add(d.sp);
  }
  const day = (dailyMap.get(d.day) ?? { date: d.day, audio: 0, camera: 0 });
  day[d.src === 0 ? 'audio' : 'camera'] += 1;
  dailyMap.set(d.day, day);
}

const stations = Object.entries(STATIONS).map(([id, s]) => {
  const t = stationTally[id] ?? { audio: 0, camera: 0, species: new Set() };
  const perSpecies = [];
  for (const sid of t.species) {
    perSpecies.push([sid, detections.filter((d) => d.st === id && d.sp === sid).length]);
  }
  const counts = perSpecies.map(([, c]) => c);
  return {
    id,
    ...s,
    audio: t.audio,
    camera: t.camera,
    total: t.audio + t.camera,
    richness: t.species.size,
    shannon: Number(shannon(counts).toFixed(3)),
    simpson: Number(simpson(counts).toFixed(3)),
    top: perSpecies.sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
});

/** Species that share a station — drives the constellation edges. */
const edges = [];
const byStation = new Map();
for (const d of detections) {
  if (!d.st) continue;
  const set = byStation.get(d.st) ?? new Map();
  set.set(d.sp, (set.get(d.sp) ?? 0) + 1);
  byStation.set(d.st, set);
}
for (const [station, counts] of byStation) {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (let i = 0; i < top.length; i += 1) {
    for (let j = i + 1; j < top.length; j += 1) {
      edges.push({ a: top[i][0], b: top[j][0], station, w: Math.min(top[i][1], top[j][1]) });
    }
  }
}
edges.sort((a, b) => b.w - a.w);

const species = speciesRows
  .map((s) => ({ ...s, stations: [...s.stations].sort() }))
  .sort((a, b) => b.count - a.count)
  .map((s, rank) => ({ ...s, rank }));

/** Remap detection species ids onto the rank-sorted species array. */
const remap = new Map(species.map((s, i) => [s.id, i]));
const finalSpecies = species.map((s, i) => ({ ...s, id: i }));

const stationOrder = stations.map((s) => s.id);

const payload = {
  meta: {
    title: 'Purcari — Живой архив',
    tz: 'Europe/Chisinau (станционное локальное время)',
    window: {
      firstDay: detections[0].day,
      lastDay: detections[detections.length - 1].day,
      days: ordMax - ordMin + 1,
    },
    counts: {
      detections: detections.length,
      acoustic: detections.filter((d) => d.src === 0).length,
      camera: detections.filter((d) => d.src === 1).length,
      species: finalSpecies.length,
      birds: finalSpecies.filter((s) => s.kind === 'bird').length,
      mammals: finalSpecies.filter((s) => s.kind === 'mammal').length,
      stations: stations.length,
      stationsActive: stations.filter((s) => s.status === 'active').length,
      stationsLost: stations.filter((s) => s.status !== 'active').length,
    },
    shannonOverall: Number(shannon(finalSpecies.map((s) => s.count)).toFixed(3)),
    simpsonOverall: Number(simpson(finalSpecies.map((s) => s.count)).toFixed(3)),
    // Sampling effort differs between the two networks, which matters for any
    // comparison of their raw counts. Measured from the data, not assumed.
    dutyCycle: {
      acousticMinutesPerHour: new Set(
        detections.filter((d) => d.src === 0).map((d) => d.min % 60)
      ).size,
      cameraContinuous:
        new Set(detections.filter((d) => d.src === 1).map((d) => d.min % 60)).size > 30,
    },
  },
  stations,
  species: finalSpecies,
  // Parallel arrays keep the payload small; the runtime reads them straight
  // into typed arrays for the particle attributes.
  detections: {
    sp: detections.map((d) => remap.get(d.sp)),
    st: detections.map((d) => (d.st ? stationOrder.indexOf(d.st) : -1)),
    min: detections.map((d) => d.min),
    day: detections.map((d) => d.ord - ordMin),
    src: detections.map((d) => d.src),
    night: detections.map((d) => d.night),
    lat: detections.map((d) => Number(d.lat.toFixed(5))),
    lng: detections.map((d) => Number(d.lng.toFixed(5))),
  },
  hourly,
  daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  monthly: monthlyCsv.map((r) => ({ month: r.date_calc, richness: Number(r['all sites']) })),
  diversity: diversityCsv.map((r) => ({
    site: r.site,
    filter: r.filtre,
    shannon: Number(r['MAX(shannon)']),
    simpson: Number(r['MAX(simpson)']),
    richness: Number(r['MAX(richesse)']),
  })),
  edges: edges.slice(0, 260).map((e) => ({ a: remap.get(e.a), b: remap.get(e.b), w: e.w })),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'installation.json'), JSON.stringify(payload));

/** Slimmed GeoJSON so the legacy dashboard's /data.geojson fetch resolves. */
writeFileSync(
  join(OUT_DIR, 'data.geojson'),
  JSON.stringify({
    count: geo.count,
    items: geo.items.map((it) => ({
      id: it.id,
      title: it.title,
      datatype: it.datatype,
      startdate: it.startdate,
      enddate: it.enddate,
      properties: it.properties,
      geojson: it.geojson,
    })),
  })
);

const size = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`installation.json  ${size(JSON.stringify(payload).length)}`);
console.log(
  `  ${payload.meta.counts.detections} detections · ${payload.meta.counts.species} species · ` +
    `${payload.meta.counts.stations} stations · ${payload.meta.window.days} days`
);
console.log(`  acoustic ${payload.meta.counts.acoustic} / camera ${payload.meta.counts.camera}`);
console.log(`  peak hour audio ${hourly.audio.indexOf(Math.max(...hourly.audio))}:00, camera ${hourly.camera.indexOf(Math.max(...hourly.camera))}:00`);
