/**
 * The visual system for both installation versions.
 *
 * Grounded in the estate itself: the near-black of a cellar, the deep garnet of
 * Negru de Purcari, gilded label foil, and the living greens of the vine. Every
 * colour is warm-shifted — nothing in this piece is a neutral grey.
 */

export const PALETTE = {
  /** Backgrounds, darkest first. Not pure black — a violet-garnet cast. */
  void: '#05040A',
  cellar: '#0B0812',
  sediment: '#150B18',
  lees: '#241026',

  /**
   * Purcari Wineries Group house tokens, lifted from the PARCELA terroir deck
   * (Arpentin, RO-WINE 2026) so the installation reads as the estate's own voice.
   */
  brandNavy: '#202F61',
  brandNavyDeep: '#002060',
  brandBronze: '#AA7D50',
  brandInk: '#231F20',

  /** The wine range. */
  garnet: '#5E0B2A',
  wine: '#8C1338',
  blush: '#C24F6B',

  /** Label foil — the accent that carries all primary emphasis. */
  gold: '#C9A227',
  foil: '#E8C86A',
  candle: '#FFE9B0',

  /** The living range. */
  vine: '#6FA65A',
  chlorophyll: '#9BD16B',
  moss: '#3E5C3A',

  /** Water and night sky. */
  water: '#4EA8C7',
  dusk: '#5C6BA8',

  /** Warm alert / ember. */
  ember: '#FF7A3C',

  /** Type. */
  bone: '#EDE6D6',
  parchment: '#C7BCA5',
  ash: '#7A7264',
} as const;

/**
 * Ecological guild → colour. These are the load-bearing categorical colours:
 * every particle, arc and label inherits its hue from the animal's guild, so the
 * palette must stay legible at one-pixel scale against near-black.
 */
export const GUILD_COLORS: Record<string, string> = {
  songbird: '#E8C86A',
  gamebird: '#D98A46',
  dove: '#C9A0B4',
  waterbird: '#4EA8C7',
  wader: '#5FBFA8',
  raptor: '#9B7BD4',
  owl: '#6C7FC4',
  woodpecker: '#E0703A',
  aerial: '#E8845A',
  corvid: '#8C9BAB',
  carnivore: '#D9455F',
  herbivore: '#8FBF6A',
  rodent: '#B08CA8',
  mammal: '#C4A882',
  bird: '#A89C7E',
};

export const GUILD_LABELS: Record<string, string> = {
  songbird: 'Songbird',
  gamebird: 'Gamebird',
  dove: 'Dove',
  waterbird: 'Waterbird',
  wader: 'Wader',
  raptor: 'Raptor',
  owl: 'Owl',
  woodpecker: 'Woodpecker',
  aerial: 'Aerial hunter',
  corvid: 'Corvid',
  carnivore: 'Carnivore',
  herbivore: 'Herbivore',
  rodent: 'Small mammal',
  mammal: 'Mammal',
  bird: 'Bird',
};

/** Habitat → colour, used for the terrain wash and station halos. */
export const HABITAT_COLORS: Record<string, string> = {
  hedgerow: '#9BD16B',
  vineyard: '#8C1338',
  treeline: '#6FA65A',
  valley: '#4E7C59',
  grassland: '#C9A227',
  woodland: '#3E7A4A',
  woodland_edge: '#6B9A4E',
  ravine: '#7A5C8C',
  wetland: '#4EA8C7',
  chateau: '#E8C86A',
};

export const HABITAT_LABELS: Record<string, string> = {
  hedgerow: 'Hedgerow',
  vineyard: 'Vineyard',
  treeline: 'Tree line',
  valley: 'Valley floor',
  grassland: 'Grassland',
  woodland: 'Woodland',
  woodland_edge: 'Woodland edge',
  ravine: 'Ravine',
  wetland: 'Pond margin',
  chateau: 'Château',
};

/**
 * The survey's own semantic map code for station typology, and for the
 * single-method diversity classes. Kept beside the other categorical scales so
 * the three readings of the estate stay visually consistent wherever they appear.
 */
export const TYPOLOGY_COLORS: Record<string, string> = {
  core: '#4E9A5A',
  transition: '#8C7BC4',
  method_dependent: '#3E86BE',
  periphery: '#9E2846',
};

export const TYPOLOGY_LABELS: Record<string, string> = {
  core: 'Rich stable core',
  transition: 'Transition',
  method_dependent: 'Depends who you ask',
  periphery: 'Poor edge',
};

export const CLASS_COLORS: Record<string, string> = {
  high: '#4E9A5A',
  intermediate: '#8C7BC4',
  low: '#9E2846',
};

/** Convert '#rrggbb' to a linear-ish [r,g,b] triple in 0..1 for shader uniforms. */
export function toRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Sample a colour ramp built from the palette; t in 0..1. */
export function ramp(stops: string[], t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(0.9999, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = toRGB(stops[i]);
  const b = toRGB(stops[Math.min(stops.length - 1, i + 1)]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Night → day → night, used to tint scenes by hour of day. */
export const DIURNAL_RAMP = [
  PALETTE.dusk,
  PALETTE.lees,
  PALETTE.garnet,
  PALETTE.ember,
  PALETTE.foil,
  PALETTE.candle,
  PALETTE.foil,
  PALETTE.ember,
  PALETTE.garnet,
  PALETTE.lees,
  PALETTE.dusk,
];

/** Low → high activity, for the chronogram surface. */
export const ACTIVITY_RAMP = [
  '#0B0812',
  '#241026',
  '#5E0B2A',
  '#8C1338',
  '#D9455F',
  '#E0703A',
  '#E8C86A',
  '#FFE9B0',
];

export const TYPE = {
  display: "'Cormorant Garamond', 'Didot', 'Times New Roman', serif",
  body: "'Inter', 'Helvetica Neue', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
} as const;
