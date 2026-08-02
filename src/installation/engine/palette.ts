import { Color } from 'three';

/**
 * The installation is lit like a barrel cellar: near-black with a violet cast,
 * lifted by candle gold and oxidised wine reds. Everything additive on screen
 * has to survive that background, so the accents run hot (values above 1 feed
 * the bloom threshold).
 */
export const PALETTE = {
  void: '#07050a',
  ink: '#100a11',
  oxblood: '#4a0e22',
  wine: '#8b1538',
  ember: '#d4634a',
  gold: '#d4af37',
  bone: '#f5e6d3',
  vine: '#6e8b5a',
  dusk: '#3b4a7a',
  aurora: '#9b7fd4',
  mist: '#7d7a86',
} as const;

export type GuildId = 'songbird' | 'nocturnal' | 'raptor' | 'water' | 'mammal' | 'unknown';

/**
 * One hue per ecological guild. Chosen so the two large groups (songbirds by
 * day, nocturnal raptors by night) sit on opposite sides of the wheel — the
 * circadian scene reads as a warm/cold split with no labels needed.
 */
export const GUILD_COLORS: Record<GuildId, string> = {
  songbird: '#f0c661',
  nocturnal: '#7f8fd8',
  raptor: '#e8734a',
  water: '#4fb3a8',
  mammal: '#c9455f',
  unknown: '#6d6a75',
};

export const GUILD_ORDER: GuildId[] = ['songbird', 'nocturnal', 'water', 'raptor', 'mammal', 'unknown'];

const cache = new Map<string, Color>();

export function color(hex: string): Color {
  let c = cache.get(hex);
  if (!c) {
    c = new Color(hex);
    cache.set(hex, c);
  }
  return c;
}

export function guildColor(guild: string): Color {
  return color(guildCss(guild));
}

/** Guild hue as a CSS string, for the DOM overlay. */
export function guildCss(guild: string): string {
  return GUILD_COLORS[guild as GuildId] ?? GUILD_COLORS.unknown;
}

export function guildLabel(guild: string): string {
  return (
    {
      songbird: 'Passereaux',
      nocturnal: 'Rapaces nocturnes',
      raptor: 'Rapaces diurnes',
      water: 'Oiseaux d’eau',
      mammal: 'Mammifères',
      unknown: 'Non identifié',
    } as Record<string, string>
  )[guild] ?? 'Non identifié';
}

/** Flat RGB triples for guilds, indexed by GUILD_ORDER — uploaded as a uniform array. */
export function guildColorArray(): number[] {
  return GUILD_ORDER.flatMap(id => {
    const c = color(GUILD_COLORS[id]);
    return [c.r, c.g, c.b];
  });
}

export function guildIndex(guild: string): number {
  const i = GUILD_ORDER.indexOf(guild as GuildId);
  return i < 0 ? GUILD_ORDER.length - 1 : i;
}
