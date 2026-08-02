# Le Chœur — touchscreen installation

A media-art piece for a wall-mounted touchscreen at Château Purcari, built from
the same biodiversity survey the analytics dashboard reads.

It is a **separate entry point** (`installation.html`), not a mode of the
dashboard. The two share the repository and nothing else: the kiosk bundle
carries no Leaflet, no Recharts, no dashboard code, and it boots from a 51 KB
pre-baked data file rather than parsing the 3.4 MB export.

```
npm install
npm run dev          # http://localhost:3000/installation.html
npm run build        # emits dist/index.html and dist/installation.html
```

---

## What is on screen

Five chapters, each a full-screen realtime composition. Everything is drawn from
the 2,665 detections recorded between 31 July and 16 August 2025 by four acoustic
recorders and a short camera-trap line, across 121 species.

| | Chapter | What it shows | Touch |
|---|---|---|---|
| — | **Le chœur** | Attract state. All 2,665 detections held in a ring whose azimuth is time of day, with a wave of light sweeping it in clock order. Because the dawn chorus is almost a third of the record, the wave arrives as a visible swell every half minute and goes quiet overnight. | Drag to turn, tap to push the cloud |
| I | **Terroir** | The five recording stations on their real coordinates along 3 km of vineyard, each a shaft of light scaled to what it heard, its detections spiralling up out of the ground in time-of-day order. | Drag to orbit, tap a beacon to focus it |
| II | **Circadien** | Every detection on a 24-hour dial: angle from the minute it was recorded, distance from the centre from its rank within that hour. The spikes *are* the hourly histogram, and the tallest by a wide margin is the dawn chorus at 04:00–07:00. | Drag left/right to scrub the hour |
| III | **Espèces** | 121 species positioned by *when* they sing — the angle of each node is the circular mean of its 24-hour profile, so the dawn chorus gathers on one side and the owls and nightjars drift to the other. Distance from the centre is inverse abundance. Links join species with similar daily rhythms. | Drag to rotate, tap a node to select it |
| IV | **Flux** | The seventeen days of the survey as a river of light, thinning from 347 detections on 4 August to one on the last three days. | Drag left/right to scrub the day |

Two ideas run through all five so a visitor keeps their bearings: **midnight is
up and hours run clockwise** everywhere a clock appears, and **colour always
means ecological guild** (the legend in the footer is the only key needed).

### A note on the decline in Chapter IV

The daily counts fall away across the survey. That is the listening effort
winding down — recorders being collected — not birds leaving the vineyard. The
chapter is written to say so; please keep that framing if the copy is edited.

---

## Interaction model

Designed for a wall panel with no cursor, no keyboard and no scroll:

- **Everything is press / drag / release.** There are no hover states anywhere.
- Chapter buttons fire on `pointerdown`, not `click` — on a panel with input lag,
  waiting for the full tap reads as an unresponsive interface.
- Up to six simultaneous touches push and light the particle fields in every
  chapter; a tap that barely moves also spawns an expanding ripple.
- A flick keeps spinning after release, then the framing eases back toward a
  composed one — so a visitor who spins the camera and walks away leaves the
  piece looking intentional for the next person.
- After 75 s without a touch the piece returns to *Le chœur* on its own.
- Text selection, context menus, pinch-zoom, overscroll and tap highlights are
  all disabled. The first touch requests fullscreen if the kiosk shell has not
  already done it.

### Service panel

Four taps in the **top-left corner** within a few seconds opens a commissioning
overlay: frame rate, framebuffer size, draw calls, program and texture counts,
and the dataset the build was made from. Tap it to dismiss. This is for whoever
installs the panel — there is no other way to read a frame rate on a machine with
no keyboard.

---

## How it is built

Raw Three.js with hand-written GLSL. React renders the typographic overlay and
nothing else — it subscribes to a single readout callback and re-renders only
when the *text* changes, so the DOM never competes with the frame budget. The
selection marker is written straight to the DOM each frame instead of going
through state.

```
installation.html                 kiosk entry point
scripts/build-installation-atlas.mjs   bakes data.geojson -> atlas.json
src/installation/
  main.tsx                        bootstrap (deliberately no StrictMode)
  Installation.tsx                shell: overlay, chapter state, service corner
  engine/
    Engine.ts                     renderer, frame loop, chapters, quality governor
    PostFX.ts                     bloom chain + composite grade (the look)
    Pointer.ts                    multi-touch, taps, ripples, inertia, idle clock
    Scene.ts                      Chapter and Readout contracts
    glsl.ts                       shared GLSL chunks
    blending.ts                   true additive blending
    palette.ts                    colours and ecological guilds
  scenes/
    ChapterBase.ts                camera rig + touch uniform plumbing
    ChorusScene.ts  TerroirScene.ts  CircadianScene.ts
    SpeciesScene.ts FluxScene.ts
  data/
    atlas.ts / atlas.json         the baked dataset
  ui/                             Readout, ChapterNav, Sparkline, Diagnostics
  styles/installation.css         overlay chrome (no Tailwind in this bundle)
```

### Rebuilding the data

`src/installation/data/atlas.json` is committed, so a clone builds without the
raw export. Regenerate it when the survey data changes:

```
npm run atlas
```

**Timestamps.** The export carries a `Z` suffix, but the hourly histogram peaks
at 04:00–06:00, which is the dawn chorus for Moldova in August (sunrise ~06:10).
Reading them as UTC and shifting to UTC+3 would put the chorus at 07:00–08:00,
well after full daylight. The recorder wrote local time; the atlas uses the hours
as-is, and every clock in the piece is local time.

### Things worth knowing before editing a shader

Three details caused most of the bugs during the build, and all three are easy to
reintroduce:

1. **Blending.** Materials use `ADDITIVE` from `engine/blending.ts`, which is
   `One, One`. Three's built-in `AdditiveBlending` is `SrcAlpha, One`, and since
   every shader here already scales its colour by coverage, that preset squares
   the term — the faint structural passes disappear entirely while the hot cores
   still bloom.
2. **Point sizes** come from `pointSizeFor(worldSize, viewZ)`, a real perspective
   projection using `projectionMatrix[1][1]` and the framebuffer height. A
   hand-tuned constant instead would halve every sprite's relative size the
   moment the piece runs on a denser panel.
3. **Colour space.** The scenes render unclamped linear light into half-float
   buffers; the composite tonemaps, applies the sRGB transfer function by hand
   (`ShaderMaterial` gets no automatic output conversion), and only then grades,
   vignettes and adds grain. Grading before the transfer function makes the
   numbers mean something completely different — a 0.02 shadow lift becomes 25%
   of the visible range instead of 2%.

Also: `active`, `filter`, `input`, `output` and `sample` are reserved words in
GLSL ES and will fail to compile. And a backtick inside a shader comment ends the
template literal.

### Performance

The frame loop clamps deltas, pauses on `visibilitychange`, and runs a quality
governor that trades render scale (down to 0.55x) for frame rate when the rolling
frame cost climbs — far less visible on slow camera moves than dropped frames.
The kiosk bundle is ~37 KB gzipped on top of Three.js.

---

## Verifying changes

There is no automated visual test. The build was checked by driving the built
page in headless Chromium and reading the frames back — worth repeating after any
shader change, since a shader that fails to compile still renders a black canvas
without throwing:

```js
// npm i --no-save playwright, then launch with:
chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',   // or your local Chromium
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
```

Listen for `console` messages while the page loads: Three logs the full GLSL
compile error, including the offending line, before the canvas goes black. Check
both a landscape and a portrait viewport — the overlay reflows below 8:9 and the
chapter list moves under the readout.
