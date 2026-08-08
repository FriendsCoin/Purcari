import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';
import { ADDITIVE } from '../engine/blending';
import {
  CURL,
  EASING,
  HASH,
  POINT_SIZE,
  RIPPLE_UNIFORMS,
  SIMPLEX3,
  SPRITE,
  TOUCH_UNIFORMS,
} from '../engine/glsl';
import { color, guildColorArray, guildIndex, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, maxHourly, peakHour, points } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Seconds for the chorus wave to travel one full day. */
const CYCLE_SECONDS = 34;

/** Seconds for the flock to fly its whole circuit. */
const PATH_SECONDS = 96;

/** How far the circuit roams, in scene units. */
const ROAM = 13;

/**
 * Prologue — Le chœur.
 *
 * The attract state, and the first thing anyone sees: all 2,665 detections as a
 * single murmuration. The flock flies one closed circuit through the dark —
 * stretching along its own direction of travel the way starlings do, flattening,
 * now and then tearing into two lobes and healing again — and the dawn-chorus
 * wave runs through it as a surge of light in time-of-day order. Because the
 * chorus is nearly a third of the record, the surge arrives as a visible pulse
 * every half minute, thins through the afternoon, and goes quiet overnight.
 *
 * It carries no controls. Any touch parts the flock the way a falcon does, and
 * wakes the interface.
 */
export class ChorusScene extends ChapterBase {
  readonly id = 'chorus' as const;
  readonly look = { exposure: 1.0, bloom: 0.66, grain: 0.02, aberration: 1.15, vignette: 1.2, trail: 0.88 };

  private readonly cloud: Points;
  private readonly uniforms: ReturnType<typeof createUniforms>;
  private cachedReadout: Readout;
  private readoutHour = -1;

  /** Scratch for the path derivative; the flock's frame is built from it. */
  private readonly centre = new Vector3();
  private readonly ahead = new Vector3();
  private readonly heading = new Vector3(1, 0, 0);
  private readonly side = new Vector3(0, 0, 1);
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    super(46);

    this.restSpherical.set(35, Math.PI * 0.4, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    // The flock is the motion; the camera only breathes.
    this.idleSpin = 0.02;
    this.minPolar = Math.PI * 0.18;
    this.maxPolar = Math.PI * 0.62;
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.cloud = this.buildFlock();
    this.scene.add(this.cloud);

    this.cachedReadout = { eyebrow: '', title: '' };
  }

  /**
   * Each detection is a bird with a fixed place in the flock's own body: a point
   * in a unit ball, scaled per-frame along the flock's heading, side and up.
   *
   * The place is not random. Its angle around the body's long axis is the
   * detection's time of day, so the dawn records fly together — and when the
   * wave passes through the body in clock order it travels *along* the flock as
   * a front, the way a turn propagates through real starlings.
   */
  private buildFlock(): Points {
    const count = points.count;
    const offset = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const guild = new Float32Array(count);
    const seed = new Float32Array(count);
    const weight = new Float32Array(count);
    const lobe = new Float32Array(count);

    // Station along the body by *rank* in the day, not by raw hour. A third of
    // the record is the dawn chorus; on the raw clock those birds pack into one
    // slab of the body and the wave detonates it as a single overexposed ball.
    // Ranked, the body has the same density everywhere, and the dawn third is a
    // third of the body's length that lights up as the front runs it.
    const rank = new Float32Array(count);
    Array.from({ length: count }, (_, i) => i)
      .sort((a, b) => points.minute[a] - points.minute[b])
      .forEach((detection, position) => {
        rank[detection] = position / Math.max(1, count - 1);
      });

    for (let i = 0; i < count; i += 1) {
      const dayFraction = points.minute[i] / 1440;

      const along = (rank[i] * 2 - 1) * 0.94 + (hash(i * 1.37) - 0.5) * 0.12;
      const angle = hash(i * 7.91) * Math.PI * 2;
      const radial = Math.cbrt(hash(i * 3.19)) * Math.sqrt(Math.max(0, 1 - along * along));

      offset[i * 3] = clamp(along, -1, 1);
      offset[i * 3 + 1] = Math.cos(angle) * radial;
      offset[i * 3 + 2] = Math.sin(angle) * radial;

      phase[i] = dayFraction;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      seed[i] = hash(i * 5.77);
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.2, 1);
      lobe[i] = hash(i * 11.3) > 0.5 ? 1 : -1;
    }

    const geometry = new BufferGeometry();
    // A dummy position keeps three.js happy; the vertex shader ignores it.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aOffset', new BufferAttribute(offset, 3));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));
    geometry.setAttribute('aLobe', new BufferAttribute(lobe, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CHORUS_VERTEX,
        fragmentShader: CHORUS_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    return cloud;
  }

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
  }

  /** The circuit: a closed, never-repeating-looking weave through the dark. */
  private static path(t: number, out: Vector3): Vector3 {
    return out.set(
      ROAM * Math.sin(t + 0.4) + ROAM * 0.36 * Math.sin(2.3 * t + 1.1),
      ROAM * 0.3 * Math.sin(1.7 * t + 1.9) + ROAM * 0.14 * Math.sin(3.1 * t),
      ROAM * 0.78 * Math.sin(2.0 * t + 3.3) + ROAM * 0.33 * Math.cos(1.1 * t + 0.6)
    );
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.8, ctx.delta);

    // The wave keeps its own clock, independent of the camera, so returning to
    // this chapter never restarts the swell mid-flight.
    const phase = (ctx.time % CYCLE_SECONDS) / CYCLE_SECONDS;
    this.uniforms.uPhase.value = phase;

    // ---- the flock's frame -------------------------------------------------
    const t = (ctx.time / PATH_SECONDS) * Math.PI * 2;
    ChorusScene.path(t, this.centre);
    ChorusScene.path(t + 0.045, this.ahead);
    this.heading.subVectors(this.ahead, this.centre);
    if (this.heading.lengthSq() > 1e-8) this.heading.normalize();
    this.side.crossVectors(this.heading, this.up).normalize();

    this.uniforms.uCentre.value.copy(this.centre);
    this.uniforms.uHeading.value.copy(this.heading);
    this.uniforms.uSide.value.copy(this.side);

    // The body breathes: long along the flight, flatter than it is wide, and
    // slower than any of it looks — starlings, not smoke.
    const stretch = 1 + 0.5 * Math.sin(ctx.time * 0.21 + 1.7);
    this.uniforms.uAxes.value.set(
      11.5 * stretch,
      6.4 * (1 + 0.3 * Math.sin(ctx.time * 0.31)),
      3.1 * (1 + 0.24 * Math.sin(ctx.time * 0.26 + 3.1))
    );

    // Now and then the flock tears into two lobes and heals. Cubing the sine
    // keeps it whole most of the time; the split is an event, not a state.
    const tear = Math.max(0, Math.sin(ctx.time * 0.09 + 2.2));
    this.uniforms.uSplit.value = tear * tear * tear * 5.4;

    // Attention pulls the flock tighter; left alone it loosens and spreads.
    this.uniforms.uAttention.value = damp(
      this.uniforms.uAttention.value,
      ctx.pointer.activeCount > 0 ? 1 : 1 - ctx.idle * 0.6,
      1.6,
      ctx.delta
    );

    // The camera leans after the flock without chasing it: the frame follows at
    // half distance, so the murmuration crosses the screen rather than sitting
    // pinned in the middle of it.
    this.desiredTarget.copy(this.centre).multiplyScalar(0.72);
    // A phone is taller than it is wide, and the flock is long: the camera
    // stands further back as the frame narrows, or the murmuration spends half
    // its circuit out of shot.
    const narrow = ctx.aspect < 1.25 ? Math.pow(1.25 / ctx.aspect, 0.72) : 1;
    this.desired.radius = damp(this.desired.radius, (ctx.idle > 0.5 ? 37 : 34) * narrow, 0.6, ctx.delta);

    this.updateCameraRig(ctx);
    this.refreshReadout(phase);
  }

  private refreshReadout(phase: number): void {
    const hour = Math.floor(phase * 24) % 24;
    if (hour === this.readoutHour) return;
    this.readoutHour = hour;
    this.cachedReadout = {
      eyebrow: 'Château Purcari · Biodiversité',
      title: 'Le chœur',
      body:
        `2 665 détections, 121 espèces, cinq stations d’écoute. ` +
        `Du 31 juillet au 16 août 2025.`,
      stats: [
        { label: 'Heure', value: formatHour(hour) },
        { label: 'Détections', value: String(atlas.hourly[hour]) },
        { label: 'Pic du chœur', value: formatHour(peakHour) },
      ],
      spark: atlas.hourly.map(v => v / maxHourly),
      accent: PALETTE.gold,
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
    uPhase: { value: 0 },
    uAttention: { value: 1 },
    uCentre: { value: new Vector3() },
    uHeading: { value: new Vector3(1, 0, 0) },
    uSide: { value: new Vector3(0, 0, 1) },
    uAxes: { value: new Vector3(8, 5, 2.6) },
    uSplit: { value: 0 },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uAurora: { value: color(PALETTE.aurora) },
    ...touch,
  };
}

function hash(n: number): number {
  const s = Math.sin(n * 43.21) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const CHORUS_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uPhase;
uniform float uAttention;
uniform vec3 uCentre;
uniform vec3 uHeading;
uniform vec3 uSide;
uniform vec3 uAxes;
uniform float uSplit;
uniform vec3 uGuildColors[6];
attribute vec3 aOffset;
attribute float aPhase;
attribute float aGuild;
attribute float aSeed;
attribute float aWeight;
attribute float aLobe;
varying vec3 vColor;
varying float vAlpha;

${SIMPLEX3}
${CURL}
${HASH}
${EASING}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 flockUp = normalize(cross(uSide, uHeading));

  // The bird's station in the body, in the body's own frame.
  vec3 pos = uCentre
    + uHeading * aOffset.x * uAxes.x
    + uSide    * aOffset.y * uAxes.y
    + flockUp  * aOffset.z * uAxes.z
    + uSide    * aLobe * uSplit;

  // Individual wander inside the body — divergence-free, so the flock churns
  // without curdling into clumps.
  float loose = 1.7 + (1.0 - uAttention) * 1.3;
  pos += curlNoise(pos * 0.085 + vec3(0.0, uTime * 0.05, 0.0)) * loose;

  // The chorus wave: a front running through the body in time-of-day order,
  // which is also nose-to-tail order — the birds surge as it passes.
  float signed = fract(uPhase - aPhase + 1.0);
  signed = signed > 0.5 ? signed - 1.0 : signed;
  float lead = exp(-signed * signed * 2600.0);
  float tail = signed > 0.0 ? exp(-signed * 26.0) * 0.55 : 0.0;
  float wave = clamp(lead + tail, 0.0, 1.4);
  pos += uHeading * wave * 1.7 + flockUp * wave * 0.5;

  // A finger is a falcon: the flock opens around it and closes behind it.
  pos += touchDisplace(pos, 9.0, 5.0);
  float ripple = rippleField(pos, 10.0, 2.6, 2.0);
  pos += normalize(pos - uCentre + 1e-4) * ripple * 1.6;

  // Entry: the birds fly in from a wide scatter, the far ones last.
  float reveal = easeOutQuart(clamp(uReveal * 1.7 - aSeed * 0.6, 0.0, 1.0));
  pos = mix(uCentre + (pos - uCentre) * 3.2, pos, reveal);

  vec3 guild = uGuildColors[int(aGuild)];
  // The wave warms each bird toward candlelight without erasing its guild hue.
  vColor = mix(guild * 0.8, mix(guild, vec3(1.0, 0.88, 0.62), 0.5) * 1.35, wave);
  vColor += vec3(0.4, 0.29, 0.13) * ripple + vec3(0.3) * touchGlow(pos, 8.0);

  // A slow individual shimmer keeps the quiet hours from going flat.
  float shimmer = 0.72 + 0.28 * sin(uTime * 0.9 + aSeed * 42.0);
  vAlpha = (0.3 + wave * 0.42) * (0.4 + aWeight * 0.6) * shimmer * reveal;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.09 + aWeight * 0.11 + wave * 0.07 + ripple * 0.2, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const CHORUS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
${SPRITE}

void main(){
  float a = spriteAlpha(gl_PointCoord, 0.85) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.6, a);
}
`;
