import type { VineyardAdvice, VineyardReviewSummary } from '@/types';

/**
 * Curated review and agronomic recommendations derived from the final
 * 12-month biodiversity monitoring report for Château Purcari
 * (Every1Counts — "Analysis of data collected over 12 months",
 * collection period 29 May 2025 → 28 May 2026, 365 days).
 *
 * Every item below is grounded in a specific figure or finding from that
 * report so the advice can be traced back to the evidence.
 */

export const vineyardReviewSummary: VineyardReviewSummary = {
  headline: 'A biodiversity-rich vineyard worth protecting',
  verdict:
    'Across both monitoring methods Purcari ranks among the very top sites measured. ' +
    'Camera traps recorded 35 terrestrial species and acoustic recorders detected 195 bird ' +
    'species, with balanced, well-structured communities. The estate already hosts a functional ' +
    'predator–prey web and several species of conservation concern. The goal of the works below ' +
    'is to protect this rich core, lift the poorer edges, and keep the vineyard a refuge for ' +
    'farmland wildlife while sustaining production.',
  highlights: [
    'Shannon H′ = 2.26 and Pielou evenness J = 0.70 (cameras) — moderate-to-high diversity, no single dominant species.',
    'European Turtle Dove (globally Vulnerable) is the most-detected bird acoustically (1,428 detections) — a flagship to protect.',
    'Only 42.9% of terrestrial activity is nocturnal (below the 70% disturbance threshold) — diurnal tranquility is largely preserved.',
    'Dawn chorus averages 6.0 species/morning across 349 mornings — "the site is alive and little disturbed at dawn".',
    'Diversity is spatially structured: a stable rich core (H9, H1, H13, H11, H14) versus consistently poorer edges (H4, H6, H-Château).',
  ],
  kpis: [
    { label: 'Terrestrial species', value: '35', hint: 'Camera traps, 12 months' },
    { label: 'Bird species', value: '195', hint: 'Acoustic, BirdNet conf. >0.8' },
    { label: 'Shannon H′', value: '2.26', hint: 'Camera community diversity' },
    { label: 'Nocturnal activity', value: '42.9%', hint: 'Below 70% = low disturbance' },
    { label: 'Species of concern', value: '5', hint: 'IUCN / national Red List taxa' },
    { label: 'Dawn chorus', value: '6.0 sp', hint: 'Species heard per morning' },
  ],
};

export const vineyardAdvice: VineyardAdvice[] = [
  {
    id: 'protect-core',
    title: 'Protect the biodiversity core zones',
    icon: '🛡️',
    category: 'habitat',
    priority: 'high',
    color: '#166534',
    summary:
      'Hotspots H9, H1 and H13 (both methods), reinforced by H11 and H14 on cameras, form a stable ' +
      'high-diversity core. They act as reference biodiversity zones and should be shielded from ' +
      'intensification.',
    evidence: [
      'Spatial analysis names H9, H1, H13 as the robust high-diversity core across both cameras and acoustics.',
      'Jaccard clustering shows H1/H10/H11/H12/H13/H14 sharing a large part of their species (H11–H14 = 0.69).',
      'Kruskal-Wallis ranks H11, H14, H13, H1, H9 in the top diversity group (letter A) for cameras.',
    ],
    zones: ['H9', 'H1', 'H13', 'H11', 'H14'],
    works: [
      { action: 'Delineate the wooded edges around these hotspots as no-herbicide conservation buffers.', season: 'winter', effort: 'low' },
      { action: 'Keep permanent grass cover and postpone mowing on the inter-rows adjacent to these zones.', season: 'spring', effort: 'low' },
      { action: 'Avoid new access tracks, drainage or grubbing works inside the buffer.', season: 'year-round', effort: 'low' },
    ],
    benefit:
      'Maintains the estate’s ecological reference areas and the source populations that recolonise the rest of the vineyard.',
  },
  {
    id: 'lift-periphery',
    title: 'Reconnect and enrich the poor edges',
    icon: '🌱',
    category: 'habitat',
    priority: 'high',
    color: '#15803d',
    summary:
      'H4, H6 and H-Château are consistently the poorest, most compositionally singular sites — likely ' +
      'fragmented or infrastructure-influenced. Adding structure here is the biggest lever for gains.',
    evidence: [
      'H4 and H6 are the robust low-diversity periphery across both methods.',
      'H-Château, H4 and H7 are compositional outliers, sharing very few species with the rest.',
      'Report: these edges are "ecologically simplified... likely fragmented or infrastructure-influenced".',
    ],
    zones: ['H4', 'H6', 'H-Château'],
    works: [
      { action: 'Plant native hedgerows / shrub corridors linking the poor edges to the core zones.', season: 'autumn', effort: 'high' },
      { action: 'Sow multi-species flower strips between rows to feed pollinators and seed-eating birds.', season: 'spring', effort: 'medium' },
      { action: 'Install nest boxes, insect hotels and beetle banks to add micro-habitat.', season: 'winter', effort: 'medium' },
    ],
    benefit:
      'Raises diversity where it is lowest and stitches isolated fragments into a connected habitat mosaic.',
  },
  {
    id: 'turtle-dove',
    title: 'Safeguard the Vulnerable Turtle Dove',
    icon: '🕊️',
    category: 'fauna',
    priority: 'high',
    color: '#b91c1c',
    summary:
      'The European Turtle Dove — globally Vulnerable (IUCN) — is the single most-detected bird on site. ' +
      'Purcari is a genuine refuge for a declining farmland species, and simple measures keep it that way.',
    evidence: [
      '1,428 acoustic detections of Streptopelia turtur, world status VU — Vulnerable.',
      'A migratory farmland bird that has declined strongly across Europe.',
      'Report highlights its presence as the "conservation relevance" of the site.',
    ],
    zones: ['Site-wide', 'Hedgerows', 'Fallow margins'],
    works: [
      { action: 'Keep seed-rich weedy strips and fallow patches for summer feeding.', season: 'summer', effort: 'medium' },
      { action: 'Do not cut hedges or scrub during the breeding season (May–August).', season: 'summer', effort: 'low' },
      { action: 'Maintain shallow water points / mud puddles for drinking.', season: 'spring', effort: 'low' },
      { action: 'Minimise herbicide near nesting hedgerows to protect seed food supply.', season: 'year-round', effort: 'low' },
    ],
    benefit:
      'Supports breeding of a globally Vulnerable species and strengthens Purcari’s conservation and ESG credentials.',
  },
  {
    id: 'water-otter',
    title: 'Protect water courses for the otter',
    icon: '🦦',
    category: 'water',
    priority: 'medium',
    color: '#0369a1',
    summary:
      'The Eurasian otter (Lutra lutra, Near Threatened) was recorded on site — a strong indicator of ' +
      'healthy water. Protecting riparian buffers and keeping spray out of watercourses maintains it.',
    evidence: [
      '3 detections of Lutra lutra, world status NT — Near Threatened.',
      'Otter presence signals good water quality and functional aquatic habitat.',
      'Estate already runs subsurface drip irrigation (15–30% water savings), which limits runoff.',
    ],
    zones: ['Riparian corridors', 'Reservoirs', 'Drainage lines'],
    works: [
      { action: 'Keep vegetated buffer strips uncultivated along all water courses and ponds.', season: 'year-round', effort: 'low' },
      { action: 'Prevent phytosanitary runoff: respect no-spray buffers near water and manage slopes.', season: 'summer', effort: 'medium' },
      { action: 'Continue expanding subsurface drip to further cut runoff and erosion.', season: 'spring', effort: 'high' },
    ],
    benefit:
      'Preserves aquatic habitat quality and the otter as a top-of-web bioindicator of clean water.',
  },
  {
    id: 'wild-boar',
    title: 'Manage wild boar damage risk',
    icon: '🐗',
    category: 'fauna',
    priority: 'medium',
    color: '#92400e',
    summary:
      'Wild boar are regularly present (102 detections). They contribute to the trophic web but can ' +
      'damage vines, fruit and soil — worth watching where the vineyard meets the woods (H14, H7).',
    evidence: [
      '102 Eurasian Wild Pig detections on camera over the year.',
      'H14 and H7 sit on the wooded south-east edge where boar pressure concentrates.',
      'Both predators and herbivores present — a functional but pressure-bearing system.',
    ],
    zones: ['H14', 'H7', 'Wood-edge parcels'],
    works: [
      { action: 'Monitor damage on wood-edge parcels near harvest and log incidents.', season: 'autumn', effort: 'low' },
      { action: 'Deploy targeted electric fencing on the most vulnerable parcels before véraison.', season: 'summer', effort: 'high' },
      { action: 'Remove attractants (fallen fruit, spilled pomace) from field margins.', season: 'autumn', effort: 'low' },
    ],
    benefit:
      'Limits crop and soil damage while keeping boar as part of the ecosystem rather than eradicating them.',
  },
  {
    id: 'phytosanitary',
    title: 'Keep phytosanitary pressure low',
    icon: '🧪',
    category: 'phytosanitary',
    priority: 'high',
    color: '#7c3aed',
    summary:
      'The rich dawn chorus and low nocturnal disturbance indicate a lightly-stressed system. Continuing ' +
      'and extending the UV-C and biocontrol programme protects that signal.',
    evidence: [
      'UV-C technology already delivers a 40% reduction in phytosanitary treatments.',
      'Dawn chorus of 6.0 species/morning — "rich chorus, the site is alive and little disturbed".',
      'Only 42.9% nocturnal activity, below the 70% threshold that signals altered tranquility.',
    ],
    zones: ['Site-wide', '25 ha organic conversion'],
    works: [
      { action: 'Extend UV-C treatment coverage to more parcels beyond the current programme.', season: 'spring', effort: 'high' },
      { action: 'Use pheromone mating disruption for grape moths instead of broad-spectrum insecticide.', season: 'summer', effort: 'medium' },
      { action: 'Reduce copper/sulphur loading where disease pressure allows; favour biocontrol.', season: 'summer', effort: 'medium' },
    ],
    benefit:
      'Sustains bird and invertebrate abundance, and builds toward the 25 ha organic-conversion goal.',
  },
  {
    id: 'mowing-regime',
    title: 'Adopt a wildlife-friendly mowing regime',
    icon: '🌾',
    category: 'soil-cover',
    priority: 'medium',
    color: '#4d7c0f',
    summary:
      'Ground-active species dominate the camera data — pheasant, brown hare — alongside grass-nesting ' +
      'birds and invertebrates. How and when the inter-rows are mown directly affects them.',
    evidence: [
      'Common Pheasant (1,171) and Brown Hare (818) are the two most-detected camera species.',
      'Estate already practices grass seeding and reintegrates vine residues into soils.',
      'Wildlife activity is continuous across 24h — typical of a rural agro-forestry mosaic.',
    ],
    zones: ['Inter-rows', 'Grassed alleys', 'Field margins'],
    works: [
      { action: 'Mow alternate inter-rows, leaving refuge strips of standing cover.', season: 'spring', effort: 'low' },
      { action: 'Delay first mowing until after peak ground-nesting (late spring).', season: 'spring', effort: 'low' },
      { action: 'Mow from the centre outward so animals can escape to the edges.', season: 'summer', effort: 'low' },
    ],
    benefit:
      'Protects hares, ground-nesting birds and pollinators while keeping the cover-crop agronomy intact.',
  },
  {
    id: 'human-pressure',
    title: 'Ease human pressure on the diurnal edges',
    icon: '🚦',
    category: 'fauna',
    priority: 'low',
    color: '#0891b2',
    summary:
      'H7, H-Château and H4 show strong daytime dominance (>80% diurnal). This can reflect open habitat ' +
      'but also human/vehicle activity that pushes wildlife away — small changes reduce that pressure.',
    evidence: [
      'Day/night split: H7 83.3%, H-Château 85.7%, H4 89.7% diurnal detections.',
      'Report notes human pressure can reinforce diurnality at edge sites.',
      'These sites are also the compositional outliers with the fewest shared species.',
    ],
    zones: ['H7', 'H-Château', 'H4'],
    works: [
      { action: 'Concentrate machinery passes into set time windows to leave quiet periods.', season: 'summer', effort: 'low' },
      { action: 'Add screening vegetation between tracks/buildings and adjacent parcels.', season: 'autumn', effort: 'medium' },
      { action: 'Reduce or shield night lighting near the château and access roads.', season: 'year-round', effort: 'low' },
    ],
    benefit:
      'Restores usable habitat and nocturnal access for wary species at the estate’s busiest edges.',
  },
  {
    id: 'monitoring',
    title: 'Secure and continue the monitoring network',
    icon: '📷',
    category: 'monitoring',
    priority: 'medium',
    color: '#334155',
    summary:
      'Equipment loss and sensor failures interrupted data collection. A secured, continuous network ' +
      'turns this baseline into a multi-year trend and underpins organic / regenerative certification.',
    evidence: [
      'Repeated "equipment disappearance" events and an out-of-order acoustic sensor at H9 (from 17.03.26).',
      'Monitoring was "not continuous", with active hotspots swinging between 6 and 10.',
      '12 distinct hotspots surveyed but only after relocations from the original 10.',
    ],
    zones: ['All hotspots', 'Core zones first'],
    works: [
      { action: 'Fit anti-theft mounts and discreet placement, prioritising the core hotspots.', season: 'year-round', effort: 'medium' },
      { action: 'Add redundancy (a spare camera/recorder) at reference zones H9, H1, H13.', season: 'spring', effort: 'medium' },
      { action: 'Schedule regular sensor health checks to catch failures like the H9 recorder early.', season: 'year-round', effort: 'low' },
    ],
    benefit:
      'Produces a reliable year-on-year biodiversity trend and evidence base for certification and ESG reporting.',
  },
];
