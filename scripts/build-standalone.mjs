#!/usr/bin/env node
/**
 * Folds the standalone build into a single HTML file.
 *
 * Inlines the script, the stylesheet and both data payloads, so the result runs
 * from a file:// URL, an offline laptop or a sandboxed page with no network of
 * any kind. Run after `vite build --config vite.standalone.config.ts`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-standalone');
const OUT = join(DIST, 'purcari-living-archive.html');

const html = readFileSync(join(DIST, 'standalone.html'), 'utf8');
const script = readFileSync(join(DIST, 'app.js'), 'utf8');
const cssPath = join(DIST, 'app.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';

const installation = readFileSync(join(ROOT, 'public', 'installation.json'), 'utf8');
const landscape = existsSync(join(ROOT, 'public', 'landscape.json'))
  ? readFileSync(join(ROOT, 'public', 'landscape.json'), 'utf8')
  : 'null';

/** `</script` inside a string literal would close the tag early. */
const safe = (json) => json.replace(/<\/script/gi, '<\\/script');

const payload = `<script>window.__PURCARI__={installation:${safe(installation)},landscape:${safe(landscape)}};</script>`;

// Replacer functions, not replacement strings: minified bundles are full of
// `$&` and `$'`, which String.replace would expand and shred the code.
let out = html
  .replace(
    /<script type="module"[^>]*src="[^"]*"><\/script>/,
    () => `${payload}\n<script type="module">${script}</script>`
  )
  .replace(/<link rel="stylesheet"[^>]*href="[^"]*"\s*\/?>/, () => (css ? `<style>${css}</style>` : ''));

// Nothing may reach outside the page.
const external = [...out.matchAll(/(?:src|href)="((?:https?:)?\/\/[^"]+)"/g)].map((m) => m[1]);
if (external.length) {
  console.warn(`  warning: ${external.length} external reference(s) survived:`, external.slice(0, 5));
}

writeFileSync(OUT, out);
console.log(`purcari-living-archive.html  ${(out.length / 1024 / 1024).toFixed(2)} MB`);

/**
 * Second output: the same thing as a body fragment, for hosts that supply their
 * own document skeleton. Assembled from the parts rather than sliced out of the
 * page above — Vite emits the module script into <head>, so carving on <body>
 * would drop the whole application.
 */
const fragment = [
  '<title>Purcari — Живой архив</title>',
  '<style>html,body{margin:0;padding:0;background:#04060a;overflow:hidden}</style>',
  css ? `<style>${css}</style>` : '',
  '<div id="root"></div>',
  payload,
  `<script type="module">${script}</script>`,
]
  .filter(Boolean)
  .join('\n');

const FRAGMENT_OUT = join(DIST, 'purcari-living-archive.fragment.html');
writeFileSync(FRAGMENT_OUT, fragment);
console.log(
  `purcari-living-archive.fragment.html  ${(fragment.length / 1024 / 1024).toFixed(2)} MB`
);
