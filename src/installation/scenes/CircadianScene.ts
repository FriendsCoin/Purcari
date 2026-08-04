import {
  BufferAttribute,
  BufferGeometry,
  MathUtils,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, SPRITE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildIndex, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, maxHourly, peakHour, points, speciesAtHour } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

const R_INNER = 4.6;
const R_SPAN = 9.0;
const R_OUTER = R_INNER + R_SPAN;

/** Seconds of real time per hour of the dial — a full day sweeps in ~40 s. */
const SECONDS_PER_HOUR = 1.7;

/** After scrubbing, the dial waits this long before resuming its own sweep. */
const RESUME_DELAY = 4.5;

/**
 * Chapter II — Circadien.
 *
 * Every detection placed on a 24-hour dial by the minute it was recorded, its
 * distance from the centre given by its rank within that hour. The result is a
 * sunburst whose spikes are literally the hourly histogram — and the tallest of
 * them, by a wide margin, is the dawn chorus between 04:00 and 07:00.
 *
 * A hand sweeps the dial on its own; dragging left or right scrubs it by hand.
 */
export class CircadianScene extends ChapterBase {
  readonly id = 'circadian' as const;
  readonly look = { exposure: 0.98, bloom: 0.62, grain: 0.022, aberration: 0.85, vignette: 1.15 };

  private readonly detections: Points;
  private readonly dial: Mesh;
  private readonly uniforms: ReturnType<typeof createUniforms>;

  /** Continuous position of the hand, 0..24. */
  private hour = 4.5;
  private scrubHold = 0;
  /** True while a tap is holding the hand on one hour. */
  private pinned = false;
  /** 0 on entering, 1 once the opening move has landed. */
  private flight = 0;
  private cachedReadout: Readout;
  private readoutHour = -1;

  constructor() {
    super(40);

    this.restSpherical.set(46, Math.PI / 2, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.hour, this.touch);

    this.detections = this.buildDetections();
    this.dial = this.buildDial();
    this.scene.add(this.dial, this.detections);

    this.cachedReadout = { eyebrow: '', title: '' };
  }

  /**
   * Angle comes from the exact minute, radius from the detection's rank inside
   * its hour. Ranking is what turns a ring of dots into a readable histogram.
   */
  private buildDetections(): Points {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const hour = new Float32Array(count);
    const guild = new Float32Array(count);
    const seed = new Float32Array(count);
    const weight = new Float32Array(count);

    const rank = new Uint16Array(24);
    // Ranking runs in atlas order, which is sorted by abundance, so the abundant
    // species land near the centre of each spike and the rarities tip the ends.
    for (let i = 0; i < count; i += 1) {
      const minute = points.minute[i];
      const h = Math.floor(minute / 60);
      const r = rank[h];
      rank[h] += 1;

      const angle = hourToAngle(minute / 60);
      // Jitter widens each spike into a fan instead of a needle.
      const jitter = (hash(i * 7.13) - 0.5) * 0.055;
      const radius = R_INNER + (r / maxHourly) * R_SPAN;

      position[i * 3] = Math.cos(angle + jitter) * radius;
      position[i * 3 + 1] = Math.sin(angle + jitter) * radius;
      position[i * 3 + 2] = (hash(i * 3.77) - 0.5) * 0.9;

      hour[i] = h;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      seed[i] = hash(i * 1.61);
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.22, 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aHour', new BufferAttribute(hour, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DETECTION_VERTEX,
        fragmentShader: DETECTION_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    return cloud;
  }

  /** One quad; every mark on the dial is drawn procedurally in the fragment shader. */
  private buildDial(): Mesh {
    const dial = new Mesh(
      new PlaneGeometry(R_OUTER * 2.6, R_OUTER * 2.6, 1, 1),
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DIAL_VERTEX,
        fragmentShader: DIAL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    dial.position.z = -1.2;
    dial.frustumCulled = false;
    return dial;
  }

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.hour = peakHour - 1.5;
    this.scrubHold = 0;
    this.pinned = false;
    this.readoutHour = -1;
    this.flight = 0;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 1.0, ctx.delta);

    // Pointing at a spike is the obvious thing to do in front of a dial, so it
    // does the obvious thing: the hand goes to that hour and stays there until
    // it is released. The middle of the dial is the release — it is the one
    // place on screen that carries no hour and no detections.
    for (const tap of ctx.pointer.consumeTaps()) {
      const radius = Math.hypot(tap.world.x, tap.world.y);
      if (radius < R_INNER * 0.8) {
        this.pinned = false;
      } else {
        this.hour = angleToHour(Math.atan2(tap.world.y, tap.world.x));
        this.scrubHold = 0;
        this.pinned = true;
      }
    }

    // Horizontal drag scrubs the hand; a full screen width is a bit over a day.
    const drag = ctx.pointer.dragWithInertia;
    if (Math.abs(drag.x) > 1e-5) {
      this.hour += drag.x * 14;
      this.scrubHold = RESUME_DELAY;
      this.pinned = false;
    } else if (this.pinned) {
      // Held by a tap: neither the sweep nor the resume timer runs.
    } else if (this.scrubHold > 0) {
      this.scrubHold -= ctx.delta;
    } else {
      this.hour += ctx.delta / SECONDS_PER_HOUR;
    }
    this.hour = ((this.hour % 24) + 24) % 24;

    this.uniforms.uHour.value = this.hour;
    this.uniforms.uScrub.value = damp(
      this.uniforms.uScrub.value,
      this.scrubHold > 0 || this.pinned ? 1 : 0,
      3,
      ctx.delta
    );

    this.flight = Math.min(1, this.flight + ctx.delta / 4.2);
    this.frameCamera(ctx);
    this.refreshReadout();
  }

  /**
   * Fixed front-on framing that fits the dial to the short edge of the panel,
   * with a slow sway so the composition never sits perfectly still.
   */
  private frameCamera(ctx: FrameContext): void {
    const halfV = MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * ctx.aspect);
    const framed = (R_OUTER * 1.22) / Math.tan(Math.min(halfV, halfH));

    // Opening move: the dial comes up out of a steep, distant three-quarter view
    // and rolls flat to the panel, so the chapter arrives as a camera move
    // rather than as a cut to a diagram.
    const landed = 1 - Math.pow(1 - this.flight, 3);
    const distance = framed * (1 + (1 - landed) * 0.85);

    const sway = Math.sin(ctx.time * 0.21) * 0.035 + ctx.pointer.centroid.x * 0.06 + (1 - landed) * 0.5;
    const tilt =
      Math.cos(ctx.time * 0.17) * 0.03 + ctx.pointer.centroid.y * 0.05 + (1 - landed) * 0.55;

    this.spherical.radius = damp(this.spherical.radius, distance, 2.2, ctx.delta);
    this.spherical.theta = damp(this.spherical.theta, sway, 1.6, ctx.delta);
    this.spherical.phi = damp(this.spherical.phi, Math.PI / 2 - tilt, 1.6, ctx.delta);

    this.camera.position.setFromSpherical(this.spherical);
    this.camera.lookAt(0, 0, 0);
  }

  private refreshReadout(): void {
    const current = Math.floor(this.hour) % 24;
    // Pinning is part of the key: holding an hour is what earns the longer list,
    // and the readout has to change the moment the hand is held or released.
    const key = current + (this.pinned ? 24 : 0);
    if (key === this.readoutHour) return;
    this.readoutHour = key;

    const count = atlas.hourly[current];
    // A held hour is being studied rather than watched, so it names more of what
    // was singing in it.
    const top = speciesAtHour(current, this.pinned ? 6 : 3);
    const isNight = current >= 21 || current < 5;
    const share = ((count / atlas.meta.total) * 100).toFixed(1);

    this.cachedReadout = {
      eyebrow: this.pinned ? 'Chapitre II · Heure maintenue' : 'Chapitre II · Cycle circadien',
      title: formatHour(current),
      body:
        top.length > 0
          ? `${isNight ? 'Nuit' : 'Jour'} · ${top.map(s => s.name).join(' · ')}`
          : `${isNight ? 'Nuit' : 'Jour'} · aucune détection à cette heure`,
      stats: [
        { label: 'Détections', value: String(count) },
        { label: 'Part du total', value: `${share} %` },
        { label: 'Pic du chœur', value: formatHour(peakHour) },
      ],
      spark: atlas.hourly.map(v => v / maxHourly),
      accent: isNight ? PALETTE.dusk : PALETTE.gold,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

function createUniforms(hour: number, touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uHour: { value: hour },
    uScrub: { value: 0 },
    uInner: { value: R_INNER },
    uSpan: { value: R_SPAN },
    uOuter: { value: R_OUTER },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uDusk: { value: color(PALETTE.dusk) },
    ...touch,
  };
}

/** Midnight at the top, hours running clockwise — the way a visitor reads a clock. */
/** Inverse of hourToAngle: where on the clock a finger landed, in hours. */
function angleToHour(angle: number): number {
  return ((((Math.PI / 2 - angle) / (Math.PI * 2)) * 24) % 24 + 24) % 24;
}

function hourToAngle(hour: number): number {
  return Math.PI / 2 - (hour / 24) * Math.PI * 2;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const DIAL_ANGLE = /* glsl */ `
#define TAU 6.28318530718
float angleToHour(vec2 p){
  return mod((1.5707963 - atan(p.y, p.x)) / TAU * 24.0, 24.0);
}
/** Shortest distance between two hours on a 24-hour wrap. */
float hourDelta(float a, float b){
  float d = abs(mod(a - b + 36.0, 24.0) - 12.0);
  return 12.0 - d;
}
`;

const DETECTION_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uHour;
uniform float uInner;
uniform vec3 uGuildColors[6];
attribute float aHour;
attribute float aGuild;
attribute float aSeed;
attribute float aWeight;
varying vec3 vColor;
varying float vAlpha;

${SIMPLEX3}
${HASH}
${EASING}
${DIAL_ANGLE}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;
  float radius = length(pos.xy);
  vec2 dir = radius > 0.0001 ? pos.xy / radius : vec2(0.0, 1.0);

  // Proximity of the sweeping hand, on the 24-hour wrap. Named heat rather than
  // the obvious "active", which is a reserved word in GLSL ES.
  float delta = hourDelta(uHour, aHour + 0.5);
  float heat = exp(-delta * delta * 0.9);

  // The hours under the hand lift off the dial and lean toward the viewer.
  pos.xy += dir * heat * 1.5;
  pos.z += heat * 2.6;

  // Constant slow breathing, so the inactive hours are never fully dead.
  float breath = snoise(vec3(pos.xy * 0.12, uTime * 0.16));
  pos.xy += dir * breath * 0.22;
  pos.z += breath * 0.35;

  pos += touchDisplace(pos, 5.0, 1.9);
  float ripple = rippleField(pos, 8.0, 2.6, 1.5);
  pos.xy += dir * ripple * 1.2;

  // Reveal: the sunburst grows outward from the hub.
  float grow = easeOutQuart(clamp(uReveal * 1.4 - (radius - uInner) / 14.0, 0.0, 1.0));
  pos.xy = mix(dir * uInner * 0.35, pos.xy, grow);

  vec3 guild = uGuildColors[int(aGuild)];
  // Held down deliberately: the dawn hours stack ~240 sprites into one spike, and
  // additive blending turns anything brighter into a solid white blob.
  vColor = mix(guild * 0.7, guild * 1.1 + vec3(0.22, 0.15, 0.05), heat);
  vColor += vec3(0.4, 0.3, 0.15) * ripple + vec3(0.35) * touchGlow(pos, 5.0);
  vAlpha = (0.30 + heat * 0.5) * (0.4 + aWeight * 0.6) * uReveal;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.075 + aWeight * 0.11 + heat * 0.16 + ripple * 0.25, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const DETECTION_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
${SPRITE}

void main(){
  float a = spriteAlpha(gl_PointCoord, 0.8) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.45, a);
}
`;

const DIAL_VERTEX = /* glsl */ `
varying vec2 vLocal;
void main(){
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DIAL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uHour;
uniform float uScrub;
uniform float uInner;
uniform float uSpan;
uniform float uOuter;
uniform vec3 uGold;
uniform vec3 uBone;
uniform vec3 uDusk;
varying vec2 vLocal;

${HASH}
${DIAL_ANGLE}

/**
 * Soft line at a given value. The falloff width is passed in rather than derived
 * from fwidth() so the shader compiles the same on every GLSL version the kiosk
 * might end up running.
 */
float line(float value, float target, float width, float softness){
  return 1.0 - smoothstep(width, width + softness, abs(value - target));
}

void main(){
  float radius = length(vLocal);
  float hour = angleToHour(vLocal);

  vec3 accumulated = vec3(0.0);
  float alpha = 0.0;

  // --- night band, just outside the sunburst -------------------------------
  float night = smoothstep(20.4, 21.0, hour) + (1.0 - smoothstep(4.6, 5.2, hour));
  night = clamp(night, 0.0, 1.0);
  float bandMask = smoothstep(uOuter + 0.15, uOuter + 0.5, radius) *
                   (1.0 - smoothstep(uOuter + 1.1, uOuter + 1.5, radius));
  vec3 bandColor = mix(uGold * 0.5, uDusk * 1.4, night);
  accumulated += bandColor * bandMask * 0.5;
  alpha += bandMask * 0.28;

  // --- hour ticks ----------------------------------------------------------
  float tickPhase = fract(hour);
  float tickWidth = 0.35 / max(radius, 1.0);
  float tickSoft = tickWidth * 1.6;
  float tick = line(tickPhase, 0.0, tickWidth, tickSoft) + line(tickPhase, 1.0, tickWidth, tickSoft);
  bool major = mod(floor(hour + 0.5), 6.0) < 0.5;
  float tickLength = major ? 1.5 : 0.7;
  float tickMask = smoothstep(uOuter + 0.55, uOuter + 0.75, radius) *
                   (1.0 - smoothstep(uOuter + 0.7 + tickLength, uOuter + 0.95 + tickLength, radius));
  accumulated += uBone * tick * tickMask * (major ? 0.8 : 0.32);
  alpha += tick * tickMask * (major ? 0.5 : 0.2);

  // --- concentric guides ---------------------------------------------------
  float rings = 0.0;
  for (int i = 1; i < 4; i++){
    float target = uInner + uSpan * float(i) / 4.0;
    rings += line(radius, target, 0.010, 0.030);
  }
  float ringMask = smoothstep(uInner - 0.4, uInner + 0.2, radius) * (1.0 - smoothstep(uOuter - 0.5, uOuter, radius));
  accumulated += uBone * rings * ringMask * 0.085;
  alpha += rings * ringMask * 0.09;

  // --- the sweeping hand ---------------------------------------------------
  float delta = hourDelta(uHour, hour);
  float hand = exp(-delta * delta * 26.0);
  float handMask = smoothstep(uInner * 0.35, uInner * 0.7, radius) *
                   (1.0 - smoothstep(uOuter + 0.6, uOuter + 2.2, radius));
  // Trailing wake behind the hand, in the direction it travels.
  float behind = clamp(mod(hour - uHour + 24.0, 24.0), 0.0, 24.0);
  float wake = exp(-behind * 1.5) * 0.26;
  accumulated += mix(uGold, uBone, 0.35) * (hand * 1.15 + wake) * handMask;
  alpha += (hand + wake * 0.6) * handMask * 0.7;

  // --- hub -----------------------------------------------------------------
  float hub = 1.0 - smoothstep(0.0, uInner * 0.92, radius);
  float hubRing = line(radius, uInner * 0.92, 0.018, 0.035);
  float pulse = 0.86 + 0.14 * sin(uTime * 1.1);
  accumulated += mix(uDusk, uGold, 0.5) * pow(hub, 3.0) * 0.5 * pulse;
  accumulated += uGold * hubRing * 0.7;
  alpha += pow(hub, 3.0) * 0.34 + hubRing * 0.5;

  // Scrubbing brightens the whole dial: feedback that the drag registered.
  float boost = 1.0 + uScrub * 0.5;
  float fade = 1.0 - smoothstep(uOuter + 2.0, uOuter + 5.5, radius);

  gl_FragColor = vec4(accumulated * boost * 0.45, clamp(alpha, 0.0, 1.0)) * uReveal * fade;
}
`;
