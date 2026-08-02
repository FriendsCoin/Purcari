import type { InstallationData, Site, Species } from './types';

let cache: Promise<InstallationData> | null = null;

export function loadInstallationData(): Promise<InstallationData> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/installation.json`).then((res) => {
      if (!res.ok) throw new Error(`installation.json ${res.status}`);
      return res.json() as Promise<InstallationData>;
    });
  }
  return cache;
}

/* ------------------------------------------------------------------ layout */

/**
 * Project station coordinates into the scene's local space, centred and scaled
 * so the whole estate fits a `radius`-unit disc while keeping true geometry —
 * the constellation is a real map, not a diagram.
 */
export function layoutSites(sites: Site[], radius = 6) {
  const xs = sites.map((s) => s.x);
  const ys = sites.map((s) => s.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const extent = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1,
  );
  const scale = (radius * 2) / extent;
  return sites.map((site) => ({
    site,
    position: [(site.x - cx) * scale, 0, -(site.y - cy) * scale] as [number, number, number],
  }));
}

/* --------------------------------------------------------------- selectors */

/** Species detected at a given station, richest first. */
export function speciesAtSite(data: InstallationData, siteId: string): Species[] {
  return data.species
    .filter((s) => s.sites[siteId] > 0)
    .sort((a, b) => (b.sites[siteId] ?? 0) - (a.sites[siteId] ?? 0));
}

/**
 * How strongly each species is active at a given hour, 0..1 relative to its own
 * daily peak. This is what makes the outdoor piece honest: at 03:00 you see the
 * animals that are genuinely awake at 03:00 on this estate.
 */
export function activityAtHour(species: Species, hour: number): number {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const peak = Math.max(...species.hourly, 1);
  const next = species.hourly[(h + 1) % 24];
  const frac = hour - Math.floor(hour);
  return (species.hourly[h] * (1 - frac) + next * frac) / peak;
}

/** Species awake right now, most active first. */
export function awakeAt(data: InstallationData, hour: number, minimum = 0.12): Species[] {
  return data.species
    .map((s) => ({ s, a: activityAtHour(s, hour) }))
    .filter((e) => e.a >= minimum)
    .sort((a, b) => b.a - a.a)
    .map((e) => e.s);
}

/**
 * Wariness, 0..1 — how readily a species abandons a disturbed place.
 *
 * There is no field-measured flight-initiation distance in the survey, so this
 * composes the three proxies the data does carry: rarity (rare animals are seen
 * where people are not), nocturnality (night activity is avoidance of us), and
 * how few stations the animal tolerates. The outdoor piece uses it to order the
 * return of the fauna — the boldest come back first, the otter comes back last.
 */
export function wariness(species: Species, maxTotal: number, stations: number): number {
  const rarity = 1 - Math.log1p(species.total) / Math.log1p(maxTotal);
  const night = species.nightRatio;
  const restricted = 1 - species.siteCount / stations;
  const w = rarity * 0.5 + night * 0.3 + restricted * 0.2;
  return Math.max(0, Math.min(1, w));
}

/**
 * Species scored for the outdoor piece.
 *
 * Domestic animals are dropped: the piece is about wild animals returning to a
 * place that has gone quiet, and a horse or a farm cat wandering back would
 * quietly undo that. They remain in every count and in the indoor chapters.
 */
export function withWariness(data: InstallationData) {
  const wild = data.species.filter((s) => !s.domestic);
  const maxTotal = Math.max(...wild.map((s) => s.total));
  const stations = data.sites.length;
  return wild.map((species) => ({
    species,
    wariness: wariness(species, maxTotal, stations),
  }));
}

/* ----------------------------------------------------------------- shaping */

export function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map((v) => v / max);
}

/** Log-scaled 0..1, so a 6000-detection pheasant does not erase a 3-detection otter. */
export function logScale(value: number, max: number): number {
  if (max <= 1) return 0;
  return Math.log1p(Math.max(0, value)) / Math.log1p(max);
}

export function sunAt(data: InstallationData, month: number) {
  return data.sun[Math.max(0, Math.min(11, month))] ?? { month: month + 1, sunrise: 6, sunset: 18 };
}

/**
 * Aggregate 53 weekly points to a smooth curve of `samples` values, so phenology
 * reads as a continuous seasonal breath rather than a bar chart.
 */
export function smoothWeekly(
  data: InstallationData,
  key: 'camera' | 'sound' | 'richness',
  samples = 128,
): number[] {
  const raw = data.weekly.map((w) => w[key]);
  if (!raw.length) return new Array(samples).fill(0);
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * (raw.length - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(raw.length - 1, i0 + 1);
    const f = t - i0;
    out.push(raw[i0] * (1 - f) + raw[i1] * f);
  }
  const max = Math.max(...out, 1);
  return out.map((v) => v / max);
}

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
