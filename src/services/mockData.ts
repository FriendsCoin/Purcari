import type { AnalysisData, Detection, Species, Hypothesis, Hotspot } from '@/types';
import { mockProjects } from './mockProjects';

/**
 * Generates mock biodiversity monitoring data for demonstration
 */
export function generateMockData(): {
  analysis: AnalysisData;
  hotspots: Hotspot[];
  projects: typeof mockProjects;
} {
  const detections: Detection[] = [];
  const species: Species[] = [
    { name: 'Red Fox', type: 'mammal', count: 89 },
    { name: 'Roe Deer', type: 'mammal', count: 45 },
    { name: 'European Hare', type: 'mammal', count: 67 },
    { name: 'Wild Boar', type: 'mammal', count: 23 },
    { name: 'Chouette hulotte', type: 'bird', count: 234 },
    { name: 'European Robin', type: 'bird', count: 567 },
    { name: 'Common Blackbird', type: 'bird', count: 892 },
    { name: 'Great Tit', type: 'bird', count: 1203 },
  ];

  let id = 0;
  species.forEach(sp => {
    for (let i = 0; i < sp.count; i++) {
      const monthOffset = Math.floor(i / (sp.count / 3));
      const dayOffset = i % 30;
      const hour =
        sp.type === 'mammal'
          ? (20 + Math.floor(Math.random() * 10)) % 24
          : 5 + Math.floor(Math.random() * 6);

      detections.push({
        id: id++,
        timestamp: new Date(2025, 4 + monthOffset, 1 + dayOffset, hour, 0).toISOString(),
        species: sp.name,
        type: sp.type,
        hotspot_id: Math.floor(Math.random() * 6) + 1,
      });
    }
  });

  const hourlyActivity: Record<number, number> = {};
  const speciesCounts: Record<string, number> = {};
  const typeDistribution: Record<string, number> = {};

  detections.forEach(d => {
    const hour = new Date(d.timestamp).getHours();
    hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
    speciesCounts[d.species] = (speciesCounts[d.species] || 0) + 1;
    typeDistribution[d.type] = (typeDistribution[d.type] || 0) + 1;
  });

  const sorted = Object.entries(speciesCounts).sort((a, b) => a[1] - b[1]);
  const rare = sorted.filter(([, c]) => c < 50);
  const common = sorted.filter(([, c]) => c > 500);

  const mammalHours: Record<number, number> = {};
  detections
    .filter(d => d.type === 'mammal')
    .forEach(d => {
      const h = new Date(d.timestamp).getHours();
      mammalHours[h] = (mammalHours[h] || 0) + 1;
    });

  const nightHours = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  const nightCount = nightHours.reduce((sum, h) => sum + (mammalHours[h] || 0), 0);
  const dayHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const dayCount = dayHours.reduce((sum, h) => sum + (mammalHours[h] || 0), 0);

  const hypotheses: Hypothesis[] = [
    {
      id: 'h1',
      title: 'Water Proximity → Bird Diversity',
      icon: '💧',
      result: 'confirmed',
      confidence: 0.78,
      description:
        'Hotspots closer to water sources exhibit significantly higher bird species diversity',
      methodology:
        'Compared species richness at hotspots within 100m of water vs. those farther away',
      findings: [
        'Near water (< 100m): Average 5.2 species per hotspot',
        'Far from water (≥ 100m): Average 2.8 species per hotspot',
        'Water Source (Hotspot #3): Highest diversity with 2,103 bird detections',
        'Riparian habitats provide critical resources: drinking water, bathing, and insect abundance',
      ],
      implications: [
        'Maintain water access points throughout vineyard',
        'Create artificial water features in dry areas',
        'Protect existing streams and ponds',
        'Monitor water quality as biodiversity indicator',
      ],
      evidence: {
        avgNearWater: '5.2 species',
        avgFarWater: '2.8 species',
        difference: '+85% more diversity',
      },
    },
    {
      id: 'h2',
      title: 'Nocturnal Mammals Avoid Daytime',
      icon: '🌙',
      result: nightCount > dayCount ? 'confirmed' : 'rejected',
      confidence: nightCount / (nightCount + dayCount),
      description:
        'Mammal activity peaks during nighttime hours (20:00-06:00), indicating successful adaptation to human-dominated landscapes',
      methodology:
        'Analyzed temporal distribution of 224 mammal detections across 24-hour period',
      findings: [
        `Night activity (20:00-06:00): ${nightCount} detections`,
        `Day activity (06:00-20:00): ${dayCount} detections`,
        `Ratio: ${(nightCount / dayCount).toFixed(2)}:1 in favor of night`,
        'Red Fox and Wild Boar show strongest nocturnal preference',
        'European Hare active during dawn/dusk (crepuscular)',
      ],
      implications: [
        'Vineyard operations during day minimize disturbance',
        'Night-time corridor preservation critical',
        'Camera trap placement optimized for 21:00-04:00',
        'Consider "dark sky" practices to reduce light pollution',
      ],
      evidence: {
        nightActivity: `${nightCount} detections`,
        dayActivity: `${dayCount} detections`,
        ratio: `${(nightCount / dayCount).toFixed(2)}:1`,
      },
    },
    {
      id: 'h3',
      title: 'May-June Migration Peak',
      icon: '📈',
      result: 'confirmed',
      confidence: 0.65,
      description:
        'Bird detections peak during breeding season (May-June), consistent with migratory and resident breeding patterns',
      methodology: 'Compared monthly detection rates across May, June, July, and August',
      findings: [
        'May-June: 4,523 bird detections (57% of total)',
        'July-August: 3,417 bird detections (43% of total)',
        'Peak activity: First week of June (breeding initiation)',
        'Species richness highest in May (113 species documented)',
        'Decline in August suggests post-breeding dispersal',
      ],
      implications: [
        'Critical nesting period: minimize disturbance May-June',
        'Habitat management timing: avoid pruning/mowing in spring',
        'Future monitoring should extend into September (autumn migration)',
        'Educational tours highlight breeding season spectacle',
      ],
      evidence: {
        mayJune: '4,523 detections',
        julyAug: '3,417 detections',
        peak: 'Early June',
      },
    },
    {
      id: 'h4',
      title: 'Rare Species Prefer Forest Edge',
      icon: '🌲',
      result: 'confirmed',
      confidence: 0.71,
      description:
        'Species with fewer detections (< 50) disproportionately utilize forest edge habitats (Hotspots #2, #5)',
      methodology:
        'Analyzed habitat preferences of 4 rare species vs. common species distribution',
      findings: [
        'Rare species in forest habitats: 71% of detections',
        'Rare species in open habitats: 29% of detections',
        'Wild Boar (23 detections): 87% in Oak Grove/Forest Edge',
        'Roe Deer (45 detections): 78% in woodland areas',
        'Forest edge provides structural complexity and cover',
      ],
      implications: [
        'Preserve existing forest patches and hedgerows',
        'Create wildlife corridors between forest fragments',
        'Avoid clearance of edge habitats',
        'Rare species = indicators of habitat quality',
      ],
      evidence: {
        rareInForest: '71%',
        rareInOpen: '29%',
        habitats: 'Forest Edge, Oak Grove',
      },
    },
    {
      id: 'h5',
      title: 'Temporal Niche Partitioning',
      icon: '⏰',
      result: 'confirmed',
      confidence: 0.58,
      description:
        'Predator-prey pairs (Fox-Hare) show temporal separation, reducing direct encounters',
      methodology:
        'Compared peak activity hours of Red Fox (predator) vs. European Hare (prey)',
      findings: [
        'Red Fox peak: 22:00-02:00 (late night)',
        'European Hare peak: 05:00-07:00 (early morning)',
        'Temporal separation: ~5 hours',
        'Only 12% overlap in activity windows',
        'Suggests behavioral adaptation to reduce predation risk',
      ],
      implications: [
        'Ecosystem functioning: predator-prey dynamics intact',
        'Habitat complexity allows coexistence',
        'Monitoring both species tracks ecosystem health',
        'Educational value: illustrate ecological interactions',
      ],
      evidence: {
        foxPeak: '22:00-02:00',
        harePeak: '05:00-07:00',
        separation: '5 hours',
      },
    },
  ];

  const hotspots: Hotspot[] = [
    {
      id: 1,
      name: 'North Vineyard',
      lat: 46.5275,
      lng: 29.8569,
      x: 1,
      y: 1,
      color: 'from-green-500 to-emerald-500',
      detections: 234,
      species: 12,
      description: 'Main vineyard area with grape cultivation',
    },
    {
      id: 2,
      name: 'Forest Edge',
      lat: 46.5265,
      lng: 29.8559,
      x: 0,
      y: 1,
      color: 'from-green-600 to-green-700',
      detections: 189,
      species: 15,
      description: 'Transition zone between forest and vineyard',
    },
    {
      id: 3,
      name: 'Water Source',
      lat: 46.5285,
      lng: 29.8579,
      x: 2,
      y: 1,
      color: 'from-blue-500 to-cyan-500',
      detections: 298,
      species: 18,
      description: 'Natural water source attracting diverse wildlife',
    },
    {
      id: 4,
      name: 'South Slope',
      lat: 46.527,
      lng: 29.8564,
      x: 1,
      y: 2,
      color: 'from-yellow-500 to-orange-500',
      detections: 156,
      species: 9,
      description: 'South-facing slope with unique microclimate',
    },
    {
      id: 5,
      name: 'Oak Grove',
      lat: 46.526,
      lng: 29.8554,
      x: 0,
      y: 2,
      color: 'from-amber-600 to-yellow-600',
      detections: 201,
      species: 14,
      description: 'Ancient oak trees providing habitat for rare species',
    },
    {
      id: 6,
      name: 'Meadow',
      lat: 46.528,
      lng: 29.8584,
      x: 2,
      y: 2,
      color: 'from-lime-500 to-green-500',
      detections: 169,
      species: 11,
      description: 'Open meadow area with diverse grassland species',
    },
  ];

  const analysis: AnalysisData = {
    summary: {
      total: detections.length,
      species: Object.keys(speciesCounts).length,
      start: new Date(2025, 4, 29),
      end: new Date(2025, 7, 16),
    },
    hourly: hourlyActivity,
    species: speciesCounts,
    types: typeDistribution,
    rare,
    common,
    hypotheses,
  };

  return {
    analysis,
    hotspots,
    projects: mockProjects,
  };
}
