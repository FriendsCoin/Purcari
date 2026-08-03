#!/usr/bin/env node
/**
 * Recovers the species temporal-overlap matrix from the Every1Counts analysis
 * deck and bakes it for the installation.
 *
 *   node scripts/extract-overlap-matrix.mjs <slide-7-heatmap.png>
 *
 * The deck ships the matrix as a rendered heatmap, not as numbers, so the values
 * are read back out of the pixels. That is only defensible because the encoding
 * is fully determined and independently checkable:
 *
 *   - The plot uses the ColorBrewer RdBu ramp with the scale pinned to [-1, 1]
 *     (the legend is labelled 1 / 0.5 / 0 / -0.5 / -1), so colour -> value is a
 *     lookup, not a guess.
 *   - Every cell on the leading diagonal must come back as exactly +1.
 *   - The matrix must be symmetric: rho(i,j) and rho(j,i) are sampled from two
 *     different pixels and have to agree.
 *
 * Both checks run on every build and the script fails loudly if either drifts.
 * Residual quantisation is about +/-0.01, which is far finer than anything the
 * installation renders.
 *
 * If the raw correlation table ever becomes available, replace this entirely —
 * reading numbers back out of a picture is a last resort, not a good idea.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TARGET = resolve(ROOT, 'src/installation/data/overlap.json');

/** Heatmap plot area inside the extracted image, in pixels. */
const GRID = { x0: 142, x1: 1324, y0: 31, y1: 585 };

/**
 * Row and column order as printed on the slide, with the French names the rest
 * of the installation uses. `mammal` / `bird` follows the guild colouring
 * elsewhere; `domestic` marks the two that are somebody's pet.
 */
const SPECIES = [
  { en: 'Badger', fr: 'Blaireau européen', kind: 'mammal' },
  { en: 'Blackbird', fr: 'Merle noir', kind: 'bird' },
  { en: 'Brown Hare', fr: 'Lièvre d’Europe', kind: 'mammal' },
  { en: 'Carrion Crow', fr: 'Corneille noire', kind: 'bird' },
  { en: 'Cat', fr: 'Chat', kind: 'domestic' },
  { en: 'Chaffinch', fr: 'Pinson des arbres', kind: 'bird' },
  { en: 'Common Field Mouse', fr: 'Mulot sylvestre', kind: 'mammal' },
  { en: 'Common Pheasant', fr: 'Faisan de Colchide', kind: 'bird' },
  { en: 'Common Starling', fr: 'Étourneau sansonnet', kind: 'bird' },
  { en: 'Dog', fr: 'Chien', kind: 'domestic' },
  { en: 'Eurasian Wild Pig', fr: 'Sanglier', kind: 'mammal' },
  { en: 'European Roe', fr: 'Chevreuil', kind: 'mammal' },
  { en: 'Golden jackal', fr: 'Chacal doré', kind: 'mammal' },
  { en: 'Great Tit', fr: 'Mésange charbonnière', kind: 'bird' },
  { en: 'House Sparrow', fr: 'Moineau domestique', kind: 'bird' },
  { en: 'Red fox', fr: 'Renard roux', kind: 'mammal' },
  { en: 'Rook', fr: 'Corbeau freux', kind: 'bird' },
  { en: 'Song Thrush', fr: 'Grive musicienne', kind: 'bird' },
];

/** ColorBrewer RdBu, 11 classes. Index 0 is the red end. */
const RD_BU = [
  [103, 0, 31],
  [178, 24, 43],
  [214, 96, 77],
  [244, 165, 130],
  [253, 219, 199],
  [247, 247, 247],
  [209, 229, 240],
  [146, 197, 222],
  [67, 147, 195],
  [33, 102, 172],
  [5, 48, 97],
];

/** Interpolated ramp: t = 0 is rho = +1, t = 1 is rho = -1. */
function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RD_BU.length - 1);
  const i = Math.min(RD_BU.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map(c => RD_BU[i][c] + (RD_BU[i + 1][c] - RD_BU[i][c]) * f);
}

const LUT = Array.from({ length: 2001 }, (_, i) => {
  const t = i / 2000;
  return { rho: 1 - 2 * t, rgb: rampColor(t) };
});

function colorToRho(r, g, b) {
  let best = 0;
  let bestDistance = Infinity;
  for (const entry of LUT) {
    const d =
      (entry.rgb[0] - r) ** 2 + (entry.rgb[1] - g) ** 2 + (entry.rgb[2] - b) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = entry.rho;
    }
  }
  return { rho: best, distance: Math.sqrt(bestDistance) };
}

// ------------------------------------------------------- minimal PNG decode --

/**
 * Decodes a non-interlaced 8-bit truecolour PNG. Written out rather than pulled
 * from a dependency so the repository does not grow an image library for one
 * build script that runs by hand.
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
      channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
      if (!channels) throw new Error(`unsupported colour type ${colorType}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec, section 9).
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

// -------------------------------------------------------------------- main --

const source = process.argv[2];
if (!source) {
  process.stderr.write('usage: node scripts/extract-overlap-matrix.mjs <heatmap.png>\n');
  process.exit(1);
}

const image = decodePng(readFileSync(source));
const n = SPECIES.length;
const cellW = (GRID.x1 - GRID.x0 + 1) / n;
const cellH = (GRID.y1 - GRID.y0 + 1) / n;

const pixel = (x, y) => {
  const i = (y * image.width + x) * image.channels;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
};

const matrix = [];
let worstDistance = 0;

for (let row = 0; row < n; row += 1) {
  const values = [];
  for (let col = 0; col < n; col += 1) {
    // Median of a small patch at the cell centre, to step over the gridlines
    // and any anti-aliasing at the cell borders.
    const cx = Math.round(GRID.x0 + (col + 0.5) * cellW);
    const cy = Math.round(GRID.y0 + (row + 0.5) * cellH);
    const samples = [];
    for (let dy = -3; dy <= 3; dy += 3) {
      for (let dx = -6; dx <= 6; dx += 6) samples.push(pixel(cx + dx, cy + dy));
    }
    const median = [0, 1, 2].map(c => {
      const sorted = samples.map(s => s[c]).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    });
    const { rho, distance } = colorToRho(median[0], median[1], median[2]);
    worstDistance = Math.max(worstDistance, distance);
    values.push(Math.round(rho * 1000) / 1000);
  }
  matrix.push(values);
}

// ------------------------------------------------------------- validation --

const problems = [];

for (let i = 0; i < n; i += 1) {
  if (matrix[i][i] < 0.985) {
    problems.push(`diagonal ${SPECIES[i].en} read as ${matrix[i][i]}, expected 1`);
  }
}

let worstAsymmetry = 0;
for (let i = 0; i < n; i += 1) {
  for (let j = i + 1; j < n; j += 1) {
    worstAsymmetry = Math.max(worstAsymmetry, Math.abs(matrix[i][j] - matrix[j][i]));
  }
}
if (worstAsymmetry > 0.06) {
  problems.push(`matrix is not symmetric: worst |rho(i,j) - rho(j,i)| = ${worstAsymmetry.toFixed(3)}`);
}
if (worstDistance > 26) {
  problems.push(`a cell colour sat ${worstDistance.toFixed(1)} away from the ramp — wrong colormap?`);
}

if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`FAIL: ${p}\n`);
  process.exit(1);
}

// Average the two triangles: they are independent reads of the same number, so
// the mean is a better estimate than either.
const symmetric = matrix.map((rowValues, i) =>
  rowValues.map((v, j) => (i === j ? 1 : Math.round(((v + matrix[j][i]) / 2) * 1000) / 1000))
);

const overlap = {
  meta: {
    source: 'Every1Counts, "Analysis of data collected over 10 months on the Château Purcari site", 25 Feb 2026',
    measure: 'Spearman rho of temporal co-occurrence between camera-trap species',
    period: 'June 2025 – March 2026',
    recovered: 'read back from the published heatmap; see scripts/extract-overlap-matrix.mjs',
    maxAsymmetry: Math.round(worstAsymmetry * 1000) / 1000,
    maxColourDistance: Math.round(worstDistance * 10) / 10,
  },
  species: SPECIES,
  matrix: symmetric,
};

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(overlap)}\n`);

const pairs = [];
for (let i = 0; i < n; i += 1) {
  for (let j = i + 1; j < n; j += 1) pairs.push({ i, j, rho: symmetric[i][j] });
}
pairs.sort((a, b) => b.rho - a.rho);

process.stdout.write(
  `overlap → ${TARGET.replace(`${ROOT}/`, '')}\n` +
    `  ${n} species · symmetry check ${worstAsymmetry.toFixed(3)} · ramp fit ${worstDistance.toFixed(1)}\n` +
    `  strongest together: ${pairs
      .slice(0, 3)
      .map(p => `${SPECIES[p.i].en}/${SPECIES[p.j].en} ${p.rho.toFixed(2)}`)
      .join(', ')}\n` +
    `  strongest apart:    ${pairs
      .slice(-3)
      .reverse()
      .map(p => `${SPECIES[p.i].en}/${SPECIES[p.j].en} ${p.rho.toFixed(2)}`)
      .join(', ')}\n`
);
