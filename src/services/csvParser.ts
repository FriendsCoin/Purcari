/**
 * Parses CSV data into structured format
 */

export interface MonthlyTrend {
  month: string;
  count: number;
}

export interface SiteDiversity {
  site: string;
  shannon: number;
}

export interface DetailedMetrics {
  site: string;
  filter: string;
  shannon: number;
  simpson: number;
  richness: number;
}

/**
 * Loads and parses monthly trends CSV
 */
export async function loadMonthlyTrends(): Promise<MonthlyTrend[]> {
  try {
    const response = await fetch('/20251110_100109.csv');
    const text = await response.text();
    const lines = text.trim().split('\n').slice(1); // Skip header

    return lines.map(line => {
      const [month, count] = line.split(',');
      return {
        month: month.trim(),
        count: parseFloat(count),
      };
    });
  } catch (error) {
    console.error('Error loading monthly trends:', error);
    return [];
  }
}

/**
 * Loads and parses site diversity comparison CSV
 */
export async function loadSiteDiversity(): Promise<SiteDiversity[]> {
  try {
    const response = await fetch('/20251110_100135.csv');
    const text = await response.text();
    const lines = text.trim().split('\n').slice(1); // Skip header

    return lines.map(line => {
      const [site, shannon] = line.split(',');
      return {
        site: site.trim(),
        shannon: parseFloat(shannon),
      };
    });
  } catch (error) {
    console.error('Error loading site diversity:', error);
    return [];
  }
}

/**
 * Loads and parses detailed metrics CSV
 */
export async function loadDetailedMetrics(): Promise<DetailedMetrics[]> {
  try {
    const response = await fetch('/20251110_100150.csv');
    const text = await response.text();
    const lines = text.trim().split('\n').slice(1); // Skip header

    return lines.map(line => {
      const [site, filter, shannon, simpson, richness] = line.split(',');
      return {
        site: site.trim(),
        filter: filter.trim(),
        shannon: parseFloat(shannon),
        simpson: parseFloat(simpson),
        richness: parseInt(richness, 10),
      };
    });
  } catch (error) {
    console.error('Error loading detailed metrics:', error);
    return [];
  }
}

/**
 * Loads all CSV data at once
 */
export async function loadAllCSVData() {
  const [monthlyTrends, siteDiversity, detailedMetrics] = await Promise.all([
    loadMonthlyTrends(),
    loadSiteDiversity(),
    loadDetailedMetrics(),
  ]);

  return {
    monthlyTrends,
    siteDiversity,
    detailedMetrics,
  };
}

/**
 * Get metrics for a specific site and filter
 */
export function getMetricsForSite(
  metrics: DetailedMetrics[],
  siteName: string,
  filter: 'all species' | 'wild species' = 'all species'
): DetailedMetrics | undefined {
  return metrics.find(m => m.site === siteName && m.filter === filter);
}

/**
 * Compare two sites
 */
export function compareSites(
  metrics: DetailedMetrics[],
  site1: string,
  site2: string,
  filter: 'all species' | 'wild species' = 'all species'
) {
  const s1 = getMetricsForSite(metrics, site1, filter);
  const s2 = getMetricsForSite(metrics, site2, filter);

  if (!s1 || !s2) return null;

  return {
    site1: s1,
    site2: s2,
    shannonDiff: s1.shannon - s2.shannon,
    simpsonDiff: s1.simpson - s2.simpson,
    richnessDiff: s1.richness - s2.richness,
  };
}
