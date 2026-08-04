/**
 * Act layouts.
 *
 * Every act is the same 3015 particles — one per real detection — rearranged.
 * Each function fills position/colour/size buffers, and the shader morphs
 * between two of them with a per-particle delay, so the cloud reorganises like
 * a flock rather than snapping.
 *
 * Scene space: 1 unit ≈ 52 m on the ground. Vertical relief is exaggerated
 * (VERTICAL_EXAGGERATION) because the real 137 m spread across the station
 * network would otherwise be invisible next to its 3 km footprint.
 */

import { Color } from 'three';
import type { Archive } from './data';
import type { Projection } from './projection';
import { LANDSCAPE_SPAN } from './projection';
import { PALETTE, detectionColor } from './theme';

export const GROUND_SPAN = LANDSCAPE_SPAN;

export interface Layout {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
}

/** Deterministic PRNG so every reload composes the identical picture. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function empty(n: number): Layout {
  return { position: new Float32Array(n * 3), color: new Float32Array(n * 3), size: new Float32Array(n) };
}

/** Every act shares the archive's single projection onto the real terrain. */
export function geoProjector(archive: Archive): Projection {
  return archive.projection;
}

/** Per-detection base tint and grain size, shared by most acts. */
function baseAppearance(archive: Archive) {
  const n = archive.count;
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const c = new Color();
  const maxCount = Math.max(...archive.species.map((s) => s.count));

  for (let i = 0; i < n; i += 1) {
    const sp = archive.species[archive.sp[i]];
    detectionColor(archive.minute[i] / 60, sp.kind, c);
    color[i * 3] = c.r;
    color[i * 3 + 1] = c.g;
    color[i * 3 + 2] = c.b;
    // Rare species keep a larger grain so a single record is never lost in the mass.
    const rarity = 1 - Math.log(sp.count + 1) / Math.log(maxCount + 1);
    size[i] = 0.85 + 1.5 * rarity ** 1.6 + (archive.src[i] === 1 ? 0.35 : 0);
  }
  return { color, size };
}

export interface LayoutContext {
  archive: Archive;
  base: { color: Float32Array; size: Float32Array };
  geo: ReturnType<typeof geoProjector>;
}

export function makeContext(archive: Archive): LayoutContext {
  return { archive, base: baseAppearance(archive), geo: geoProjector(archive) };
}

// ---------------------------------------------------------------------------
// ACT 0 — dormant cloud behind the title
// ---------------------------------------------------------------------------
export function layoutDormant({ archive, base }: LayoutContext): Layout {
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(1207);
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    const shell = 24 + rnd() * 9;
    out.position[i * 3] = Math.cos(theta) * radius * shell * 1.35;
    out.position[i * 3 + 1] = y * shell * 0.62;
    out.position[i * 3 + 2] = Math.sin(theta) * radius * shell * 1.35;
    out.size[i] = base.size[i] * 0.85;
  }
  out.color.set(base.color);
  return out;
}

// ---------------------------------------------------------------------------
// ACT 1 — the land: each station becomes a plume of light at its true position
// ---------------------------------------------------------------------------
export function layoutTerrain(ctx: LayoutContext): Layout {
  const { archive, base, geo } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(4401);
  const maxTotal = Math.max(...archive.stations.map((s) => s.total), 1);

  const seen = new Int32Array(archive.stations.length);
  for (let i = 0; i < n; i += 1) {
    const stIdx = archive.st[i];
    const station = stIdx >= 0 ? archive.stations[stIdx] : null;
    const lat = station ? station.lat : archive.lat[i];
    const lng = station ? station.lng : archive.lng[i];
    const [x, z] = geo.project(lat, lng);
    const ground = geo.ground(lat, lng);

    const total = station ? Math.max(station.total, 1) : 1;
    const k = stIdx >= 0 ? seen[stIdx]++ / total : rnd();
    // Plume: wide at the base, tapering as it rises. Height reads as abundance.
    const plume = 3 + 16 * (total / maxTotal) ** 0.55;
    const spread = 2.6 * (1 - k) ** 0.7 + 0.25;
    const theta = rnd() * Math.PI * 2;
    const rad = Math.sqrt(rnd()) * spread;

    out.position[i * 3] = x + Math.cos(theta) * rad;
    out.position[i * 3 + 1] = ground + k * plume + rnd() * 0.5;
    out.position[i * 3 + 2] = z + Math.sin(theta) * rad;
    out.size[i] = base.size[i];
  }
  out.color.set(base.color);
  return out;
}

// ---------------------------------------------------------------------------
// ACT 2 — chronos: a 24 hour dial, acoustic inside, camera outside
// ---------------------------------------------------------------------------
const CHRONOS_INNER = 17;
const CHRONOS_OUTER = 27;

export function layoutChronos(ctx: LayoutContext): Layout {
  const { archive, base } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(909);
  const BINS = 144; // ten-minute resolution

  const stack = [new Int32Array(BINS), new Int32Array(BINS)];
  for (let i = 0; i < n; i += 1) {
    const src = archive.src[i];
    const bin = Math.min(BINS - 1, Math.floor(archive.minute[i] / 10));
    const j = stack[src][bin]++;

    const angle = (archive.minute[i] / 1440) * Math.PI * 2 - Math.PI / 2;
    const ring = src === 0 ? CHRONOS_INNER : CHRONOS_OUTER;
    const rad = ring + (rnd() - 0.5) * 0.8;

    // The acoustic recorder only listens for ten minutes an hour, so its
    // detections land in 24 tight clusters. Grains spiral outward as they stack
    // — a tuft rather than a needle — and height uses a compressed scale so the
    // dawn burst stays in frame next to the quiet hours.
    const height = j ** 0.62 * 0.3;
    const spiral = Math.sqrt(j) * 0.14;
    const turn = j * 2.39996;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const radialOffset = Math.cos(turn) * spiral;
    const tangentOffset = Math.sin(turn) * spiral;

    out.position[i * 3] = ca * (rad + radialOffset) - sa * tangentOffset;
    out.position[i * 3 + 1] = height + rnd() * 0.08;
    out.position[i * 3 + 2] = sa * (rad + radialOffset) + ca * tangentOffset;
    out.size[i] = base.size[i];
  }
  out.color.set(base.color);
  return out;
}

export const CHRONOS_RINGS = { inner: CHRONOS_INNER, outer: CHRONOS_OUTER };

// ---------------------------------------------------------------------------
// SEASON — the chronos dial extruded through eighty days
// ---------------------------------------------------------------------------
export const SEASON = { radius: 18, height: 56 };

/**
 * Same angular mapping as the dial, so the morph out of act III is a lift
 * rather than a rearrangement: hour around, day up the axis.
 *
 * The shape is an honest picture of the survey rather than of the wildlife.
 * The cameras ran all summer and scatter thinly up the whole cylinder; the
 * microphones ran for a fortnight and pack the top into a dense collar.
 */
export function layoutSeason(ctx: LayoutContext): Layout {
  const { archive, base } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(2408);
  const maxDay = Math.max(archive.meta.window.days - 1, 1);

  for (let i = 0; i < n; i += 1) {
    const angle = (archive.minute[i] / 1440) * Math.PI * 2 - Math.PI / 2;
    // Acoustic inside, camera outside — the same reading as the dial.
    const radius = SEASON.radius + (archive.src[i] === 0 ? -2.2 : 2.2) + (rnd() - 0.5) * 1.4;

    out.position[i * 3] = Math.cos(angle) * radius;
    out.position[i * 3 + 1] = (archive.day[i] / maxDay) * SEASON.height - SEASON.height / 2;
    out.position[i * 3 + 2] = Math.sin(angle) * radius;
    out.size[i] = base.size[i];
  }
  out.color.set(base.color);
  return out;
}

// ---------------------------------------------------------------------------
// TAIL — rank abundance, built out of the detections themselves
// ---------------------------------------------------------------------------
export const TAIL = { near: 22, far: -74, height: 24 };

/**
 * One column per species, ordered by abundance, each column made of that
 * species' own grains. The height is log-scaled or the 255 of the commonest
 * would flatten the 33 species heard exactly once into the floor — and those
 * are the point.
 *
 * The rank axis runs away from the camera rather than across it. A row 136
 * columns wide will not fit a frame that also holds a readout panel, and
 * perspective does something the flat version cannot: the rare end genuinely
 * recedes, trailing off toward a vanishing point.
 */
export function layoutTail(ctx: LayoutContext): Layout {
  const { archive, base } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(6231);

  const total = archive.species.length;
  const maxCount = Math.max(...archive.species.map((s) => s.count), 1);
  const seen = new Int32Array(total);

  for (let i = 0; i < n; i += 1) {
    const spId = archive.sp[i];
    const species = archive.species[spId];
    const rank = species.rank;

    const z = tailColumn(archive, rank);
    const bar = 1.5 + TAIL.height * (Math.log(species.count + 1) / Math.log(maxCount + 1));
    const k = seen[spId]++ / Math.max(species.count, 1);

    out.position[i * 3] = (rnd() - 0.5) * 1.1;
    out.position[i * 3 + 1] = k * bar - 6;
    out.position[i * 3 + 2] = z + (rnd() - 0.5) * 0.3;
    out.size[i] = base.size[i];
  }
  out.color.set(base.color);
  return out;
}

/** Depth of a species' column along the rank axis, for labels and guides. */
export function tailColumn(archive: Archive, rank: number): number {
  const t = rank / Math.max(archive.species.length - 1, 1);
  return TAIL.near + t * (TAIL.far - TAIL.near);
}

// ---------------------------------------------------------------------------
// ACT 3 — voices: 136 species as a spiral galaxy, common at the core
// ---------------------------------------------------------------------------
export function speciesNodes(archive: Archive): Float32Array {
  const nodes = new Float32Array(archive.species.length * 3);
  const total = archive.species.length;
  for (let r = 0; r < total; r += 1) {
    const t = r / total;
    const radius = 5 + 31 * Math.sqrt(t);
    const angle = r * GOLDEN_ANGLE * 1.9;
    nodes[r * 3] = Math.cos(angle) * radius;
    nodes[r * 3 + 1] = Math.sin(t * Math.PI * 2.2) * 3.4 * (0.25 + t);
    nodes[r * 3 + 2] = Math.sin(angle) * radius;
  }
  return nodes;
}

export function layoutVoices(ctx: LayoutContext): Layout {
  const { archive, base } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(7717);
  const nodes = speciesNodes(archive);

  for (let i = 0; i < n; i += 1) {
    const spId = archive.sp[i];
    const sp = archive.species[spId];
    // Cluster radius grows slowly with abundance so common species read as mass.
    const cloud = 0.8 + Math.log(sp.count + 1) * 0.55;
    const u = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const rad = Math.cbrt(rnd()) * cloud;
    const s = Math.sqrt(Math.max(0, 1 - u * u));

    out.position[i * 3] = nodes[spId * 3] + Math.cos(phi) * s * rad;
    out.position[i * 3 + 1] = nodes[spId * 3 + 1] + u * rad * 0.75;
    out.position[i * 3 + 2] = nodes[spId * 3 + 2] + Math.sin(phi) * s * rad;
    out.size[i] = base.size[i] * 1.05;
  }
  out.color.set(base.color);
  return out;
}

// ---------------------------------------------------------------------------
// ACT 4 — stations: helical columns of light, silenced ones burning down
// ---------------------------------------------------------------------------
export function layoutStations(ctx: LayoutContext): Layout {
  const { archive, base, geo } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(3313);
  const maxTotal = Math.max(...archive.stations.map((s) => s.total), 1);
  const seen = new Int32Array(archive.stations.length);
  const ash = new Color(PALETTE.ash);
  const wine = new Color(PALETTE.wine);
  const c = new Color();

  for (let i = 0; i < n; i += 1) {
    const stIdx = archive.st[i];
    const station = stIdx >= 0 ? archive.stations[stIdx] : null;
    if (!station) {
      // Detections without a station drift as faint dust below the columns.
      out.position[i * 3] = (rnd() - 0.5) * 70;
      out.position[i * 3 + 1] = -6 - rnd() * 4;
      out.position[i * 3 + 2] = (rnd() - 0.5) * 70;
      out.size[i] = base.size[i] * 0.5;
      c.fromArray(base.color, i * 3).lerp(ash, 0.7).toArray(out.color, i * 3);
      continue;
    }

    const [x, z] = geo.project(station.lat, station.lng);
    const total = Math.max(station.total, 1);
    const j = seen[stIdx]++;
    const k = j / total;
    const height = 5 + 17 * (total / maxTotal) ** 0.5;
    const twist = j * 0.34;
    const rad = 0.55 + Math.sin(k * Math.PI) * 0.85;

    out.position[i * 3] = x + Math.cos(twist) * rad;
    out.position[i * 3 + 1] = geo.ground(station.lat, station.lng) + k * height;
    out.position[i * 3 + 2] = z + Math.sin(twist) * rad;
    out.size[i] = base.size[i];

    c.fromArray(base.color, i * 3);
    if (station.status !== 'active') {
      // Lost equipment: the upper part of the column fades to ember and ash.
      c.lerp(wine, 0.35 * k).lerp(ash, 0.5 * k);
    }
    c.toArray(out.color, i * 3);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ACT 5 — index: four land uses as blooms, sized by their Shannon index
// ---------------------------------------------------------------------------
export const SITE_ACCENT: Record<string, string> = {
  Purcari: PALETTE.gold,
  'Organic vineyard': PALETTE.moss,
  'Hotel park': PALETTE.cyan,
  'Peri-urban area': PALETTE.ash,
};

export const SITE_RU: Record<string, string> = {
  Purcari: 'Purcari',
  'Organic vineyard': 'Органический виноградник',
  'Hotel park': 'Парк отеля',
  'Peri-urban area': 'Пригородная зона',
};

/** A bloom's outer reach in scene units, driven by its Shannon index. */
export const BLOOM_REACH = (shannon: number) => 3.2 + shannon * 3;

export function bloomSites(archive: Archive) {
  const rows = archive.diversity.filter((d) => d.filter === 'all species');
  const order = ['Purcari', 'Organic vineyard', 'Hotel park', 'Peri-urban area'];
  return order
    .map((site) => rows.find((r) => r.site === site))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((row, i, all) => ({
      ...row,
      center: [(i - (all.length - 1) / 2) * 17, 0, 0] as [number, number, number],
      accent: SITE_ACCENT[row.site] ?? PALETTE.bone,
    }));
}

export function layoutBloom(ctx: LayoutContext): Layout {
  const { archive, base } = ctx;
  const n = archive.count;
  const out = empty(n);
  const rnd = mulberry32(5150);
  const sites = bloomSites(archive);
  const c = new Color();
  const accents = sites.map((s) => new Color(s.accent));

  // Particles are dealt to the sites in proportion to recorded richness, so the
  // mass of each bloom is itself a reading of the data.
  const weights = sites.map((s) => s.richness);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const quota = weights.map((w) => Math.round((w / wsum) * n));

  let site = 0;
  let used = 0;
  for (let i = 0; i < n; i += 1) {
    while (site < sites.length - 1 && used >= quota[site]) {
      site += 1;
      used = 0;
    }
    used += 1;
    const s = sites[site];

    const petals = Math.max(4, Math.round(s.richness / 2));
    const reach = BLOOM_REACH(s.shannon);
    const turbulence = 1 - s.simpson;

    const t = rnd();
    const theta = t * Math.PI * 2 * 6 + rnd() * 0.35;
    const phi = Math.acos(1 - 2 * rnd());
    const rose = 0.45 + 0.55 * Math.abs(Math.cos((petals * theta) / 2));
    // Biased outward: a hollow-ish shell reads as a flower, an even fill reads
    // as fog.
    const rad = reach * rose * (0.5 + 0.5 * Math.cbrt(rnd()));

    out.position[i * 3] = s.center[0] + Math.sin(phi) * Math.cos(theta) * rad;
    out.position[i * 3 + 1] =
      s.center[1] + Math.cos(phi) * rad * (0.5 + turbulence * 1.0) + (rnd() - 0.5) * turbulence * 3;
    out.position[i * 3 + 2] = s.center[2] + Math.sin(phi) * Math.sin(theta) * rad;
    out.size[i] = base.size[i] * 0.95;

    c.fromArray(base.color, i * 3).lerp(accents[site], 0.65).toArray(out.color, i * 3);
  }
  return out;
}
