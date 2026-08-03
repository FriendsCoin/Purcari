import { BufferAttribute, BufferGeometry } from 'three';
import { METRES_TO_SCENE } from '../data/terrain';

/**
 * The château estate, drawn as an architectural line model.
 *
 * The footprint is stylised — a main block with a central tower, two wings, the
 * long low cellar range behind, and the tree alley in front. It is a portrait of
 * the estate's massing, not a survey of it. The *position* is exact; the size is
 * not, and deliberately so: at true scale a 44 m building on a 5.5 km landscape
 * is a third of a scene unit and disappears. It is drawn at the same order of
 * exaggeration as the terrain relief so the two read together.
 */
const BUILDING_EXAGGERATION = 6;

/** Local metres, x east and z south, before exaggeration. */
interface Block {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Ridge height above the eaves. 0 gives a flat roof. */
  roof: number;
  /** Ridge runs along x when true, along z when false. */
  ridgeAlongX?: boolean;
}

const BLOCKS: Block[] = [
  // Main range, facing the alley.
  { x: 0, z: 0, width: 44, depth: 15, height: 11, roof: 7, ridgeAlongX: true },
  // Central tower breaking the roofline.
  { x: 0, z: -1, width: 9, depth: 9, height: 17, roof: 8, ridgeAlongX: true },
  // Wings, stepped back and lower.
  { x: -32, z: 3, width: 21, depth: 12, height: 8, roof: 5, ridgeAlongX: true },
  { x: 32, z: 3, width: 21, depth: 12, height: 8, roof: 5, ridgeAlongX: true },
  // The cellar range behind, long and low — the working half of the estate.
  { x: -6, z: 30, width: 54, depth: 11, height: 5.5, roof: 3, ridgeAlongX: true },
  { x: 34, z: 26, width: 12, depth: 20, height: 5, roof: 2.5, ridgeAlongX: false },
];

/** Trees down both sides of the approach, running north from the main range. */
const ALLEY = { count: 11, spacing: 13, offset: 13, start: -22 };

const S = METRES_TO_SCENE * BUILDING_EXAGGERATION;

function pushSegment(out: number[], a: number[], b: number[]): void {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
}

/**
 * Edges of a block: the base rectangle, the four verticals, the eaves, and the
 * roof — hipped when the ridge is shorter than the eaves, gabled otherwise.
 */
function blockEdges(block: Block, out: number[]): void {
  const hw = (block.width / 2) * S;
  const hd = (block.depth / 2) * S;
  const cx = block.x * S;
  const cz = block.z * S;
  const eave = block.height * S;
  const ridge = (block.height + block.roof) * S;

  const corners = [
    [cx - hw, 0, cz - hd],
    [cx + hw, 0, cz - hd],
    [cx + hw, 0, cz + hd],
    [cx - hw, 0, cz + hd],
  ];

  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    // Base, eaves line, and the vertical at this corner.
    pushSegment(out, a, b);
    pushSegment(out, [a[0], eave, a[2]], [b[0], eave, b[2]]);
    pushSegment(out, a, [a[0], eave, a[2]]);
  }

  if (block.roof <= 0) return;

  if (block.ridgeAlongX !== false) {
    const r0 = [cx - hw * 0.62, ridge, cz];
    const r1 = [cx + hw * 0.62, ridge, cz];
    pushSegment(out, r0, r1);
    for (const corner of corners) pushSegment(out, [corner[0], eave, corner[2]], corner[0] < cx ? r0 : r1);
  } else {
    const r0 = [cx, ridge, cz - hd * 0.62];
    const r1 = [cx, ridge, cz + hd * 0.62];
    pushSegment(out, r0, r1);
    for (const corner of corners) pushSegment(out, [corner[0], eave, corner[2]], corner[2] < cz ? r0 : r1);
  }
}

/** Solid faces, so the building occludes the contour lines behind it. */
function blockMass(block: Block, position: number[], normal: number[], index: number[]): void {
  const hw = (block.width / 2) * S;
  const hd = (block.depth / 2) * S;
  const cx = block.x * S;
  const cz = block.z * S;
  const eave = block.height * S;
  const ridge = (block.height + block.roof) * S;
  const base = position.length / 3;

  const walls: [number[], number[], number[]][] = [
    [[cx - hw, 0, cz - hd], [cx + hw, 0, cz - hd], [0, 0, -1]],
    [[cx + hw, 0, cz - hd], [cx + hw, 0, cz + hd], [1, 0, 0]],
    [[cx + hw, 0, cz + hd], [cx - hw, 0, cz + hd], [0, 0, 1]],
    [[cx - hw, 0, cz + hd], [cx - hw, 0, cz - hd], [-1, 0, 0]],
  ];

  for (const [a, b, n] of walls) {
    const v = position.length / 3;
    position.push(a[0], 0, a[2], b[0], 0, b[2], b[0], eave, b[2], a[0], eave, a[2]);
    for (let i = 0; i < 4; i += 1) normal.push(n[0], n[1], n[2]);
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }

  if (block.roof > 0) {
    const alongX = block.ridgeAlongX !== false;
    const r0 = alongX ? [cx - hw * 0.62, ridge, cz] : [cx, ridge, cz - hd * 0.62];
    const r1 = alongX ? [cx + hw * 0.62, ridge, cz] : [cx, ridge, cz + hd * 0.62];
    const eaves = [
      [cx - hw, eave, cz - hd],
      [cx + hw, eave, cz - hd],
      [cx + hw, eave, cz + hd],
      [cx - hw, eave, cz + hd],
    ];
    // Two slopes plus the hip ends, fanned from the ridge.
    const fan = [
      [eaves[0], eaves[1], alongX ? r1 : r0, alongX ? r0 : r0],
      [eaves[2], eaves[3], alongX ? r0 : r1, alongX ? r1 : r1],
    ];
    for (const quad of fan) {
      const v = position.length / 3;
      for (const p of quad) position.push(p[0], p[1], p[2]);
      for (let i = 0; i < 4; i += 1) normal.push(0, 1, 0);
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    for (const [a, b] of [
      [eaves[1], eaves[2]],
      [eaves[3], eaves[0]],
    ]) {
      const v = position.length / 3;
      const apex = a[0] > cx || a[2] > cz ? r1 : r0;
      position.push(a[0], a[1], a[2], b[0], b[1], b[2], apex[0], apex[1], apex[2]);
      for (let i = 0; i < 3; i += 1) normal.push(0, 0.6, 0);
      index.push(v, v + 1, v + 2);
    }
  }

  void base;
}

export interface ChateauGeometry {
  /** Glowing outline of the estate. */
  edges: BufferGeometry;
  /** Dark solid, drawn first so the outline reads against it. */
  mass: BufferGeometry;
  /** Warm windows on the facades, as points. */
  windows: Float32Array;
  /** Trunk base and canopy centre for each tree in the alley. */
  trees: { x: number; z: number; height: number; radius: number }[];
  /** Radius that covers the whole estate, in scene units. */
  radius: number;
}

export function buildChateau(): ChateauGeometry {
  const edgePositions: number[] = [];
  const edgeSeed: number[] = [];
  const massPosition: number[] = [];
  const massNormal: number[] = [];
  const massIndex: number[] = [];

  for (const block of BLOCKS) {
    const before = edgePositions.length;
    blockEdges(block, edgePositions);
    blockMass(block, massPosition, massNormal, massIndex);
    // One seed per vertex so the outline can be traced on rather than faded in.
    for (let i = before; i < edgePositions.length; i += 3) {
      edgeSeed.push((i / 3) % 1024);
    }
  }

  const edges = new BufferGeometry();
  edges.setAttribute('position', new BufferAttribute(Float32Array.from(edgePositions), 3));
  edges.setAttribute('aSeed', new BufferAttribute(Float32Array.from(edgeSeed), 1));

  const mass = new BufferGeometry();
  mass.setAttribute('position', new BufferAttribute(Float32Array.from(massPosition), 3));
  mass.setAttribute('normal', new BufferAttribute(Float32Array.from(massNormal), 3));
  mass.setIndex(massIndex);

  // A scatter of lit windows across the main range and the wings.
  const windows: number[] = [];
  for (const block of BLOCKS.slice(0, 4)) {
    const hw = (block.width / 2) * S;
    const hd = (block.depth / 2) * S;
    const rows = Math.max(1, Math.round(block.height / 4));
    const cols = Math.max(2, Math.round(block.width / 6));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (hash(r * 31.7 + c * 12.3 + block.x) > 0.62) continue;
        const y = ((r + 0.75) / (rows + 0.5)) * block.height * S;
        const x = block.x * S + (((c + 0.5) / cols) * 2 - 1) * hw * 0.86;
        // Front and back facades only; the ends are too narrow to read.
        windows.push(x, y, block.z * S - hd);
        if (hash(r * 7.1 + c * 3.3) > 0.5) windows.push(x, y, block.z * S + hd);
      }
    }
  }

  const trees: ChateauGeometry['trees'] = [];
  for (let i = 0; i < ALLEY.count; i += 1) {
    const z = (ALLEY.start - i * ALLEY.spacing) * S;
    for (const side of [-1, 1]) {
      trees.push({
        x: side * ALLEY.offset * S,
        z,
        height: (11 + hash(i * 5.3 + side) * 5) * S,
        radius: (3.2 + hash(i * 9.1 + side) * 1.4) * S,
      });
    }
  }

  // Extent of the built estate only. The alley runs 150 m out in front and would
  // otherwise triple this, which is the difference between the camera framing the
  // buildings and framing an empty avenue.
  let radius = 0;
  for (let i = 0; i < edgePositions.length; i += 3) {
    radius = Math.max(radius, Math.hypot(edgePositions[i], edgePositions[i + 2]));
  }

  return { edges, mass, windows: Float32Array.from(windows), trees, radius };
}

function hash(n: number): number {
  const s = Math.sin(n * 43.7581) * 43758.5453;
  return s - Math.floor(s);
}
