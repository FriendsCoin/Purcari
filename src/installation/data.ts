/**
 * Runtime data layer for the installation.
 *
 * The payload is produced by scripts/build-installation-data.mjs from the raw
 * E1C exports. Here it is widened into typed arrays once, so the render loop
 * never touches plain objects.
 */

import { useEffect, useState } from 'react';
import { FALLBACK_BBOX, makeProjection, type GeoBox, type Projection, type TerrainGrid } from './projection';

/** A polyline or ring straight from OpenStreetMap, in [lat, lng] pairs. */
export interface GeoShape {
  pts: Array<[number, number]>;
  name?: string;
  kind?: string;
  levels?: number;
}

export interface Place {
  lat: number;
  lng: number;
  name: string;
  kind: string;
}

export interface Landscape {
  bbox: GeoBox;
  terrain: TerrainGrid | null;
  buildings: GeoShape[];
  vineyards: GeoShape[];
  wood: GeoShape[];
  scrub: GeoShape[];
  farmland: GeoShape[];
  water: GeoShape[];
  rivers: GeoShape[];
  roads: GeoShape[];
  places: Place[];
  chateau: Place | null;
}

export type SpeciesKind = 'bird' | 'mammal' | 'domestic' | 'unknown';

export interface Species {
  id: number;
  name: string;
  ru: string;
  en: string;
  sci: string;
  kind: SpeciesKind;
  audio: number;
  camera: number;
  count: number;
  rank: number;
  stations: string[];
  iucn: { status: string; note: string } | null;
}

export interface Station {
  id: string;
  plot: string;
  lat: number;
  lng: number;
  alt: number;
  zone: 'core' | 'edge' | 'matrix';
  status: 'active' | 'lost' | 'moved';
  lostAt?: string;
  audio: number;
  camera: number;
  total: number;
  richness: number;
  shannon: number;
  simpson: number;
  top: Array<[number, number]>;
}

export interface DiversityRow {
  site: string;
  filter: string;
  shannon: number;
  simpson: number;
  richness: number;
}

export interface Payload {
  meta: {
    title: string;
    tz: string;
    window: { firstDay: string; lastDay: string; days: number };
    counts: {
      detections: number;
      acoustic: number;
      camera: number;
      species: number;
      birds: number;
      mammals: number;
      stations: number;
      stationsActive: number;
      stationsLost: number;
    };
    shannonOverall: number;
    simpsonOverall: number;
    dutyCycle: { acousticMinutesPerHour: number; cameraContinuous: boolean };
  };
  stations: Station[];
  species: Species[];
  detections: {
    sp: number[];
    st: number[];
    min: number[];
    day: number[];
    src: number[];
    night: number[];
    lat: number[];
    lng: number[];
  };
  hourly: { audio: number[]; camera: number[] };
  daily: Array<{ date: string; audio: number; camera: number }>;
  monthly: Array<{ month: string; richness: number }>;
  diversity: DiversityRow[];
  edges: Array<{ a: number; b: number; w: number }>;
}

/** Payload plus the derived views the render layer works from. */
export interface Archive extends Payload {
  count: number;
  /** Real basemap: DEM relief plus the OSM features around the estate. */
  landscape: Landscape | null;
  projection: Projection;
  /** Per-detection typed views. */
  sp: Uint16Array;
  st: Int8Array;
  minute: Uint16Array;
  day: Uint16Array;
  src: Uint8Array;
  night: Uint8Array;
  /** 0 bird, 1 mammal, 2 domestic, 3 unknown — cheap enough for the shader. */
  kind: Uint8Array;
  lat: Float32Array;
  lng: Float32Array;
  /** Geographic extent, used to normalise coordinates into scene space. */
  bounds: { lat0: number; lat1: number; lng0: number; lng1: number; alt0: number; alt1: number };
  stationIndex: Map<string, number>;
  /** Detection indices grouped by station, then by species — used by layouts. */
  perStation: number[][];
  perSpecies: number[][];
}

export const KIND_CODE: Record<string, number> = { bird: 0, mammal: 1, domestic: 2, unknown: 3 };
export const KIND_LABEL = ['птицы', 'звери', 'домашние', 'не определён'];

function widen(p: Payload, landscape: Landscape | null): Archive {
  const n = p.detections.sp.length;
  const lat = Float32Array.from(p.detections.lat);
  const lng = Float32Array.from(p.detections.lng);

  const perStation: number[][] = p.stations.map(() => []);
  const perSpecies: number[][] = p.species.map(() => []);
  for (let i = 0; i < n; i += 1) {
    const st = p.detections.st[i];
    if (st >= 0) perStation[st].push(i);
    perSpecies[p.detections.sp[i]].push(i);
  }

  const alts = p.stations.map((s) => s.alt);

  return {
    ...p,
    count: n,
    landscape,
    projection: makeProjection(landscape?.bbox ?? FALLBACK_BBOX, landscape?.terrain ?? null),
    sp: Uint16Array.from(p.detections.sp),
    st: Int8Array.from(p.detections.st),
    minute: Uint16Array.from(p.detections.min),
    day: Uint16Array.from(p.detections.day),
    src: Uint8Array.from(p.detections.src),
    night: Uint8Array.from(p.detections.night),
    kind: Uint8Array.from(p.detections.sp.map((id) => KIND_CODE[p.species[id]?.kind ?? 'unknown'])),
    lat,
    lng,
    bounds: {
      lat0: Math.min(...lat),
      lat1: Math.max(...lat),
      lng0: Math.min(...lng),
      lng1: Math.max(...lng),
      alt0: Math.min(...alts),
      alt1: Math.max(...alts),
    },
    stationIndex: new Map(p.stations.map((s, i) => [s.id, i])),
    perStation,
    perSpecies,
  };
}

export function useArchive(): { archive: Archive | null; error: string | null } {
  const [archive, setArchive] = useState<Archive | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    // The single-file build inlines both payloads into the page, so there is
    // nothing to fetch and the piece works from a file:// URL or a sandbox.
    const inlined = (globalThis as { __PURCARI__?: { installation: Payload; landscape: Landscape | null } })
      .__PURCARI__;
    if (inlined) {
      setArchive(widen(inlined.installation, inlined.landscape));
      return undefined;
    }

    const grab = async (file: string) => {
      const r = await fetch(`${import.meta.env.BASE_URL}${file}`);
      if (!r.ok) throw new Error(`${file}: ${r.status} ${r.statusText}`);
      return r.json();
    };

    Promise.all([
      grab('installation.json'),
      // The basemap is a bonus, not a requirement — the piece still reads
      // without it, so a missing landscape must not block the archive.
      grab('landscape.json').catch(() => null),
    ])
      .then(([payload, landscape]: [Payload, Landscape | null]) => {
        if (alive) setArchive(widen(payload, landscape));
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });

    return () => {
      alive = false;
    };
  }, []);

  return { archive, error };
}

export const MINUTES_PER_DAY = 1440;

/** Calendar date of a day offset, counted from the archive's first day. */
export function dateOf(archive: Archive, day: number): Date {
  const first = Date.parse(`${archive.meta.window.firstDay}T00:00:00Z`);
  return new Date(first + day * 86400000);
}

const RU_DATE = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  timeZone: 'UTC',
});

export interface DetectionDetail {
  index: number;
  species: Species;
  station: Station | null;
  date: string;
  time: string;
  source: 'acoustic' | 'camera';
  night: boolean;
}

/** Everything the inspector card needs about one recorded detection. */
export function describeDetection(archive: Archive, index: number): DetectionDetail {
  const stationIndex = archive.st[index];
  return {
    index,
    species: archive.species[archive.sp[index]],
    station: stationIndex >= 0 ? archive.stations[stationIndex] : null,
    date: RU_DATE.format(dateOf(archive, archive.day[index])),
    time: clock(archive.minute[index]),
    source: archive.src[index] === 0 ? 'acoustic' : 'camera',
    night: archive.night[index] === 1,
  };
}

/** Formats a minute-of-day as HH:MM. */
export function clock(minute: number): string {
  const m = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
