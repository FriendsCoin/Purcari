import { useState, useCallback, useEffect } from 'react';
import type { AnalysisData, GeoJSONData, FilterState } from '@/types';
import { processGeoJSONData, filterByTimeRange } from '@/utils/dataProcessing';
import { validateGeoJSONData } from '@/utils/validation';

interface UseDataAnalysisReturn {
  analysis: AnalysisData | null;
  isLoading: boolean;
  error: string | null;
  loadData: (data: GeoJSONData) => Promise<void>;
  clearData: () => void;
  filterData: (filters: FilterState) => void;
}

export function useDataAnalysis(): UseDataAnalysisReturn {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (data: GeoJSONData) => {
    setIsLoading(true);
    setError(null);

    try {
      // Validate data
      if (!validateGeoJSONData(data)) {
        throw new Error('Invalid GeoJSON data format');
      }

      if (data.items.length === 0) {
        throw new Error('No observation data found');
      }

      // Process data with slight delay to show loading state
      await new Promise(resolve => setTimeout(resolve, 500));

      const processedData = processGeoJSONData(data);
      setAnalysis(processedData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process data';
      setError(errorMessage);
      console.error('Data processing error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearData = useCallback(() => {
    setAnalysis(null);
    setError(null);
  }, []);

  const filterData = useCallback(
    (filters: FilterState) => {
      if (!analysis) return;

      // Apply filters to the analysis data
      // This is a simplified version - you can expand based on your needs
      console.warn('Filtering functionality to be implemented', filters);
    },
    [analysis]
  );

  return {
    analysis,
    isLoading,
    error,
    loadData,
    clearData,
    filterData,
  };
}
