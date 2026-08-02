import raw from './atlas.json';

export interface AtlasMeta {
  total: number;
  speciesCount: number;
  stationCount: number;
  start: string;
  end: string;
  nightShare: number;
  origin: { lon: number; lat: number };
  source: string;
  generatedFrom: string;
}

export interface AtlasStation {
  id: number;
  code: string;
  lon: number;
  lat: number;
  /** Metres east of the survey centroid. */
  x: number;
  /** Metres south of the survey centroid. */
  z: number;
  total: number;
  species: number;
  hourly: number[];
}

export interface AtlasSpecies {
  name: string;
  guild: string;
  count: number;
  hourly: number[];
  stations: number[];
  firstDay: number;
  lastDay: number;
  /** Share of detections between 21:00 and 05:00 local. */
  nocturnality: number;
}

export interface AtlasDay {
  date: string;
  count: number;
  species: number;
  night: number;
}

export interface Atlas {
  meta: AtlasMeta;
  guilds: { id: string; label: string; count: number }[];
  hourly: number[];
  stations: AtlasStation[];
  species: AtlasSpecies[];
  days: AtlasDay[];
  points: {
    station: number[];
    species: number[];
    /** Minute of the local day, 0..1439. */
    minute: number[];
    /** Index into `days`. */
    day: number[];
  };
}

export const atlas = raw as unknown as Atlas;

/** Detections, as typed arrays — every scene builds its buffers from these. */
export const points = {
  count: atlas.points.station.length,
  station: Uint8Array.from(atlas.points.station),
  species: Uint8Array.from(atlas.points.species),
  minute: Uint16Array.from(atlas.points.minute),
  day: Uint8Array.from(atlas.points.day),
};

export const maxHourly = Math.max(...atlas.hourly);
export const maxDaily = Math.max(...atlas.days.map(d => d.count));
export const maxStationTotal = Math.max(...atlas.stations.map(s => s.total));

/** Extent of the survey area in metres, used to normalise station positions. */
export const surveyExtent = (() => {
  const xs = atlas.stations.map(s => s.x);
  const zs = atlas.stations.map(s => s.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  };
})();

/** Station positions normalised into a scene-unit box, keeping the real aspect ratio. */
export function stationScenePosition(station: AtlasStation, spread: number): [number, number] {
  const scale = spread / Math.max(surveyExtent.width, surveyExtent.depth);
  return [(station.x - surveyExtent.centerX) * scale, (station.z - surveyExtent.centerZ) * scale];
}

const dayFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

export function formatDay(date: string): string {
  // Parsed as UTC then read back in UTC, so the label never slips a day on a
  // kiosk configured for a different timezone than the recorder.
  const d = new Date(`${date}T12:00:00Z`);
  return dayFormatter.format(d).replace('.', '');
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Species active at a given hour, most abundant first. */
export function speciesAtHour(hour: number, limit = 6): AtlasSpecies[] {
  return atlas.species
    .filter(s => s.hourly[hour] > 0)
    .sort((a, b) => b.hourly[hour] - a.hourly[hour])
    .slice(0, limit);
}

/** Species recorded at a given station, most abundant first. */
export function speciesAtStation(stationId: number, limit = 6): AtlasSpecies[] {
  return atlas.species.filter(s => s.stations.includes(stationId)).slice(0, limit);
}

/** Peak hour of the dawn chorus. */
export const peakHour = atlas.hourly.indexOf(maxHourly);

/** 24 values in 0..1, for sparklines. */
export function normalisedHourly(hourly: number[]): number[] {
  const max = Math.max(...hourly, 1);
  return hourly.map(v => v / max);
}
