/**
 * Chapter — "Refuge".
 *
 * Every chapter before this one describes the estate. This one asks what the
 * estate's own choices do to it. Nothing outside its boundary appears.
 *
 * Three readings of the same row of columns, and the row dissolves and re-forms
 * between them rather than sliding:
 *
 *   Practices  — the stages of the estate's own sustainable programme, each
 *                pillar standing at how far that stage has been rolled out.
 *   Habitats   — the ground inside the boundary, each pillar standing at the
 *                effective number of species that habitat carries.
 *   Ecosystem  — the three pillars the published ecosystem score is built from,
 *                with the overall score drawn across as their datum.
 *
 * The row is a colonnade: each reading stands on a plinth, rises through a
 * fluted shaft and ends in a capital sitting exactly at its number. The
 * architecture is the reading, and the biome — the estate's own recorded
 * community — is the light rising inside it.
 *
 * TWO SCALES IN THE PRACTICES READING, and this is deliberate rather than
 * sloppy. Three of the stages are published as a share (of the estate, of its
 * treatments, of its water); two are published only in hectares, and the
 * estate's total area is not published anywhere in the survey. There is no
 * honest conversion between them, so they are drawn as two groups with a gap
 * between and their units on their captions, and the hectare pillars are left
 * open at the top — no capital — because a capital would assert a position on
 * an axis they are not on.
 *
 * Beneath everything runs the protection line: a cold sheet whose filled height
 * is `protection.protConn` of the tallest column. That figure is 0.0%, so the
 * sheet fills nothing and all that remains is a hairline with no height at all.
 * It is drawn from the data, not drawn to look like an argument.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import { HABITAT_LABELS, PALETTE, toRGB } from '../core/palette';
import type { InstallationData } from '../core/types';
import { DITHER, SIMPLEX_3D, SPRITE, TONEMAP } from './chunks';

/* ------------------------------------------------------------------ layout */

/**
 * Compile-time bound on the per-column uniform arrays. The estate's twelve
 * stations fall into ten habitats; anything beyond this is dropped rather than
 * silently overflowing the arrays, which on some drivers is a black screen
 * instead of an error.
 */
const MAX_COLUMNS = 10;

/** Capacity of one column. The density gate lights a fraction of these. */
const MOTES_PER_COLUMN = 300;

/**
 * Total width the row is allowed. Ten habitats have to fit the frame seven land
 * uses did, so the gap is fitted to the count rather than fixed — capped, so a
 * short row does not stretch into a picket fence.
 */
const ROW_WIDTH = 13.2;
const MAX_COLUMN_GAP = 1.74;

function columnGap(count: number): number {
  return Math.min(MAX_COLUMN_GAP, ROW_WIDTH / Math.max(1, count - 1));
}
const COLUMN_RADIUS = 0.32;
const MAX_HEIGHT = 5.0;
/** Mote size in WORLD units — the vertex shader converts to pixels by depth. */
const MOTE_SIZE = 0.42;

/** The row stands on y = 0; the group is dropped so it frames a camera aimed at the origin. */
const BASE_Y = -1.85;

const HERO_RING_INNER = 0.46;
const HERO_RING_OUTER = 0.92;

/**
 * Spacing of the three ecosystem pillars. Wider than the habitat row: three
 * readings deserve the air that ten cannot have.
 */
const PILLAR_GAP = 3.4;

/** Spacing inside a practice group, and the break between the two scales. */
const PRACTICE_GAP = 2.4;
const PRACTICE_GROUP_BREAK = 4.2;

/**
 * The tallest hectare figure the survey publishes. It sets the second scale, and
 * it is only ever compared with the other hectare figure — never with a share.
 */
const HECTARE_SCALE = 300;

/** Flutes cut into each shaft — the count that reads as a column and not a pipe. */
const SHAFT_FLUTES = 9.0;
const SHAFT_SIDES = 20;
/**
 * Rings up the shaft. Two would be enough to draw a tube and is what the first
 * version had — but then every profile term in the vertex shader is only ever
 * evaluated at the two ends, the radius interpolates straight between them, and
 * a column with a plinth and a capital renders as a lampshade. The profile needs
 * somewhere to be carved.
 */
const SHAFT_RINGS = 14;

/** Samples along each chord of the skyline. */
const SKYLINE_STEPS = 20;
/** Half-width of the tick drawn across each column's head. */
const SKYLINE_TICK = 0.30;
/** Radius of the pool of light a column casts on the floor, before its fill scales it. */
const POOL_RADIUS = 0.95;
const POOL_SEGMENTS = 40;

/** How far above and below the baseline the protection sheet reaches. */
const PROT_BAND = 0.74;
const PROT_BELOW = 0.14;

/** Finger-sized pick radius, in CSS pixels. */
const PICK_RADIUS = 70;

/** Seconds the row takes to dissolve and re-form when the reading changes. */
const MORPH_SECONDS = 1.3;

const hexColor = (hex: string): THREE.Color => new THREE.Color().fromArray(toRGB(hex));

/**
 * Deterministic pseudo-random from a land-use name — the same column always
 * grows the same way, so a returning visitor sees the same estate.
 */
function rand(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/* -------------------------------------------------------------- data → row */

/** One metric's reading of a land use: how tall its column stands, how full it is. */
interface Reading {
  /** World units. */
  height: number;
  /** 0..1 fraction of the column's mote capacity that is alive. */
  fill: number;
}

interface ColumnLayout {
  landUse: string;
  self: boolean;
  x: number;
  /** null when the land use is missing from that survey — it fades out, never pops. */
  camera: Reading | null;
  bird: Reading | null;
  color: THREE.Color;
}

/**
 * Density floor: the sparsest column still has to read as a column rather than
 * as a handful of stray sparks.
 */
function density(richness: number, max: number): number {
  return 0.16 + 0.84 * (richness / Math.max(1, max));
}

/**
 * Motes are laid out along the column's height, so the count that fills a column
 * is the linear density times the height — richness sets how thick the light is
 * per metre, diversity sets how far up it goes.
 */
function reading(heightNorm: number, richness: number, maxRichness: number): Reading {
  return {
    height: heightNorm * MAX_HEIGHT,
    fill: Math.min(1, heightNorm * density(richness, maxRichness)),
  };
}

/**
 * Ground the estate works or has built on. Everything else it keeps.
 *
 * This is a statement of what each hectare *is*, and it is deliberately not a
 * ranking. The worked block is not the poorest ground in either reading — it
 * outscores the tree line for mammals and both the tree line and the pond margin
 * for birds — so colouring production as "poor" would be an argument the survey
 * does not support. The heights do the ranking; the colour only says which
 * ground is in production and which the estate keeps.
 */
const WORKED_HABITATS = new Set(['vineyard']);
const BUILT_HABITATS = new Set(['chateau']);

/** Shannon over a pooled count vector. */
function shannon(counts: number[]): number {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const n of counts) {
    if (n <= 0) continue;
    const p = n / total;
    h -= p * Math.log(p);
  }
  return h;
}

/**
 * One column per habitat inside the estate.
 *
 * Detections are pooled across every station of a habitat and the indices are
 * computed from the pooled vector. Averaging each station's own richness would
 * be wrong in the other direction: the two woodland stations share most of their
 * species, so summing double-counts and averaging throws away the half of the
 * woodland community that only one of them saw.
 *
 * A species the survey recorded by both methods counts in both readings. Its
 * per-station totals are not split by method in the export, and inventing a
 * split would be worse than counting it once in each of two separate answers.
 */
function buildHabitats(data: InstallationData): ColumnLayout[] {
  const stationsByHabitat = new Map<string, string[]>();
  for (const site of data.sites) {
    const ids = stationsByHabitat.get(site.habitat) ?? [];
    ids.push(site.id);
    stationsByHabitat.set(site.habitat, ids);
  }

  interface Pooled {
    habitat: string;
    camera: number[];
    sound: number[];
  }

  const pooled: Pooled[] = [];
  for (const [habitat, ids] of stationsByHabitat) {
    const camera: number[] = [];
    const sound: number[] = [];
    for (const species of data.species) {
      let count = 0;
      for (const id of ids) count += species.sites[id] ?? 0;
      if (count <= 0) continue;
      if (species.modality !== 'sound') camera.push(count);
      if (species.modality !== 'camera') sound.push(count);
    }
    pooled.push({ habitat, camera, sound });
  }

  const effective = (counts: number[]) => Math.exp(shannon(counts));
  const maxCameraEffective = Math.max(...pooled.map(p => effective(p.camera)), 1);
  const maxSoundEffective = Math.max(...pooled.map(p => effective(p.sound)), 1);
  const maxCameraRichness = Math.max(...pooled.map(p => p.camera.length), 1);
  const maxSoundRichness = Math.max(...pooled.map(p => p.sound.length), 1);

  /**
   * Row order is the camera reading's own ranking, richest first, and it never
   * changes with `metric`. Re-sorting on the cross-fade would slide every column
   * sideways and destroy the one thing the row is for — watching a fixed set of
   * places rise and fall as you change who you ask.
   */
  const ordered = [...pooled]
    .sort((a, b) => effective(b.camera) - effective(a.camera))
    .slice(0, MAX_COLUMNS);

  const gap = columnGap(ordered.length);
  const span = (ordered.length - 1) * gap;

  const kept = hexColor(PALETTE.foil);
  const worked = hexColor(PALETTE.parchment);
  const built = hexColor(PALETTE.ash);

  return ordered.map((entry, i) => ({
    landUse: HABITAT_LABELS[entry.habitat] ?? entry.habitat,
    // `self` is what the caption renders in the estate's own gold; here that is
    // every hectare the estate keeps rather than works.
    self: !WORKED_HABITATS.has(entry.habitat) && !BUILT_HABITATS.has(entry.habitat),
    x: i * gap - span / 2,
    camera: reading(
      effective(entry.camera) / maxCameraEffective,
      entry.camera.length,
      maxCameraRichness
    ),
    bird: reading(
      effective(entry.sound) / maxSoundEffective,
      entry.sound.length,
      maxSoundRichness
    ),
    color: BUILT_HABITATS.has(entry.habitat)
      ? built.clone()
      : WORKED_HABITATS.has(entry.habitat)
        ? worked.clone()
        : kept.clone(),
  }));
}

/* ------------------------------------------------------------- arrangements */

/**
 * One column, in one reading of the row.
 *
 * Everything the scene needs per column lives here and reaches the GPU as a
 * uniform, so a reading is a plain array of these and adding another costs no
 * geometry. The row eases between arrangements while a dissolve pulse dims it,
 * which is what lets ten habitats become five practice stages without the two
 * being mistaken for the same objects rearranging.
 */
interface Slot {
  label: string;
  /** Position along the row, world units. */
  x: number;
  /** World height of the capital — the reading itself. */
  height: number;
  /** 0..1 share of the column's mote capacity that is alive. */
  fill: number;
  /** 0..1; a slot with no reading behind it fades out rather than collapsing. */
  presence: number;
  color: THREE.Color;
  /** Drives the caption's gold — the readings the chapter wants the eye on. */
  self: boolean;
  /** 1 = a capital at the reading, 0 = left open because there is no axis for it. */
  capital: number;
  /**
   * Which scale this column is measured on. The skyline joins heads *within* a
   * group and breaks between them: a thread running from a share to a hectare
   * figure would draw a profile across two axes, which is the one thing the two
   * groups exist to prevent.
   */
  group: number;
}

const EMPTY_SLOT = (x: number): Slot => ({
  label: '',
  x,
  height: 0,
  fill: 0,
  presence: 0,
  color: hexColor(PALETTE.ash),
  self: false,
  capital: 0,
  group: 0,
});

/** Pad an arrangement out to the uniform arrays' fixed length. */
function padded(slots: Slot[]): Slot[] {
  const out = slots.slice(0, MAX_COLUMNS);
  // Absent slots drift outward as they fade, so they leave the frame rather than
  // piling up on the last real column.
  while (out.length < MAX_COLUMNS) out.push(EMPTY_SLOT((out.length - MAX_COLUMNS / 2) * 2.4));
  return out;
}

/**
 * The stages of the estate's own sustainable programme.
 *
 * Left group — measured as a share, and standing at it. Right group — published
 * only in hectares, standing on their own scale, open at the top. See the note
 * at the head of this file for why they are not reconciled: the estate's total
 * area is not in the survey, so there is no conversion that would not be an
 * invention.
 *
 * Mote density is uniform across every stage, and deliberately so. The survey is
 * a single twelve-month baseline with no before-and-after, so the light rising
 * through these columns is the one community the estate holds — not a claim
 * about what each practice contributes to it.
 */
function buildPractices(data: InstallationData): Slot[] {
  const estate = data.narrative.estate;
  const notInProduction = data.narrative.landCover
    .filter(entry => entry.label !== 'Agricultural' && entry.label !== 'Built')
    .reduce((sum, entry) => sum + entry.share, 0);

  const shares = [
    { label: 'Treatments cut', value: estate.phytosanitaryReduction },
    { label: 'Land kept', value: notInProduction },
    // The conservative end of the published range; the caption carries both.
    { label: 'Water saved', value: estate.waterSavingLow },
  ].sort((a, b) => b.value - a.value);

  const hectares = [
    { label: 'Drip irrigation', value: estate.dripIrrigationHectares },
    { label: 'Organic conversion', value: estate.organicConversionHectares },
  ].sort((a, b) => b.value - a.value);

  const kept = hexColor(PALETTE.foil);
  const measured = hexColor(PALETTE.parchment);

  const slots: Slot[] = [];
  shares.forEach((entry, i) => {
    slots.push({
      label: entry.label,
      x: i * PRACTICE_GAP,
      height: entry.value * MAX_HEIGHT,
      fill: 0.55,
      presence: 1,
      color: kept.clone(),
      self: true,
      capital: 1,
      group: 0,
    });
  });

  const offset = (shares.length - 1) * PRACTICE_GAP + PRACTICE_GROUP_BREAK;
  hectares.forEach((entry, i) => {
    slots.push({
      label: entry.label,
      x: offset + i * PRACTICE_GAP,
      height: (entry.value / HECTARE_SCALE) * MAX_HEIGHT,
      fill: 0.55,
      presence: 1,
      color: measured.clone(),
      self: false,
      capital: 0,
      group: 1,
    });
  });

  // Centre the whole row on the origin, gap and all.
  const centre = (slots[0].x + slots[slots.length - 1].x) / 2;
  for (const slot of slots) slot.x -= centre;
  return padded(slots);
}

/**
 * The three readings the estate's published ecosystem score is built from.
 *
 * This is the one reading that is not a row of places at all but a statement
 * about the whole estate: how strong its ecosystem is, and which leg of it is
 * doing the work. Connectivity stands at 78.4 and intrinsic quality at 34.6 —
 * the estate is strong because it is joined to the landscape around it, not
 * because any single hectare of it is pristine. Three pillars, and the overall
 * score is the line they are measured against.
 *
 * Gold above that line, cool below it, so the weak leg is visible without a
 * legend — cool, but not so deep it stops being legible, or "below the datum"
 * turns into "not there".
 */
function buildPillars(data: InstallationData): Slot[] {
  const score = data.narrative.ecosystemScore;
  const entries = [
    { label: 'Intrinsic quality', value: score.intrinsic },
    { label: 'Landscape', value: score.landscape },
    { label: 'Connectivity', value: score.connectivity },
  ];
  const span = (entries.length - 1) * PILLAR_GAP;
  return padded(
    entries.map((entry, i) => ({
      label: entry.label,
      x: i * PILLAR_GAP - span / 2,
      height: (entry.value / 100) * MAX_HEIGHT,
      fill: Math.min(1, entry.value / 100),
      presence: 1,
      color:
        entry.value >= score.overall
          ? hexColor(PALETTE.foil)
          : hexColor(PALETTE.dusk).lerp(hexColor(PALETTE.parchment), 0.4),
      self: entry.value >= score.overall,
      capital: 1,
      group: 0,
    }))
  );
}

/**
 * The habitat row at a given point in the mammals-to-birds cross-fade.
 *
 * Resolved per frame rather than baked, because `metric` is a continuous control
 * and the row has to bend through it: a habitat missing from one survey holds
 * the other's shape while its presence fades, so nothing collapses to the floor.
 */
function habitatSlots(columns: ColumnLayout[], metric: number): Slot[] {
  return padded(
    columns.map(column => {
      const cam = column.camera ?? column.bird;
      const bird = column.bird ?? column.camera;
      const height = cam && bird ? cam.height * (1 - metric) + bird.height * metric : 0;
      const fill = cam && bird ? cam.fill * (1 - metric) + bird.fill * metric : 0;
      return {
        label: column.landUse,
        x: column.x,
        height,
        fill,
        presence: (column.camera ? 1 - metric : 0) + (column.bird ? metric : 0),
        color: column.color,
        self: column.self,
        capital: 1,
        group: 0,
      };
    })
  );
}

/* --------------------------------------------------------------- geometries */

/**
 * All columns in ONE Points buffer — a single draw call for the whole row.
 * `position` carries only the column's axis; the offset inside the column and
 * the height along it are attributes the vertex shader resolves per frame, which
 * is what lets height and density change without touching the buffer.
 */
function buildMoteGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const count = columns.length * MOTES_PER_COLUMN;
  const positions = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 2);
  const columnIndex = new Float32Array(count);
  const phases = new Float32Array(count);
  const ranks = new Float32Array(count);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const scales = new Float32Array(count);
  const heroes = new Float32Array(count);

  let k = 0;
  columns.forEach((column, ci) => {
    const radius = column.self ? COLUMN_RADIUS * 1.15 : COLUMN_RADIUS;
    for (let m = 0; m < MOTES_PER_COLUMN; m++) {
      const salt = m * 8;
      // sqrt of a uniform sample fills the disc evenly instead of crowding the axis.
      const r = radius * Math.sqrt(rand(column.landUse, salt + 1));
      const theta = rand(column.landUse, salt + 2) * Math.PI * 2;

      positions[k * 3] = column.x;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = 0;
      offsets[k * 2] = Math.cos(theta) * r;
      offsets[k * 2 + 1] = Math.sin(theta) * r;

      columnIndex[k] = ci;
      phases[k] = rand(column.landUse, salt + 3);
      // The density gate keeps motes whose rank falls under the current fill.
      // A random rank rather than a sequential one means the motes that drop out
      // are scattered through the column instead of shearing off its top.
      ranks[k] = rand(column.landUse, salt + 4);
      speeds[k] = 0.55 + rand(column.landUse, salt + 5) * 0.9;
      seeds[k] = rand(column.landUse, salt + 6);
      scales[k] =
        MOTE_SIZE * (0.7 + rand(column.landUse, salt + 7) * 0.7) * (column.self ? 1.3 : 1);

      heroes[k] = column.self ? 1 : 0;
      k++;
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2));
  geometry.setAttribute('aColumn', new THREE.BufferAttribute(columnIndex, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aHero', new THREE.BufferAttribute(heroes, 1));

  // Every mote's stored position sits on the baseline; the rise happens in the
  // shader, so an automatic bounding sphere would be a flat line and the row
  // would cull itself away the moment the camera looked slightly down.
  const half = (columns.length - 1) * columnGap(columns.length) * 0.5 + COLUMN_RADIUS;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, MAX_HEIGHT * 0.5, 0),
    Math.hypot(half, MAX_HEIGHT * 0.5) + 1
  );
  return geometry;
}

/**
 * The skyline: a thread strung head to head across the row, plus a tick laid
 * across each head.
 *
 * The columns already carry the comparison, but a row of separate glows makes the
 * eye measure each one against the frame instead of against its neighbours. The
 * thread turns them into a single profile — and because its height is read from
 * the same live uniform arrays the motes are, it *bends* through the camera-to-bird
 * cross-fade instead of being redrawn. Watching the wooded park's head fall past
 * the vineyard's as you change who you ask is the chapter's second argument.
 *
 * No JavaScript touches this buffer after it is built: every vertex carries the
 * two columns it lies between and resolves its own height in the vertex shader.
 */
function buildSkylineGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const columnA: number[] = [];
  const columnB: number[] = [];
  const blends: number[] = [];

  const push = (x: number, a: number, b: number, blend: number) => {
    positions.push(x, 0, 0);
    columnA.push(a);
    columnB.push(b);
    blends.push(blend);
  };

  for (let i = 0; i < columns.length - 1; i++) {
    const left = columns[i];
    const right = columns[i + 1];
    for (let s = 0; s < SKYLINE_STEPS; s++) {
      for (const step of [s, s + 1]) {
        const blend = step / SKYLINE_STEPS;
        push(left.x + (right.x - left.x) * blend, i, i + 1, blend);
      }
    }
  }

  // A tick across each head — the reading itself, where the thread passes through.
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    for (const sign of [-1, 1]) {
      push(column.x, i, i, 0);
      push(column.x + SKYLINE_TICK * sign, i, i, 0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColumnA', new THREE.Float32BufferAttribute(columnA, 1));
  geometry.setAttribute('aColumnB', new THREE.Float32BufferAttribute(columnB, 1));
  geometry.setAttribute('aBlend', new THREE.Float32BufferAttribute(blends, 1));
  // Heights are resolved in the shader, so the stored geometry is a flat line and
  // an automatic bounding sphere would cull the thread the moment it lifted.
  const half = (columns.length - 1) * columnGap(columns.length) * 0.5 + SKYLINE_TICK;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, MAX_HEIGHT * 0.5, 0),
    Math.hypot(half, MAX_HEIGHT * 0.5) + 1
  );
  return geometry;
}

/**
 * A pool of light on the floor under each column, its radius following that
 * column's fill. It costs one draw call and it is what stops the row reading as
 * seven glows floating in a void: the cores now stand on something and cast onto
 * it, which is the whole cellar metaphor the chapter is built on.
 */
function buildPoolGeometry(count: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const radial: number[] = [];
  const columnIndex: number[] = [];

  const vertex = (ci: number, rx: number, rz: number) => {
    positions.push(0, 0, 0);
    radial.push(rx, rz);
    columnIndex.push(ci);
  };

  for (let ci = 0; ci < count; ci++) {
    for (let s = 0; s < POOL_SEGMENTS; s++) {
      const a0 = (s / POOL_SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / POOL_SEGMENTS) * Math.PI * 2;
      // A fan is fine here because the fragment shader recovers the radius from
      // an interpolated 2D offset rather than from an interpolated scalar — the
      // linear interpolation of a vector across a triangle is exact, so there are
      // none of the radial spikes a per-vertex radius would produce.
      vertex(ci, 0, 0);
      vertex(ci, Math.cos(a0) * POOL_RADIUS, Math.sin(a0) * POOL_RADIUS);
      vertex(ci, Math.cos(a1) * POOL_RADIUS, Math.sin(a1) * POOL_RADIUS);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRadial', new THREE.Float32BufferAttribute(radial, 2));
  geometry.setAttribute('aColumn', new THREE.Float32BufferAttribute(columnIndex, 1));
  // Pools are placed from the uniform x each frame, so the stored positions are
  // only a starting point — bound for the whole row in either arrangement.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    ROW_WIDTH + POOL_RADIUS * 2
  );
  return geometry;
}

/**
 * The shaft: a fluted, tapering shell of light around each plume, with a plinth
 * at its foot and a flared capital at its head.
 *
 * The plumes alone read as smoke. The whole argument of the chapter is that this
 * estate *holds something up* — and a column that holds something up has a
 * silhouette: it stands on a base, it narrows as it rises, it ends in a capital.
 * The capital sits exactly at the reading, so the architecture is the number.
 *
 * One buffer for all eight slots; the height, the position and the taper are all
 * resolved in the vertex shader from the same uniform arrays the motes read, so
 * the shafts can never disagree with the light inside them.
 */
function buildShaftGeometry(count: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const radial: number[] = [];
  const angles: number[] = [];
  const ups: number[] = [];
  const columnIndex: number[] = [];

  const vertex = (ci: number, side: number, up: number) => {
    const angle = (side / SHAFT_SIDES) * Math.PI * 2;
    positions.push(0, 0, 0);
    radial.push(Math.cos(angle), Math.sin(angle));
    angles.push(side / SHAFT_SIDES);
    ups.push(up);
    columnIndex.push(ci);
  };

  for (let ci = 0; ci < count; ci++) {
    for (let s = 0; s < SHAFT_SIDES; s++) {
      for (let r = 0; r < SHAFT_RINGS; r++) {
        const lo = r / SHAFT_RINGS;
        const hi = (r + 1) / SHAFT_RINGS;
        vertex(ci, s, lo);
        vertex(ci, s + 1, lo);
        vertex(ci, s + 1, hi);
        vertex(ci, s, lo);
        vertex(ci, s + 1, hi);
        vertex(ci, s, hi);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aRadial', new THREE.Float32BufferAttribute(radial, 2));
  geometry.setAttribute('aAngle', new THREE.Float32BufferAttribute(angles, 1));
  geometry.setAttribute('aUp', new THREE.Float32BufferAttribute(ups, 1));
  geometry.setAttribute('aColumn', new THREE.Float32BufferAttribute(columnIndex, 1));
  // Built flat at the origin and raised in the shader, so an automatic bound
  // would be a point and the whole row would cull itself.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, MAX_HEIGHT * 0.5, 0),
    ROW_WIDTH + MAX_HEIGHT
  );
  return geometry;
}

/** Row half-width, including the margin the baseline and sheet run out to. */
function rowExtent(columns: ColumnLayout[]): number {
  const gap = columnGap(columns.length);
  return (columns.length - 1) * gap * 0.5 + gap * 0.85;
}

/**
 * The ground the columns stand on: one hairline rule across the row, plus a
 * short cross tick in depth under each column so the cores read as standing on
 * something rather than floating.
 */
function buildBaselineGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const half = rowExtent(columns);
  const positions: number[] = [];
  const colors: number[] = [];
  const rule = hexColor(PALETTE.ash);
  const tick = hexColor(PALETTE.parchment);

  const segments = 120;
  for (let i = 0; i < segments; i++) {
    for (const t of [i / segments, (i + 1) / segments]) {
      // Both ends fade out, so the rule has no visible termination.
      const fade = Math.pow(Math.sin(t * Math.PI), 0.55) * 0.34;
      positions.push(-half + t * half * 2, 0, 0);
      colors.push(rule.r * fade, rule.g * fade, rule.b * fade);
    }
  }

  // Two segments meeting under the column centre, so the tick can fade at both
  // ends — a single segment has only two vertices and cannot.
  for (const column of columns) {
    for (const sign of [-1, 1]) {
      positions.push(column.x, 0, 0.5 * sign);
      colors.push(0, 0, 0);
      positions.push(column.x, 0, 0);
      colors.push(tick.r * 0.3, tick.g * 0.3, tick.b * 0.3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildProtectionGeometry(columns: ColumnLayout[]): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(rowExtent(columns) * 2 + 0.6, PROT_BAND);
  // Sit the sheet so y = 0 falls just inside its lower edge: the hairline needs a
  // little room to bleed downward or it clips against its own boundary.
  geometry.translate(0, PROT_BAND * 0.5 - PROT_BELOW, 0);
  return geometry;
}

/* ------------------------------------------------------------------ shaders */

const MOTE_VERT = /* glsl */ `
${SIMPLEX_3D}
#define MAX_COLUMNS ${MAX_COLUMNS}

attribute vec2 aOffset;    // where this mote sits inside its column's disc
attribute float aColumn;
attribute float aPhase;    // start height, 0..1 of the column
attribute float aRank;     // 0..1 rank used by the density gate
attribute float aSeed;
attribute float aSpeed;
attribute float aScale;    // world units
attribute float aHero;

uniform float uTime;
uniform float uReveal;
uniform float uFocus;      // 0 = nothing selected, 1 = something is
uniform float uCount;
uniform float uRise;       // column heights per second
uniform float uSway;
uniform float uMorph;
uniform float uMorphAge;

/*
 * The change of reading travels. A scalar dip switched the whole row off and
 * on again, which read as a projector blink; staggering the same dip by column
 * turns it into a wave running left to right, so the eye is told "these are
 * re-forming in order" rather than "the image glitched". The stagger is small
 * enough that every column is still near the bottom of its own dip when the
 * data swaps at age 0.5 — nothing is caught mid-change.
 */
float morphDip(float column){
  float order = column / max(uCount - 1.0, 1.0);
  float phase = clamp((uMorphAge - order * 0.18) / 0.82, 0.0, 1.0);
  return sin(phase * 3.14159265);
}      // peaks halfway through a change of reading
uniform vec3  uColumnColor[MAX_COLUMNS];
uniform float uX[MAX_COLUMNS];
uniform float uHeight[MAX_COLUMNS];
uniform float uFill[MAX_COLUMNS];
uniform float uPresence[MAX_COLUMNS];
uniform float uSelect[MAX_COLUMNS];

varying vec3 vColor;
varying float vGlow;
varying float vAlpha;
varying float vHero;

void main(){
  // Uniform arrays are indexed here and nowhere else: GLSL ES 1.00 allows a
  // non-constant index into a uniform array in the vertex stage only, so every
  // per-column value reaches the fragment stage as a varying.
  int idx = int(aColumn + 0.5);
  float height = uHeight[idx];
  float fill = uFill[idx];
  float presence = uPresence[idx];
  float sel = uSelect[idx];

  // The row arrives left to right rather than all at once — a lag of 0.3 across
  // the whole reveal, which is a beat, not a queue.
  float order = aColumn / max(uCount - 1.0, 1.0);
  float rv = clamp(uReveal * 1.3 - order * 0.3, 0.0, 1.0);
  rv = rv * rv * (3.0 - 2.0 * rv);

  // Motes drift up the column and recycle at its foot.
  float rise = fract(aPhase + uTime * uRise * aSpeed);
  float y = rise * height * rv;

  // Fade at both ends so the recycle is a disappearance, not a jump; the top
  // fade also gives the core a soft tip instead of a cut edge.
  float ends = smoothstep(0.0, 0.05, rise) * (1.0 - smoothstep(0.88, 1.0, rise));

  // Density. The upper bound overshoots 1.0 so a completely full column keeps
  // its top decile of motes instead of dimming them.
  float alive = 1.0 - smoothstep(fill - 0.08, fill + 0.06, aRank);

  // A slow spindle: the light narrows as it climbs, and wanders as it goes.
  float taper = 1.0 - 0.20 * smoothstep(0.35, 1.0, rise);
  float t = uTime * 0.05 + aSeed * 40.0;
  vec2 wander = vec2(
    snoise(vec3(aOffset.x * 1.4, y * 0.45, t)),
    snoise(vec3(aOffset.y * 1.4, y * 0.45, t + 13.0))
  );
  vec3 p = vec3(
    uX[idx] + aOffset.x * taper + wander.x * uSway,
    y,
    position.z + aOffset.y * taper + wander.y * uSway
  );

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float breathe = 1.0 + sin(uTime * 0.9 + aSeed * 6.2831) * 0.10;
  float size = aScale * breathe * (1.0 + sel * 0.35) * (0.62 + 0.38 * rv);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;

  vColor = uColumnColor[idx];
  vHero = aHero;
  // The estate burns brighter than its neighbours before any selection happens;
  // a selection then lifts one column and drops the rest well below it.
  vGlow = mix(0.52, 1.0, aHero) * mix(1.0, mix(0.26, 1.55, sel), uFocus);
  // The row dims almost to nothing halfway through the change of reading and
  // comes back. Sliding seven land uses into three ecosystem pillars at full
  // brightness would look like the same seven objects rearranging — it would
  // read as an equivalence between "vineyard" and "connectivity", which is not
  // a claim the survey makes. Dissolving and re-forming says what it is: a
  // different question being asked of the same estate.
  vAlpha = alive * ends * presence * rv * (1.0 - morphDip(aColumn) * 0.72);
}
`;

const MOTE_FRAG = /* glsl */ `
${SPRITE}
varying vec3 vColor;
varying float vGlow;
varying float vAlpha;
varying float vHero;

void main(){
  float mask = spriteAlpha(gl_PointCoord, 0.6);
  float a = mask * vAlpha * 0.62;
  if (a <= 0.002) discard;

  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.40, d);

  // Kept well under 1.0 before blending: several hundred additive motes overlap
  // inside the densest column and the bloom pass sits downstream of all of them.
  vec3 color = vColor * vGlow;
  color += vec3(1.0, 0.94, 0.80) * core * (0.14 + vHero * 0.34) * vGlow;

  gl_FragColor = vec4(color * a, a);
}
`;

const SKYLINE_VERT = /* glsl */ `
#define MAX_COLUMNS ${MAX_COLUMNS}

attribute float aColumnA;
attribute float aColumnB;
attribute float aBlend;

uniform float uTime;
uniform float uReveal;
uniform float uFocus;
uniform float uCount;
uniform float uDatum;     // >0 flattens the thread to this height (the score datum)
uniform float uMorph;
uniform float uMorphAge;

/*
 * The change of reading travels. A scalar dip switched the whole row off and
 * on again, which read as a projector blink; staggering the same dip by column
 * turns it into a wave running left to right, so the eye is told "these are
 * re-forming in order" rather than "the image glitched". The stagger is small
 * enough that every column is still near the bottom of its own dip when the
 * data swaps at age 0.5 — nothing is caught mid-change.
 */
float morphDip(float column){
  float order = column / max(uCount - 1.0, 1.0);
  float phase = clamp((uMorphAge - order * 0.18) / 0.82, 0.0, 1.0);
  return sin(phase * 3.14159265);
}
uniform vec3  uColumnColor[MAX_COLUMNS];
uniform float uGroup[MAX_COLUMNS];
uniform float uX[MAX_COLUMNS];
uniform float uHeight[MAX_COLUMNS];
uniform float uPresence[MAX_COLUMNS];
uniform float uSelect[MAX_COLUMNS];

varying vec3  vColor;
varying float vAlpha;
varying float vRun;    // 0..1 along the row, for the glint

void main(){
  int ia = int(aColumnA + 0.5);
  int ib = int(aColumnB + 0.5);

  // In the land-use reading the thread joins the heads and *is* the profile. In
  // the ecosystem reading it flattens to the overall score and becomes the datum
  // the three pillars are read against — connectivity standing above it, the
  // intrinsic reading well below.
  // Named "level" rather than the obvious name: GLSL reserves "flat" as an
  // interpolation qualifier, and a variable called that is a compile error.
  float level = step(0.001, uDatum);
  float y = mix(mix(uHeight[ia], uHeight[ib], aBlend), uDatum, level);
  float presence = mix(min(uPresence[ia], uPresence[ib]), 1.0, level);
  // A segment spanning two scales is not a profile. It is not drawn.
  presence *= 1.0 - step(0.5, abs(uGroup[ia] - uGroup[ib]));
  float sel = max(uSelect[ia], uSelect[ib]) * (1.0 - level);

  // Same left-to-right lag as the motes, so the thread arrives with its columns.
  float order = mix(aColumnA, aColumnB, aBlend) / max(uCount - 1.0, 1.0);
  float rv = clamp(uReveal * 1.3 - order * 0.3, 0.0, 1.0);
  rv = rv * rv * (3.0 - 2.0 * rv);

  vec3 p = vec3(mix(uX[ia], uX[ib], aBlend), y * rv, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  vRun = order;
  // A land use missing from the current survey drops out of the thread rather
  // than dragging it to the floor: the segment fades, it does not lie.
  vColor = mix(mix(uColumnColor[ia], uColumnColor[ib], aBlend), vec3(1.0, 0.93, 0.78), level);
  vAlpha = presence * rv * (0.46 + sel * 0.60) * mix(1.0, mix(0.45, 1.35, sel), uFocus)
         * (1.0 - morphDip((aColumnA + aColumnB) * 0.5) * 0.6);
}
`;

const SKYLINE_FRAG = /* glsl */ `
uniform float uTime;

varying vec3  vColor;
varying float vAlpha;
varying float vRun;

void main(){
  // A glint travelling the length of the row, so the profile is read left to
  // right — the direction the ranking is meant to be read in.
  float glint = exp(-pow((vRun - fract(uTime * 0.09)) * 6.0, 2.0));
  float a = vAlpha * (0.62 + 0.38 * glint);
  if (a <= 0.002) discard;
  gl_FragColor = vec4((vColor + vec3(1.0, 0.93, 0.78) * glint * 0.5) * a, a);
}
`;

const POOL_VERT = /* glsl */ `
#define MAX_COLUMNS ${MAX_COLUMNS}

attribute vec2 aRadial;
attribute float aColumn;

uniform float uTime;
uniform float uReveal;
uniform float uFocus;
uniform float uCount;
uniform float uMorph;
uniform float uMorphAge;

/*
 * The change of reading travels. A scalar dip switched the whole row off and
 * on again, which read as a projector blink; staggering the same dip by column
 * turns it into a wave running left to right, so the eye is told "these are
 * re-forming in order" rather than "the image glitched". The stagger is small
 * enough that every column is still near the bottom of its own dip when the
 * data swaps at age 0.5 — nothing is caught mid-change.
 */
float morphDip(float column){
  float order = column / max(uCount - 1.0, 1.0);
  float phase = clamp((uMorphAge - order * 0.18) / 0.82, 0.0, 1.0);
  return sin(phase * 3.14159265);
}
uniform vec3  uColumnColor[MAX_COLUMNS];
uniform float uX[MAX_COLUMNS];
uniform float uFill[MAX_COLUMNS];
uniform float uPresence[MAX_COLUMNS];
uniform float uSelect[MAX_COLUMNS];

varying vec3  vColor;
varying vec2  vRadial;
varying float vAlpha;
varying float vSelect;

void main(){
  int idx = int(aColumn + 0.5);
  float fill = uFill[idx];
  float presence = uPresence[idx];
  float sel = uSelect[idx];

  float order = aColumn / max(uCount - 1.0, 1.0);
  float rv = clamp(uReveal * 1.3 - order * 0.3, 0.0, 1.0);
  rv = rv * rv * (3.0 - 2.0 * rv);

  // The pool widens with the column's density, and breathes very slightly.
  float scale = (0.45 + fill * 0.85) * (1.0 + sin(uTime * 0.35 + aColumn) * 0.03 + sel * 0.10);
  vec3 p = vec3(uX[idx] + aRadial.x * scale, 0.004, position.z + aRadial.y * scale);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  vColor = uColumnColor[idx];
  vRadial = aRadial;
  vSelect = sel;
  vAlpha = presence * rv * mix(1.0, mix(0.30, 1.5, sel), uFocus) * (1.0 - morphDip(aColumn) * 0.6);
}
`;

const POOL_FRAG = /* glsl */ `
${TONEMAP}
${DITHER}

uniform float uTime;

varying vec3  vColor;
varying vec2  vRadial;
varying float vAlpha;
varying float vSelect;

void main(){
  // Radius recovered per fragment from the interpolated offset — exact, and free
  // of the radial banding a per-vertex radius gives a triangle fan.
  float r = length(vRadial) / ${POOL_RADIUS.toFixed(3)};
  float body = pow(clamp(1.0 - r, 0.0, 1.0), 2.6);
  // A ring travelling outward, slow enough to read as light settling.
  float ripple = 0.86 + 0.14 * sin(r * 9.0 - uTime * 0.7 + vSelect * 2.0);
  float glow = body * ripple * vAlpha * 0.46;
  if (glow <= 0.002) discard;
  gl_FragColor = vec4(dither(aces(vColor * glow), gl_FragCoord.xy), glow);
}
`;

const SHAFT_VERT = /* glsl */ `
#define MAX_COLUMNS ${MAX_COLUMNS}

attribute vec2 aRadial;
attribute float aAngle;
attribute float aUp;
attribute float aColumn;

uniform float uTime;
uniform float uReveal;
uniform float uFocus;
uniform float uCount;
uniform float uMorph;
uniform float uMorphAge;

/*
 * The change of reading travels. A scalar dip switched the whole row off and
 * on again, which read as a projector blink; staggering the same dip by column
 * turns it into a wave running left to right, so the eye is told "these are
 * re-forming in order" rather than "the image glitched". The stagger is small
 * enough that every column is still near the bottom of its own dip when the
 * data swaps at age 0.5 — nothing is caught mid-change.
 */
float morphDip(float column){
  float order = column / max(uCount - 1.0, 1.0);
  float phase = clamp((uMorphAge - order * 0.18) / 0.82, 0.0, 1.0);
  return sin(phase * 3.14159265);
}
uniform vec3  uColumnColor[MAX_COLUMNS];
uniform float uCapital[MAX_COLUMNS];
uniform float uX[MAX_COLUMNS];
uniform float uHeight[MAX_COLUMNS];
uniform float uFill[MAX_COLUMNS];
uniform float uPresence[MAX_COLUMNS];
uniform float uSelect[MAX_COLUMNS];

varying float vAngle;
varying float vUp;
varying float vAlpha;
varying float vSelect;
varying float vPhase;
varying float vCrown;
varying vec3  vColor;

void main(){
  int idx = int(aColumn + 0.5);
  float height = uHeight[idx];
  float presence = uPresence[idx];
  float sel = uSelect[idx];

  float order = aColumn / max(uCount - 1.0, 1.0);
  float rv = clamp(uReveal * 1.3 - order * 0.3, 0.0, 1.0);
  rv = rv * rv * (3.0 - 2.0 * rv);

  // The silhouette that makes it a column rather than a tube: a foot that
  // spreads, a shaft that is very nearly parallel — with the faint outward swell
  // a real column is given so it does not look pinched — and a capital that
  // flares once, sharply, exactly at the reading.
  float plinth  = 1.0 + 0.30 * (1.0 - smoothstep(0.0, 0.06, aUp));
  float shaft   = 1.0 - 0.09 * aUp + 0.045 * sin(aUp * 3.14159265);
  // A capital asserts a position on an axis. The two hectare stages are not on
  // the row's axis, so they get none — the shaft simply stops, open.
  float crown   = uCapital[idx];
  float capital = 1.0 + 0.28 * crown * smoothstep(0.88, 0.955, aUp)
                       * (1.0 - smoothstep(0.985, 1.0, aUp));
  float radius  = 0.32 * 1.45 * plinth * shaft * capital;

  vec3 p = vec3(uX[idx] + aRadial.x * radius, aUp * height * rv, aRadial.y * radius);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  vAngle = aAngle;
  vUp = aUp;
  vSelect = sel;
  vColor = uColumnColor[idx];
  // Per-column phase, so the light climbing the shafts runs down the row as a
  // procession instead of every column pulsing as one organism.
  vPhase = fract(uTime * 0.085 + aColumn * 0.37);
  vCrown = crown;
  vAlpha = presence * rv * (0.55 + uFill[idx] * 0.45)
         * mix(1.0, mix(0.35, 1.5, sel), uFocus)
         * (1.0 - morphDip(aColumn) * 0.72);
}
`;

const SHAFT_FRAG = /* glsl */ `
${TONEMAP}
${DITHER}

varying float vAngle;
varying float vUp;
varying float vAlpha;
varying float vSelect;
varying float vPhase;
varying float vCrown;
varying vec3  vColor;

void main(){
  // Flutes: the shaft is carved, not smooth. A cosine rather than a hard edge,
  // because at this scale a stepped groove aliases into a moiré.
  float flute = 0.5 + 0.5 * cos(vAngle * 6.2831853 * ${SHAFT_FLUTES.toFixed(1)});
  float carve = 0.30 + 0.70 * pow(flute, 1.6);

  // The stone thins as it rises, so the plume inside reads through the top.
  float body = (1.0 - smoothstep(0.30, 1.04, vUp)) * 0.62 + 0.20;

  // Plinth and capital: the two bands that make the silhouette legible even
  // when the shaft itself is nearly transparent. Both are narrow — a wide band
  // stops reading as an edge and starts reading as a lamp.
  float plinth = exp(-vUp * 46.0) * 1.0;
  // No crown means no capital band either — the light thins out and stops.
  float capital = exp(-pow((vUp - 0.925) * 26.0, 2.0)) * 0.95 * vCrown;
  float openTop = (1.0 - vCrown) * (1.0 - smoothstep(0.55, 1.0, vUp)) * 0.22;

  // A light climbing the shaft — the one moving thing on the stone.
  float climb = exp(-pow((vUp - vPhase) * 7.0, 2.0)) * 0.5;

  float glow = (body * carve + plinth + capital + openTop + climb * carve) * vAlpha * 0.36;
  glow *= 1.0 + vSelect * 0.9;
  if (glow <= 0.002) discard;

  gl_FragColor = vec4(dither(aces(vColor * glow), gl_FragCoord.xy), clamp(glow, 0.0, 1.0));
}
`;

const PROTECTION_VERT = /* glsl */ `
varying vec2 vUv;
varying float vY;

void main(){
  vUv = uv;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PROTECTION_FRAG = /* glsl */ `
${DITHER}
${TONEMAP}
uniform vec3 uColor;
uniform float uTime;
uniform float uReveal;
uniform float uProtected;   // world height of the protected share of the row

varying vec2 vUv;
varying float vY;

void main(){
  // The sheet fills from the baseline up to uProtected, which is protConn of
  // the tallest column. protConn is 0.0%, so this term evaluates to nothing
  // anywhere and the fill is never drawn. The absence is computed, not staged.
  float fill = (1.0 - smoothstep(uProtected - 0.02, uProtected + 0.02, vY)) * step(0.0, vY);

  float line = exp(-abs(vY) * 30.0);
  float haze = exp(-max(vY, 0.0) * 5.0) * 0.10;
  float ends = smoothstep(0.0, 0.10, vUv.x) * (1.0 - smoothstep(0.90, 1.0, vUv.x));
  // A slow brightening travelling along the line, so it is cold but not dead.
  float travel = 0.76 + 0.24 * sin(vUv.x * 9.0 - uTime * 0.32);

  float glow = (line * 0.42 * travel + haze + fill * 0.35) * ends * uReveal;
  gl_FragColor = vec4(dither(aces(uColor * glow), gl_FragCoord.xy), clamp(glow, 0.0, 1.0));
}
`;

const RING_VERT = /* glsl */ `
varying float vRadius;

void main(){
  // RingGeometry is built in its local XY plane, so the radius is available
  // before the mesh is laid flat.
  vRadius = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uReveal;
uniform float uInner;
uniform float uOuter;

varying float vRadius;

void main(){
  float t = clamp((vRadius - uInner) / max(uOuter - uInner, 1e-4), 0.0, 1.0);
  // A crest in the middle of the band: no hard edge on either side.
  float band = pow(sin(t * 3.14159265), 1.6);
  float pulse = 0.74 + 0.26 * sin(uTime * 0.55);
  float glow = band * 0.30 * pulse * uReveal;
  gl_FragColor = vec4(uColor * glow, glow);
}
`;

/* ---------------------------------------------------------------- materials */

type Uniform<T> = { value: T };

/** Object types (not interfaces) so they satisfy ShaderMaterial's index signature. */
type MoteUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uFocus: Uniform<number>;
  uCount: Uniform<number>;
  uRise: Uniform<number>;
  uSway: Uniform<number>;
  /** Peaks halfway through a change of reading, so the row can dissolve. */
  uMorph: Uniform<number>;
  uMorphAge: Uniform<number>;
  /** Above zero, the skyline flattens to this height and becomes a datum. */
  uDatum: Uniform<number>;
  uColumnColor: Uniform<THREE.Color[]>;
  uCapital: Uniform<number[]>;
  uGroup: Uniform<number[]>;
  uX: Uniform<number[]>;
  uHeight: Uniform<number[]>;
  uFill: Uniform<number[]>;
  uPresence: Uniform<number[]>;
  uSelect: Uniform<number[]>;
};

type ProtectionUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uProtected: Uniform<number>;
  uColor: Uniform<THREE.Color>;
};

type RingUniforms = {
  uTime: Uniform<number>;
  uReveal: Uniform<number>;
  uInner: Uniform<number>;
  uOuter: Uniform<number>;
  uColor: Uniform<THREE.Color>;
};

interface Shaded<U> {
  material: THREE.ShaderMaterial;
  uniforms: U;
}

/** Nothing in this chapter is lit; everything is emissive. */
const GLOW_DEFAULTS = {
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
} as const;

function createMoteMaterial(): Shaded<MoteUniforms> {
  const uniforms: MoteUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uFocus: { value: 0 },
    uCount: { value: 1 },
    // One full pass up a column takes roughly twenty seconds at the slowest.
    uRise: { value: 0.055 },
    uSway: { value: 0.085 },
    uMorph: { value: 0 },
    uMorphAge: { value: 9 },
    uDatum: { value: 0 },
    uColumnColor: {
      value: Array.from({ length: MAX_COLUMNS }, () => hexColor(PALETTE.ash)),
    },
    uCapital: { value: new Array<number>(MAX_COLUMNS).fill(1) },
    uGroup: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uX: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uHeight: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uFill: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uPresence: { value: new Array<number>(MAX_COLUMNS).fill(0) },
    uSelect: { value: new Array<number>(MAX_COLUMNS).fill(0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

/**
 * The skyline and the floor pools read the *same uniform record* the motes do —
 * the object itself, not a copy of its values. Column heights, fills, presences
 * and selections are eased once per frame in one place, and three layers that
 * must agree about where a column's head is cannot disagree by construction.
 */
function createSharedMaterial(
  uniforms: MoteUniforms,
  vertexShader: string,
  fragmentShader: string,
  side: THREE.Side = THREE.FrontSide
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side,
    ...GLOW_DEFAULTS,
  });
}

function createProtectionMaterial(protectedHeight: number): Shaded<ProtectionUniforms> {
  const uniforms: ProtectionUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uProtected: { value: protectedHeight },
    // The one cold colour in a chapter otherwise made of candlelight.
    uColor: { value: hexColor(PALETTE.dusk) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: PROTECTION_VERT,
    fragmentShader: PROTECTION_FRAG,
    side: THREE.DoubleSide,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

function createRingMaterial(): Shaded<RingUniforms> {
  const uniforms: RingUniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uInner: { value: HERO_RING_INNER },
    uOuter: { value: HERO_RING_OUTER },
    uColor: { value: hexColor(PALETTE.foil) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    side: THREE.DoubleSide,
    ...GLOW_DEFAULTS,
  });
  return { material, uniforms };
}

/* ---------------------------------------------------------------- component */

/** Screen-space distance from a point to a segment, in pixels. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Which reading of the row is on stage. */
export type RefugeMode = 'practices' | 'habitat' | 'ecosystem';

export interface RefugeProps {
  data: InstallationData;
  reveal?: number;
  /** 0 = camera/mammal Shannon comparison, 1 = bird richness comparison. Cross-fade between them. */
  metric?: number;
  /**
   * Which question the row answers — see the head of this file. All three are
   * about this estate alone.
   */
  mode?: RefugeMode;
  /** Which land use is selected, by `landUse` string, or null. */
  selected?: string | null;
  onSelect?: (landUse: string | null) => void;
  /**
   * Reports where each column's foot sits on screen, in CSS pixels, so the
   * parent can caption them in real type. A comparison nobody can read the
   * labels of is decoration — and text drawn inside the canvas would need a
   * font file, which this piece cannot fetch.
   */
  onLayout?: (marks: { landUse: string; x: number; y: number; self: boolean; value: number }[]) => void;
}

export function Refuge({
  data,
  reveal = 1,
  metric = 0,
  mode = 'practices',
  selected = null,
  onSelect,
  onLayout,
}: RefugeProps) {
  const lastLayout = useRef(0);
  const groupRef = useRef<THREE.Group>(null);
  const revealRef = useRef(0);
  /** Seeded from the prop so the first frame is already the requested metric. */
  const metricRef = useRef(THREE.MathUtils.clamp(metric, 0, 1));
  /** The reading being drawn, and the one asked for; they differ mid-change. */
  const shownRef = useRef<RefugeMode>(mode);
  const requestedRef = useRef<RefugeMode>(mode);
  const morphAt = useRef(-999);
  /** The arrangement being drawn, for the pick. Written by the frame loop. */
  const slotsRef = useRef<Slot[]>([]);
  const measureRef = useRef<THREE.LineSegments>(null);
  const measureY = useRef(0);
  const focusRef = useRef(0);
  const { camera, size } = useThree();

  const columns = useMemo(() => buildHabitats(data), [data]);
  const practices = useMemo(() => buildPractices(data), [data]);
  const pillars = useMemo(() => buildPillars(data), [data]);
  const overall = data.narrative.ecosystemScore.overall;
  const hero = useMemo(() => columns.find(column => column.self) ?? null, [columns]);

  /** protConn is a percentage; at 0.0% the sheet's fill has no height whatsoever. */
  const protectedHeight = useMemo(
    () => (data.narrative.protection.protConn / 100) * MAX_HEIGHT,
    [data.narrative.protection.protConn]
  );

  const moteGeometry = useMemo(() => buildMoteGeometry(columns), [columns]);
  const shaftGeometry = useMemo(() => buildShaftGeometry(MAX_COLUMNS), []);
  const skylineGeometry = useMemo(() => buildSkylineGeometry(columns), [columns]);
  const poolGeometry = useMemo(() => buildPoolGeometry(MAX_COLUMNS), []);
  const baselineGeometry = useMemo(() => buildBaselineGeometry(columns), [columns]);
  const protectionGeometry = useMemo(() => buildProtectionGeometry(columns), [columns]);
  const ringGeometry = useMemo(
    () => new THREE.RingGeometry(HERO_RING_INNER, HERO_RING_OUTER, 96),
    []
  );
  /** Invisible catcher, so a tap anywhere in the frame can pick or clear. */
  const backdropGeometry = useMemo(() => new THREE.PlaneGeometry(60, 40), []);

  const motes = useMemo(() => createMoteMaterial(), []);
  const skylineMaterial = useMemo(
    () => createSharedMaterial(motes.uniforms, SKYLINE_VERT, SKYLINE_FRAG),
    [motes]
  );
  const poolMaterial = useMemo(
    () => createSharedMaterial(motes.uniforms, POOL_VERT, POOL_FRAG, THREE.DoubleSide),
    [motes]
  );
  const shaftMaterial = useMemo(
    // Double-sided: the shell is open at both ends and additive, so the far wall
    // showing through is what gives the shaft its depth.
    () => createSharedMaterial(motes.uniforms, SHAFT_VERT, SHAFT_FRAG, THREE.DoubleSide),
    [motes]
  );
  const protection = useMemo(() => createProtectionMaterial(protectedHeight), [protectedHeight]);
  const ring = useMemo(() => createRingMaterial(), []);
  const baselineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        opacity: 0,
        ...GLOW_DEFAULTS,
      }),
    []
  );
  /*
   * The measure: the baseline's own geometry lifted to the selected column's
   * capital and warmed to gold. Comparison is the one thing a row of columns
   * is for, and the eye cannot hold a height across four intervening shafts —
   * a rule at that height can. It rides the same eased uniform the shafts
   * read, so it is always exactly as tall as the column is drawn, including
   * mid-change.
   */
  const measureMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        color: new THREE.Color(1.5, 1.24, 0.66),
        opacity: 0,
        ...GLOW_DEFAULTS,
      }),
    []
  );
  const backdropMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    []
  );

  useEffect(() => {
    const geometries = [
      moteGeometry,
      shaftGeometry,
      skylineGeometry,
      poolGeometry,
      baselineGeometry,
      protectionGeometry,
      ringGeometry,
      backdropGeometry,
    ];
    const materials = [
      motes.material,
      shaftMaterial,
      skylineMaterial,
      poolMaterial,
      protection.material,
      ring.material,
      baselineMaterial,
      measureMaterial,
      backdropMaterial,
    ];
    return () => {
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
    };
  }, [
    moteGeometry,
    shaftGeometry,
    skylineGeometry,
    poolGeometry,
    baselineGeometry,
    protectionGeometry,
    ringGeometry,
    backdropGeometry,
    motes,
    shaftMaterial,
    skylineMaterial,
    poolMaterial,
    protection,
    ring,
    baselineMaterial,
    measureMaterial,
    backdropMaterial,
  ]);

  /**
   * Nearest column in screen space. A column is a tall stroke, not a dot, so the
   * test is against its projected axis — a radius around its centre would miss
   * the top of the vineyard and the whole of the industrial stub.
   *
   * Reads the live uniform arrays rather than the data, so mid-cross-fade the
   * pick matches what is actually on screen.
   */
  const pick = (clientX: number, clientY: number): string | null => {
    const group = groupRef.current;
    if (!group) return null;
    const xs = motes.uniforms.uX.value;
    const heights = motes.uniforms.uHeight.value;
    const presence = motes.uniforms.uPresence.value;
    // The arrangement actually on screen. This used to read `columns` — the
    // habitat layout — for both the x of each column and its name, which meant
    // that in the practices and ecosystem readings the pick tested positions
    // no column stood at and returned habitat names nothing could match. The
    // symptom was total: in those two readings a column could not be selected
    // at all.
    const slots = slotsRef.current;
    const foot = new THREE.Vector3();
    const head = new THREE.Vector3();
    let best: string | null = null;
    let bestDistance = PICK_RADIUS;

    for (let i = 0; i < slots.length; i++) {
      // A column that has faded out is not there to be touched.
      if (presence[i] < 0.25 || slots[i].presence <= 0) continue;
      foot.set(xs[i], 0, 0).applyMatrix4(group.matrixWorld).project(camera);
      head.set(xs[i], heights[i], 0).applyMatrix4(group.matrixWorld).project(camera);
      const distance = distanceToSegment(
        clientX,
        clientY,
        (foot.x * 0.5 + 0.5) * size.width,
        (-foot.y * 0.5 + 0.5) * size.height,
        (head.x * 0.5 + 0.5) * size.width,
        (-head.y * 0.5 + 0.5) * size.height
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slots[i].label;
      }
    }
    return best;
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect?.(pick(event.nativeEvent.offsetX, event.nativeEvent.offsetY));
  };

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    // Clamp the step so a tab-switch stall cannot snap every transition open.
    const dt = Math.min(delta, 1 / 15);
    // Time-based exponential smoothing: identical response at 30 or 144 fps.
    const ease = (current: number, target: number, rate: number) =>
      current + (target - current) * (1 - Math.exp(-dt * rate));

    revealRef.current = ease(revealRef.current, THREE.MathUtils.clamp(reveal, 0, 1), 2.6);
    metricRef.current = ease(metricRef.current, THREE.MathUtils.clamp(metric, 0, 1), 1.5);
    focusRef.current = ease(focusRef.current, selected === null ? 0 : 1, 4.5);

    /* ---- which reading is on stage ---- */

    // A change of reading is not a re-scaling of the same row — it is a
    // different question — so the row dims almost to nothing, swaps at the
    // bottom of that dip, and comes back. Sliding ten habitats into five
    // practice stages at full brightness would read as an equivalence between
    // "grassland" and "drip irrigation", which is not a claim anyone is making.
    if (mode !== requestedRef.current) {
      requestedRef.current = mode;
      morphAt.current = time;
    }
    const morphAge = (time - morphAt.current) / MORPH_SECONDS;
    const morph = morphAge < 1 ? Math.sin(Math.max(0, morphAge) * Math.PI) : 0;
    // Committed at the bottom of the dip, while there is nothing on screen to see
    // change. Before that the outgoing reading is still the one being drawn.
    if (morphAge >= 0.5) shownRef.current = requestedRef.current;

    const shown = shownRef.current;
    const target =
      shown === 'practices'
        ? practices
        : shown === 'ecosystem'
          ? pillars
          : habitatSlots(columns, metricRef.current);

    slotsRef.current = target;

    const r = revealRef.current;
    const eased = r * r * (3 - 2 * r);

    const u = motes.uniforms;
    let measureHeight = 0;
    // Fast enough to have arrived by the time the row is bright again, so the
    // change is something that happened in the dark rather than a slide.
    const rate = 5.5;
    for (let i = 0; i < MAX_COLUMNS; i++) {
      const slot = target[i];
      u.uX.value[i] = ease(u.uX.value[i], slot.x, rate);
      u.uHeight.value[i] = ease(u.uHeight.value[i], slot.height, rate);
      u.uFill.value[i] = ease(u.uFill.value[i], slot.fill, rate);
      u.uPresence.value[i] = ease(u.uPresence.value[i], slot.presence, rate);
      u.uCapital.value[i] = ease(u.uCapital.value[i], slot.capital, rate);
      // Not eased: a half-broken thread is worse than either state.
      u.uGroup.value[i] = slot.group;
      u.uColumnColor.value[i].lerp(slot.color, 1 - Math.exp(-dt * rate));
      // Selection is a prop change rather than a continuous control, so this one
      // gets its own ease. It never touches React state.
      u.uSelect.value[i] = ease(u.uSelect.value[i], slot.label === selected ? 1 : 0, 5.5);
      if (slot.label === selected && slot.presence > 0) measureHeight = u.uHeight.value[i];
    }

    u.uTime.value = time;
    u.uReveal.value = eased;
    u.uFocus.value = focusRef.current;
    u.uCount.value = MAX_COLUMNS;
    u.uMorph.value = morph;
    u.uMorphAge.value = Math.min(morphAge, 9);
    // Only the ecosystem reading has a datum: a published overall score the three
    // pillars are read against. The other two readings are profiles, and the
    // thread joins their heads.
    u.uDatum.value = ease(
      u.uDatum.value,
      shown === 'ecosystem' ? (overall / 100) * MAX_HEIGHT : 0,
      rate
    );

    /* ---- captions ---- */

    // At 5 Hz — they are DOM, and moving them every frame would thrash layout
    // for no visible gain.
    if (onLayout && groupRef.current && time - lastLayout.current > 0.2) {
      lastLayout.current = time;
      const group = groupRef.current;
      const foot = new THREE.Vector3();
      onLayout(
        target.map((slot, i) => {
          // The live uniform x, not the slot's own: mid-change the column is
          // somewhere between its two homes and the caption has to be with it.
          foot.set(u.uX.value[i], 0, 0).applyMatrix4(group.matrixWorld).project(camera);
          return {
            landUse: slot.label,
            x: (foot.x * 0.5 + 0.5) * size.width,
            y: (-foot.y * 0.5 + 0.5) * size.height,
            self: slot.self,
            // Faded out with its column, and dropped entirely while the row is
            // dissolved. A slot with no reading behind it is gone outright, not
            // merely faint: an eased value never quite reaches zero, and a label
            // lingering at 1% opacity is a label for a column that is not there.
            value: slot.presence <= 0 ? 0 : u.uPresence.value[i] * u.uHeight.value[i] * (1 - morph) ** 2,
          };
        })
      );
    }

    protection.uniforms.uTime.value = time;
    protection.uniforms.uReveal.value = eased;
    ring.uniforms.uTime.value = time;
    // The ring marks one column as the estate's own, which only means anything
    // in the habitat reading — the other two are already about nothing else.
    ring.uniforms.uReveal.value =
      eased * (1 - focusRef.current * 0.35) * (shown === 'habitat' ? 1 : 0) * (1 - morph);
    baselineMaterial.opacity = eased * 0.9;
    // The measure rises to the chosen capital and dies with the selection —
    // and with the morph wave, so it never asserts a height mid-change.
    measureY.current = ease(measureY.current, measureHeight, 6);
    measureMaterial.opacity = ease(
      measureMaterial.opacity,
      measureHeight > 0.05 ? eased * 0.8 * (1 - morph) : 0,
      6
    );
    if (measureRef.current) measureRef.current.position.y = measureY.current;

    const group = groupRef.current;
    if (group) {
      group.visible = eased > 0.002;
      // The row lifts into place as it brightens, and then keeps a barely
      // perceptible sway — enough parallax to give the cores depth, far too
      // little to notice on a screen someone stands in front of for an hour.
      /*
       * On a phone in portrait the camera has pulled a long way back to fit ten
       * capitals across, which leaves the row sitting low in a very tall frame —
       * directly behind the chapter controls, which have no gutter to move into.
       * Lifting the row is the only free axis: the controls stay where a thumb
       * expects them and the colonnade clears them. Zero on any landscape panel,
       * which is what the piece is actually built for.
       */
      const lift = THREE.MathUtils.clamp(size.height / Math.max(1, size.width) - 1, 0, 1.5) * 4;
      group.position.y = BASE_Y + lift - (1 - eased) * 0.3;
      group.rotation.y = Math.sin(time * 0.05) * 0.045;
    }
  });

  return (
    <group ref={groupRef} name="refuge" position={[0, BASE_Y, 0]}>
      <mesh
        geometry={backdropGeometry}
        material={backdropMaterial}
        position={[0, MAX_HEIGHT * 0.5, -4]}
        onPointerDown={handlePointerDown}
      />

      <mesh geometry={protectionGeometry} material={protection.material} renderOrder={1} />
      {/* Already built in the ground plane — the vertex shader lays the radial
          offset into XZ directly, so this must not be rotated flat a second time. */}
      <mesh geometry={poolGeometry} material={poolMaterial} renderOrder={1} />
      <lineSegments geometry={baselineGeometry} material={baselineMaterial} renderOrder={2} />
      {/* Same rule geometry, lifted: the ticks land over each column's axis. */}
      <lineSegments
        ref={measureRef}
        geometry={baselineGeometry}
        material={measureMaterial}
        renderOrder={2}
      />

      {hero && (
        <mesh
          geometry={ringGeometry}
          material={ring.material}
          position={[hero.x, 0.012, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={2}
        />
      )}

      {/* Under the plume: the stone is the container, the light is the reading. */}
      <mesh geometry={shaftGeometry} material={shaftMaterial} renderOrder={2} />
      <points geometry={moteGeometry} material={motes.material} renderOrder={3} />
      <lineSegments geometry={skylineGeometry} material={skylineMaterial} renderOrder={4} />
    </group>
  );
}
