import raw from './passages.json';
import { solarDay, type SolarDay } from './solar';

export type PassageKind = 'mammal' | 'bird' | 'domestic';

export interface PassageCamera {
  code: string;
  lon: number;
  lat: number;
  /** Metres east of the survey centroid, on the acoustic atlas' own projection. */
  x: number;
  /** Metres south of it. */
  z: number;
  total: number;
  species: number;
  hourly: number[];
  nightShare: number;
}

export interface PassageSpecies {
  en: string;
  fr: string;
  scientific: string;
  kind: PassageKind;
  count: number;
  hourly: number[];
  /** Indices into `passages.cameras`. */
  cameras: number[];
  nightShare: number;
  firstDay: number;
  lastDay: number;
}

export interface PassageDay {
  date: string;
  count: number;
  species: number;
  night: number;
}

interface PassagesFile {
  meta: {
    total: number;
    records: number;
    speciesCount: number;
    wildSpeciesCount: number;
    cameraCount: number;
    start: string;
    end: string;
    dayCount: number;
    activeDays: number;
    nightShare: number;
    origin: { lon: number; lat: number };
    source: string;
    generatedFrom: string;
  };
  hourly: number[];
  cameras: PassageCamera[];
  species: PassageSpecies[];
  days: PassageDay[];
  events: {
    species: number[];
    camera: number[];
    day: number[];
    /** Minute of the local day, 0..1439. */
    minute: number[];
    /** Animals in the record — fourteen of them carry more than one. */
    count: number[];
  };
}

export const passages = raw as unknown as PassagesFile;

/** Every record, as typed arrays. 350 of them, so the whole set is one buffer. */
export const passageEvents = {
  count: passages.events.day.length,
  species: Uint8Array.from(passages.events.species),
  camera: Uint8Array.from(passages.events.camera),
  day: Uint8Array.from(passages.events.day),
  minute: Uint16Array.from(passages.events.minute),
  animals: Uint8Array.from(passages.events.count),
};

/**
 * Sunrise and sunset for every night of the deployment, at the survey origin.
 *
 * Eighty days of trigonometry is nothing, so it runs at module load rather than
 * being baked into the JSON — which keeps the night band in step if the export
 * is ever rebuilt over a different window.
 */
export const passageSolar: SolarDay[] = passages.days.map(day =>
  solarDay(day.date, passages.meta.origin.lat, passages.meta.origin.lon)
);

const monthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const shortFormatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

export function formatPassageDate(date: string, long = false): string {
  const d = new Date(`${date}T12:00:00Z`);
  return (long ? monthFormatter : shortFormatter).format(d).replace('.', '');
}

export function kindLabel(kind: PassageKind): string {
  return { mammal: 'Mammifères', bird: 'Oiseaux', domestic: 'Domestiques' }[kind];
}

/**
 * One hue per kind, matching Chapter V exactly — the two chapters read the same
 * camera-trap survey, and an animal that is wine-red in one of them cannot be
 * gold in the other.
 */
export function kindAccent(kind: PassageKind): string {
  return { mammal: '#8b1538', bird: '#d4af37', domestic: '#7d7a86' }[kind];
}
