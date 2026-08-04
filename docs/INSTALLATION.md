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

Eight chapters, each a full-screen realtime composition. Chapters I–IV, VII and
the attract state are drawn from the 2,665 detections recorded between 31 July
and 16 August 2025 by five acoustic recorders across 121 species; Chapters V and
VI come from the camera traps — a different survey, a different method — and say
so on screen.

| | Chapter | What it shows | Touch |
|---|---|---|---|
| — | **Le chœur** | Attract state. All 2,665 detections held in a ring whose azimuth is time of day, with a wave of light sweeping it in clock order. Because the dawn chorus is almost a third of the record, the wave arrives as a visible swell every half minute and goes quiet overnight. | Drag to turn, tap to push the cloud |
| I | **Terroir** | The estate from above, on aerial imagery, with the five recorders marked where they actually stand and a plume of light over each one carrying its detections. It behaves like a map: drag to pan, pinch to zoom, and a scale bar in the masthead tracks the zoom. | Drag to pan, pinch to zoom, tap a marker |
| II | **Circadien** | Every detection on a 24-hour dial: angle from the minute it was recorded, distance from the centre from its rank within that hour. The spikes *are* the hourly histogram, and the tallest by a wide margin is the dawn chorus at 04:00–07:00. | Drag left/right to scrub the hour |
| III | **Espèces** | 121 species positioned by *when* they sing — the angle of each node is the circular mean of its 24-hour profile, so the dawn chorus gathers on one side and the owls and nightjars drift to the other. Distance from the centre is inverse abundance. Links join species with similar daily rhythms. | Drag to rotate, tap a node to select it |
| IV | **Flux** | The seventeen days of the survey as a river of light, thinning from 347 detections on 4 August to one on the last three days. | Drag left/right to scrub the day |
| V | **Chevauchement** | Eighteen camera-trap species and the correlation between their daily rhythms, as a ring of chords. Warm means two species are out at the same hours, cool means they avoid each other. The highlight walks the ring on its own. | Tap a species to hold it |
| VI | **Passages** | Eighty nights as eighty rows — an actogram. Midnight at both edges, noon in the middle, and every light is one of the 367 animals that crossed a camera trap between 29 May and 16 August, at the minute it crossed. The violet field is the real night for 46.52° N, computed per day, so it narrows into the solstice and reopens through August. Half the passages fall inside it. | Drag to travel the nights, pinch to zoom, tap a passage |
| VII | **La traîne** | The 121 species ranked from most heard to rarest, as a receding colonnade, with the running total climbing away behind it. Eight species make half the record; thirty-two were heard exactly once. Height is logarithmic and the chapter says so — on a linear scale the tail would be invisible. | Drag to travel the ranking, tap a filament |

### What Chapter I is made of

Aerial imagery, in two levels, fetched by `npm run basemap` and committed:

| Layer | Zoom | Size | Covers |
|---|---|---|---|
| `basemap-context.jpg` | 16 | 3840 x 3072 px, 1.64 m/px | 6.3 x 5.0 km — everything the camera can reach |
| `basemap.jpg` | 17 | 2560 x 5120 px, 0.82 m/px | 2.1 x 4.2 km — the station corridor and the estate |

The sharp layer is laid over the wide one and feathered out at its own edges, for
the same reason a slippy map has a tile pyramid: one image cannot be both wide
enough to pinch out to the whole survey and sharp enough to read vine rows at the
estate without becoming a texture no GPU wants.

The tiles are Web Mercator and the scene is equirectangular, so the two disagree
slightly across five kilometres of latitude. Rather than ignore it, the map mesh
carries a **UV per layer per vertex** computed from the real projection, which
makes the imagery land exactly where the coordinates say it should — and makes
the two layers land on each other.

**This replaced a three-dimensional landform**, and the reason is worth keeping.
The elevation model was right: the ground really does fall about 130 m from the
vineyard plateau to the river. But that is over 3.1 km — a four percent grade you
would barely notice walking it — and the chapter drew it with **seven times
vertical exaggeration**, which turned a gentle slope into a cliff face with the
château perched on top of it. The estate was a procedural line model with its
footprint exaggerated six times to compensate. Both are gone. A photograph cannot
misrepresent the shape of the ground that way.

`scripts/fetch-terrain.mjs` and `terrain.json` are still here, and the elevations
are still quoted in the readouts, where they are honest:

| Station | Elevation | Detections | Species |
|---|---|---|---|
| ct45 | 157 m | 9 | 5 |
| ct48 | 142 m | 261 | 54 |
| AU-03 | 91 m | 605 | 75 |
| **ct47** | **27 m** | **1 082** | **65** |
| **AU-05** | **35 m** | **708** | **69** |

The two recorders at the bottom of the drop logged more than the other three
combined, and every heron, bittern, little bittern, crake, swan and crane in the
dataset came from them.

The imagery also **corrected the story**. ct47, the recorder that logged more than
any other, does not stand on the Dniester floodplain three kilometres north, as
the elevation model alone had suggested — it stands at the **two ponds in the
estate park**, about 120 m from the château, and they are plainly visible in the
picture. That is where the herons, bitterns, crakes and little bitterns come from.
The richest listening point in the survey is on the château's doorstep.

Château Purcari itself is at 46.5295 N, 29.8719 E, from OpenStreetMap; in the
imagery that lands on the manor range beside those ponds.

**Licensing.** The imagery is Esri World Imagery (Esri, Maxar, Earthstar
Geographics), free to use with attribution, which the footer carries. For a
permanent commercial installation this should be licensed imagery — or better,
the estate's own drone orthophoto. Only `TILE_URL` in the fetch script changes.

Two ideas run through all eight so a visitor keeps their bearings: **midnight is
up and hours run clockwise** everywhere a clock appears, and **colour always
means ecological guild** (the legend in the footer is the only key needed). The
two camera-trap chapters have no guilds to colour by, so they swap the legend for
wild mammals / birds / domestic animals — and they use the same three hues as
each other, because they are the same fifteen animals.

A species picked in one chapter stays picked in the next. The selection is a
French vernacular name held in `engine/selection.ts`, which is the only thing the
three datasets have in common; a chapter that has never heard of the animal simply
opens unselected. Holding the red fox in VI and walking to V is the intended way
to read the two camera-trap chapters against each other.

### What Chapter V is made of, and where its numbers come from

Chapter V is the only one **not** built from `data.geojson`. It comes from the
Every1Counts analysis deck covering ten months of camera-trap data (June 2025 –
March 2026) — a different survey, a different method, and 18 species that barely
overlap with the 121 acoustic ones.

Because it is a different dataset, the overlay says so: chapters can set
`period`, `source` and `legend` on their readout, and this one overrides the
masthead dates, the footer credit and the guild legend. No chapter is ever
labelled with another chapter's provenance.

The deck ships the correlation matrix as a **rendered heatmap, not as numbers**,
so `scripts/extract-overlap-matrix.mjs` reads the values back out of the pixels.
That is a last resort, and it is only defensible because the encoding is fully
determined and independently checkable:

- the plot uses the ColorBrewer **RdBu** ramp with the scale pinned to [-1, 1]
  (the legend is labelled 1 / 0.5 / 0 / -0.5 / -1), so colour to value is a
  lookup rather than a judgement;
- every cell on the leading diagonal must come back as exactly **+1**;
- the matrix must be **symmetric** — rho(i,j) and rho(j,i) are sampled from two
  different pixels and have to agree.

All three run on every extraction and the script exits non-zero if any drifts.
On the current deck the symmetry error is **0.000** and the worst colour sits
22.7 units from the ramp, giving roughly ±0.02 on each value — far finer than
anything the chapter draws. **If the raw correlation table ever becomes
available, delete this script and use it.**

The ring order is also not a design choice. It is the dominant eigenvector of the
matrix, recovered by power iteration, and it separates the community by itself:

```
Sanglier  Blaireau  Chacal  Mulot  Lièvre  Chat  Chevreuil  Renard | Grive  Pinson …
   -0.31    -0.30   -0.29  -0.22  -0.21  -0.15    -0.13    -0.01  | +0.08  +0.16
   \___________________ mammals _______________________/          \____ birds ____/
```

Eight mammals at one pole, ten birds at the other, the **red fox at almost
exactly zero** — crepuscular, at home in both halves — and the dog filed among
the birds, because dogs are walked in daylight. Neighbours on the ring share
their hours; opposite sides never meet. The strongest relationships in the whole
matrix are avoidances: pheasant/wild boar -0.85, badger/pheasant -0.85.

### What Chapter VI is made of

The camera-trap export: 350 records, 367 passages (fourteen records carry more
than one animal), 15 species, 8 traps, 29 May to 16 August 2025. Sixty-nine of
the eighty days carry a passage; the other eleven are drawn as the empty rows
they are, because nothing walking past a lens is data too.

Timestamps carry no timezone and are used as written, the same conclusion the
acoustic atlas reached for the same site. Read raw, the badger comes out 91 %
nocturnal with a peak at 02:00 and the pheasant 4 % nocturnal with a peak at
14:00 — both exactly right. Shifting by Moldova's +3 would put the badger's peak
around sunrise, back at the sett.

The night band is not drawn from those timestamps but from the sun: NOAA's solar
position equations, evaluated per day at the survey origin (`data/solar.ts`).
It is the one part of the chapter that is not measurement, and it is what makes
the measurement legible — 8 h 10 of dark at the solstice, 9 h 50 by mid-August.

```
npm run passages   # camera traps  20251110_100018.csv -> passages.json (14 KB)
```

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
- A tap is projected onto the chapter's interaction plane **at the moment it is
  released**, not read from the last frame. A tap released between two frames —
  routine on a mouse, and on the panel whenever the framerate dips — would
  otherwise arrive carrying the world origin, which every chapter that picks in
  world space reads as a tap dead in its own centre.
- Where something plays on its own — the circadian hand, the river of days — a
  tap **holds it**: the hand goes to the hour you pointed at and stays. Tapping
  the middle of the dial, or the day already held, hands it back. A held hour
  also names more of what was singing in it.
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
scripts/fetch-basemap.mjs              stitches map tiles -> basemap*.jpg
scripts/fetch-terrain.mjs              fetches SRTM       -> terrain.json
scripts/extract-overlap-matrix.mjs     reads the deck     -> overlap.json
scripts/build-passages-atlas.mjs       bakes the CT export -> passages.json
public/installation/                   the two basemap layers
src/installation/
  main.tsx                        bootstrap (deliberately no StrictMode)
  Installation.tsx                shell: overlay, chapter state, service corner
  engine/
    Engine.ts                     renderer, frame loop, chapters, quality governor
    PostFX.ts                     bloom chain + composite grade (the look)
    Pointer.ts                    multi-touch, taps, ripples, inertia, idle clock
    Scene.ts                      Chapter and Readout contracts
    selection.ts                  the species held across chapters
    glsl.ts                       shared GLSL chunks
    blending.ts                   true additive blending
    palette.ts                    colours and ecological guilds
  scenes/
    ChapterBase.ts                camera rig + touch uniform plumbing
    ChorusScene.ts  TerroirScene.ts  CircadianScene.ts
    SpeciesScene.ts FluxScene.ts  OverlapScene.ts
    PassagesScene.ts              the eighty-night actogram
    TailScene.ts                  the abundance ranking
  data/
    atlas.ts / atlas.json         the baked detections
    basemap.ts / basemap.json     the aerial layers: bounds, projection, extent
    terrain.ts / terrain.json     elevations, now only quoted as figures
    overlap.ts / overlap.json     the camera-trap correlation matrix
    passages.ts / passages.json   the camera-trap records, one row per passage
    solar.ts                      sunrise and sunset, for the night band in VI
  ui/                             Readout, ChapterNav, Sparkline, Diagnostics
  styles/installation.css         overlay chrome (no Tailwind in this bundle)
```

### Rebuilding the data

Every generated file is committed, so a clone builds and runs with no network
access. None of these need running unless the area of interest or the source
data changes.

```
npm run atlas      # detections   data.geojson (3.4 MB) -> atlas.json   (51 KB)
npm run basemap    # aerial       380 map tiles         -> basemap*.jpg (3.1 MB)
npm run terrain    # elevation    SRTM via opentopodata -> terrain.json (17 KB)
npm run overlap -- <heatmap.png>   # chapter V matrix   -> overlap.json  (7 KB)
npm run passages   # camera traps 20251110_100018.csv    -> passages.json (14 KB)
```

`npm run basemap` needs a raster library that the project deliberately does not
depend on — platform binaries every install would otherwise pay for, for a script
that runs by hand and rarely:

```
npm install --no-save sharp
```

Note that on npm 10 `--no-save` prunes other extraneous packages, so if you also
installed Playwright by hand, reinstall the two together.

The heatmap for `npm run overlap` is the third embedded image on slide 7 of the
Every1Counts deck; extract it with any PDF tool that can pull raw images.

`npm run terrain` hits a public endpoint at one request per second and takes
about a minute.

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

Four more that cost real time during the build:

4. **Anything that covers the frame must stay under the bloom threshold.** A
   full-frame layer with any brightness at all is a bloom problem — the
   five-level mip chain smears it into soft cells that look exactly like a bug in
   a particle system. Chapter I's photographic grade ends in a shoulder for this
   reason: the winery roofs are already clipped in the source imagery, and
   without the roll-off they drive the bright-pass on their own.
5. **Animation timing runs on wall-clock, simulation on the clamped delta.** The
   frame loop clamps delta to 1/20 s so a stall cannot slingshot the motion. The
   chapter dissolve deliberately does *not* use that clamp: driving a 1.4 s
   crossfade off it stretched the transition to twenty seconds on a machine
   rendering at two frames a second — while it was drawing two chapters at once.
6. **Anything that changes per frame has to bypass the readout gate.** React only
   re-renders when the readout object's *identity* changes, which is what keeps
   the DOM out of the frame budget — but it also means the scale bar froze at the
   value it held when the chapter was entered. The marker and the scale bar are
   both written straight to the DOM from the frame callback instead.
7. **A map with edges needs the frustum clamped, not the centre.** Clamping the
   look-at point to the imagery still lets the corners of a tilted frustum run off
   it. `clampToMap` derives both the altitude ceiling and the pan limits from the
   same reach constants, so the two cannot disagree.

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
