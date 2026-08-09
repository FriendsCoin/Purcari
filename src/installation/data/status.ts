import raw from './status.json';

export type Tier = 'CR' | 'EN' | 'VU' | 'NT';

export interface StatusSpecies {
  fr: string;
  scientific: string;
  kind: 'bird' | 'mammal';
  /** Which of the two surveys recorded it. */
  survey: 'acoustic' | 'camera';
  /** Category on Moldova's own list, when the transcription carries it. */
  national: { category: Tier; where: string; whereFr: string | null } | null;
  /** Global IUCN category, when it is worse than least concern. */
  global: Tier | null;
  globalLabel: string | null;
  count: number;
  hourly: number[];
  /** Station or camera codes that recorded it. */
  stations: string[];
  firstDay: number;
  lastDay: number;
  nocturnality: number;
  /**
   * BirdNET scores behind the identification. Null for a camera record, which a
   * person identified from a photograph — there is no model score to report, and
   * pretending otherwise would be the one dishonest thing this chapter could do.
   */
  confidence: { n: number; min: number; median: number; max: number } | null;
  /** The worst category it carries, from either list. */
  tier: Tier;
}

/**
 * An entry of the national list as transcribed — whether or not either survey
 * found it. Most of the book is species this estate never recorded, and saying
 * so is the point of showing the whole list.
 */
export interface RedbookEntry {
  /** The name the book gives it, in Romanian. */
  ro: string;
  scientific: string;
  /** The accepted spelling, where the transcription carries a variant. */
  accepted: string | null;
  /** French vernacular name, where Wikidata has one. */
  fr: string | null;
  kind: 'bird' | 'mammal' | null;
  category: Tier;
  /** The book's range note, in Romanian and in French. */
  where: string;
  whereFr: string | null;
  /** True when one of the two surveys recorded it at Purcari. */
  found: boolean;
}

interface StatusFile {
  meta: {
    generatedFrom: string;
    national: {
      title: string;
      transcribedFrom: string;
      retrieved: string;
      note: string;
      names: { endpoint: string; retrieved: string; what: string; note: string };
      counts: Partial<Record<Tier, number>>;
      listed: number;
      found: number;
      uncategorised: number;
    };
    global: { endpoint: string; retrieved: string; what: string; note: string };
    tiers: Tier[];
    confidence: {
      scored: number;
      threshold: number;
      median: number;
      histogram: number[];
      buckets: string[];
    };
    counted: { acousticSpecies: number; cameraSpecies: number; resolved: number };
  };
  species: StatusSpecies[];
  /** The transcribed national list, worst category first. */
  redbook: RedbookEntry[];
}

export const status = raw as unknown as StatusFile;

/**
 * One hue per category, hot to cool as the trouble eases. Deliberately outside
 * the guild palette: this is not what an animal is, it is how close it is to
 * not being here at all.
 */
export const TIER_COLORS: Record<Tier, string> = {
  CR: '#e04a4a',
  EN: '#e08a3c',
  VU: '#d4af37',
  NT: '#6f97a8',
};

export const TIER_LABELS: Record<Tier, string> = {
  CR: 'En danger critique',
  EN: 'En danger',
  VU: 'Vulnérable',
  NT: 'Quasi menacée',
};

/** Species on the national list, worst first. */
export const nationalSpecies = status.species.filter(s => s.national);
