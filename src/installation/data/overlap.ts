import raw from './overlap.json';

export type OverlapKind = 'mammal' | 'bird' | 'domestic';

export interface OverlapSpecies {
  en: string;
  fr: string;
  kind: OverlapKind;
}

interface OverlapFile {
  meta: {
    source: string;
    measure: string;
    period: string;
    recovered: string;
    maxAsymmetry: number;
    maxColourDistance: number;
  };
  species: OverlapSpecies[];
  matrix: number[][];
}

export const overlap = raw as unknown as OverlapFile;

export const overlapSpecies = overlap.species;
export const overlapMatrix = overlap.matrix;
export const overlapCount = overlapSpecies.length;

/**
 * Ring order: species sorted along the dominant eigenvector of the correlation
 * matrix.
 *
 * This is not a chosen arrangement — it is the axis the data itself is built
 * around, recovered by power iteration. It separates the eight mammals from the
 * ten birds cleanly, puts the red fox almost exactly at zero (crepuscular, at
 * home in both halves) and files the dog with the birds, because dogs are walked
 * in daylight. Ordering the ring by it means neighbours on the ring are species
 * that share their hours, and opposite sides are species that never meet.
 */
export const overlapOrder = (() => {
  const n = overlapCount;
  let v = new Array(n).fill(1 / Math.sqrt(n));

  for (let iteration = 0; iteration < 400; iteration += 1) {
    const w = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let j = 0; j < n; j += 1) sum += overlapMatrix[i][j] * v[j];
      w[i] = sum;
    }
    const norm = Math.hypot(...w) || 1;
    v = w.map(x => x / norm);
  }

  // Sign of an eigenvector is arbitrary; pin it so mammals always land first.
  const mammalMean =
    overlapSpecies.reduce((sum, s, i) => (s.kind === 'mammal' ? sum + v[i] : sum), 0) /
    Math.max(1, overlapSpecies.filter(s => s.kind === 'mammal').length);
  if (mammalMean > 0) v = v.map(x => -x);

  return {
    /** Species indices, ordered along the axis. */
    indices: v.map((_, i) => i).sort((a, b) => v[a] - v[b]),
    /** Each species' position on the axis, -1..1 after normalising. */
    axis: (() => {
      const max = Math.max(...v.map(Math.abs)) || 1;
      return v.map(x => x / max);
    })(),
  };
})();

/** Strongest positive and strongest negative partner of a species. */
export function overlapExtremes(index: number): { closest: number; furthest: number } {
  let closest = -1;
  let furthest = -1;
  for (let j = 0; j < overlapCount; j += 1) {
    if (j === index) continue;
    if (closest < 0 || overlapMatrix[index][j] > overlapMatrix[index][closest]) closest = j;
    if (furthest < 0 || overlapMatrix[index][j] < overlapMatrix[index][furthest]) furthest = j;
  }
  return { closest, furthest };
}

/** Every unordered pair, strongest agreement first. */
export const overlapPairs = (() => {
  const pairs: { i: number; j: number; rho: number }[] = [];
  for (let i = 0; i < overlapCount; i += 1) {
    for (let j = i + 1; j < overlapCount; j += 1) {
      pairs.push({ i, j, rho: overlapMatrix[i][j] });
    }
  }
  return pairs.sort((a, b) => b.rho - a.rho);
})();

export function overlapKindLabel(kind: OverlapKind): string {
  return kind === 'mammal' ? 'Mammifère' : kind === 'bird' ? 'Oiseau' : 'Domestique';
}
