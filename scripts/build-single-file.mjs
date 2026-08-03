#!/usr/bin/env node
/**
 * Bundles one installation entry into a single self-contained .html file.
 *
 * Why: the kiosk build is a normal multi-file Vite output served over HTTP. A
 * shareable preview — a link opened on a phone — has to survive a host that
 * blocks every external request, so the JS, the CSS and the 113 kB survey
 * bundle all have to live inside the document.
 *
 * The data is injected as `window.__PURCARI_DATA__`; `loadInstallationData()`
 * checks for it before attempting a fetch, so the same source runs unchanged in
 * both the served build and the inlined one.
 *
 * This drives Vite's Node API with code-splitting disabled rather than stitching
 * the normal multi-chunk output back together by hand. An earlier version did
 * the latter — collecting chunks and re-pointing their imports at blob URLs —
 * and it is not worth it: the bundler already knows how to emit one module.
 *
 * Usage: node scripts/build-single-file.mjs <indoor|outdoor|pocket> <out.html>
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.argv[2];
const outPath = process.argv[3];

if (!['indoor', 'outdoor', 'pocket'].includes(entry) || !outPath) {
  console.error('usage: node scripts/build-single-file.mjs <indoor|outdoor|pocket> <out.html>');
  process.exit(1);
}

const outDir = resolve(root, `.single-build/${entry}`);
rmSync(outDir, { recursive: true, force: true });

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@components': resolve(root, 'src/components'),
      '@utils': resolve(root, 'src/utils'),
      '@types': resolve(root, 'src/types'),
      '@hooks': resolve(root, 'src/hooks'),
      '@services': resolve(root, 'src/services'),
      '@assets': resolve(root, 'src/assets'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    // Everything in one module, so the document needs no second request.
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: resolve(root, `${entry}.html`),
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
        entryFileNames: 'app.js',
        assetFileNames: 'app[extname]',
      },
    },
  },
});

/* ------------------------------------------------------------------ inline */

let html = readFileSync(resolve(outDir, `${entry}.html`), 'utf8');
const js = readFileSync(resolve(outDir, 'app.js'), 'utf8');
const cssPath = resolve(outDir, 'app.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
const data = readFileSync(resolve(root, 'public', 'data', 'installation.json'), 'utf8');

// The landscape bundle must be inlined too, or the preview would try to fetch
// it and get nothing — the Estate chapter would silently fall back to the
// abstract ground on exactly the build most people will actually see.
const landscapePath = resolve(root, 'public', 'data', 'landscape.json');
const landscape = existsSync(landscapePath) ? readFileSync(landscapePath, 'utf8') : 'null';

/**
 * Nothing embedded in a <script> may be able to close it. A minified bundle
 * really does contain `</script>` inside string literals, and that ends the
 * element early — the symptom is a bare "Unexpected token '<'" and a blank page.
 * `<!--` matters too: HTML-like comments are a syntax error inside a module.
 */
const forScript = (text) =>
  text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

html = html
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')
  .replace(/<script[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>/g, '');

/**
 * Inject with a replacer *function*, never a replacement string.
 *
 * In a replacement string `$&`, `` $` ``, `$'` and `$1` are substitution
 * patterns — and minified JavaScript is full of `$&` (a variable named `$`
 * followed by a bitwise and). Passing the bundle as a replacement string
 * silently rewrote those into the matched text, producing a literal `</body>`
 * in the middle of three.js and a "Unexpected token '<'" at load. A function
 * replacer disables the whole mechanism.
 */
const injectBefore = (source, marker, payload) =>
  source.replace(marker, () => payload + marker);

html = injectBefore(
  html,
  '</head>',
  `<style>${css}</style>
<style>
  /* Preview build: the kiosk hides the cursor, which strands a desktop visitor. */
  .inst-root { cursor: default; }
</style>
`,
);

html = injectBefore(
  html,
  '</body>',
  `<script>window.__PURCARI_DATA__ = ${forScript(data)};
window.__PURCARI_LANDSCAPE__ = ${forScript(landscape)};</script>
<script type="module">${forScript(js)}</script>
`,
);

writeFileSync(outPath, html);
rmSync(resolve(root, '.single-build'), { recursive: true, force: true });

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(
  `wrote ${outPath} (${kb} kB) — js ${(js.length / 1024) | 0} kB, ` +
    `css ${(css.length / 1024) | 0} kB, survey ${(data.length / 1024) | 0} kB, ` +
    `landscape ${(landscape.length / 1024) | 0} kB`,
);
