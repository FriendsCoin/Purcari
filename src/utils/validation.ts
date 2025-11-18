import type { GeoJSONData, ObservationPoint } from '@/types';

/**
 * Validates GeoJSON data structure
 */
export function validateGeoJSONData(data: unknown): data is GeoJSONData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const geoData = data as GeoJSONData;

  if (typeof geoData.count !== 'number') {
    return false;
  }

  if (!Array.isArray(geoData.items)) {
    return false;
  }

  // Validate at least first item structure
  if (geoData.items.length > 0) {
    return validateObservationPoint(geoData.items[0]);
  }

  return true;
}

/**
 * Validates individual observation point
 */
export function validateObservationPoint(point: unknown): point is ObservationPoint {
  if (!point || typeof point !== 'object') {
    return false;
  }

  const obs = point as ObservationPoint;

  return !!(
    obs.id &&
    obs.title &&
    obs.geojson &&
    obs.geojson.type === 'Point' &&
    Array.isArray(obs.geojson.coordinates) &&
    obs.geojson.coordinates.length === 2 &&
    typeof obs.geojson.coordinates[0] === 'number' &&
    typeof obs.geojson.coordinates[1] === 'number'
  );
}

/**
 * Validates CSV file format
 */
export function validateCSVFile(file: File): boolean {
  const validExtensions = ['.csv', '.txt'];
  const fileName = file.name.toLowerCase();

  return validExtensions.some(ext => fileName.endsWith(ext));
}

/**
 * Validates coordinate bounds (Moldova region)
 */
export function validateCoordinates(lat: number, lng: number): boolean {
  // Moldova approximate bounds
  const MOLDOVA_BOUNDS = {
    minLat: 45.4,
    maxLat: 48.5,
    minLng: 26.6,
    maxLng: 30.2,
  };

  return (
    lat >= MOLDOVA_BOUNDS.minLat &&
    lat <= MOLDOVA_BOUNDS.maxLat &&
    lng >= MOLDOVA_BOUNDS.minLng &&
    lng <= MOLDOVA_BOUNDS.maxLng
  );
}

/**
 * Sanitizes user input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validates date range
 */
export function validateDateRange(start: Date, end: Date): boolean {
  const now = new Date();
  return start <= end && start <= now && end <= now;
}

/**
 * Error messages for validation failures
 */
export const ValidationErrors = {
  INVALID_GEOJSON: 'Invalid GeoJSON data structure',
  INVALID_OBSERVATION: 'Invalid observation point data',
  INVALID_CSV: 'Invalid CSV file format. Please use .csv or .txt files',
  INVALID_COORDINATES: 'Coordinates are outside valid range',
  INVALID_DATE_RANGE: 'Invalid date range specified',
  FILE_TOO_LARGE: 'File size exceeds maximum allowed (10MB)',
  EMPTY_DATA: 'No data found in file',
} as const;

/**
 * Validates file size
 */
export function validateFileSize(file: File, maxSizeMB = 10): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxSizeBytes;
}
