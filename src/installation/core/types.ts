/** Runtime shape of public/data/installation.json, emitted by scripts/build_installation_data.py. */

/**
 * Findings that live in the survey reports rather than in the raw detections.
 * Kept alongside the data so on-screen claims and their sources never drift.
 */
export interface Narrative {
  thesis: string;
  thesisSource: string;
  dawnChorus: { meanSpecies: number; mornings: number; verdict: string; text: string };
  refuge: string;
  protection: {
    protConn: number;
    protectedHectares: number;
    natura2000Zones: number;
    text: string;
    policy: string;
  };
  benchmark: { landUse: string; shannon: number; richness: number; self: boolean }[];
  birdBenchmark: { landUse: string; richness: number; self: boolean }[];
  ecosystemScore: {
    overall: number;
    intrinsic: number;
    landscape: number;
    connectivity: number;
  };
  landCover: { label: string; share: number }[];
  estate: {
    dripIrrigationHectares: number;
    irrigationInvestmentEuro: number;
    waterSavingLow: number;
    waterSavingHigh: number;
    organicConversionHectares: number;
    phytosanitaryReduction: number;
    founded: number;
  };
  terroir: {
    units: string[];
    unitsEn: string[];
    soils: string[];
    measurementsPerHectare: number;
    line: string;
  };
  nightMethod: string;
  credits: { survey: string; terroir: string; acoustics: string };
}

export interface InstallationMeta {
  site: string;
  region: string;
  origin: { lat: number; lon: number };
  surveyStart: string;
  surveyEnd: string;
  surveyDays: number;
  stations: number;
  cameraTraps: number;
  acousticRecorders: number;
  totalDetections: number;
  cameraDetections: number;
  soundDetections: number;
  totalSpecies: number;
  cameraSpecies: number;
  soundSpecies: number;
  shannon: number;
  simpson: number;
  chao1: number;
  nightRatio: number;
  /** Camera-only night share, the figure comparable to the report's 42.9%. */
  cameraNightRatio: number;
}

/** Every1Counts cross-method classification of a station. */
export type Typology = 'core' | 'transition' | 'method_dependent' | 'periphery';
/** Single-method diversity class. */
export type DiversityClass = 'high' | 'intermediate' | 'low';

export interface Site {
  id: string;
  label: string;
  habitat: string;
  /** How the station reads when both methods are considered together. */
  typology: Typology;
  /** How the same land reads to camera traps alone… */
  cameraClass: DiversityClass;
  /** …and to acoustic recorders alone. The disagreement is the point. */
  soundClass: DiversityClass;
  note: string;
  lat: number;
  lon: number;
  /** Metres east / north of the estate origin. */
  x: number;
  y: number;
  cameraDetections: number;
  cameraSpecies: number;
  soundDetections: number;
  soundSpecies: number;
  richness: number;
  detections: number;
  shannon: number;
  simpson: number;
  evenness: number;
  chao1: number;
  nightRatio: number;
  activeDays: number;
  topSpecies: string[];
  hourly: number[];
  monthly: number[];
}

export interface Species {
  sci: string;
  name: string;
  /** Vernacular label, present only when it differs from `name`. */
  alt: string;
  /** Domesticated or feral. Counted everywhere, but excluded from the outdoor piece. */
  domestic: boolean;
  modality: 'camera' | 'sound' | 'both';
  guild: string;
  total: number;
  sites: Record<string, number>;
  siteCount: number;
  hourly: number[];
  monthly: number[];
  nightRatio: number;
  nocturnal: boolean;
  peakHour: number;
  peakMonth: number;
  confidence: number | null;
  flagship: boolean;
  status: string | null;
  note: string | null;
  rank: number;
}

export interface WeekPoint {
  week: string;
  camera: number;
  sound: number;
  richness: number;
}

export interface SunPoint {
  month: number;
  sunrise: number;
  sunset: number;
}

export interface SiteLink {
  a: string;
  b: string;
  jaccard: number;
  shared: number;
}

export interface GuildTotals {
  total: number;
  species: number;
}

export interface InstallationData {
  meta: InstallationMeta;
  narrative: Narrative;
  sites: Site[];
  species: Species[];
  /** [modality][month 0-11][hour 0-23] detection counts. */
  surface: Record<'camera' | 'sound', number[][]>;
  weekly: WeekPoint[];
  sun: SunPoint[];
  links: SiteLink[];
  guilds: Record<string, GuildTotals>;
  flagships: string[];
}

/**
 * Normalised sensor signals, all 0..1 unless noted. Both installation versions
 * consume this same bus; indoors it is driven by touch, outdoors by hardware,
 * so a scene never needs to know which version it is running in.
 */
export interface SensorState {
  /** Someone is within the interaction zone. */
  presence: number;
  /** How much the scene is being disturbed right now — movement + noise. */
  disturbance: number;
  /** Seconds the visitor has held still and quiet. Drives the return of the fauna. */
  stillnessSeconds: number;
  /** Ambient sound pressure, smoothed. */
  loudness: number;
  /** Dominant ambient frequency band, 0 = low rumble, 1 = high. */
  brightness: number;
  /** Live 32-bin spectrum of the ambient microphone. */
  spectrum: Float32Array;
  /** Where the visitor is, in normalised screen space. */
  focus: { x: number; y: number };
  /** Hour of day as a float, 0..24 — real clock time, drives which species are awake. */
  clockHour: number;
  /** Optional hardware channels (WebSerial): temperature °C, wind m/s, lux. */
  temperature: number | null;
  wind: number | null;
  lux: number | null;
  /** Which sensor sources are actually live. */
  sources: { camera: boolean; microphone: boolean; serial: boolean };
}
