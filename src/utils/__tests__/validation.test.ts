import {
  validateCoordinates,
  validateDateRange,
  sanitizeInput,
  validateFileSize,
} from '../validation';

describe('validation utilities', () => {
  describe('validateCoordinates', () => {
    it('should validate coordinates within Moldova bounds', () => {
      expect(validateCoordinates(46.5275, 29.8569)).toBe(true);
    });

    it('should reject coordinates outside Moldova bounds', () => {
      expect(validateCoordinates(0, 0)).toBe(false);
      expect(validateCoordinates(90, 180)).toBe(false);
    });
  });

  describe('validateDateRange', () => {
    it('should validate correct date range', () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-12-31');
      expect(validateDateRange(start, end)).toBe(true);
    });

    it('should reject invalid date range (start > end)', () => {
      const start = new Date('2025-12-31');
      const end = new Date('2025-01-01');
      expect(validateDateRange(start, end)).toBe(false);
    });

    it('should reject future dates', () => {
      const start = new Date('2030-01-01');
      const end = new Date('2030-12-31');
      expect(validateDateRange(start, end)).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('should sanitize HTML special characters', () => {
      const input = '<script>alert("XSS")</script>';
      const result = sanitizeInput(input);

      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    it('should handle normal text', () => {
      const input = 'Normal text without special chars';
      const result = sanitizeInput(input);

      expect(result).toBe(input);
    });
  });

  describe('validateFileSize', () => {
    it('should validate file within size limit', () => {
      const file = new File(['test'], 'test.csv', { type: 'text/csv' });
      expect(validateFileSize(file, 10)).toBe(true);
    });

    it('should reject file exceeding size limit', () => {
      const largeContent = 'a'.repeat(11 * 1024 * 1024); // 11MB
      const file = new File([largeContent], 'large.csv', { type: 'text/csv' });
      expect(validateFileSize(file, 10)).toBe(false);
    });
  });
});
