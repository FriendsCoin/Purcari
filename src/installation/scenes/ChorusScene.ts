import { BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
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

const RADIUS = 15;

/**
 * Prologue — Le chœur.
 *
 * The attract state, and where the piece returns when nobody has touched it for
 * a while. All 2,665 detections held in a single slowly turning cloud, with a
 * wave of light sweeping through them in time-of-day order: because the dawn
 * chorus is nearly a third of everything recorded, the wave arrives as a visible
 * swell every half minute, then thins out through the afternoon and goes quiet
 * overnight.
 *
 * It carries no controls of its own. Any touch pushes the cloud and wakes the
 * interface.
 */
export class ChorusScene extends ChapterBase {
  readonly id = 'chorus' as const;
  readonly look = { exposure: 1.0, bloom: 0.68, grain: 0.020, aberration: 1.2, vignette: 1.2 };

  private readonly cloud: Points;
  private readonly uniforms: ReturnType<typeof createUniforms>;
  private cachedReadout: Readout;
  private readoutHour = -1;

  constructor() {
    super(46);

    this.restSpherical.set(40, Math.PI * 0.34, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.idleSpin = 0.045;
    this.minPolar = Math.PI * 0.14;
    this.maxPolar = Math.PI * 0.62;
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.cloud = this.buildCloud();
    this.scene.add(this.cloud);

    this.cachedReadout = { eyebrow: '', title: '' };
  }

  /**
   * Rest positions on a thick ring whose azimuth is the detection's time of day.
   *
   * An even distribution over the volume looked like a nebula but said nothing:
   * the chorus wave landed on scattered motes and read as random sparkle. Binding
   * the angle to the clock makes the cloud's own shape the daily rhythm — dense
   * through the dawn sector, thin overnight — and turns the wave into a front
   * that sweeps the ring like a lighthouse.
   */
  private buildCloud(): Points {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const guild = new Float32Array(count);
    const seed = new Float32Array(count);
    const weight = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const dayFraction = points.minute[i] / 1440;

      // Same clock convention as the dial: midnight up, hours running clockwise.
      // The spread keeps each hour a soft band rather than a blade.
      const spread = (hash(i * 1.37) - 0.5) * 0.42;
      const theta = Math.PI / 2 - dayFraction * Math.PI * 2 + spread;

      // Square-rooted radius spreads evenly across the annulus instead of
      // crowding the inner edge.
      const r = RADIUS * (0.34 + 0.66 * Math.sqrt(hash(i * 7.91)));
      position[i * 3] = Math.cos(theta) * r;
      position[i * 3 + 1] = (hash(i * 3.19) - 0.5) * RADIUS * 0.7;
      position[i * 3 + 2] = Math.sin(theta) * r;

      phase[i] = dayFraction;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      seed[i] = hash(i * 5.77);
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.2, 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));

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

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.8, ctx.delta);

    // The wave keeps its own clock, independent of the camera, so returning to
    // this chapter never restarts the swell mid-flight.
    const phase = (ctx.time % CYCLE_SECONDS) / CYCLE_SECONDS;
    this.uniforms.uPhase.value = phase;

    // Attention pulls the cloud tighter; leaving it alone lets it expand and calm.
    this.uniforms.uAttention.value = damp(
      this.uniforms.uAttention.value,
      ctx.pointer.activeCount > 0 ? 1 : 1 - ctx.idle * 0.7,
      1.6,
      ctx.delta
    );

    this.desired.radius = damp(this.desired.radius, ctx.idle > 0.5 ? 45 : 40, 0.6, ctx.delta);
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
    uRadius: { value: RADIUS },
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
uniform float uRadius;
uniform vec3 uGuildColors[6];
attribute float aPhase;
attribute float aGuild;
attribute float aSeed;
attribute float aWeight;
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
  vec3 rest = position;

  // Divergence-free advection: the cloud churns without the particles piling up
  // into clumps, which is what separates air from confetti.
  vec3 flow = curlNoise(rest * 0.045 + vec3(0.0, uTime * 0.018, 0.0));
  vec3 pos = rest + flow * (2.4 + (1.0 - uAttention) * 2.2);

  // A slow differential rotation: the core turns faster than the rim.
  float spin = uTime * 0.06 * (1.0 - length(rest) / (uRadius * 2.0));
  float c = cos(spin), s = sin(spin);
  pos.xz = mat2(c, -s, s, c) * pos.xz;

  // The chorus wave: a front travelling through the cloud in time-of-day order.
  float signed = fract(uPhase - aPhase + 1.0);
  signed = signed > 0.5 ? signed - 1.0 : signed;
  // Ahead of the front it falls away fast; behind it, slowly.
  float lead = exp(-signed * signed * 2600.0);
  float tail = signed > 0.0 ? exp(-signed * 26.0) * 0.55 : 0.0;
  float wave = clamp(lead + tail, 0.0, 1.4);

  // The ring swells where the chorus is passing and settles behind it.
  pos.y += wave * 1.1 + sin(aPhase * 6.2831853 * 3.0 + uTime * 0.25) * 0.5;
  pos += normalize(pos + 1e-4) * wave * 2.6;
  pos = mix(pos, pos * 1.12, 1.0 - uAttention);

  pos += touchDisplace(pos, 7.0, 3.0);
  float ripple = rippleField(pos, 10.0, 2.6, 2.0);
  pos += normalize(pos + 1e-4) * ripple * 1.8;

  float reveal = easeOutQuart(clamp(uReveal * 1.6 - length(rest) / (uRadius * 3.0), 0.0, 1.0));
  pos *= mix(0.4, 1.0, reveal);

  vec3 guild = uGuildColors[int(aGuild)];
  // The wave warms each mote toward candlelight without erasing its guild hue —
  // pushing all the way to white loses the only colour coding the piece has.
  vColor = mix(guild * 0.75, mix(guild, vec3(1.0, 0.88, 0.62), 0.5) * 1.7, wave);
  vColor += vec3(0.45, 0.32, 0.15) * ripple + vec3(0.35) * touchGlow(pos, 7.0);

  // A slow individual shimmer keeps the quiet hours from going flat.
  float shimmer = 0.7 + 0.3 * sin(uTime * 0.8 + aSeed * 42.0);
  vAlpha = (0.22 + wave * 0.82) * (0.35 + aWeight * 0.65) * shimmer * reveal;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.10 + aWeight * 0.16 + wave * 0.26 + ripple * 0.35, mv.z);
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
  gl_FragColor = vec4(vColor * a * 0.55, a);
}
`;
