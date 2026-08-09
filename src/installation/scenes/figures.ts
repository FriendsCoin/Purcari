/**
 * Animal figures, as outlines to be filled with evidence.
 *
 * The conservation chapter needs its animals to read as animals — a visitor
 * should know they are looking at an owl before they read the word. There are
 * no photographs in this piece and no illustrations to license, so each figure
 * is a hand-authored outline, one per guild, drawn from points.
 *
 * They are deliberately **guild figures, not portraits**. The owl outline is
 * the owl of every owl; what makes it a particular species is the name beside
 * it and the detections inside it. Drawing a species-accurate silhouette from
 * memory would be inventing a claim about an animal, which is exactly what this
 * piece does not do — an obviously schematic figure claims nothing.
 *
 * Coordinates are in a -1..1 box, y up.
 */

export type FigureId = 'owl' | 'raptor' | 'water' | 'songbird' | 'mammal';

/** Closed outlines, as flat [x, y, x, y, …] runs. */
const OUTLINES: Record<FigureId, number[]> = {
  // Perched, square-shouldered, ear tufts. The night birds of the list.
  owl: [
    -0.16, 0.92, -0.30, 0.74, -0.44, 0.62, -0.52, 0.40, -0.54, 0.10, -0.48, -0.22,
    -0.36, -0.52, -0.20, -0.72, -0.22, -0.86, -0.10, -0.88, -0.04, -0.76, 0.04, -0.76,
    0.10, -0.88, 0.22, -0.86, 0.20, -0.72, 0.36, -0.52, 0.48, -0.22, 0.54, 0.10,
    0.52, 0.40, 0.44, 0.62, 0.30, 0.74, 0.16, 0.92, 0.06, 0.70, -0.06, 0.70,
  ],
  // Soaring, wings out, fingered primaries and a fanned tail.
  raptor: [
    0.0, 0.34, 0.16, 0.30, 0.42, 0.34, 0.68, 0.30, 0.90, 0.18, 0.98, 0.06,
    0.80, 0.02, 0.94, -0.06, 0.72, -0.08, 0.84, -0.18, 0.56, -0.14, 0.30, -0.06,
    0.14, -0.10, 0.10, -0.44, 0.20, -0.62, 0.0, -0.54, -0.20, -0.62, -0.10, -0.44,
    -0.14, -0.10, -0.30, -0.06, -0.56, -0.14, -0.84, -0.18, -0.72, -0.08, -0.94, -0.06,
    -0.80, 0.02, -0.98, 0.06, -0.90, 0.18, -0.68, 0.30, -0.42, 0.34, -0.16, 0.30,
  ],
  // Long neck, heavy body, standing: the swan, the curlew, the waders.
  water: [
    -0.10, 0.94, -0.20, 0.82, -0.22, 0.52, -0.16, 0.22, -0.30, 0.06, -0.52, -0.06,
    -0.66, -0.24, -0.62, -0.42, -0.44, -0.52, -0.16, -0.56, 0.06, -0.54, 0.10, -0.72,
    0.16, -0.88, 0.24, -0.88, 0.20, -0.70, 0.22, -0.54, 0.42, -0.48, 0.58, -0.34,
    0.60, -0.16, 0.46, 0.00, 0.20, 0.14, 0.06, 0.34, 0.06, 0.66, 0.14, 0.84,
    0.30, 0.92, 0.16, 0.98, -0.02, 0.98,
  ],
  // Small, perched, cocked tail — the passerines and the pigeons.
  songbird: [
    -0.34, 0.62, -0.46, 0.48, -0.48, 0.28, -0.38, 0.10, -0.20, -0.06, -0.02, -0.24,
    0.16, -0.34, 0.34, -0.36, 0.30, -0.52, 0.42, -0.66, 0.62, -0.78, 0.86, -0.82,
    0.72, -0.64, 0.60, -0.42, 0.56, -0.20, 0.42, 0.06, 0.22, 0.30, 0.06, 0.48,
    -0.06, 0.62, -0.20, 0.68,
  ],
  // Quadruped in profile with a long tail: the marten and the wildcat.
  mammal: [
    -0.92, 0.10, -0.78, 0.26, -0.70, 0.44, -0.62, 0.28, -0.44, 0.24, -0.20, 0.26,
    0.06, 0.30, 0.30, 0.34, 0.52, 0.44, 0.66, 0.62, 0.78, 0.82, 0.92, 0.74,
    0.86, 0.52, 0.72, 0.30, 0.56, 0.16, 0.40, 0.02, 0.44, -0.34, 0.34, -0.60,
    0.22, -0.60, 0.26, -0.34, 0.16, -0.06, -0.10, -0.02, -0.34, -0.04, -0.40, -0.36,
    -0.50, -0.60, -0.62, -0.58, -0.56, -0.32, -0.60, -0.06, -0.76, 0.00, -0.88, -0.04,
  ],
};

/**
 * Open strokes inside the outline: the wing, the facial disc, the eye, the legs.
 *
 * An outline alone reads as a pictogram. These are what make it a drawing —
 * the same marks an engraver would cut, and the reason the figure sits with the
 * inked ground rather than on top of it.
 */
const DETAILS: Record<FigureId, number[][]> = {
  owl: [
    // Facial disc, then the two eyes.
    [-0.34, 0.56, -0.42, 0.34, -0.36, 0.10, -0.16, -0.02, 0.16, -0.02, 0.36, 0.10, 0.42, 0.34, 0.34, 0.56],
    [-0.24, 0.34, -0.16, 0.40, -0.08, 0.34, -0.16, 0.28, -0.24, 0.34],
    [0.24, 0.34, 0.16, 0.40, 0.08, 0.34, 0.16, 0.28, 0.24, 0.34],
    // Beak, and the folded wing down the flank.
    [0.0, 0.24, -0.05, 0.10, 0.0, 0.04, 0.05, 0.10, 0.0, 0.24],
    [-0.40, 0.02, -0.44, -0.24, -0.34, -0.48, -0.18, -0.62],
    [0.40, 0.02, 0.44, -0.24, 0.34, -0.48, 0.18, -0.62],
    // Breast barring.
    [-0.26, -0.12, 0.26, -0.12],
    [-0.30, -0.30, 0.30, -0.30],
    [-0.24, -0.46, 0.24, -0.46],
  ],
  raptor: [
    // Leading edges, and the primaries drawn as separate quills.
    [-0.16, 0.28, -0.46, 0.24, -0.76, 0.16, -0.94, 0.06],
    [0.16, 0.28, 0.46, 0.24, 0.76, 0.16, 0.94, 0.06],
    [-0.40, 0.22, -0.44, 0.02],
    [-0.58, 0.16, -0.66, -0.04],
    [-0.76, 0.10, -0.86, -0.10],
    [0.40, 0.22, 0.44, 0.02],
    [0.58, 0.16, 0.66, -0.04],
    [0.76, 0.10, 0.86, -0.10],
    // Head and the fanned tail.
    [-0.06, 0.30, 0.0, 0.42, 0.06, 0.30],
    [0.0, -0.10, 0.0, -0.56],
    [-0.10, -0.14, -0.14, -0.58],
    [0.10, -0.14, 0.14, -0.58],
  ],
  water: [
    // Neck line, eye, bill.
    [-0.10, 0.86, -0.12, 0.56, -0.08, 0.28],
    [0.0, 0.80, 0.06, 0.84, 0.02, 0.76],
    [0.14, 0.86, 0.30, 0.92],
    // Folded wing and the flank.
    [0.10, 0.10, 0.34, -0.02, 0.48, -0.20, 0.42, -0.40],
    [-0.20, -0.10, 0.06, -0.22, 0.28, -0.30],
    // Legs.
    [0.10, -0.54, 0.12, -0.76],
    [-0.02, -0.56, -0.04, -0.74],
  ],
  songbird: [
    // Eye, bill, wing, tail feathers.
    [-0.34, 0.44, -0.28, 0.50, -0.22, 0.44, -0.28, 0.38, -0.34, 0.44],
    [-0.46, 0.40, -0.62, 0.36],
    [-0.24, 0.24, 0.02, 0.06, 0.22, -0.14],
    [-0.10, 0.06, 0.12, -0.16, 0.30, -0.32],
    [0.36, -0.40, 0.62, -0.62, 0.82, -0.76],
    [0.32, -0.50, 0.58, -0.70],
    // Legs.
    [-0.06, -0.22, -0.02, -0.40],
  ],
  mammal: [
    // Ear, eye, muzzle.
    [-0.78, 0.26, -0.70, 0.44, -0.60, 0.28],
    [-0.74, 0.16, -0.68, 0.20, -0.64, 0.14],
    [-0.92, 0.10, -0.84, 0.06],
    // Shoulder and haunch, and the line of the back.
    [-0.56, 0.20, -0.48, -0.02, -0.40, -0.30],
    [0.30, 0.28, 0.42, 0.02, 0.40, -0.28],
    [-0.62, 0.26, -0.20, 0.24, 0.30, 0.32],
    // Legs.
    [-0.44, -0.04, -0.48, -0.54],
    [-0.34, -0.06, -0.30, -0.52],
    [0.36, -0.02, 0.32, -0.56],
    [0.24, -0.04, 0.22, -0.58],
  ],
};

export interface Figure {
  /** Points walked round the outline at even spacing. */
  outline: { x: number; y: number }[];
  /** Points along the interior strokes — the drawing inside the shape. */
  detail: { x: number; y: number }[];
  /** Points along an interior hatch, for the shading an engraver would cut. */
  hatch: { x: number; y: number }[];
  /** Points inside it, in a stable order — take as many as there is evidence. */
  fill: { x: number; y: number }[];
}

const cache = new Map<FigureId, Figure>();

/** Builds (once) an outline of `steps` points and a pool of interior points. */
export function figure(id: FigureId, steps = 150, pool = 90): Figure {
  const cached = cache.get(id);
  if (cached) return cached;

  const flat = OUTLINES[id];
  const poly: { x: number; y: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) poly.push({ x: flat[i], y: flat[i + 1] });

  // Walk the perimeter at even arc length, so a long edge is not drawn with the
  // same handful of points as a short one.
  let perimeter = 0;
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    perimeter += length;
    return { a, b, length };
  });

  const outline: { x: number; y: number }[] = [];
  let edge = 0;
  let travelled = 0;
  for (let s = 0; s < steps; s += 1) {
    const want = (s / steps) * perimeter;
    while (edge < edges.length - 1 && travelled + edges[edge].length < want) {
      travelled += edges[edge].length;
      edge += 1;
    }
    const t = edges[edge].length < 1e-6 ? 0 : (want - travelled) / edges[edge].length;
    outline.push({
      x: edges[edge].a.x + (edges[edge].b.x - edges[edge].a.x) * t,
      y: edges[edge].a.y + (edges[edge].b.y - edges[edge].a.y) * t,
    });
  }

  // Interior points by rejection, on a fixed pseudo-random sequence so the same
  // species always fills the same way.
  const fill: { x: number; y: number }[] = [];
  let n = 1;
  while (fill.length < pool && n < 20000) {
    const x = hash(n * 12.9898) * 2 - 1;
    const y = hash(n * 78.233) * 2 - 1;
    n += 1;
    if (inside(poly, x, y)) fill.push({ x, y });
  }

  // The interior strokes, walked at the same spacing as the outline.
  const detail: { x: number; y: number }[] = [];
  for (const stroke of DETAILS[id]) {
    for (let i = 0; i + 3 < stroke.length; i += 2) {
      const ax = stroke[i];
      const ay = stroke[i + 1];
      const bx = stroke[i + 2];
      const by = stroke[i + 3];
      const steps = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 0.022));
      for (let k = 0; k <= steps; k += 1) {
        detail.push({ x: ax + (bx - ax) * (k / steps), y: ay + (by - ay) * (k / steps) });
      }
    }
  }

  // The hatch: parallel cuts at an angle, clipped to the inside of the shape.
  // It is what stops a filled figure from reading as a sticker, and it is
  // deliberately dim — the bright marks inside a figure are its detections,
  // and shading must never be mistaken for evidence.
  const hatch: { x: number; y: number }[] = [];
  const angle = -0.62;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let line = -1.6; line <= 1.6; line += 0.115) {
    let run = 0;
    for (let t = -1.6; t <= 1.6; t += 0.02) {
      const x = cos * t - sin * line;
      const y = sin * t + cos * line;
      if (!inside(poly, x, y)) {
        run = 0;
        continue;
      }
      run += 1;
      // Skip the first sample of every span so the hatch stops short of the
      // outline instead of thickening it.
      if (run > 1 && run % 2 === 0) hatch.push({ x, y });
    }
  }

  const built = { outline, detail, hatch, fill };
  cache.set(id, built);
  return built;
}

function inside(poly: { x: number; y: number }[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
