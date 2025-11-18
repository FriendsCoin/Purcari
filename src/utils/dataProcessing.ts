import type { Detection, GeoJSONData, AnalysisData } from '@/types';

/**
 * Processes GeoJSON data from observation points
 */
export function processGeoJSONData(geoData: GeoJSONData): AnalysisData {
  const detections: Detection[] = [];
  const speciesCounts: Record<string, number> = {};
  const typeDistribution: Record<string, number> = {};
  const hourlyActivity: Record<number, number> = {};

  geoData.items.forEach((item, index) => {
    const species = item.title || 'Unknown';
    const timestamp = item.startdate;
    const hour = new Date(timestamp).getHours();

    // Determine species type based on French names
    const type = determineSpeciesType(species);

    // Count species
    speciesCounts[species] = (speciesCounts[species] || 0) + 1;
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;
    hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;

    // Create detection record
    detections.push({
      id: index,
      timestamp,
      species,
      type,
      hotspot_id: parseInt(item.properties.sensor?.ref?.replace('ct', '') || '0'),
      coordinates: [item.geojson.coordinates[1], item.geojson.coordinates[0]],
    });
  });

  // Calculate rare and common species
  const sorted = Object.entries(speciesCounts).sort((a, b) => a[1] - b[1]);
  const rare = sorted.filter(([, count]) => count < 50);
  const common = sorted.filter(([, count]) => count > 100);

  return {
    summary: {
      total: detections.length,
      species: Object.keys(speciesCounts).length,
      start: new Date(Math.min(...detections.map(d => new Date(d.timestamp).getTime()))),
      end: new Date(Math.max(...detections.map(d => new Date(d.timestamp).getTime()))),
    },
    hourly: hourlyActivity,
    species: speciesCounts,
    types: typeDistribution,
    rare,
    common,
    hypotheses: [],
  };
}

/**
 * Determines species type from name (supports French and English)
 */
function determineSpeciesType(species: string): 'mammal' | 'bird' | 'bat' | 'insect' {
  const lower = species.toLowerCase();

  // Mammals (French)
  const mammals = ['renard', 'lievre', 'chevreuil', 'sanglier', 'hare', 'fox', 'deer', 'boar'];
  if (mammals.some(m => lower.includes(m))) return 'mammal';

  // Bats (French)
  const bats = ['chauve', 'pipistrelle', 'bat'];
  if (bats.some(b => lower.includes(b))) return 'bat';

  // Birds (default for most observations)
  return 'bird';
}

/**
 * Calculates temporal patterns in activity
 */
export function calculateTemporalPatterns(hourlyData: Record<number, number>) {
  const nightHours = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  const dayHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

  const nightCount = nightHours.reduce((sum, h) => sum + (hourlyData[h] || 0), 0);
  const dayCount = dayHours.reduce((sum, h) => sum + (hourlyData[h] || 0), 0);

  return {
    nightCount,
    dayCount,
    ratio: nightCount / (dayCount || 1),
    peakHour: Object.entries(hourlyData).sort((a, b) => b[1] - a[1])[0]?.[0] || 0,
  };
}

/**
 * Filters detections by time range
 */
export function filterByTimeRange(
  detections: Detection[],
  range: 'all' | 'morning' | 'afternoon' | 'evening' | 'night'
): Detection[] {
  if (range === 'all') return detections;

  const timeRanges: Record<string, number[]> = {
    morning: [5, 6, 7, 8, 9, 10, 11],
    afternoon: [12, 13, 14, 15, 16, 17],
    evening: [18, 19, 20, 21],
    night: [22, 23, 0, 1, 2, 3, 4],
  };

  const hours = timeRanges[range] || [];
  return detections.filter(d => hours.includes(new Date(d.timestamp).getHours()));
}

/**
 * Groups detections by species type
 */
export function groupBySpeciesType(detections: Detection[]): Record<string, Detection[]> {
  return detections.reduce((acc, detection) => {
    const type = detection.type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(detection);
    return acc;
  }, {} as Record<string, Detection[]>);
}

/**
 * Calculates diversity metrics
 */
export function calculateDiversityMetrics(speciesCounts: Record<string, number>) {
  const species = Object.keys(speciesCounts);
  const total = Object.values(speciesCounts).reduce((sum, count) => sum + count, 0);

  // Shannon diversity index
  const shannon = -Object.values(speciesCounts).reduce((sum, count) => {
    const p = count / total;
    return sum + (p * Math.log(p));
  }, 0);

  // Simpson's diversity index
  const simpson = 1 - Object.values(speciesCounts).reduce((sum, count) => {
    const p = count / total;
    return sum + (p * p);
  }, 0);

  return {
    richness: species.length,
    shannon: shannon.toFixed(3),
    simpson: simpson.toFixed(3),
    evenness: (shannon / Math.log(species.length)).toFixed(3),
  };
}

/**
 * Exports data to CSV format
 */
export function exportToCSV(data: Detection[]): string {
  const headers = ['ID', 'Timestamp', 'Species', 'Type', 'Hotspot ID', 'Latitude', 'Longitude'];
  const rows = data.map(d => [
    d.id,
    d.timestamp,
    d.species,
    d.type,
    d.hotspot_id,
    d.coordinates?.[0] || '',
    d.coordinates?.[1] || '',
  ]);

  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Formats date range for display
 */
export function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };

  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
}
