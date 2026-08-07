import { BufferAttribute, BufferGeometry, LineSegments, MathUtils, Points, ShaderMaterial, Vector3 } from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatDay } from '../data/atlas';
import { passages, formatPassageDate } from '../data/passages';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Scene-unit width of the whole deployment, 29 May to 16 August. */
const SPAN = 34;

/** Where the two instruments' bands sit, above and below the axis. */
const EAR_Y = 3.4;
const EYE_Y = -3.4;

/** Tallest day on either band. */
const MAX_SWELL = 3.6;

const TAP_RADIUS = 0.09;

const DAYS = passages.meta.dayCount;

/** Which day of the camera deployment the recorders were switched on. */
const ACOUSTIC_OFFSET = Math.round(
  (Date.parse(`${atlas.days[0].date}T12:00:00Z`) - Date.parse(`${passages.meta.start}T12:00:00Z`)) / 86400000
);

/** The four species both instruments found, out of 133. */
const SHARED = (() => {
  const heard = new Map(atlas.species.map(s => [s.name, s]));
  return passages.species
    .filter(s => heard.has(s.fr))
    .map(s => ({
      fr: s.fr,
      seen: s.count,
      heard: heard.get(s.fr)?.count ?? 0,
      scientific: s.scientific,
    }))
    .sort((a, b) => b.seen + b.heard - (a.seen + a.heard));
})();

type Focus = 'both' | 'ear' | 'eye' | number;

/**
 * Chapter IX — Méthodes.
 *
 * How any of this is known, told as the two instruments themselves.
 *
 * Along the axis, eighty days of summer. Below it the camera traps, which
 * watched all eighty and recorded 367 passages. Above it the microphones, which
 * listened for the last seventeen and logged 2,665 detections — a band a fifth
 * as long and seven times as heavy, which is the whole difference between the
 * two methods in one shape.
 *
 * Then the punchline, drawn between them. The recorders found 121 species; the
 * cameras found 15. Between the two lists there are exactly **four** species in
 * common — pheasant, great tit, red-backed shrike, robin — and they are the only
 * threads crossing the axis. Everything else each instrument found, the other
 * one missed entirely: no microphone ever heard the badger, and no camera ever
 * saw the ninety-odd songbirds passing overhead.
 *
 * That is not a flaw in either instrument. It is what a method *is*: a question
 * with a shape, which can only be answered in that shape. Ask with a microphone
 * and a place answers in birdsong; ask with a lens and the same place answers in
 * footprints on a trail at two in the morning.
 */
export class MethodsScene extends ChapterBase {
  readonly id = 'methods' as const;
  readonly look = { exposure: 1.0, bloom: 0.6, grain: 0.022, aberration: 0.95, vignette: 1.14 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly axis: LineSegments;
  private readonly bands: Points;
  private readonly threads: LineSegments;
  private readonly nodes: Points;

  /** Screen anchors for the two instruments and the four shared species. */
  private readonly anchors: { focus: Focus; position: Vector3 }[] = [];

  private focus: Focus = 'both';
  private focusStrength = 0;
  private orbit = 0;
  private orbitTarget = 0;
  private zoom = 1.25;
  private zoomTarget = 1;
  private pinchPrevious = 0;
  private flight = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  constructor() {
    super(42);

    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.layoutAnchors();
    this.axis = this.buildAxis();
    this.bands = this.buildBands();
    this.threads = this.buildThreads();
    this.nodes = this.buildNodes();
    this.scene.add(this.axis, this.threads, this.bands, this.nodes);

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  private static xForDay(day: number): number {
    return (day / (DAYS - 1) - 0.5) * SPAN;
  }

  /** Where a shared species' thread crosses the axis. */
  private static xForShared(index: number): number {
    // Left of centre, where there is room between the hubs and the busy end of
    // the acoustic band.
    return -SPAN * 0.22 + (index / Math.max(1, SHARED.length - 1)) * SPAN * 0.34;
  }

  private layoutAnchors(): void {
    // The two hubs sit clear of the axis, one above and one below, so the fans
    // they throw never wash over the bands they are meant to explain.
    this.anchors.push({ focus: 'ear', position: new Vector3(-SPAN * 0.54, EAR_Y + 1.5, 0) });
    this.anchors.push({ focus: 'eye', position: new Vector3(-SPAN * 0.54, EYE_Y - 1.5, 0) });
    SHARED.forEach((_, i) => {
      this.anchors.push({ focus: i, position: new Vector3(MethodsScene.xForShared(i), 0, 0) });
    });
  }

  // ------------------------------------------------------------------- build --

  /** The eighty days, as a rule with a mark on the first of each month. */
  private buildAxis(): LineSegments {
    const position: number[] = [];
    const weight: number[] = [];

    for (let day = 0; day < DAYS - 1; day += 1) {
      for (const step of [day, day + 1]) {
        position.push(MethodsScene.xForDay(step), 0, 0);
        weight.push(0.25);
      }
    }

    passages.days.forEach((entry, day) => {
      if (!entry.date.endsWith('-01')) return;
      const x = MethodsScene.xForDay(day);
      position.push(x, -0.55, 0, x, 0.55, 0);
      weight.push(1, 1);
    });

    // The day the recorders were switched on: the one event on this axis.
    const start = MethodsScene.xForDay(ACOUSTIC_OFFSET);
    position.push(start, -EAR_Y, 0, start, EAR_Y, 0);
    weight.push(0.6, 0.6);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aWeight', new BufferAttribute(new Float32Array(weight), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: AXIS_VERTEX,
        fragmentShader: AXIS_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    return lines;
  }

  /**
   * Both instruments' daily effort, as two swarms.
   *
   * Each day is drawn as a little column of motes whose height is that day's
   * count on its own scale — the two bands cannot share one, because 347
   * detections in a day and 24 passages in a day are not the same unit and
   * putting them on the same rule would say they were.
   */
  private buildBands(): Points {
    const position: number[] = [];
    const side: number[] = [];
    const day: number[] = [];
    const seed: number[] = [];

    const acousticMax = Math.max(...atlas.days.map(d => d.count), 1);
    const cameraMax = Math.max(...passages.days.map(d => d.count), 1);

    atlas.days.forEach((entry, i) => {
      const x = MethodsScene.xForDay(i + ACOUSTIC_OFFSET);
      const swell = Math.pow(entry.count / acousticMax, 0.72) * MAX_SWELL;
      const motes = Math.max(2, Math.round(6 + (entry.count / acousticMax) * 26));
      for (let m = 0; m < motes; m += 1) {
        position.push(x, EAR_Y + (m / motes) * swell, 0);
        side.push(0);
        day.push(i + ACOUSTIC_OFFSET);
        seed.push(hash(i * 13.7 + m));
      }
    });

    passages.days.forEach((entry, i) => {
      if (entry.count === 0) return;
      const x = MethodsScene.xForDay(i);
      const swell = Math.pow(entry.count / cameraMax, 0.72) * MAX_SWELL;
      const motes = Math.max(2, Math.round(3 + (entry.count / cameraMax) * 18));
      for (let m = 0; m < motes; m += 1) {
        position.push(x, EYE_Y - (m / motes) * swell, 0);
        side.push(1);
        day.push(i);
        seed.push(hash(i * 7.3 + m + 500));
      }
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
    geometry.setAttribute('aDay', new BufferAttribute(new Float32Array(day), 1));
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: BAND_VERTEX,
        fragmentShader: BAND_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 2;
    return cloud;
  }

  /**
   * The four threads that cross.
   *
   * Everything either instrument found that the other missed is drawn as a stub
   * that goes nowhere — one per species, fanned out from each side. Only four
   * threads make it all the way across, and they are the whole point.
   */
  private buildThreads(): LineSegments {
    const position: number[] = [];
    const shared: number[] = [];
    const along: number[] = [];
    const index: number[] = [];
    const segments = 22;

    const curve = (t: number, from: Vector3, to: Vector3, out: Vector3): void => {
      // Bowed through the axis, so a crossing reads as a crossing.
      const midX = (from.x + to.x) / 2;
      const inv = 1 - t;
      out.set(
        inv * inv * from.x + 2 * inv * t * midX + t * t * to.x,
        inv * inv * from.y + t * t * to.y,
        0
      );
    };

    const from = new Vector3();
    const to = new Vector3();
    const point = new Vector3();

    SHARED.forEach((_, i) => {
      const x = MethodsScene.xForShared(i);
      from.set(-SPAN * 0.54, EAR_Y + 1.5, 0.4);
      to.set(x, 0, 0.4);
      for (const [a, b] of [
        [from.clone(), to.clone()],
        [new Vector3(-SPAN * 0.54, EYE_Y - 1.5, 0.4), to.clone()],
      ]) {
        for (let s = 0; s < segments; s += 1) {
          for (const t of [s / segments, (s + 1) / segments]) {
            curve(t, a, b, point);
            position.push(point.x, point.y, point.z);
            shared.push(1);
            along.push(t);
            index.push(i);
          }
        }
      }
    });

    // The stubs: everything each instrument found alone.
    const stub = (count: number, y: number, sign: number) => {
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count;
        const spread = (t - 0.5) * 2;
        const x0 = -SPAN * 0.54;
        // Short and swept back behind the bands: a hundred and twenty-eight
        // findings that went nowhere should read as a brush, not as a starburst
        // across the chapter.
        const x1 = x0 - 1.0 - Math.abs(spread) * 1.9;
        const y1 = y + sign * spread * 2.9;
        position.push(x0, y, -1.5, x1, y1, -1.5);
        shared.push(0, 0);
        along.push(0, 1);
        index.push(-1, -1);
      }
    };
    stub(atlas.species.length - SHARED.length, EAR_Y, 1);
    stub(passages.species.length - SHARED.length, EYE_Y, -1);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aShared', new BufferAttribute(new Float32Array(shared), 1));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
    geometry.setAttribute('aIndex', new BufferAttribute(new Float32Array(index), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: THREAD_VERTEX,
        fragmentShader: THREAD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    return lines;
  }

  /** The two instruments, and a node on each crossing thread. */
  private buildNodes(): Points {
    const position: number[] = [];
    const kind: number[] = [];
    const index: number[] = [];

    for (const anchor of this.anchors) {
      position.push(anchor.position.x, anchor.position.y, anchor.position.z);
      kind.push(typeof anchor.focus === 'number' ? 2 : anchor.focus === 'ear' ? 0 : 1);
      index.push(typeof anchor.focus === 'number' ? anchor.focus : -1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aKind', new BufferAttribute(new Float32Array(kind), 1));
    geometry.setAttribute('aIndex', new BufferAttribute(new Float32Array(index), 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: NODE_VERTEX,
        fragmentShader: NODE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 3;
    return cloud;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.focus = 'both';
    this.focusStrength = 0;
    this.orbit = 0;
    this.orbitTarget = 0;
    this.zoom = 1.25;
    this.zoomTarget = 1;
    this.flight = 0;
    this.pinchPrevious = 0;
    this.readoutKey = '';
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.75, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.focus = hit === null || sameFocus(hit, this.focus) ? 'both' : hit;
      speciesSelection.set(typeof this.focus === 'number' ? SHARED[this.focus].fr : null);
    }

    this.handleNavigation(ctx);

    this.focusStrength = damp(this.focusStrength, this.focus === 'both' ? 0 : 1, 2.6, ctx.delta);
    this.uniforms.uFocus.value =
      this.focus === 'both' ? -1 : this.focus === 'ear' ? 0 : this.focus === 'eye' ? 1 : 2;
    this.uniforms.uFocusIndex.value = typeof this.focus === 'number' ? this.focus : -1;
    this.uniforms.uFocusStrength.value = this.focusStrength;

    this.flight = Math.min(1, this.flight + ctx.delta / 4);
    this.updateCamera(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  private handleNavigation(ctx: FrameContext): void {
    const active = [...ctx.pointer.touches.values()].filter(t => t.down);

    if (active.length >= 2) {
      const separation = active[0].ndc.distanceTo(active[1].ndc);
      if (this.pinchPrevious > 0.001 && separation > 0.001) {
        this.zoomTarget *= this.pinchPrevious / separation;
      }
      this.pinchPrevious = separation;
    } else {
      this.pinchPrevious = 0;
      const wheel = ctx.pointer.consumeWheel();
      if (wheel !== 0) this.zoomTarget *= Math.pow(0.88, wheel);
      const drag = ctx.pointer.dragWithInertia;
      if (Math.abs(drag.x) > 1e-6) this.orbitTarget = clamp(this.orbitTarget - drag.x * 1.6, -0.5, 0.5);
    }

    this.zoomTarget = clamp(this.zoomTarget, 0.7, 1.6);
    if (ctx.idle > 0.4) this.orbitTarget = damp(this.orbitTarget, 0, 0.5 * ctx.idle, ctx.delta);
  }

  private updateCamera(ctx: FrameContext): void {
    this.orbit = damp(this.orbit, this.orbitTarget, 3, ctx.delta);
    this.zoom = damp(this.zoom, this.zoomTarget, 2.2, ctx.delta);

    const landed = 1 - Math.pow(1 - this.flight, 3);
    const halfV = MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * ctx.aspect);
    // Framed on the width when there is width to spare, on the height when the
    // panel is tall — the axis is the thing that must never be cropped.
    const distance =
      Math.max(SPAN * 0.58 / Math.tan(halfH), (EAR_Y + MAX_SWELL + 1.5) / Math.tan(halfV)) *
      this.zoom *
      (1 + (1 - landed) * 0.25);

    const swing = this.orbit + Math.sin(ctx.time * 0.08) * 0.03 + ctx.pointer.centroid.x * 0.05;
    this.camera.position.set(
      Math.sin(swing) * distance,
      ctx.pointer.centroid.y * 1.1 + (1 - landed) * 3,
      Math.cos(swing) * distance
    );
    this.camera.lookAt(0, 0, 0);
  }

  private pick(ndcX: number, ndcY: number): Focus | null {
    let best: Focus | null = null;
    let bestDistance = TAP_RADIUS;
    for (const anchor of this.anchors) {
      this.probe.copy(anchor.position).project(this.camera);
      if (this.probe.z > 1) continue;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = anchor.focus;
      }
    }
    return best;
  }

  private updateMarker(): void {
    const anchor = this.anchors.find(a => sameFocus(a.focus, this.focus));
    if (!anchor || this.focus === 'both') {
      this.marker = undefined;
      return;
    }
    this.probe.copy(anchor.position).project(this.camera);
    this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
  }

  // ----------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = typeof this.focus === 'number' ? `shared-${this.focus}` : this.focus;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout =
        typeof this.focus === 'number'
          ? this.sharedReadout(this.focus)
          : this.focus === 'ear'
            ? this.earReadout()
            : this.focus === 'eye'
              ? this.eyeReadout()
              : this.overviewReadout();
    }
    this.cachedReadout.marker = this.marker;
  }

  private frame(): Readout {
    return {
      period: `${formatPassageDate(passages.meta.start, true)} — ${formatPassageDate(passages.meta.end, true)} 2025`,
      legend: [
        { label: 'Micros · 17 jours', color: PALETTE.gold },
        { label: 'Pièges photo · 80 jours', color: PALETTE.wine },
        { label: 'Les deux', color: PALETTE.bone },
      ],
      source: 'Every1Counts · BirdNET · 8 pièges photo, 5 enregistreurs',
    };
  }

  private overviewReadout(): Readout {
    return {
      ...this.frame(),
      eyebrow: 'Chapitre IX',
      title: 'Méthodes',
      body:
        `Deux instruments, un été. En bas les pièges photo : quatre-vingts jours de guet, ` +
        `${passages.meta.total} passages. En haut les micros : dix-sept jours d’écoute, ` +
        `${atlas.meta.total.toLocaleString('fr-FR')} détections. ` +
        `Ensemble ils trouvent ${atlas.meta.speciesCount + passages.meta.speciesCount} espèces — ` +
        `et n’en partagent que ${SHARED.length}. Ce sont les seuls fils qui traversent.`,
      stats: [
        { label: 'Espèces entendues', value: String(atlas.meta.speciesCount) },
        { label: 'Espèces vues', value: String(passages.meta.speciesCount) },
        { label: 'En commun', value: String(SHARED.length) },
        { label: 'Jours de relevé', value: `${DAYS} / ${atlas.days.length}` },
      ],
      accent: PALETTE.bone,
    };
  }

  private earReadout(): Readout {
    const best = atlas.days.reduce((a, b) => (b.count > a.count ? b : a));
    return {
      ...this.frame(),
      eyebrow: 'Instrument · cinq enregistreurs',
      title: 'Écouter',
      body:
        `Du ${formatDay(atlas.days[0].date)} au ${formatDay(atlas.days[atlas.days.length - 1].date)}, ` +
        `cinq micros sur le domaine, et un modèle — BirdNET — qui nomme ce qu’ils captent. ` +
        `Il entend tout ce qui chante, de la caille au butor, et absolument rien de ce qui marche sans bruit : ` +
        `pas un blaireau, pas un renard.`,
      stats: [
        { label: 'Détections', value: atlas.meta.total.toLocaleString('fr-FR') },
        { label: 'Espèces', value: String(atlas.meta.speciesCount) },
        { label: 'Meilleur jour', value: `${best.count} · ${formatDay(best.date)}` },
        { label: 'La nuit', value: `${Math.round(atlas.meta.nightShare * 100)} %` },
      ],
      spark: atlas.days.map(d => d.count / Math.max(...atlas.days.map(x => x.count))),
      accent: PALETTE.gold,
    };
  }

  private eyeReadout(): Readout {
    const best = passages.days.reduce((a, b) => (b.count > a.count ? b : a));
    return {
      ...this.frame(),
      eyebrow: 'Instrument · huit pièges photo',
      title: 'Voir',
      body:
        `Du ${formatPassageDate(passages.meta.start, true)} au ${formatPassageDate(passages.meta.end, true)}, ` +
        `huit boîtiers à hauteur de museau, déclenchés par le mouvement, relevés à l’œil. ` +
        `Ils voient le renard, le chacal, le sanglier, le chat forestier — et ne verront jamais ` +
        `les quatre-vingt-dix passereaux qui passent au-dessus.`,
      stats: [
        { label: 'Passages', value: String(passages.meta.total) },
        { label: 'Espèces', value: String(passages.meta.speciesCount) },
        { label: 'Meilleur jour', value: `${best.count} · ${formatPassageDate(best.date)}` },
        { label: 'La nuit', value: `${Math.round(passages.meta.nightShare * 100)} %` },
      ],
      spark: passages.days.map(d => d.count / Math.max(...passages.days.map(x => x.count))),
      accent: PALETTE.wine,
    };
  }

  private sharedReadout(index: number): Readout {
    const entry = SHARED[index];
    return {
      ...this.frame(),
      eyebrow: `Vue et entendue · ${entry.scientific}`,
      title: entry.fr,
      body:
        `Une des ${SHARED.length} espèces que les deux instruments ont trouvées. ` +
        `${entry.heard} fois au micro, ${entry.seen} fois devant l’objectif : ` +
        `le même animal, compté deux fois par deux méthodes qui ne se ressemblent en rien.`,
      stats: [
        { label: 'Entendue', value: String(entry.heard) },
        { label: 'Vue', value: String(entry.seen) },
        { label: 'En commun', value: `${SHARED.length} / ${atlas.meta.speciesCount + passages.meta.speciesCount}` },
      ],
      accent: PALETTE.bone,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

function sameFocus(a: Focus, b: Focus): boolean {
  return a === b;
}

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uFocus: { value: -1 },
    uFocusIndex: { value: -1 },
    uFocusStrength: { value: 0 },
    uGold: { value: color(PALETTE.gold) },
    uWine: { value: color(PALETTE.wine) },
    uBone: { value: color(PALETTE.bone) },
    uMist: { value: color(PALETTE.mist) },
    ...touch,
  };
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const FOCUS = /* glsl */ `
uniform float uFocus;
uniform float uFocusIndex;
uniform float uFocusStrength;

/** 1 while this side of the axis is the one being looked at. */
float sideFocus(float side){
  if (uFocus < -0.5) return 1.0;
  return mix(1.0, step(abs(uFocus - side), 0.5), uFocusStrength);
}
`;

const AXIS_VERTEX = /* glsl */ `
uniform float uReveal;
attribute float aWeight;
varying float vWeight;

void main(){
  vWeight = aWeight;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AXIS_FRAGMENT = /* glsl */ `
uniform float uReveal;
uniform vec3 uMist;
uniform vec3 uBone;
varying float vWeight;

void main(){
  float a = mix(0.10, 0.34, vWeight) * uReveal;
  vec3 tint = mix(uMist, uBone, vWeight * 0.6);
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

const BAND_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uGold;
uniform vec3 uWine;
attribute float aSide;
attribute float aDay;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;

${SIMPLEX3}
${EASING}
${FOCUS}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  // The swarm breathes along the axis rather than across it, so the day a mote
  // belongs to never becomes ambiguous.
  float t = uTime * 0.35 + aSeed * 6.2831;
  pos.x += sin(t) * 0.05;
  pos.y += cos(t * 1.1) * 0.07;
  pos.z += snoise(vec3(aSeed * 9.0, uTime * 0.2, aDay * 0.1)) * 0.35;

  pos += touchDisplace(pos, 4.0, 0.7);
  float ripple = rippleField(pos, 9.0, 2.6, 1.6);
  pos.y += ripple * 0.35 * (aSide < 0.5 ? 1.0 : -1.0);

  vColor = mix(uGold, uWine * 1.5, aSide) + vec3(0.28, 0.2, 0.08) * ripple;

  // The bands arrive left to right, the way the summer ran.
  float grow = easeOutQuart(clamp(uReveal * 1.8 - aDay / ${DAYS.toFixed(1)} * 0.7, 0.0, 1.0));
  vAlpha = 0.5 * grow * sideFocus(aSide);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.15 + ripple * 0.08, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const BAND_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.55, d);
  float halo = exp(-d * 2.8) * 0.45;
  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.8, a);
}
`;

const THREAD_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aShared;
attribute float aAlong;
attribute float aIndex;
varying float vShared;
varying float vAlong;
varying float vHeld;

${EASING}
${FOCUS}

void main(){
  vShared = aShared;
  vAlong = aAlong;
  vHeld = (uFocusIndex < -0.5 ? 0.0 : step(abs(uFocusIndex - aIndex), 0.5)) * uFocusStrength;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const THREAD_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uBone;
uniform vec3 uMist;
varying float vShared;
varying float vAlong;
varying float vHeld;

void main(){
  // A thread that crosses is bone and carries a travelling light; a stub that
  // goes nowhere is a grey hair, and there are a hundred and twenty-eight of them.
  float pulse = exp(-pow(fract(vAlong - uTime * 0.22) - 0.5, 2.0) * 30.0) * vShared;
  float taper = vShared > 0.5 ? 1.0 : (1.0 - vAlong) * 0.8;

  vec3 tint = mix(uMist, uBone, vShared);
  float a = (mix(0.05, 0.34, vShared) + pulse * 0.4 + vHeld * 0.5) * taper * uReveal;
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

const NODE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uGold;
uniform vec3 uWine;
uniform vec3 uBone;
attribute float aKind;
attribute float aIndex;
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

${EASING}
${FOCUS}
${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vec3 pos = position;
  vHeld = aKind < 1.5
    ? (uFocus < -0.5 ? 0.0 : step(abs(uFocus - aKind), 0.5)) * uFocusStrength
    : (uFocusIndex < -0.5 ? 0.0 : step(abs(uFocusIndex - aIndex), 0.5)) * uFocusStrength;

  pos.y += sin(uTime * 0.9 + aIndex + aKind * 2.0) * 0.06;
  pos += touchDisplace(pos, 3.0, 0.4);

  vColor = aKind < 0.5 ? uGold : aKind < 1.5 ? uWine * 1.6 : uBone;
  vColor = mix(vColor, uBone, vHeld * 0.5) * (1.0 + vHeld * 0.5);
  vAlpha = (aKind < 1.5 ? 0.85 : 0.6) * easeOutQuart(clamp(uReveal * 1.5, 0.0, 1.0));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor((aKind < 1.5 ? 0.62 : 0.42) + vHeld * 0.3, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const NODE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.42, d);
  float halo = exp(-d * 2.4) * 0.5;
  float ring = 1.0 - smoothstep(0.03, 0.08, abs(d - 0.72));

  float a = (core + halo + ring * (0.35 + vHeld * 0.6)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.85 + vec3(ring) * 0.12 * vHeld, a);
}
`;
