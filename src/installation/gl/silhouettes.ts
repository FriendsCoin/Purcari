/**
 * Two forms, and the guild mapping that chooses between them.
 *
 * When a visitor chooses an animal, the swarm gathers a ghost of it. The forms
 * are surface point clouds sampled from meshes that were generated — a bird in
 * flight and a quadruped in profile — and baked into `glyphClouds.json` by
 * `scripts/build_glyph_clouds.mjs`. See that script for why a point cloud and
 * not the mesh.
 *
 * These are deliberately *category glyphs* and not portraits. The survey ships
 * detections, not images, and a plausible rendering of a Turtle Dove would be an
 * invention dressed as a record. A glyph is a label: it says "bird" the way the
 * word does, and the species' own name sits beside it in real type. The only
 * claim being made is the survey's own guild for the species, drawn as a shape.
 */

import clouds from './glyphClouds.json';

export type GlyphKind = 'bird' | 'mammal';

/** How many points each form carries; both clouds are built to the same count. */
export const GLYPH_POINTS = clouds.points;

/**
 * The survey's own guilds, sorted into the two forms.
 *
 * Everything not listed here is drawn as a bird, which is not a guess: 197 of
 * the 213 species came from the acoustic survey and the guild vocabulary is
 * overwhelmingly ornithological. The mammal guilds are named explicitly so the
 * fallback can never quietly turn a roe deer into a heron.
 */
const MAMMAL_GUILDS = new Set(['carnivore', 'herbivore', 'rodent', 'mammal', 'small mammal']);

export function glyphFor(guild: string): GlyphKind {
  return MAMMAL_GUILDS.has(guild) ? 'mammal' : 'bird';
}

/**
 * One form as a flat xyz buffer, centred on the origin and normalised so its
 * longest axis spans 1. Already oriented to face the camera with Y up — the
 * turn was resolved at build time, not here.
 */
export function glyphCloud(kind: GlyphKind): Float32Array {
  return new Float32Array(clouds[kind]);
}

/**
 * Where the clouds came from.
 *
 * `GLYPH_SOURCE` is the full statement and lives in the built file beside the
 * data it describes. `GLYPH_CREDIT` is the one line the piece shows a visitor:
 * everything else on screen is measured, and the only two things that are not
 * should say so before anyone walks up to the screen.
 */
export const GLYPH_SOURCE = clouds.source;
export const GLYPH_CREDIT =
  'Two forms — a bird and a quadruped — are generated illustration, not records. Everything else is measured.';
