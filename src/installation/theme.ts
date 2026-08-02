/**
 * Visual language for the Living Archive installation.
 *
 * Colour carries meaning here rather than decoration: every particle is tinted
 * by the hour it was recorded at, so a night detection reads cold and a dawn
 * detection reads gold no matter which act it is arranged into. Mammals are
 * pulled toward wine red, the estate's own colour, to separate the camera
 * network from the acoustic one at a glance.
 */

import { Color } from 'three';

export const PALETTE = {
  void: '#04060a',
  ink: '#080c12',
  bone: '#ece7dc',
  ash: '#7d8894',
  wine: '#b31f42',
  wineDeep: '#5e0f24',
  gold: '#f0b429',
  amber: '#e8853c',
  cyan: '#4fd2e8',
  night: '#2f5fd0',
  moss: '#6f9a5a',
} as const;

/** Hour-of-day colour ramp: midnight → dawn → noon → dusk → midnight. */
const DAY_RAMP: Array<[number, string]> = [
  [0, '#1e3fa8'],
  [3.5, '#3f6fd8'],
  [5, '#f0b429'],
  [7, '#f6d08a'],
  [12, '#ece7dc'],
  [17, '#f3c169'],
  [19.5, '#e8703c'],
  [21.5, '#3a4fb8'],
  [24, '#1e3fa8'],
];

const rampColors = DAY_RAMP.map(([stop, hex]) => ({ stop, color: new Color(hex) }));

/** Samples the day ramp at a given hour (0–24, wraps). */
export function hourColor(hour: number, target = new Color()): Color {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < rampColors.length - 1; i += 1) {
    const a = rampColors[i];
    const b = rampColors[i + 1];
    if (h >= a.stop && h <= b.stop) {
      const t = (h - a.stop) / (b.stop - a.stop || 1);
      return target.copy(a.color).lerp(b.color, t);
    }
  }
  return target.copy(rampColors[0].color);
}

const WINE = new Color(PALETTE.wine);
const ASH = new Color(PALETTE.ash);

/**
 * Final particle tint: the hour ramp, pulled toward wine for mammals and
 * desaturated for domestic animals so livestock never reads as wildlife.
 */
export function detectionColor(hour: number, kind: string, target = new Color()): Color {
  hourColor(hour, target);
  if (kind === 'mammal') target.lerp(WINE, 0.62);
  else if (kind === 'domestic') target.lerp(ASH, 0.72);
  return target;
}

export const ZONE_COLOR: Record<string, string> = {
  core: PALETTE.gold,
  edge: PALETTE.cyan,
  matrix: PALETTE.ash,
};
