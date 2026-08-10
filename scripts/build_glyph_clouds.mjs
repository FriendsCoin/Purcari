#!/usr/bin/env node
/**
 * Turns a generated GLB mesh into a point cloud the installation can hold.
 *
 * Why not ship the mesh. This piece is made entirely of additive marks on black:
 * a shaded photoreal quadruped dropped into it would look like a different work
 * pasted over this one. And the offline single-file build is 1.4 MB in total —
 * two 1.5 MB GLBs would triple it for something the visitor sees for four
 * seconds. Sampling the surface into a few hundred points keeps the form, keeps
 * the visual language, costs ~14 kB per animal, and lets the marks fly into it.
 *
 * The sampling is area-weighted, which matters: sampling triangles uniformly
 * clusters points wherever the mesh happens to be finely tessellated — around
 * the head, in these models — and leaves a wing as a scatter of four. Weighting
 * by triangle area gives an even skin, which is what reads as a form.
 *
 * Deterministic: a fixed low-discrepancy sequence, no Math.random, so rebuilding
 * gives byte-identical output and the same animal always stands the same way.
 *
 * The GLB is parsed here rather than with GLTFLoader — the loader wants a DOM
 * for its texture path, and all this needs is POSITION and the index buffer.
 *
 * Usage: node scripts/build_glyph_clouds.mjs <bird.glb> <deer.glb> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** Points per animal. Enough to read as a form, few enough to stay a drawing. */
// Raised from 900 after the first build: a surface cloud reads as its density,
// and at 900 the deer's haunch thinned into scatter at kiosk size. 1500 keeps
// the file at ~56 kB — still nothing against the meshes it replaces.
const POINTS = 1500;

/* ------------------------------------------------------------------- glTF */

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (kind === 0x4e4f534a) json = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + start, length).toString('utf8'));
    else if (kind === 0x004e4942) bin = new Uint8Array(bytes.buffer, bytes.byteOffset + start, length);
    // Chunks are 4-byte aligned.
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json || !bin) throw new Error('GLB missing a chunk');
  return { json, bin };
}

const COMPONENT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const Ctor = COMPONENT[accessor.componentType];
  const per = COMPONENTS_PER[accessor.type];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  // Interleaved accessors would need a stride walk; these models are tightly
  // packed, and asserting is better than silently reading garbage.
  if (view.byteStride && view.byteStride !== per * Ctor.BYTES_PER_ELEMENT) {
    throw new Error('interleaved accessor not supported');
  }
  return new Ctor(bin.buffer, bin.byteOffset + start, accessor.count * per);
}

/* ---------------------------------------------------------------- sampling */

/**
 * `count` points spread over the mesh surface, weighted by triangle area.
 *
 * Two low-discrepancy streams: one picks the triangle through the cumulative
 * area, one places the point inside it. Both are the plastic-number sequences
 * used everywhere else in this project, so the result is stable and even.
 */
function sampleSurface(positions, indices, count) {
  const triangles = indices.length / 3;
  const cumulative = new Float64Array(triangles);
  let total = 0;

  const ax = [0, 0, 0];
  const bx = [0, 0, 0];
  const cx = [0, 0, 0];
  const fetch = (i, out) => {
    out[0] = positions[i * 3];
    out[1] = positions[i * 3 + 1];
    out[2] = positions[i * 3 + 2];
  };

  for (let t = 0; t < triangles; t++) {
    fetch(indices[t * 3], ax);
    fetch(indices[t * 3 + 1], bx);
    fetch(indices[t * 3 + 2], cx);
    const ux = bx[0] - ax[0];
    const uy = bx[1] - ax[1];
    const uz = bx[2] - ax[2];
    const vx = cx[0] - ax[0];
    const vy = cx[1] - ax[1];
    const vz = cx[2] - ax[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    total += 0.5 * Math.hypot(nx, ny, nz);
    cumulative[t] = total;
  }

  const fract = (x) => x - Math.floor(x);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const target = ((i + 0.5) / count) * total;
    let lo = 0;
    let hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    fetch(indices[lo * 3], ax);
    fetch(indices[lo * 3 + 1], bx);
    fetch(indices[lo * 3 + 2], cx);

    // Uniform barycentric sample of the triangle.
    let u = fract(i * 0.7548776662466927);
    let v = fract(i * 0.5698402909980532);
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    out[i * 3] = ax[0] * w + bx[0] * u + cx[0] * v;
    out[i * 3 + 1] = ax[1] * w + bx[1] * u + cx[1] * v;
    out[i * 3 + 2] = ax[2] * w + bx[2] * u + cx[2] * v;
  }
  return out;
}

/**
 * Which axes of the generated model face the camera.
 *
 * The generator returns each model in its own frame, and the silhouette that
 * reads is not the same one in both: the bird is legible from above, with its
 * wingspan across the frame, while the deer is only legible from the side. Both
 * were checked by projecting the raw cloud on all three axis pairs before this
 * was written down — the bird's front view is a shapeless V and the deer's front
 * view is a post.
 *
 * Baked here rather than at runtime so the scene receives clouds that are
 * already oriented, with Y up, and the third axis left as real depth for the
 * figure to turn in.
 */
const ORIENT = {
  // (x, y, z) -> (x, z, y): the top-down view, wings spread across the frame.
  bird: [0, 2, 1],
  // (x, y, z) -> (z, y, x): the profile, nose to tail across the frame.
  mammal: [2, 1, 0],
};

/** Centre on the origin and scale so the longest axis spans 1. */
function normalise(points, order) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], points[i + a]);
      max[a] = Math.max(max[a], points[i + a]);
    }
  }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const centre = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const from = order[a];
      // Three decimals is a millimetre on a one-metre form — well under the
      // size of the sprite each point is drawn as, and it halves the file.
      out[i + a] = Math.round(((points[i + from] - centre[from]) / span) * 1000) / 1000;
    }
  }
  return out;
}

/* ------------------------------------------------------------------- main */

const [birdPath, deerPath, outPath] = process.argv.slice(2);
if (!birdPath || !deerPath || !outPath) {
  console.error('usage: node scripts/build_glyph_clouds.mjs <bird.glb> <deer.glb> <out.json>');
  process.exit(1);
}

const cloud = (path, kind) => {
  const { json, bin } = parseGlb(readFileSync(path));
  const primitive = json.meshes[0].primitives[0];
  const positions = readAccessor(json, bin, primitive.attributes.POSITION);
  const indices = readAccessor(json, bin, primitive.indices);
  return normalise(sampleSurface(positions, indices, POINTS), ORIENT[kind]);
};

const out = {
  points: POINTS,
  bird: cloud(birdPath, 'bird'),
  mammal: cloud(deerPath, 'mammal'),
  source:
    'Surface point clouds sampled from meshes generated with Trellis (image-to-3D) ' +
    'from reference images generated with FLUX. Illustration, not a record: these are ' +
    'category glyphs — a bird and a quadruped — not depictions of any individual ' +
    'animal recorded in the survey.',
};

writeFileSync(outPath, JSON.stringify(out));
const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1);
console.log(`wrote ${outPath} — ${POINTS} points per glyph, ${kb} kB`);
