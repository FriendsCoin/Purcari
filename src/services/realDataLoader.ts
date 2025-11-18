import type { GeoJSONData, AnalysisData } from '@/types';

/**
 * Loads and parses the real GeoJSON data file
 */
export async function loadRealGeoJSONData(): Promise<GeoJSONData> {
  try {
    const response = await fetch('/data.geojson');
    if (!response.ok) {
      throw new Error(`Failed to load GeoJSON: ${response.statusText}`);
    }
    const data = await response.json();
    return data as GeoJSONData;
  } catch (error) {
    console.error('Error loading GeoJSON data:', error);
    throw error;
  }
}

/**
 * Processes real GeoJSON into analysis format
 */
export function processRealGeoJSON(geoData: GeoJSONData): AnalysisData {
  const hourlyActivity: Record<number, number> = {};
  const speciesCounts: Record<string, number> = {};
  const typeDistribution: Record<string, number> = {};
  const nightActivity = { day: 0, night: 0 };

  // Process each observation
  geoData.items.forEach(item => {
    const species = item.title || 'Unknown';
    const timestamp = new Date(item.startdate);
    const hour = timestamp.getHours();

    // Count hourly activity
    hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;

    // Count species
    speciesCounts[species] = (speciesCounts[species] || 0) + 1;

    // Determine type (mammal, bird, etc.)
    const type = determineSpeciesType(species);
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;

    // Track day/night
    if (item.properties.isnight) {
      nightActivity.night++;
    } else {
      nightActivity.day++;
    }
  });

  // Calculate rare and common species
  const sorted = Object.entries(speciesCounts).sort((a, b) => a[1] - b[1]);
  const rare = sorted.filter(([, count]) => count < 50);
  const common = sorted.filter(([, count]) => count > 100);

  // Find date range
  const dates = geoData.items.map(item => new Date(item.startdate).getTime());
  const start = new Date(Math.min(...dates));
  const end = new Date(Math.max(...dates));

  return {
    summary: {
      total: geoData.count,
      species: Object.keys(speciesCounts).length,
      start,
      end,
    },
    hourly: hourlyActivity,
    species: speciesCounts,
    types: typeDistribution,
    rare,
    common,
    hypotheses: [], // Will be generated based on data
  };
}

/**
 * Determines species type from French/English name
 */
function determineSpeciesType(species: string): 'mammal' | 'bird' | 'bat' | 'insect' {
  const lower = species.toLowerCase();

  // Mammals in French
  const mammals = [
    'renard',
    'lievre',
    'chevreuil',
    'sanglier',
    'fox',
    'hare',
    'deer',
    'boar',
    'blaireau',
    'martre',
    'fouine',
  ];
  if (mammals.some(m => lower.includes(m))) return 'mammal';

  // Bats
  const bats = ['chauve', 'pipistrelle', 'bat'];
  if (bats.some(b => lower.includes(b))) return 'bat';

  // Birds
  const birds = [
    'oiseau',
    'bird',
    'pie',
    'corbeau',
    'pigeon',
    'merle',
    'mesange',
    'rouge',
    'gorge',
  ];
  if (birds.some(b => lower.includes(b))) return 'bird';

  // Default to bird (most common in camera trap data)
  return 'bird';
}

/**
 * Extracts unique sensor/hotspot locations from GeoJSON
 */
export function extractHotspotsFromGeoJSON(geoData: GeoJSONData) {
  const hotspotMap = new Map();

  geoData.items.forEach(item => {
    const sensorRef = item.properties.sensor?.ref;
    if (!sensorRef) return;

    if (!hotspotMap.has(sensorRef)) {
      const [lng, lat] = item.geojson.coordinates;
      hotspotMap.set(sensorRef, {
        id: sensorRef,
        name: `Camera ${sensorRef}`,
        lat,
        lng,
        detections: 0,
        species: new Set(),
        color: 'from-blue-500 to-cyan-500',
      });
    }

    const hotspot = hotspotMap.get(sensorRef);
    hotspot.detections++;
    hotspot.species.add(item.title);
  });

  return Array.from(hotspotMap.values()).map(h => ({
    ...h,
    species: h.species.size,
  }));
}
