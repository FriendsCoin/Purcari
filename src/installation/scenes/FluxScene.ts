import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MathUtils,
  Mesh,
  Points,
  ShaderMaterial,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, SPRITE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildIndex, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatDay, maxDaily, points } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Scene-unit width of the whole 17-day span. */
const SPAN = 34;
const MAX_HEIGHT = 11;
const BASELINE = -6;

/** Subdivisions between adjacent days along the ribbon. */
const RIBBON_STEPS = 16;

/** Seconds of real time per day of the record. */
const SECONDS_PER_DAY = 1.35;
const RESUME_DELAY = 4.5;

/**
 * Chapter IV — Flux.
 *
 * The survey ran for seventeen days, from 31 July to 16 August 2025, and the
 * daily counts fall away across it: 347 detections on 4 August, one on the last
 * three days. That decline is the listening effort winding down, not the birds
 * leaving, and the chapter is framed as the shape of the recording itself — a
 * river of light running left to right and thinning out.
 */
export class FluxScene extends ChapterBase {
  readonly id = 'flux' as const;
  readonly look = { exposure: 0.98, bloom: 0.58, grain: 0.024, aberration: 1.0, vignette: 1.12, trail: 0.7 };

  private readonly ribbon: Mesh;
  private readonly embers: Points;
  private readonly uniforms: ReturnType<typeof createUniforms>;

  /** Continuous playhead across the record, 0..dayCount. */
  private day = 0;
  private scrubHold = 0;
  /** True while a tap is holding the playhead on one day. */
  private pinned = false;
  private cachedReadout: Readout;
  private readoutDay = -1;

  constructor() {
    super(42);

    this.restSpherical.set(46, Math.PI / 2, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.ribbon = this.buildRibbon();
    this.embers = this.buildEmbers();
    this.scene.add(this.ribbon, this.embers);

    this.cachedReadout = { eyebrow: '', title: '' };
  }

  // ------------------------------------------------------------------ build --

  /**
   * A strip whose upper edge follows the daily counts through a Catmull-Rom
   * spline. Interpolating rather than stepping matters: seventeen hard columns
   * would read as a bar chart, and the point here is the shape of the decline.
   */
  private buildRibbon(): Mesh {
    const dayCount = atlas.days.length;
    const columns = (dayCount - 1) * RIBBON_STEPS + 1;
    const position = new Float32Array(columns * 2 * 3);
    const uv = new Float32Array(columns * 2 * 2);
    const height = new Float32Array(columns * 2);
    const nightShare = new Float32Array(columns * 2);
    const index: number[] = [];

    const counts = atlas.days.map(d => d.count / maxDaily);
    const nights = atlas.days.map(d => (d.count > 0 ? d.night / d.count : 0));

    for (let c = 0; c < columns; c += 1) {
      const t = c / (columns - 1);
      const dayPosition = t * (dayCount - 1);
      const h = catmullRom(counts, dayPosition);
      const night = catmullRom(nights, dayPosition);
      const x = (t - 0.5) * SPAN;

      for (let edge = 0; edge < 2; edge += 1) {
        const v = c * 2 + edge;
        position[v * 3] = x;
        position[v * 3 + 1] = BASELINE + (edge === 1 ? h * MAX_HEIGHT : 0);
        position[v * 3 + 2] = 0;
        uv[v * 2] = t;
        uv[v * 2 + 1] = edge;
        height[v] = h;
        nightShare[v] = night;
      }

      if (c < columns - 1) {
        // Wound counter-clockwise as seen from +Z, where the camera sits.
        const a = c * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setAttribute('aHeight', new BufferAttribute(height, 1));
    geometry.setAttribute('aNight', new BufferAttribute(nightShare, 1));
    geometry.setIndex(index);

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: RIBBON_VERTEX,
        fragmentShader: RIBBON_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // The camera sways either side of the strip, and the vertex shader pushes
        // the crest in z, so both faces have to draw.
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    return mesh;
  }

  /** One ember per detection, stacked into the day it belongs to. */
  private buildEmbers(): Points {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const day = new Float32Array(count);
    const guild = new Float32Array(count);
    const seed = new Float32Array(count);
    const weight = new Float32Array(count);

    const stack = new Uint16Array(atlas.days.length);
    for (let i = 0; i < count; i += 1) {
      const d = points.day[i];
      const rank = stack[d];
      stack[d] += 1;

      const t = d / Math.max(1, atlas.days.length - 1);
      const jitter = (hash(i * 4.19) - 0.5) * (SPAN / atlas.days.length) * 1.15;

      position[i * 3] = (t - 0.5) * SPAN + jitter;
      position[i * 3 + 1] = BASELINE + (rank / maxDaily) * MAX_HEIGHT;
      position[i * 3 + 2] = (hash(i * 9.71) - 0.5) * 2.6;

      day[i] = d;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      seed[i] = hash(i * 2.37);
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.2, 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aDay', new BufferAttribute(day, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: EMBER_VERTEX,
        fragmentShader: EMBER_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    return cloud;
  }

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.day = 0;
    this.scrubHold = 0;
    this.pinned = false;
    this.readoutDay = -1;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.85, ctx.delta);

    const lastDay = atlas.days.length - 1;

    // Tapping the river stops it on that day, which is the only way to read a
    // day that lasts a second and a half. Tapping the held day lets it run.
    for (const tap of ctx.pointer.consumeTaps()) {
      const target = clamp((tap.world.x / SPAN + 0.5) * lastDay, 0, lastDay);
      const sameDay = this.pinned && Math.abs(target - this.day) < 0.75;
      this.pinned = !sameDay;
      if (this.pinned) {
        this.day = target;
        this.scrubHold = 0;
      }
    }

    const drag = ctx.pointer.dragWithInertia;
    if (Math.abs(drag.x) > 1e-5) {
      this.day = clamp(this.day + drag.x * atlas.days.length * 0.6, 0, lastDay);
      this.scrubHold = RESUME_DELAY;
      this.pinned = false;
    } else if (this.pinned) {
      // Held by a tap: the record waits.
    } else if (this.scrubHold > 0) {
      this.scrubHold -= ctx.delta;
    } else {
      this.day += ctx.delta / SECONDS_PER_DAY;
      // Hold on the last day for a beat, then run the record again.
      if (this.day > lastDay + 2.5) this.day = 0;
    }

    this.uniforms.uDay.value = Math.min(this.day, lastDay);
    this.uniforms.uScrub.value = damp(
      this.uniforms.uScrub.value,
      this.scrubHold > 0 || this.pinned ? 1 : 0,
      3,
      ctx.delta
    );

    this.frameCamera(ctx);
    this.refreshReadout();
  }

  private frameCamera(ctx: FrameContext): void {
    const halfV = MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * ctx.aspect);
    // Framed on the width of the record; on a portrait panel that means backing
    // off far enough that the whole seventeen days still fit.
    const distance = (SPAN * 0.62) / Math.tan(halfH) + 4;

    this.spherical.radius = damp(this.spherical.radius, distance, 2.0, ctx.delta);
    this.spherical.theta = damp(
      this.spherical.theta,
      Math.sin(ctx.time * 0.19) * 0.05 + ctx.pointer.centroid.x * 0.07,
      1.5,
      ctx.delta
    );
    this.spherical.phi = damp(
      this.spherical.phi,
      Math.PI / 2 - (Math.cos(ctx.time * 0.15) * 0.025 + ctx.pointer.centroid.y * 0.05),
      1.5,
      ctx.delta
    );

    this.camera.position.setFromSpherical(this.spherical);
    this.camera.lookAt(0, BASELINE + MAX_HEIGHT * 0.28, 0);
  }

  private refreshReadout(): void {
    const index = clamp(Math.round(this.day), 0, atlas.days.length - 1);
    const key = index + (this.pinned ? atlas.days.length : 0);
    if (key === this.readoutDay) return;
    this.readoutDay = key;

    const day = atlas.days[index];
    const share = ((day.count / maxDaily) * 100).toFixed(0);

    this.cachedReadout = {
      eyebrow: this.pinned ? 'Chapitre IV · Jour maintenu' : 'Chapitre IV · Flux',
      title: formatDay(day.date),
      body:
        index === 0
          ? 'Première nuit d’enregistrement, commencée en soirée.'
          : day.count < 10
            ? 'Fin de la campagne : les enregistreurs s’arrêtent un à un.'
            : `${day.species} espèces distinctes ce jour-là.`,
      stats: [
        { label: 'Détections', value: String(day.count) },
        { label: 'Espèces', value: String(day.species) },
        { label: 'Du maximum', value: `${share} %` },
        { label: 'La nuit', value: String(day.night) },
      ],
      spark: atlas.days.map(d => d.count / maxDaily),
      accent: PALETTE.ember,
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
    uDay: { value: 0 },
    uScrub: { value: 0 },
    uDayCount: { value: atlas.days.length },
    uSpan: { value: SPAN },
    uBaseline: { value: BASELINE },
    uHeight: { value: MAX_HEIGHT },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uEmber: { value: color(PALETTE.ember) },
    uDusk: { value: color(PALETTE.dusk) },
    uWine: { value: color(PALETTE.wine) },
    ...touch,
  };
}

/** Centripetal-ish Catmull-Rom through a series, clamped at both ends. */
function catmullRom(values: number[], position: number): number {
  const i = Math.floor(position);
  const t = position - i;
  const at = (n: number) => values[clamp(n, 0, values.length - 1)];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function hash(n: number): number {
  const s = Math.sin(n * 91.7) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const PLAYHEAD = /* glsl */ `
uniform float uDay;
uniform float uDayCount;
uniform float uSpan;

/** Signed distance from the playhead, in days. Negative = already passed. */
float daysFromPlayhead(float day){
  return day - uDay;
}

/** Position along the ribbon, 0..1, expressed as a day index. */
float dayAt(float t){
  return t * (uDayCount - 1.0);
}
`;

const RIBBON_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uBaseline;
attribute float aHeight;
attribute float aNight;
varying vec2 vUv;
varying float vHeight;
varying float vNight;
varying float vPlayhead;

${SIMPLEX3}
${EASING}
${PLAYHEAD}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;
  vPlayhead = daysFromPlayhead(dayAt(uv.x));

  // The crest ripples; the baseline stays put, so the strip reads as a surface.
  float wave = snoise(vec3(uv.x * 6.0, uTime * 0.35, 0.0)) * 0.35 * uv.y;
  pos.y += wave;
  pos.z += snoise(vec3(uv.x * 4.0, uTime * 0.22, 3.1)) * 0.7 * uv.y;

  pos += touchDisplace(pos, 5.0, 1.2);
  float ripple = rippleField(pos, 9.0, 2.6, 1.6);
  pos.y += ripple * 1.2 * uv.y;

  // Draws on left to right as the chapter opens.
  float draw = easeOutQuart(clamp(uReveal * 1.8 - uv.x * 0.8, 0.0, 1.0));
  pos.y = mix(uBaseline, pos.y, draw);

  vUv = uv;
  vHeight = aHeight;
  vNight = aNight;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const RIBBON_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uScrub;
uniform vec3 uGold;
uniform vec3 uEmber;
uniform vec3 uDusk;
varying vec2 vUv;
varying float vHeight;
varying float vNight;
varying float vPlayhead;

${SIMPLEX3}

void main(){
  // Bright crest, dark body: the strip is lit from its own upper edge.
  float crest = pow(vUv.y, 2.4);
  float body = (1.0 - vUv.y) * 0.22;

  // Flow, sampled against the direction of travel so it reads as current.
  float flow = snoise(vec3(vUv.x * 9.0 - uTime * 0.32, vUv.y * 3.0, uTime * 0.1)) * 0.5 + 0.5;

  // Caustics: two counter-running bands that pinch into bright filaments where
  // they cross, the way light does on the surface of moving water.
  float c1 = snoise(vec3(vUv.x * 22.0 - uTime * 0.7, vUv.y * 5.0, 0.0));
  float c2 = snoise(vec3(vUv.x * 17.0 + uTime * 0.5, vUv.y * 4.0, 9.3));
  float caustic = pow(max(1.0 - abs(c1 - c2), 0.0), 7.0) * 0.5;

  vec3 tint = mix(uGold, uEmber, vUv.x * 0.7);
  tint = mix(tint, uDusk * 1.5, vNight * 0.75);

  // A bright band sits under the playhead and fades behind it.
  float head = exp(-vPlayhead * vPlayhead * 3.0);
  float passed = smoothstep(0.4, -0.6, vPlayhead);

  float intensity = (crest * (0.60 + flow * 0.55 + caustic) + body) * (0.5 + passed * 0.5);
  intensity += head * crest * 0.7;
  intensity *= 0.55 + vHeight * 0.9;
  intensity *= uReveal * (1.0 + uScrub * 0.35);

  gl_FragColor = vec4(tint * intensity * 0.9, intensity * 0.9);
}
`;

const EMBER_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uBaseline;
uniform vec3 uGuildColors[6];
attribute float aDay;
attribute float aGuild;
attribute float aSeed;
attribute float aWeight;
varying vec3 vColor;
varying float vAlpha;

${SIMPLEX3}
${HASH}
${EASING}
${PLAYHEAD}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;
  float fromHead = daysFromPlayhead(aDay);

  // Embers lift and drift once the playhead has gone past them, so the record
  // leaves a rising trail behind the head rather than a static histogram.
  float passed = smoothstep(0.6, -0.4, fromHead);
  float age = max(-fromHead, 0.0);
  float lift = passed * (0.5 + aSeed * 2.2) * min(age, 3.0);

  pos.y += lift;
  pos.x += sin(uTime * 0.5 + aSeed * 20.0) * lift * 0.16;
  pos.z += cos(uTime * 0.41 + aSeed * 14.0) * lift * 0.2;
  pos += vec3(snoise(vec3(pos.xy * 0.16, uTime * 0.14))) * (0.2 + lift * 0.14);

  pos += touchDisplace(pos, 5.5, 2.0);
  float ripple = rippleField(pos, 9.0, 2.6, 1.7);
  pos.y += ripple * 1.6;

  float reveal = easeOutQuart(clamp(uReveal * 1.9 - (position.x / uSpan + 0.5) * 0.85, 0.0, 1.0));
  pos.y = mix(uBaseline, pos.y, reveal);

  // At the head they burn gold; further back they cool to their guild colour and
  // dim as they climb out of frame.
  float head = exp(-fromHead * fromHead * 2.2);
  vec3 guild = uGuildColors[int(aGuild)];
  vColor = mix(guild * 0.85, mix(guild, vec3(1.0, 0.82, 0.5), 0.55) * 1.5, head);
  vColor += vec3(0.4, 0.28, 0.12) * ripple + vec3(0.3) * touchGlow(pos, 5.5);

  float faded = 1.0 - smoothstep(1.4, 3.0, age);
  vAlpha = (0.16 + head * 0.55) * (0.35 + aWeight * 0.65) * reveal * mix(0.35, 1.0, faded);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.075 + aWeight * 0.13 + head * 0.14 + ripple * 0.25, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const EMBER_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
${SPRITE}

void main(){
  float a = spriteAlpha(gl_PointCoord, 0.82) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.45, a);
}
`;
