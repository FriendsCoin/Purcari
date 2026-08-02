# Terroir Vivant / Presence — installation guide

Two media-art pieces built on one year of biodiversity monitoring at Château
Purcari (Ștefan Vodă, Moldova).

| | Indoor | Outdoor |
|---|---|---|
| Title | **Terroir vivant** | **Presence** |
| Entry | `/indoor.html` | `/outdoor.html` |
| Surface | Touchscreen panel inside the château | Projection or LED wall, sheltered |
| Input | Direct touch | Camera + microphone (+ optional serial sensors) |
| Duration | Visitor-paced; 34–40 s attract loop per chapter | ~60 s to complete the arc |
| Runs unattended | Yes | Yes |

Both read the same runtime bundle, `public/data/installation.json`, so a data
refresh updates both pieces at once.

---

## 1. The work

### Terroir vivant (indoor)

The estate's own terroir survey reads the land *downward* — 16,000 resistivity
measurements per hectare, into geology, arriving at the wine. This piece reads
the same land *upward*, into the animals living on top of it.

Three chapters, cycling on an attract loop until someone touches the screen:

1. **The Estate** — the twelve monitoring stations at their true relative
   positions on an evocation of the estate's terrain. The chapter's argument is
   the survey's own: *the same land classifies differently depending on which
   animals you ask.* The three lenses — Both / Mammals / Birds — recolour the
   stations in place. H10 is a rich station to a microphone and a nearly empty
   one to a camera; H7 is the reverse.
2. **The Year** — every detection wound into a single disc: twelve months
   around, twenty-four hours outward, with the sunrise and sunset ribbons
   tracking the seasons. The bright band hugging the sunrise line is the dawn
   chorus.
3. **The Choir** — all 213 species at once. Common species at the luminous
   centre, rare at the edges, nocturnal sinking below. Touch any mark for that
   animal's record and its own 24-hour rhythm.

### Presence (outdoor)

One sentence: **stand still, and the wild comes back.**

Every mote is one animal, drawn from the species genuinely active at the current
hour according to the survey's hourly profiles. Movement and noise scatter the
field. Stillness brings it back — in the order the data says it should, common
and bold first, rare and nocturnal last. A full minute of stillness restores the
entire chorus.

The mechanic is the argument. The survey's dawn-chorus measure is a measure of
*undisturbedness*; the only way to see this estate at its richest is to stop
disturbing it.

Wariness is not a measured field value — the survey carries no flight-initiation
distances. It is composed from three proxies the data does carry: rarity,
nocturnality, and how few stations the animal tolerates. See
`src/installation/core/data.ts`.

---

## 2. Running it

```bash
npm install
npm run data          # rebuild public/data/installation.json from raw CSV exports
npm run dev           # then open /indoor.html or /outdoor.html
npm run build         # emits all three entries to dist/
npm run preview
```

`npm run data` expects the raw Every1Counts exports. Point it at new ones with:

```bash
python3 scripts/build_installation_data.py \
  --camera path/to/export_biodiversite_sitecamera.csv \
  --sound  path/to/export_biodiversite_site_sound.csv \
  --out    public/data/installation.json
```

Requires Python 3 with `pandas`.

### URL parameters (outdoor)

| Parameter | Effect |
|---|---|
| `?simulate=1` | Ignore real sensors and drive the piece from synthesised signals. Use for bench testing and for gallery fallback. |
| `?diag=1` | Show the installer diagnostics panel. |

Keyboard, both pieces: `F` fullscreen · `D` toggle diagnostics (outdoor) ·
`←`/`→` change chapter (indoor).

---

## 3. Hardware

### Indoor touchscreen

- Any panel ≥ 32", landscape or portrait; the layout is fluid. 1080p is
  sufficient — the render is deliberately soft and grainy.
- A GPU that can hold 60 fps at the panel's native resolution. Integrated
  graphics from the last five years are fine; the heaviest scene draws ~213
  points and one full-screen bloom.
- Chrome or Edge in kiosk mode:
  ```
  chrome --kiosk --incognito --noerrdialogs --disable-pinch \
         --autoplay-policy=no-user-gesture-required \
         http://localhost:4173/indoor.html
  ```
- Audio is optional but recommended: a small speaker under the panel.

### Outdoor

- **Display**: short-throw projector onto a wall or a weatherised LED panel.
  The piece is graded for near-total darkness; in ambient light, raise
  `bloomStrength` and lower `grain` in `OutdoorApp.tsx`.
- **Camera**: any USB webcam with a wide lens, mounted facing the viewing area,
  ideally 2.5–4 m up and angled down. It is used only for frame-difference
  motion sensing at 96×72 — no image is stored, transmitted, or shown.
- **Microphone**: a USB or 3.5 mm mic in the same area. Used for level and
  spectral brightness only; no audio is recorded.
- **Optional serial sensors**: any board (Arduino, ESP32) writing
  newline-delimited JSON at 115200 baud:
  ```json
  {"t":21.4,"wind":3.2,"lux":840,"pir":1,"dist":180}
  ```
  All fields optional. Connect from the diagnostics panel. Requires a
  Chromium browser (Web Serial). If no board is attached, temperature/wind/lux
  stay `null` rather than being invented — they must never reach a wall label
  as fabricated numbers.

Browsers only grant camera, microphone and serial access from a **user
gesture** and over **HTTPS or `localhost`**. The "Begin" screen exists to
provide that gesture. For a permanent install, serve over `localhost` on the
kiosk machine, or provision a certificate, and pre-grant the permissions in the
browser profile so the piece survives a reboot without a prompt.

---

## 4. Data provenance and honesty notes

These matter for wall text — the piece states real numbers and must not
overclaim.

- **Survey**: Every1Counts, 12 months, 29 May 2025 – 28 May 2026. Twelve
  stations, each a camera trap paired with an acoustic recorder. Bird
  identification by BirdNET (Kahl et al. 2021).
- **Species counts differ by filter.** The runtime bundle uses the delivered
  exports: 35 camera species, 197 acoustic species, 213 distinct overall. The
  analysis deck quotes 195 birds at confidence > 0.8 and an effort-standardised
  camera richness of 26. Neither is wrong; they answer different questions. If
  wall text needs one number, use the deck's public line — *"almost 200 bird
  species"*.
- **Day/night** is recomputed here from civil twilight at 46.52 N / 29.87 E for
  each detection's own date. It reproduces the report's *ranking* of stations
  exactly — H14 most nocturnal, H4 and HC least — but runs lower in absolute
  terms, because the report layers a nominal 07:00–19:00 window on top of
  twilight. Figures shown on screen are ours, computed as described.
- **The sounds are synthesised, not recordings.** The survey ships detection
  metadata only; no audio was exported with it. Each voice is generated from
  that species' own numbers — guild sets timbre, rarity sets register, peak hour
  sets phrasing, night ratio sets reverb. This is structurally truthful and must
  be labelled as sonification, not as field recording. `SpeciesVoice.play` in
  `core/audio.ts` is the single seam to swap for real audio if BirdNET segments
  are supplied later.
- **The terrain is an evocation, not a DEM.** No elevation model ships with the
  survey. The ground in "The Estate" is layered noise biased along the Dniester
  valley axis, washed with the estate's three landscape units (Podiș, Coline,
  Poale). Station *positions* are real; the ground beneath them is not survey
  data.
- **The tension worth stating on the wall**: the survey finds Purcari the most
  species-rich site in the Every1Counts network — a genuine refuge — while the
  CSRD assessment records ProtConn 0.0%, 0 hectares protected, 0 Natura 2000
  zones. It is a refuge with no legal standing.

---

## 5. Structure

```
scripts/build_installation_data.py   raw CSV exports -> runtime bundle
public/data/installation.json        the bundle both pieces read

src/installation/
  core/
    types.ts        runtime shapes, and the SensorState contract
    data.ts         loader, layout projection, wariness, selectors
    palette.ts      the visual system + Purcari house tokens
    audio.ts        data-driven sonification
  gl/
    chunks.ts       shared GLSL (noise, dither, tonemap, sprite)
    Stage.tsx       canvas, bloom, grade, camera rig — shared by both pieces
    Constellation.tsx  indoor ch.1 — the estate and its three readings
    Chronogram.tsx     indoor ch.2 — the year as a disc
    Choir.tsx          indoor ch.3 — all 213 species
    PresenceField.tsx  outdoor — the stillness mechanic
  sensors/
    useMotionSensor.ts   webcam frame differencing
    useAmbientSound.ts   microphone level + spectrum
    useSerialSensors.ts  optional hardware over Web Serial
    useSensorBus.ts      unified SensorState + simulation fallback
  indoor/   IndoorApp.tsx, main.tsx
  outdoor/  OutdoorApp.tsx, main.tsx
  ui/       installation.css
```

Scenes read sensor state from a **ref**, updated every frame, never from React
state — a 60 fps `setState` would stall the render. The bus publishes a separate
coarse readout four times a second for text.

---

## 6. Tuning on site

Most adjustments are constants at the top of a single file.

| Want | Change |
|---|---|
| Faster/slower return of the fauna | `stillnessSeconds / 60` in `PresenceField.tsx`, and the `STAGES` thresholds in `OutdoorApp.tsx` |
| Piece too twitchy in a busy space | Raise the stillness reset threshold in `useSensorBus.ts` (`0.3`) |
| Animals flee too readily | Lower the flight `trigger` multiplier in `PresenceField.tsx` |
| Brighter for an ambient-lit room | `bloomStrength` / `vignette` props on `<Stage>` |
| Longer attract dwell | `dwell` per chapter in `IndoorApp.tsx` |
| Idle before attract resumes | `IDLE_RESUME_MS` in `IndoorApp.tsx` |
| Mute | `soundField.setVolume(0)`, or simply do not connect a speaker |
