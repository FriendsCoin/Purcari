import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineSegments,
  MathUtils,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { POINT_SIZE, RIPPLE_UNIFORMS, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import {
  formatPassageDate,
  kindAccent,
  kindLabel,
  passageEvents,
  passageSolar,
  passages,
} from '../data/passages';
import { formatClock } from '../data/solar';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Scene-unit width of one full day, midnight to midnight. */
const WALL_WIDTH = 30;

/** Scene-unit height of one night. Eighty of them make a 33-unit wall. */
const ROW_HEIGHT = 0.42;

/** How many nights the frame holds: the whole deployment, down to a fortnight. */
const MIN_ROWS = 14;

const TAP_RADIUS = 0.055;

const DAY_COUNT = passages.meta.dayCount;
const WALL_HEIGHT = DAY_COUNT * ROW_HEIGHT;

interface Selection {
  /** Index into passages.species. */
  species: number;
  /** Index into the event arrays, or -1 when the species was chosen elsewhere. */
  event: number;
}

/**
 * Chapter VI — Passages.
 *
 * The other half of the survey. While the microphones listened for seventeen
 * days, eight camera traps watched for eighty, from 29 May to 16 August 2025,
 * and recorded the animals no recorder ever hears: 367 passages of fox, hare,
 * jackal, boar, badger, roe.
 *
 * The form is an actogram, the plot chronobiology has used for a century. One
 * night per row, eighty rows stacked oldest at the top; midnight at both edges,
 * noon in the middle; every light is an animal crossing a lens at the minute it
 * crossed. Reading down the wall is reading the summer.
 *
 * The dark band is not decoration and not a fixed band: it is sunrise and sunset
 * computed for 46.52° N for each of the eighty days, so it narrows into the
 * solstice and opens back out through August. More than half the passages fall
 * inside it — and which side of the twilight line a species sits on is the whole
 * character of the animal. The badger is 91 % nocturnal, the pheasant 4 %.
 *
 * Source: Every1Counts camera-trap export, the same survey as Chapter V.
 */
export class PassagesScene extends ChapterBase {
  readonly id = 'passages' as const;
  readonly look = { exposure: 1.0, bloom: 0.55, grain: 0.024, aberration: 0.8, vignette: 1.15 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly points: Points;
  private readonly night: Mesh;
  private readonly rules: LineSegments;

  /** World position of every record, for picking and for the marker. */
  private readonly eventPositions: Vector3[] = [];

  /** Night at the centre of the frame, in day units. */
  private centre = DAY_COUNT / 2;
  private centreTarget = DAY_COUNT / 2;
  /** Nights the frame holds. */
  private rows = DAY_COUNT;
  private rowsTarget = DAY_COUNT;
  private pinchPrevious = 0;

  private selection: Selection | null = null;
  private selectStrength = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;
  private axis: { label: string; x: number }[] = [];

  constructor() {
    super(40);

    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.night = this.buildNightBand();
    this.rules = this.buildRules();
    this.points = this.buildPassages();
    this.scene.add(this.night, this.rules, this.points);

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  /** Midnight at both edges, noon in the middle. */
  private static xForMinute(minute: number): number {
    return (minute / 1440 - 0.5) * WALL_WIDTH;
  }

  /** Day 0 at the top, so reading down the wall reads forward in time. */
  private static yForDay(day: number): number {
    return WALL_HEIGHT / 2 - day * ROW_HEIGHT;
  }

  /**
   * Sunrise and sunset at a row *boundary* rather than at a row centre.
   *
   * Building the band from boundary to boundary means adjacent quads share an
   * edge and the twilight curve comes out smooth, instead of the staircase a
   * per-row rectangle would give.
   */
  private static twilightAt(boundary: number): { sunrise: number; sunset: number } {
    const before = passageSolar[clamp(boundary - 1, 0, DAY_COUNT - 1)];
    const after = passageSolar[clamp(boundary, 0, DAY_COUNT - 1)];
    return {
      sunrise: (before.sunrise + after.sunrise) / 2,
      sunset: (before.sunset + after.sunset) / 2,
    };
  }

  // ------------------------------------------------------------------- build --

  /**
   * The night, as two ribbons: midnight to sunrise on the left, sunset to
   * midnight on the right. `aEdge` runs 0 at the outer edge to 1 at the
   * twilight line, which is what lets the fragment shader put the light exactly
   * where the sun is.
   */
  private buildNightBand(): Mesh {
    const position: number[] = [];
    const edge: number[] = [];
    const day: number[] = [];

    const left = PassagesScene.xForMinute(0);
    const right = PassagesScene.xForMinute(1440);

    for (let row = 0; row < DAY_COUNT; row += 1) {
      const yTop = PassagesScene.yForDay(row) + ROW_HEIGHT / 2;
      const yBottom = yTop - ROW_HEIGHT;
      const top = PassagesScene.twilightAt(row);
      const bottom = PassagesScene.twilightAt(row + 1);

      const quads: [number, number, number, number, number, number][] = [
        // x-outer, x-twilight (top), x-outer, x-twilight (bottom), edge-outer, edge-twilight
        [left, PassagesScene.xForMinute(top.sunrise), left, PassagesScene.xForMinute(bottom.sunrise), 0, 1],
        [right, PassagesScene.xForMinute(top.sunset), right, PassagesScene.xForMinute(bottom.sunset), 0, 1],
      ];

      for (const [xOuterTop, xEdgeTop, xOuterBottom, xEdgeBottom, eOuter, eEdge] of quads) {
        // Two triangles, wound the same way for both ribbons.
        const corners: [number, number, number][] = [
          [xOuterTop, yTop, eOuter],
          [xEdgeTop, yTop, eEdge],
          [xEdgeBottom, yBottom, eEdge],
          [xOuterTop, yTop, eOuter],
          [xEdgeBottom, yBottom, eEdge],
          [xOuterBottom, yBottom, eOuter],
        ];
        for (const [x, y, e] of corners) {
          position.push(x, y, -0.05);
          edge.push(e);
          day.push(row);
        }
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aEdge', new BufferAttribute(new Float32Array(edge), 1));
    geometry.setAttribute('aDay', new BufferAttribute(new Float32Array(day), 1));

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: NIGHT_VERTEX,
        fragmentShader: NIGHT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // The two ribbons are mirror images of each other, so one of them is
        // wound the other way round and would be culled as a back face.
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * The armature: one hairline per night so eighty of them stay countable, a
   * brighter rule on the first of each month, and the six-hour verticals.
   */
  private buildRules(): LineSegments {
    const position: number[] = [];
    const weight: number[] = [];
    const day: number[] = [];

    const left = PassagesScene.xForMinute(0);
    const right = PassagesScene.xForMinute(1440);

    passages.days.forEach((entry, row) => {
      const y = PassagesScene.yForDay(row);
      // The first of a month is the only date a visitor can orient by without
      // labels, so it gets weight; every other night gets a whisper.
      const first = entry.date.endsWith('-01');
      position.push(left, y, -0.02, right, y, -0.02);
      weight.push(first ? 1 : 0, first ? 1 : 0);
      day.push(row, row);
    });

    const top = PassagesScene.yForDay(-0.5);
    const bottom = PassagesScene.yForDay(DAY_COUNT - 0.5);
    for (const hour of [0, 6, 12, 18, 24]) {
      const x = PassagesScene.xForMinute(hour * 60);
      position.push(x, top, -0.02, x, bottom, -0.02);
      // Midnight and noon carry the frame; the quarter hours are guides.
      const w = hour === 0 || hour === 24 || hour === 12 ? 0.55 : 0.3;
      weight.push(w, w);
      day.push(0, DAY_COUNT - 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aWeight', new BufferAttribute(new Float32Array(weight), 1));
    geometry.setAttribute('aDay', new BufferAttribute(new Float32Array(day), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: RULE_VERTEX,
        fragmentShader: RULE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    return lines;
  }

  private buildPassages(): Points {
    const count = passageEvents.count;
    const position = new Float32Array(count * 3);
    const kind = new Float32Array(count);
    const species = new Float32Array(count);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    const day = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const x = PassagesScene.xForMinute(passageEvents.minute[i]);
      const y = PassagesScene.yForDay(passageEvents.day[i]);
      position[i * 3] = x;
      position[i * 3 + 1] = y;
      position[i * 3 + 2] = 0;
      this.eventPositions.push(new Vector3(x, y, 0));

      const taxon = passages.species[passageEvents.species[i]];
      kind[i] = taxon.kind === 'mammal' ? 0 : taxon.kind === 'bird' ? 1 : 2;
      species[i] = passageEvents.species[i];
      // Group crossings are rare and worth seeing: a record of four animals is
      // drawn heavier than a record of one, on a square-root scale so it does
      // not swamp the row.
      size[i] = Math.sqrt(passageEvents.animals[i]);
      seed[i] = hash(i * 7.13);
      day[i] = passageEvents.day[i];
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aKind', new BufferAttribute(kind, 1));
    geometry.setAttribute('aSpecies', new BufferAttribute(species, 1));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aDay', new BufferAttribute(day, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: PASSAGE_VERTEX,
        fragmentShader: PASSAGE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 2;
    return cloud;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.rows = DAY_COUNT * 1.25;
    this.rowsTarget = DAY_COUNT;
    this.centre = DAY_COUNT / 2;
    this.centreTarget = DAY_COUNT / 2;
    this.pinchPrevious = 0;
    this.selectStrength = 0;

    // A species held in another chapter carries over, if this survey saw it.
    const held = speciesSelection.name;
    const index = held ? passages.species.findIndex(s => s.fr === held) : -1;
    this.selection = index >= 0 ? { species: index, event: -1 } : null;
    if (this.selection) this.frameSelection();
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.85, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      if (hit < 0) {
        this.selection = null;
        speciesSelection.clear();
      } else {
        const species = passageEvents.species[hit];
        // Tapping the same light twice lets go; tapping another light of the
        // same species walks the record without dropping the highlight.
        this.selection =
          this.selection?.event === hit ? null : { species, event: hit };
        speciesSelection.set(this.selection ? passages.species[species].fr : null);
      }
    }

    this.handleNavigation(ctx);

    this.selectStrength = damp(this.selectStrength, this.selection ? 1 : 0, 2.6, ctx.delta);
    this.uniforms.uSelected.value = this.selection?.species ?? -1;
    this.uniforms.uSelectStrength.value = this.selectStrength;

    this.updateCamera(ctx);
    this.updateOverlayAnchors();
    this.refreshReadout();
  }

  /**
   * Vertical only. The horizontal axis is the clock, and a clock that slides
   * under the finger is a clock the visitor can no longer read — so a drag
   * travels the summer and a pinch changes how much of it is on screen.
   */
  private handleNavigation(ctx: FrameContext): void {
    const active = [...ctx.pointer.touches.values()].filter(t => t.down);

    if (active.length >= 2) {
      const separation = Math.abs(active[0].ndc.y - active[1].ndc.y) + Math.abs(active[0].ndc.x - active[1].ndc.x);
      if (this.pinchPrevious > 0.001 && separation > 0.001) {
        this.rowsTarget *= this.pinchPrevious / separation;
      }
      this.pinchPrevious = separation;
    } else {
      this.pinchPrevious = 0;

      // Wheel is the laptop stand-in for a pinch; the panel never sends one.
      const wheel = ctx.pointer.consumeWheel();
      if (wheel !== 0) this.rowsTarget *= Math.pow(0.86, wheel);

      const drag = ctx.pointer.dragWithInertia;
      if (Math.abs(drag.y) > 1e-6) {
        // NDC to rows: half the frame is rowsTarget / 2 nights tall.
        this.centreTarget += drag.y * (this.rowsTarget / 2);
      }
    }

    this.rowsTarget = clamp(this.rowsTarget, MIN_ROWS, DAY_COUNT);
    // Never past the first or the last night: the wall has ends and pretending
    // otherwise reads as a bug the moment a visitor hits one.
    const halfRows = Math.min(this.rowsTarget, DAY_COUNT) / 2;
    this.centreTarget = clamp(this.centreTarget, halfRows - 0.5, DAY_COUNT - halfRows - 0.5);
  }

  /** Brings the held species into frame without changing how much is on screen. */
  private frameSelection(): void {
    if (!this.selection) return;
    const taxon = passages.species[this.selection.species];
    const middle = (taxon.firstDay + taxon.lastDay) / 2;
    const halfRows = this.rowsTarget / 2;
    this.centreTarget = clamp(middle, halfRows - 0.5, DAY_COUNT - halfRows - 0.5);
    this.centre = this.centreTarget;
  }

  /**
   * Square on to the wall.
   *
   * The distance is whichever of the two fits is tighter — enough rows to cover
   * the requested span, and enough width to keep both midnights on screen. A
   * portrait panel is limited by its width, a landscape one by its height, and
   * an actogram missing one of its edges is unreadable either way.
   */
  private updateCamera(ctx: FrameContext): void {
    this.rows = damp(this.rows, this.rowsTarget, 4.5, ctx.delta);
    this.centre = damp(this.centre, this.centreTarget, 5.5, ctx.delta);

    const halfFov = MathUtils.degToRad(this.camera.fov) / 2;
    // A margin on both fits: the masthead sits over the top of the frame, and a
    // wall whose first night is under the date line has lost its first night.
    const byHeight = ((this.rows * ROW_HEIGHT) / 2 / Math.tan(halfFov)) * 1.12;
    const byWidth = (WALL_WIDTH / 2 / (Math.tan(halfFov) * ctx.aspect)) * 1.06;
    const distance = Math.max(byHeight, byWidth);

    const y = PassagesScene.yForDay(this.centre);
    // A whisper of parallax toward the last touch, the same as the other
    // chapters, so the wall is never completely inert.
    this.camera.position.set(
      ctx.pointer.centroid.x * 0.45,
      y + ctx.pointer.centroid.y * 0.3,
      distance
    );
    this.camera.lookAt(0, y, 0);
    this.uniforms.uCentreDay.value = this.centre;
    this.uniforms.uRows.value = this.rows;
  }

  private pick(ndcX: number, ndcY: number): number {
    let best = -1;
    let bestDistance = TAP_RADIUS;
    for (let i = 0; i < this.eventPositions.length; i += 1) {
      this.probe.copy(this.eventPositions[i]).project(this.camera);
      if (this.probe.z > 1) continue;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** The marker follows the chosen record; the hour axis follows the camera. */
  private updateOverlayAnchors(): void {
    if (this.selection && this.selection.event >= 0) {
      this.probe.copy(this.eventPositions[this.selection.event]).project(this.camera);
      this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
    } else {
      this.marker = undefined;
    }

    this.axis = [0, 6, 12, 18, 24].map(hour => {
      this.probe.set(PassagesScene.xForMinute(hour * 60), PassagesScene.yForDay(this.centre), 0);
      this.probe.project(this.camera);
      return { label: `${String(hour % 24).padStart(2, '0')}:00`, x: (this.probe.x + 1) / 2 };
    });
  }

  // ----------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.selection ? `s${this.selection.species}-e${this.selection.event}` : 'overview';
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout = this.selection ? this.selectionReadout(this.selection) : this.overviewReadout();
    }
    // Both anchors move every frame while the camera settles, and both are
    // written straight to the DOM, so they are mutated in place rather than
    // spread into a new object the overlay would have to diff.
    this.cachedReadout.marker = this.marker;
    this.cachedReadout.axis = this.axis;
  }

  private chapterFrame(): Readout {
    return {
      period: `${formatPassageDate(passages.meta.start, true)} — ${formatPassageDate(passages.meta.end, true)} 2025`,
      source: `${passages.meta.total} passages · ${passages.meta.cameraCount} pièges photo · Every1Counts`,
      legend: [
        { label: 'Mammifères', color: kindAccent('mammal') },
        { label: 'Oiseaux', color: kindAccent('bird') },
        { label: 'Domestiques', color: kindAccent('domestic') },
      ],
    };
  }

  private overviewReadout(): Readout {
    const solsticeNight = Math.min(...passageSolar.map(s => s.nightHours));
    const lastNight = passageSolar[passageSolar.length - 1].nightHours;
    return {
      ...this.chapterFrame(),
      eyebrow: 'Chapitre VI',
      title: 'Passages',
      body:
        'Quatre-vingts nuits, une par ligne, minuit aux deux bords et midi au centre. ' +
        'Chaque lumière est un animal passé devant un piège photo. La nappe violette est la nuit réelle, ' +
        `du coucher au lever du soleil : ${solsticeNight.toFixed(1)} h au solstice, ` +
        `${lastNight.toFixed(1)} h à la mi-août. Touchez un passage.`,
      stats: [
        { label: 'Passages', value: String(passages.meta.total) },
        { label: 'Espèces', value: `${passages.meta.wildSpeciesCount} sauvages / ${passages.meta.speciesCount}` },
        { label: 'Nuits sans rien', value: String(passages.meta.dayCount - passages.meta.activeDays) },
        { label: 'Après le coucher', value: `${Math.round(passages.meta.nightShare * 100)} %` },
      ],
      spark: normalise(passages.hourly),
      accent: PALETTE.bone,
    };
  }

  private selectionReadout(selection: Selection): Readout {
    const taxon = passages.species[selection.species];
    const peak = taxon.hourly.indexOf(Math.max(...taxon.hourly));

    const body: string[] = [];
    if (selection.event >= 0) {
      const day = passages.days[passageEvents.day[selection.event]];
      const camera = passages.cameras[passageEvents.camera[selection.event]];
      const animals = passageEvents.animals[selection.event];
      body.push(
        `${formatPassageDate(day.date, true)}, ${formatClock(passageEvents.minute[selection.event])}, ` +
          `piège ${camera.code}${animals > 1 ? ` · ${animals} animaux` : ''}.`
      );
    }
    body.push(
      `Vu par ${taxon.cameras.length} des ${passages.meta.cameraCount} pièges, ` +
        `du ${formatPassageDate(passages.days[taxon.firstDay].date)} au ${formatPassageDate(passages.days[taxon.lastDay].date)}.`
    );

    return {
      ...this.chapterFrame(),
      eyebrow: `${kindLabel(taxon.kind)} · ${taxon.scientific}`,
      title: taxon.fr,
      body: body.join(' '),
      stats: [
        { label: 'Passages', value: String(taxon.count) },
        { label: 'Après le coucher', value: `${Math.round(taxon.nightShare * 100)} %` },
        { label: 'Heure de pointe', value: `${String(peak).padStart(2, '0')}:00` },
        { label: 'Pièges', value: `${taxon.cameras.length} / ${passages.meta.cameraCount}` },
      ],
      spark: normalise(taxon.hourly),
      accent: kindAccent(taxon.kind),
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uSelected: { value: -1 },
    uSelectStrength: { value: 0 },
    uCentreDay: { value: DAY_COUNT / 2 },
    uRows: { value: DAY_COUNT },
    uWine: { value: color(PALETTE.wine) },
    uGold: { value: color(PALETTE.gold) },
    uMist: { value: color(PALETTE.mist) },
    uBone: { value: color(PALETTE.bone) },
    uDusk: { value: color(PALETTE.dusk) },
    ...touch,
  };
}

function normalise(hourly: number[]): number[] {
  const max = Math.max(...hourly, 1);
  return hourly.map(v => v / max);
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

/** Rows arrive from the top as the chapter opens, oldest night first. */
const REVEAL = /* glsl */ `
uniform float uReveal;
uniform float uCentreDay;
uniform float uRows;

float rowReveal(float day){
  float front = uReveal * 1.35 - day / ${DAY_COUNT.toFixed(1)} * 0.35;
  return clamp(front, 0.0, 1.0);
}
`;

const NIGHT_VERTEX = /* glsl */ `
attribute float aEdge;
attribute float aDay;
varying float vEdge;
varying float vReveal;
varying vec3 vWorld;

${REVEAL}

void main(){
  vEdge = aEdge;
  vReveal = rowReveal(aDay);
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NIGHT_FRAGMENT = /* glsl */ `
uniform vec3 uDusk;
uniform vec3 uWine;
varying float vEdge;
varying float vReveal;
varying vec3 vWorld;

${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  // Deepest at midnight, thinning to nothing exactly at the sun's own line.
  float depth = 1.0 - vEdge;
  float body = pow(depth, 0.55);
  // The twilight edge itself: a thin warm seam where the sun crosses. Kept low
  // — it is a boundary, and a boundary drawn brighter than what it contains
  // turns the chapter into a picture of two curves.
  float seam = exp(-pow(vEdge - 0.985, 2.0) * 12000.0);

  vec3 tint = mix(uDusk * 0.75, uWine * 0.30, depth * 0.45);
  // Both kept small in world units: a ring travelling at the speed the abstract
  // chapters use would cross a fortnight of nights in a second and read as a
  // smear over the data rather than as an answer to a finger.
  float glow = touchGlow(vWorld, 2.0);
  float ripple = rippleField(vWorld, 3.0, 2.2, 0.7);

  float a = (body * 0.42 + seam * 0.20 + glow * 0.10 + ripple * 0.12) * vReveal;
  if (a < 0.004) discard;
  gl_FragColor = vec4((tint + vec3(0.26, 0.16, 0.06) * (seam * 0.8 + ripple)) * a, a);
}
`;

const RULE_VERTEX = /* glsl */ `
attribute float aWeight;
attribute float aDay;
varying float vWeight;
varying float vReveal;

${REVEAL}

void main(){
  vWeight = aWeight;
  vReveal = rowReveal(aDay);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RULE_FRAGMENT = /* glsl */ `
uniform vec3 uMist;
uniform vec3 uGold;
varying float vWeight;
varying float vReveal;

void main(){
  // A hairline for an ordinary night, a warmer one for the first of a month.
  // Both are armature: anything brighter and the grid competes with the animals
  // it exists to locate.
  vec3 tint = mix(uMist, uGold, vWeight);
  float a = mix(0.075, 0.16, vWeight) * vReveal;
  gl_FragColor = vec4(tint * a, a);
}
`;

const PASSAGE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSelected;
uniform float uSelectStrength;
uniform vec3 uWine;
uniform vec3 uGold;
uniform vec3 uMist;
uniform vec3 uBone;
attribute float aKind;
attribute float aSpecies;
attribute float aSize;
attribute float aSeed;
attribute float aDay;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

${REVEAL}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  float reveal = rowReveal(aDay);
  float selected = uSelected < -0.5 ? 0.0 : step(abs(uSelected - aSpecies), 0.5);
  vSelected = selected * uSelectStrength;

  // A passage is a moment, not a place: the light breathes rather than drifts,
  // so nothing is ever drawn at the wrong minute.
  float breath = 0.5 + 0.5 * sin(uTime * 1.1 + aSeed * 6.2831);
  pos.z += vSelected * 0.4;
  pos += touchDisplace(pos, 2.0, 0.25);

  float ripple = rippleField(pos, 3.0, 2.2, 0.7);

  vec3 kindColor = aKind < 0.5 ? uWine * 1.9 : aKind < 1.5 ? uGold * 1.25 : uMist * 1.5;
  vColor = mix(kindColor, mix(kindColor, uBone, 0.55) * 1.6, vSelected);
  vColor += vec3(0.32, 0.22, 0.10) * ripple;

  // Everything else recedes when a species is held, but nothing disappears:
  // the shape of the season is made of all of it.
  float dim = mix(1.0, 0.22, uSelectStrength * (1.0 - selected));
  vAlpha = (0.62 + breath * 0.22) * dim * reveal;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float scale = 0.20 + aSize * 0.10 + vSelected * 0.22 + ripple * 0.1;
  gl_PointSize = pointSizeFor(scale, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const PASSAGE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;

  float core = 1.0 - smoothstep(0.0, 0.5, d);
  float halo = exp(-d * 2.9) * 0.5;
  float ring = (1.0 - smoothstep(0.03, 0.08, abs(d - 0.8))) * vSelected;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.75 + vec3(ring) * 0.22, a);
}
`;
