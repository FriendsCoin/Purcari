/**
 * Two pictograms, and the sampling that turns them into marks.
 *
 * When a visitor chooses an animal, the swarm gathers a ghost of it. These are
 * deliberately *pictograms* — a swept-wing bird and a quadruped in profile — and
 * not portraits of the chosen species. The survey ships detections, not images,
 * and a plausible-looking rendering of a Turtle Dove would be an invention
 * dressed as a record. A glyph is a label; it says "bird" the way the word does,
 * and the species' own name sits beside it in real type.
 *
 * Guild picks which of the two forms, and that mapping is the only claim being
 * made: the survey's own guild for the species, drawn as a shape.
 */

export type GlyphKind = 'bird' | 'mammal';

/** Outline of a bird in flight, wings swept. Normalised to the unit square. */
const BIRD: readonly (readonly [number, number])[] = [
  [0.5, 0.44],
  [0.58, 0.5],
  [0.7, 0.58],
  [0.84, 0.7],
  [0.97, 0.86],
  [0.88, 0.66],
  [0.74, 0.53],
  [0.6, 0.47],
  [0.55, 0.52],
  [0.5, 0.585],
  [0.45, 0.52],
  [0.4, 0.47],
  [0.26, 0.53],
  [0.12, 0.66],
  [0.03, 0.86],
  [0.16, 0.7],
  [0.3, 0.58],
  [0.42, 0.5],
];

/** Outline of a quadruped in profile, facing left. */
const MAMMAL: readonly (readonly [number, number])[] = [
  [0.08, 0.6],
  [0.15, 0.64],
  [0.19, 0.7],
  [0.17, 0.84],
  [0.23, 0.72],
  [0.27, 0.86],
  [0.27, 0.7],
  [0.36, 0.65],
  [0.5, 0.63],
  [0.68, 0.65],
  [0.82, 0.62],
  [0.88, 0.7],
  [0.85, 0.6],
  [0.84, 0.36],
  [0.87, 0.16],
  [0.81, 0.18],
  [0.79, 0.36],
  [0.76, 0.5],
  [0.58, 0.47],
  [0.42, 0.47],
  [0.39, 0.3],
  [0.42, 0.14],
  [0.36, 0.15],
  [0.33, 0.32],
  [0.3, 0.5],
  [0.2, 0.55],
  [0.12, 0.56],
];

const OUTLINES: Record<GlyphKind, readonly (readonly [number, number])[]> = {
  bird: BIRD,
  mammal: MAMMAL,
};

/**
 * The survey's own guilds, sorted into the two forms.
 *
 * Everything not listed here is drawn as a bird, which is not a guess: 197 of
 * the 213 species came from the acoustic survey and the guild vocabulary is
 * overwhelmingly ornithological. The four mammal guilds are named explicitly so
 * the fallback can never quietly turn a roe deer into a gull.
 */
const MAMMAL_GUILDS = new Set(['carnivore', 'herbivore', 'rodent', 'mammal', 'small mammal']);

export function glyphFor(guild: string): GlyphKind {
  return MAMMAL_GUILDS.has(guild) ? 'mammal' : 'bird';
}

/**
 * `count` points spaced evenly along the closed outline.
 *
 * Along the perimeter rather than inside the shape: these silhouettes are thin —
 * a wing is a few percent of the square — and area sampling would put almost
 * every mark in the body and leave the wings as a scatter of four. Walking the
 * edge draws the contour, which is what makes the form legible at a glance and
 * keeps it obviously a drawing.
 */
export function sampleOutline(kind: GlyphKind, count: number): Float32Array {
  const outline = OUTLINES[kind];
  const n = outline.length;

  const lengths: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % n];
    const length = Math.hypot(bx - ax, by - ay);
    lengths.push(length);
    perimeter += length;
  }

  const out = new Float32Array(count * 2);
  let segment = 0;
  let walked = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * perimeter;
    while (segment < n - 1 && walked + lengths[segment] < target) {
      walked += lengths[segment];
      segment++;
    }
    const t = lengths[segment] > 0 ? (target - walked) / lengths[segment] : 0;
    const [ax, ay] = outline[segment];
    const [bx, by] = outline[(segment + 1) % n];
    // Centred on the origin, so the shader only has to scale it.
    out[i * 2] = ax + (bx - ax) * t - 0.5;
    out[i * 2 + 1] = ay + (by - ay) * t - 0.5;
  }
  return out;
}
