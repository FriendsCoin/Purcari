/**
 * The ring model for "The Unseen" — the layout of the figure, kept beside the
 * scene rather than inside it so the chapter's own legend can list exactly the
 * rings the scene draws, in the same order, without importing the component.
 */

import type { InstallationData } from '../core/types';

/** Twelve stations plus the estate ring. */
export const MAX_RINGS = 16;

const INNER_RADIUS = 1.35;
const RING_STEP = 0.245;
/** The estate's own ring stands clear of the station rings. */
const ESTATE_GAP = 0.55;

export interface RingLayout {
  id: string;
  label: string;
  /** Species actually recorded. */
  observed: number;
  /** Chao1 estimate of what is there. */
  estimated: number;
  /** observed ÷ estimated, 0..1 — how far round the ring closes. */
  completeness: number;
  radius: number;
  /** True for the ring that is the whole estate rather than one station. */
  estate: boolean;
}

/**
 * Rings, least complete innermost.
 *
 * The order is the finding: reading outward is reading from the least-counted
 * ground to the best-counted, and the estate ring closes furthest of all.
 */
export function buildRings(data: InstallationData): RingLayout[] {
  const stations = data.sites
    .map(site => ({
      id: site.id,
      label: site.label,
      observed: site.richness,
      estimated: site.chao1,
      completeness: Math.min(1, site.richness / Math.max(1, site.chao1)),
      radius: 0,
      estate: false,
    }))
    .sort((a, b) => a.completeness - b.completeness)
    .slice(0, MAX_RINGS - 1);

  stations.forEach((ring, i) => {
    ring.radius = INNER_RADIUS + i * RING_STEP;
  });

  const estate: RingLayout = {
    id: 'ESTATE',
    label: 'The whole estate',
    observed: data.meta.totalSpecies,
    estimated: data.meta.chao1,
    completeness: Math.min(1, data.meta.totalSpecies / Math.max(1, data.meta.chao1)),
    radius: INNER_RADIUS + (stations.length - 1) * RING_STEP + ESTATE_GAP,
    estate: true,
  };

  return [...stations, estate];
}

