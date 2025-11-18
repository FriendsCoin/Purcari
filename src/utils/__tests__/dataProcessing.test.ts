import {
  calculateTemporalPatterns,
  filterByTimeRange,
  calculateDiversityMetrics,
  formatDateRange,
} from '../dataProcessing';
import type { Detection } from '@/types';

describe('dataProcessing utilities', () => {
  describe('calculateTemporalPatterns', () => {
    it('should calculate night and day counts correctly', () => {
      const hourlyData = {
        0: 10, 1: 5, 2: 3, 3: 2, 4: 4, 5: 6,
        6: 20, 7: 30, 8: 25, 9: 15, 10: 12, 11: 10,
        12: 8, 13: 7, 14: 6, 15: 5, 16: 8, 17: 10,
        18: 15, 19: 12, 20: 20, 21: 18, 22: 15, 23: 12,
      };

      const result = calculateTemporalPatterns(hourlyData);

      expect(result.nightCount).toBeGreaterThan(0);
      expect(result.dayCount).toBeGreaterThan(0);
      expect(result.ratio).toBeGreaterThan(0);
      expect(result.peakHour).toBeDefined();
    });

    it('should handle empty data', () => {
      const result = calculateTemporalPatterns({});

      expect(result.nightCount).toBe(0);
      expect(result.dayCount).toBe(0);
      expect(result.ratio).toBe(0);
    });
  });

  describe('filterByTimeRange', () => {
    const mockDetections: Detection[] = [
      {
        id: 1,
        timestamp: '2025-05-01T06:00:00Z',
        species: 'Robin',
        type: 'bird',
        hotspot_id: 1,
      },
      {
        id: 2,
        timestamp: '2025-05-01T14:00:00Z',
        species: 'Fox',
        type: 'mammal',
        hotspot_id: 2,
      },
      {
        id: 3,
        timestamp: '2025-05-01T22:00:00Z',
        species: 'Owl',
        type: 'bird',
        hotspot_id: 1,
      },
    ];

    it('should return all detections for "all" range', () => {
      const result = filterByTimeRange(mockDetections, 'all');
      expect(result).toHaveLength(3);
    });

    it('should filter morning detections', () => {
      const result = filterByTimeRange(mockDetections, 'morning');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('should filter afternoon detections', () => {
      const result = filterByTimeRange(mockDetections, 'afternoon');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('should filter night detections', () => {
      const result = filterByTimeRange(mockDetections, 'night');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3);
    });
  });

  describe('calculateDiversityMetrics', () => {
    it('should calculate diversity metrics correctly', () => {
      const speciesCounts = {
        'Robin': 100,
        'Fox': 50,
        'Deer': 30,
        'Owl': 20,
      };

      const result = calculateDiversityMetrics(speciesCounts);

      expect(result.richness).toBe(4);
      expect(parseFloat(result.shannon)).toBeGreaterThan(0);
      expect(parseFloat(result.simpson)).toBeGreaterThan(0);
      expect(parseFloat(result.evenness)).toBeGreaterThan(0);
      expect(parseFloat(result.evenness)).toBeLessThanOrEqual(1);
    });

    it('should handle single species', () => {
      const speciesCounts = { 'Robin': 100 };
      const result = calculateDiversityMetrics(speciesCounts);

      expect(result.richness).toBe(1);
    });
  });

  describe('formatDateRange', () => {
    it('should format date range correctly', () => {
      const start = new Date('2025-05-01');
      const end = new Date('2025-08-16');

      const result = formatDateRange(start, end);

      expect(result).toContain('May');
      expect(result).toContain('August');
      expect(result).toContain('2025');
    });
  });
});
