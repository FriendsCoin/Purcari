import raw from './status.json';

export type Tier = 'CR' | 'EN' | 'VU' | 'NT';

export interface StatusSpecies {
  fr: string;
  scientific: string;
  kind: 'bird' | 'mammal';
  /** Which of the two surveys recorded it. */
  survey: 'acoustic' | 'camera';
  /** Category on Moldova's own list, when the transcription carries it. */
  national: { category: Tier; where: string } | null;
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

interface StatusFile {
  meta: {
    generatedFrom: string;
    national: { title: string; transcribedFrom: string; retrieved: string; note: string };
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
