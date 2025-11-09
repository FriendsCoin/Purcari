import { useState, useEffect, useRef, useCallback } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { Hotspot } from '@/types';

interface UseMapReturn {
  mapRef: React.RefObject<LeafletMap | null>;
  isMapReady: boolean;
  error: string | null;
  centerMap: (lat: number, lng: number, zoom?: number) => void;
  fitBounds: (bounds: [[number, number], [number, number]]) => void;
}

export function useMap(): UseMapReturn {
  const mapRef = useRef<LeafletMap | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if Leaflet is loaded
    if (typeof window !== 'undefined' && window.L) {
      setIsMapReady(true);
    } else {
      setError('Leaflet library not loaded');
    }
  }, []);

  const centerMap = useCallback((lat: number, lng: number, zoom = 13) => {
    if (mapRef.current) {
      mapRef.current.setView([lat, lng], zoom);
    }
  }, []);

  const fitBounds = useCallback((bounds: [[number, number], [number, number]]) => {
    if (mapRef.current) {
      mapRef.current.fitBounds(bounds);
    }
  }, []);

  return {
    mapRef,
    isMapReady,
    error,
    centerMap,
    fitBounds,
  };
}

/**
 * Hook for managing hotspot markers on the map
 */
export function useHotspots(hotspots: Hotspot[]) {
  const [selectedHotspot, setSelectedHotspot] = useState<Hotspot | null>(null);

  const getBounds = useCallback((): [[number, number], [number, number]] | null => {
    if (hotspots.length === 0) return null;

    const lats = hotspots.map(h => h.lat);
    const lngs = hotspots.map(h => h.lng);

    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
  }, [hotspots]);

  return {
    selectedHotspot,
    setSelectedHotspot,
    getBounds,
  };
}
