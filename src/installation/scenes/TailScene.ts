import {
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { POINT_SIZE, RIPPLE_UNIFORMS, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildCss, guildIndex, guildLabel, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, normalisedHourly } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Scene units between neighbouring ranks. */
const SPACING = 1.15;

/** Tallest filament, in scene units. */
const MAX_HEIGHT = 9;

/** Points stacked in the tallest filament; the rarest get three. */
const MAX_BEADS = 22;

const TAP_RADIUS = 0.07;

const SPECIES = atlas.species;
const COUNT = SPECIES.length;
const MAX_COUNT = SPECIES[0].count;

/** Running total down the ranks — the Lorenz curve of the whole record. */
const CUMULATIVE = (() => {
  const out: number[] = [];
  let sum = 0;
  for (const species of SPECIES) {
    sum += species.count;
    out.push(sum / atlas.meta.total);
  }
  return out;
})();

/** How few species it takes to make half the recording. Eight, as it turns out. */
const HALF_RANK = CUMULATIVE.findIndex(v => v >= 0.5) + 1;

const SINGLETONS = SPECIES.filter(s => s.count === 1).length;

/**
 * Chapter VII — La traîne.
 *
 * The 121 species ranked from the most heard to the least, as a receding
 * colonnade of filaments. It is the oldest plot in community ecology and it
 * carries the least comfortable fact in the survey: eight species make half the
 * 2,665 detections, and thirty-two were heard exactly once. A place is not its
 * common species — it is mostly the ones you nearly missed.
 *
 * The height is logarithmic and the chapter says so on screen. On a linear
 * scale the greenfinch would stand 255 times taller than the tail, the tail
 * would be a line of dust a pixel high, and the picture would argue the exact
 * opposite of what the data means.
 *
 * The gold ramp climbing away behind the filaments is the running total: it
 * passes half the record within the first eight, then spends the remaining
 * hundred and thirteen crawling to the top.
 */
export class TailScene extends ChapterBase {
  readonly id = 'tail' as const;
  readonly look = { exposure: 0.98, bloom: 0.62, grain: 0.022, aberration: 0.95, vignette: 1.15 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly filaments: Points;
  private readonly ramp: LineSegments;
  private readonly rule: LineSegments;

  /** Top of each filament, for picking and for the marker. */
  private readonly tops: Vector3[] = [];

  /** Rank at the centre of the frame, 0..COUNT - 1. */
  private travel = 0;
  private travelTarget = 0;
  /** 1 walks the colonnade, 3 stands back from the whole of it. */
  private spread = 2.4;
  private spreadTarget = 1.35;
  private pinchPrevious = 0;

  private selected: number | null = null;
  private selectStrength = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  constructor() {
    super(42);

    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.filaments = this.buildFilaments();
    this.ramp = this.buildRamp();
    this.rule = this.buildRule();
    this.scene.add(this.rule, this.ramp, this.filaments);

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  private static zForRank(rank: number): number {
    return -rank * SPACING;
  }

  /** Log height, normalised so rank 1 is exactly MAX_HEIGHT. */
  private static heightFor(count: number): number {
    return (Math.log10(count + 1) / Math.log10(MAX_COUNT + 1)) * MAX_HEIGHT;
  }

  // ------------------------------------------------------------------- build --

  private buildFilaments(): Points {
    const position: number[] = [];
    const guild: number[] = [];
    const rank: number[] = [];
    const along: number[] = [];
    const share: number[] = [];

    SPECIES.forEach((species, index) => {
      const height = TailScene.heightFor(species.count);
      const beads = Math.max(3, Math.round((height / MAX_HEIGHT) * MAX_BEADS));
      const z = TailScene.zForRank(index);
      this.tops.push(new Vector3(0, height, z));

      for (let b = 0; b < beads; b += 1) {
        const t = beads === 1 ? 0 : b / (beads - 1);
        position.push(0, t * height, z);
        guild.push(guildIndex(species.guild));
        rank.push(index);
        along.push(t);
        // Linear share, kept alongside the log height: the filament says how
        // rare, the brightness says how much of the record.
        share.push(species.count / MAX_COUNT);
      }
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aGuild', new BufferAttribute(new Float32Array(guild), 1));
    geometry.setAttribute('aRank', new BufferAttribute(new Float32Array(rank), 1));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
    geometry.setAttribute('aShare', new BufferAttribute(new Float32Array(share), 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: FILAMENT_VERTEX,
        fragmentShader: FILAMENT_FRAGMENT,
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
   * The running total, as a ramp climbing away from the head of the ranking.
   * It is drawn to one side so it never reads as another filament.
   */
  private buildRamp(): LineSegments {
    const position: number[] = [];
    const rank: number[] = [];
    const value: number[] = [];

    for (let i = 0; i < COUNT - 1; i += 1) {
      for (const step of [i, i + 1]) {
        position.push(-3.4, CUMULATIVE[step] * MAX_HEIGHT * 1.15, TailScene.zForRank(step));
        rank.push(step);
        value.push(CUMULATIVE[step]);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aRank', new BufferAttribute(new Float32Array(rank), 1));
    geometry.setAttribute('aValue', new BufferAttribute(new Float32Array(value), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: RAMP_VERTEX,
        fragmentShader: RAMP_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    return lines;
  }

  /**
   * The floor the filaments stand on, plus a cross tick every tenth rank so the
   * colonnade can be counted, and a brighter one where the running total passes
   * half the record.
   */
  private buildRule(): LineSegments {
    const position: number[] = [];
    const rank: number[] = [];
    const weight: number[] = [];

    for (let i = 0; i < COUNT - 1; i += 1) {
      for (const step of [i, i + 1]) {
        position.push(0, 0, TailScene.zForRank(step));
        rank.push(step);
        weight.push(0.25);
      }
    }

    for (let i = 0; i < COUNT; i += 1) {
      const half = i === HALF_RANK - 1;
      if (!half && (i + 1) % 10 !== 0) continue;
      const z = TailScene.zForRank(i);
      const width = half ? 3.4 : 1.5;
      position.push(-width, 0, z, width, 0, z);
      rank.push(i, i);
      weight.push(half ? 1 : 0.5, half ? 1 : 0.5);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aRank', new BufferAttribute(new Float32Array(rank), 1));
    geometry.setAttribute('aWeight', new BufferAttribute(new Float32Array(weight), 1));

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

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.spread = 2.4;
    this.spreadTarget = 1.35;
    this.pinchPrevious = 0;
    this.selectStrength = 0;

    const held = speciesSelection.name;
    const index = held ? SPECIES.findIndex(s => s.name === held) : -1;
    this.selected = index >= 0 ? index : null;
    this.travelTarget = index >= 0 ? index : 0;
    this.travel = Math.max(0, this.travelTarget - 6);
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.8, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.selected = hit === this.selected ? null : hit;
      speciesSelection.set(this.selected === null ? null : SPECIES[this.selected].name);
      if (this.selected !== null) this.travelTarget = this.selected;
    }

    this.handleNavigation(ctx);

    this.selectStrength = damp(this.selectStrength, this.selected === null ? 0 : 1, 2.6, ctx.delta);
    this.uniforms.uSelected.value = this.selected ?? -1;
    this.uniforms.uSelectStrength.value = this.selectStrength;

    this.updateCamera(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  /**
   * Drag travels the ranking, pinch stands back from it.
   *
   * Left to itself the camera keeps walking down the colonnade and returns to
   * the head when it runs out — an attract loop that is also the honest way to
   * read the plot, head first.
   */
  private handleNavigation(ctx: FrameContext): void {
    const active = [...ctx.pointer.touches.values()].filter(t => t.down);

    if (active.length >= 2) {
      const separation = active[0].ndc.distanceTo(active[1].ndc);
      if (this.pinchPrevious > 0.001 && separation > 0.001) {
        this.spreadTarget *= this.pinchPrevious / separation;
      }
      this.pinchPrevious = separation;
    } else {
      this.pinchPrevious = 0;

      const wheel = ctx.pointer.consumeWheel();
      if (wheel !== 0) this.spreadTarget *= Math.pow(0.88, wheel);

      const drag = ctx.pointer.dragWithInertia;
      if (Math.abs(drag.x) > 1e-6) {
        this.travelTarget -= drag.x * COUNT * 0.55;
        this.selected = null;
        speciesSelection.clear();
      }
    }

    // Idle drift, slower through the head where the interesting species are.
    if (ctx.idle > 0.01 && this.selected === null) {
      this.travelTarget += ctx.delta * ctx.idle * (2.5 + this.travelTarget * 0.06);
      if (this.travelTarget > COUNT - 1) this.travelTarget = 0;
    }

    this.spreadTarget = clamp(this.spreadTarget, 0.9, 3.2);
    this.travelTarget = clamp(this.travelTarget, 0, COUNT - 1);
  }

  /**
   * Off to one side and slightly above, looking a few ranks ahead — the view
   * down a colonnade rather than at a bar chart. Standing back widens the
   * offset and lifts the eye, so the whole tail comes into frame at once.
   */
  private updateCamera(ctx: FrameContext): void {
    this.travel = damp(this.travel, this.travelTarget, 2.6, ctx.delta);
    this.spread = damp(this.spread, this.spreadTarget, 2.2, ctx.delta);

    const z = TailScene.zForRank(this.travel);
    const sway = Math.sin(ctx.time * 0.11) * 0.6;

    this.camera.position.set(
      13 * this.spread + sway + ctx.pointer.centroid.x * 2.4,
      5.2 * this.spread + ctx.pointer.centroid.y * 1.6,
      z + 15 * this.spread
    );
    this.camera.lookAt(0, MAX_HEIGHT * 0.34, z - 7 * this.spread);

    this.uniforms.uTravel.value = this.travel;
    this.uniforms.uSpread.value = this.spread;
  }

  private pick(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    let bestDistance = TAP_RADIUS;
    for (let i = 0; i < this.tops.length; i += 1) {
      // Filaments are tall and thin, so the whole column is the target: the
      // probe is the point on it nearest the tap, not just its tip.
      this.probe.copy(this.tops[i]).project(this.camera);
      if (this.probe.z > 1) continue;
      const topX = this.probe.x;
      const topY = this.probe.y;
      this.probe.set(0, 0, this.tops[i].z).project(this.camera);
      const baseX = this.probe.x;
      const baseY = this.probe.y;

      const dx = topX - baseX;
      const dy = topY - baseY;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq < 1e-9 ? 0 : clamp(((ndcX - baseX) * dx + (ndcY - baseY) * dy) / lengthSq, 0, 1);
      const distance = Math.hypot(baseX + dx * t - ndcX, baseY + dy * t - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  private updateMarker(): void {
    if (this.selected === null) {
      this.marker = undefined;
      return;
    }
    this.probe.copy(this.tops[this.selected]).project(this.camera);
    this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
  }

  // ----------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.selected === null ? 'overview' : `species-${this.selected}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout = this.selected === null ? this.overviewReadout() : this.speciesReadout(this.selected);
    }
    this.cachedReadout.marker = this.marker;
  }

  private overviewReadout(): Readout {
    return {
      eyebrow: 'Chapitre VII',
      title: 'La traîne',
      body:
        `Les ${COUNT} espèces classées de la plus entendue à la plus rare. ` +
        `Les ${HALF_RANK} premières font la moitié des ${atlas.meta.total.toLocaleString('fr-FR')} détections ; ` +
        `${SINGLETONS} n’ont été entendues qu’une seule fois. La hauteur est logarithmique — ` +
        'à l’échelle linéaire, la traîne serait invisible. Touchez un filament.',
      stats: [
        { label: 'Espèces', value: String(COUNT) },
        { label: 'Moitié du corpus', value: `${HALF_RANK} espèces` },
        { label: 'Une seule fois', value: String(SINGLETONS) },
        { label: 'Deux fois ou moins', value: String(SPECIES.filter(s => s.count <= 2).length) },
      ],
      accent: PALETTE.gold,
    };
  }

  private speciesReadout(index: number): Readout {
    const species = SPECIES[index];
    const share = (species.count / atlas.meta.total) * 100;
    const peak = species.hourly.indexOf(Math.max(...species.hourly));

    return {
      eyebrow: `${guildLabel(species.guild)} · rang ${index + 1} sur ${COUNT}`,
      title: species.name,
      body:
        `${share < 0.1 ? 'Moins de 0,1' : share.toFixed(1).replace('.', ',')} % de l’enregistrement. ` +
        `Avec tout ce qui la précède : ${(CUMULATIVE[index] * 100).toFixed(1).replace('.', ',')} %.`,
      stats: [
        { label: 'Détections', value: String(species.count) },
        { label: 'Heure de pointe', value: formatHour(peak) },
        { label: 'Nocturnité', value: `${Math.round(species.nocturnality * 100)} %` },
        { label: 'Stations', value: `${species.stations.length} / ${atlas.meta.stationCount}` },
      ],
      spark: normalisedHourly(species.hourly),
      accent: guildCss(species.guild),
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
    uTravel: { value: 0 },
    uSpread: { value: 1.35 },
    uSelected: { value: -1 },
    uSelectStrength: { value: 0 },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uMist: { value: color(PALETTE.mist) },
    ...touch,
  };
}

// ------------------------------------------------------------------ shaders --

/**
 * Ranks fade in as the camera reaches them and never quite vanish behind it, so
 * the colonnade always has a head and a horizon.
 */
const DISTANCE = /* glsl */ `
uniform float uTravel;
uniform float uSpread;
uniform float uReveal;

float rankPresence(float rank){
  float ahead = rank - uTravel;
  // Behind the camera: gone quickly. Ahead: held for a long way down the tail.
  float back = smoothstep(-14.0, -3.0, ahead);
  float front = 1.0 - smoothstep(40.0 * uSpread, 78.0 * uSpread, ahead);
  float reveal = clamp(uReveal * 2.0 - rank / ${COUNT.toFixed(1)}, 0.0, 1.0);
  return back * front * reveal;
}
`;

const SELECTION = /* glsl */ `
uniform float uSelected;
uniform float uSelectStrength;

float isSelected(float rank){
  return uSelected < -0.5 ? 0.0 : step(abs(uSelected - rank), 0.5);
}
`;

const FILAMENT_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uGuildColors[6];
uniform vec3 uBone;
attribute float aGuild;
attribute float aRank;
attribute float aAlong;
attribute float aShare;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

${DISTANCE}
${SELECTION}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  // The head of the ranking burns steadily; the tail flickers, which is what a
  // single detection deserves.
  float rare = 1.0 - aShare;
  float flicker = 0.72 + 0.28 * sin(uTime * (0.7 + rare * 2.2) + aRank * 1.7 + aAlong * 3.0);

  float selected = isSelected(aRank);
  vSelected = selected * uSelectStrength;

  pos.x += sin(uTime * 0.5 + aRank * 0.9 + aAlong * 2.4) * 0.06 * (0.4 + rare);
  pos += touchDisplace(pos, 4.5, 0.7);
  float ripple = rippleField(pos, 8.0, 2.6, 1.6);
  pos.y += ripple * 0.5;

  float presence = rankPresence(aRank);

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = mix(guild, mix(guild, uBone, 0.5) * 1.7, vSelected);
  vColor *= 0.75 + aShare * 0.9;
  vColor += vec3(0.3, 0.21, 0.09) * ripple;

  float dim = mix(1.0, 0.28, uSelectStrength * (1.0 - selected));
  // Bright at the foot, thinning upward: the filament reads as something
  // standing rather than as a stack of beads.
  float taper = mix(1.0, 0.35, aAlong);
  vAlpha = presence * dim * taper * flicker * (0.5 + aShare * 0.5);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.30 + aShare * 0.42 + vSelected * 0.3, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FILAMENT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.6, d);
  float halo = exp(-d * 2.7) * 0.55;
  float ring = (1.0 - smoothstep(0.03, 0.09, abs(d - 0.8))) * vSelected;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.8 + vec3(ring) * 0.2, a);
}
`;

const RAMP_VERTEX = /* glsl */ `
attribute float aRank;
attribute float aValue;
varying float vValue;
varying float vPresence;

${DISTANCE}

void main(){
  vValue = aValue;
  vPresence = rankPresence(aRank);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RAMP_FRAGMENT = /* glsl */ `
uniform vec3 uGold;
uniform vec3 uBone;
varying float vValue;
varying float vPresence;

void main(){
  // Hottest where the curve is steepest — over the first handful of species.
  vec3 tint = mix(uGold * 1.4, mix(uGold, uBone, 0.4), vValue);
  float a = vPresence * mix(0.75, 0.35, vValue);
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

const RULE_VERTEX = /* glsl */ `
attribute float aRank;
attribute float aWeight;
varying float vWeight;
varying float vPresence;

${DISTANCE}

void main(){
  vWeight = aWeight;
  vPresence = rankPresence(aRank);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RULE_FRAGMENT = /* glsl */ `
uniform vec3 uMist;
uniform vec3 uGold;
varying float vWeight;
varying float vPresence;

void main(){
  vec3 tint = mix(uMist, uGold, smoothstep(0.5, 1.0, vWeight));
  float a = vWeight * 0.4 * vPresence;
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;
