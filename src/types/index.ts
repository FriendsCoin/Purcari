// Core data types for biodiversity monitoring

export interface ObservationPoint {
  id: string;
  title: string;
  dataset: string;
  datatype: string;
  startdate: string;
  enddate: string;
  properties: {
    sensor?: {
      ref: string;
    };
    isnight?: boolean;
    classification?: {
      countManual?: number;
      taxrefManual?: string;
    };
  };
  geojson: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  medias?: Array<{
    file: string;
    label: string;
  }>;
  text?: string;
}

export interface Species {
  name: string;
  type: 'mammal' | 'bird' | 'bat' | 'insect';
  count: number;
  scientificName?: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'legendary';
}

export interface Detection {
  id: number;
  timestamp: string;
  species: string;
  type: 'mammal' | 'bird' | 'bat' | 'insect';
  hotspot_id: number;
  coordinates?: [number, number];
}

export interface Hotspot {
  id: number;
  name: string;
  lat: number;
  lng: number;
  x?: number;
  y?: number;
  color: string;
  detections: number;
  species?: number;
  description?: string;
}

export interface Hypothesis {
  id: string;
  title: string;
  icon: string;
  result: 'confirmed' | 'rejected' | 'inconclusive';
  confidence: number;
  description: string;
  methodology: string;
  findings: string[];
  implications: string[];
  evidence: Record<string, string>;
}

export interface TechnicalStack {
  tech: string;
  purpose: string;
}

export interface ImplementationPhase {
  phase: string;
  tasks: string[];
}

export interface Project {
  id: number;
  name: string;
  icon: string;
  score: number;
  color: string;
  tagline: string;
  description: string;
  concept: string;
  technicalStack: TechnicalStack[];
  features: string[];
  userJourney: string[];
  whyItWorks: string[];
  implementation: {
    timeline: string;
    budget: string;
    phases: ImplementationPhase[];
  };
  roi: {
    brand: string;
    engagement: string;
    press: string;
    scientific?: string;
    education?: string;
    revenue?: string;
    data?: string;
    versatility?: string;
  };
}

export interface AnalysisData {
  summary: {
    total: number;
    species: number;
    start: Date;
    end: Date;
    hotspots?: number;
    monitoringDays?: number;
  };
  hourly: Record<number, number>;
  species: Record<string, number>;
  types: Record<string, number>;
  rare?: Array<[string, number]>;
  common?: Array<[string, number]>;
  hypotheses: Hypothesis[];
  hotspots?: Record<number, {
    name: string;
    detections: number;
    species: number;
  }>;
  seasonal?: Record<string, {
    detections: number;
    species: number;
  }>;
  insights?: string[];
}

export interface FilterState {
  timeRange: 'all' | 'morning' | 'afternoon' | 'evening' | 'night';
  speciesType: 'all' | 'mammal' | 'bird' | 'bat' | 'insect';
  hotspot: 'all' | number;
}

export interface GeoJSONData {
  count: number;
  items: ObservationPoint[];
}

export type ViewState = 'upload' | 'dashboard' | 'analysis' | 'projects';
export type DataSource = 'simulated' | 'real';
