import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MathUtils,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildCss, guildIndex, guildLabel, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, maxHourly, points, speciesAtHour } from '../data/atlas';
import { solarDay, formatClock } from '../data/solar';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Radius of the ring the hours stand on. */
const R_RING = 12;

/** Tallest blade, in scene units — the 05:00 hour, which sets the scale. */
const MAX_BLADE = 11;

/** Subdivision of one hour's blade. */
const BLADE_COLS = 5;
const BLADE_ROWS = 9;

/** Seconds of real time per hour of the sweep — a full day in ~40 s. */
const SECONDS_PER_HOUR = 1.7;

/** Detections in an hour, normalised. Blades are eased so the small hours exist. */
const HOUR_SHARE = atlas.hourly.map(v => Math.pow(v / maxHourly, 0.72));

/**
 * Sunrise and sunset at the middle of the survey, in hours.
 *
 * The acoustic survey is seventeen days long and the sun moves twenty minutes
 * across it — less than the width of the twilight seam the chapter draws — so
 * one arc for the whole window is honest, and the readout says which day it is
 * for. The per-detection figures below do *not* use it: each detection is
 * measured against the sunrise of its own day.
 */
const MID_DATE = atlas.days[Math.floor(atlas.days.length / 2)].date;
const SUN = solarDay(MID_DATE, atlas.meta.origin.lat, atlas.meta.origin.lon);
const SUNRISE_HOUR = SUN.sunrise / 60;
const SUNSET_HOUR = SUN.sunset / 60;

/**
 * How much of the record is sung before the sun is up, counted against each
 * detection's own sunrise rather than an average one.
 *
 * It comes out at just under a quarter, and it is the fact this chapter exists
 * to show: the two loudest hours of the survey, 04:00 and 05:00, are both over
 * before the sun clears the horizon at 05:49.
 */
const DARK = (() => {
  const sunrise: number[] = atlas.days.map(
    day => solarDay(day.date, atlas.meta.origin.lat, atlas.meta.origin.lon).sunrise
  );
  const sunset: number[] = atlas.days.map(
    day => solarDay(day.date, atlas.meta.origin.lat, atlas.meta.origin.lon).sunset
  );
  let before = 0;
  let after = 0;
  for (let i = 0; i < points.count; i += 1) {
    const minute = points.minute[i];
    const day = points.day[i];
    if (minute < sunrise[day]) before += 1;
    else if (minute > sunset[day]) after += 1;
  }
  return { before, after, total: points.count };
})();

/** Dominant guild of each hour — the night belongs to herons and owls. */
const HOUR_GUILD = (() => {
  const tally = Array.from({ length: 24 }, () => new Map<string, number>());
  for (let i = 0; i < points.count; i += 1) {
    const hour = Math.floor(points.minute[i] / 60);
    const guild = atlas.species[points.species[i]].guild;
    tally[hour].set(guild, (tally[hour].get(guild) ?? 0) + 1);
  }
  return tally.map(map => {
    let best = 'unknown';
    let top = -1;
    for (const [guild, n] of map) {
      if (n > top) {
        top = n;
        best = guild;
      }
    }
    return best;
  });
})();

/**
 * Chapter II — Circadien.
 *
 * A crown of twenty-four blades standing on the day itself. Each blade is one
 * hour of the survey, its height the number of detections in it, and inside it
 * every one of those detections is a mote placed by the minute it was recorded
 * and coloured by what kind of animal made it.
 *
 * The ground the crown stands on is not decoration: it is the real day, from the
 * solar equations for 46.52° N at the middle of the survey — gold from sunrise at
 * 05:49 to sunset at 20:24, violet either side, with a seam on each twilight.
 * That is what turns the shape into an argument. The two tallest blades in the
 * whole ring, 04:00 and 05:00, stand entirely on the violet: 461 detections, a
 * sixth of the record, sung before the sun is up. Counted against each
 * detection's own sunrise rather than an average one, a full quarter of the
 * survey — 628 of 2,665 — happens in the dark before dawn, and only four percent
 * after dusk. The dawn chorus is not an early-morning thing. It is a night
 * thing that stops when the light arrives.
 *
 * The guilds sort themselves without being asked: waterbirds hold midnight to
 * 02:00, owls and nightjars hold 03:00 and everything after 19:00, and the
 * songbirds hold the rest.
 *
 * Drag sideways to walk around it, drag up and down to fall from a clock face
 * into a skyline, pinch to close in. Touch an hour to hold it.
 */
export class CircadianScene extends ChapterBase {
  readonly id = 'circadian' as const;
  readonly look = { exposure: 0.96, bloom: 0.5, grain: 0.022, aberration: 0.9, vignette: 1.15, trail: 0.76 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly ground: Mesh;
  private readonly blades: Mesh;
  private readonly motes: Points;
  private readonly hand: Mesh;

  /** Continuous position of the sweep, 0..24. */
  private hour = 4.4;
  /** The hour a visitor is holding, or null while the sweep runs. */
  private pinned: number | null = null;

  /** Camera: turn around the ring, fall from plan view to elevation, close in. */
  private orbit = 0;
  private orbitTarget = 0;
  private tilt = 0;
  private tiltTarget = 0.62;
  private zoom = 1.34;
  private zoomTarget = 1;
  private pinchPrevious = 0;

  /** 0 on entering, 1 once the opening fall has landed. */
  private flight = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  constructor() {
    super(42);

    // The crown stands on the ground plane, so that is where fingers land.
    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.ground = this.buildGround();
    this.blades = this.buildBlades();
    this.motes = this.buildMotes();
    this.hand = this.buildHand();
    this.scene.add(this.ground, this.blades, this.hand, this.motes);

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  /** Midnight away from the camera's rest position, hours running clockwise. */
  private static angleFor(hour: number): number {
    return Math.PI / 2 - (hour / 24) * Math.PI * 2;
  }

  private static ringPoint(hour: number, radius: number, out: Vector3): Vector3 {
    const angle = CircadianScene.angleFor(hour);
    return out.set(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius);
  }

  // ------------------------------------------------------------------- build --

  /**
   * The day, as a disc. One quad; the arc, the twilight seams and the hour marks
   * are all drawn in the fragment shader from the sun's own times, so nothing
   * about the light depends on geometry that could drift out of step with it.
   */
  private buildGround(): Mesh {
    const size = R_RING * 2.9;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -size, 0, -size, size, 0, -size, size, 0, size,
          -size, 0, -size, size, 0, size, -size, 0, size,
        ]),
        3
      )
    );
    geometry.setAttribute(
      'aLocal',
      new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), 2)
    );

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: GROUND_VERTEX,
        fragmentShader: GROUND_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return mesh;
  }

  /** Twenty-four veils, one per hour, each spanning its own fifteen degrees. */
  private buildBlades(): Mesh {
    const position: number[] = [];
    const hour: number[] = [];
    const up: number[] = [];
    const across: number[] = [];
    const guild: number[] = [];
    const height: number[] = [];

    const a = new Vector3();
    const b = new Vector3();

    for (let h = 0; h < 24; h += 1) {
      const tall = HOUR_SHARE[h] * MAX_BLADE;
      const guildId = guildIndex(HOUR_GUILD[h]);

      for (let c = 0; c < BLADE_COLS; c += 1) {
        // A hair inside the hour's own sector, so neighbouring blades read as
        // separate hours rather than as one continuous wall.
        const t0 = (c / BLADE_COLS) * 0.92 + 0.04;
        const t1 = ((c + 1) / BLADE_COLS) * 0.92 + 0.04;
        CircadianScene.ringPoint(h + t0, R_RING, a);
        CircadianScene.ringPoint(h + t1, R_RING, b);

        for (let r = 0; r < BLADE_ROWS; r += 1) {
          const y0 = (r / BLADE_ROWS) * tall;
          const y1 = ((r + 1) / BLADE_ROWS) * tall;
          const u0 = r / BLADE_ROWS;
          const u1 = (r + 1) / BLADE_ROWS;

          const quad: [Vector3, number, number, number][] = [
            [a, y0, u0, t0],
            [b, y0, u0, t1],
            [b, y1, u1, t1],
            [a, y0, u0, t0],
            [b, y1, u1, t1],
            [a, y1, u1, t0],
          ];
          for (const [p, y, u, t] of quad) {
            position.push(p.x, y, p.z);
            hour.push(h);
            up.push(u);
            across.push(t);
            guild.push(guildId);
            height.push(HOUR_SHARE[h]);
          }
        }
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aHour', new BufferAttribute(new Float32Array(hour), 1));
    geometry.setAttribute('aUp', new BufferAttribute(new Float32Array(up), 1));
    geometry.setAttribute('aAcross', new BufferAttribute(new Float32Array(across), 1));
    geometry.setAttribute('aGuild', new BufferAttribute(new Float32Array(guild), 1));
    geometry.setAttribute('aHeight', new BufferAttribute(new Float32Array(height), 1));

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: BLADE_VERTEX,
        fragmentShader: BLADE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }

  /**
   * Every detection, inside the blade of the hour it belongs to.
   *
   * Height within the blade is the detection's rank inside its own hour, which
   * is what makes a blade read as a column of individual records rather than as
   * a bar: the abundant species fill the foot of it, the rarities tip the top.
   */
  private buildMotes(): Points {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const hour = new Float32Array(count);
    const guild = new Float32Array(count);
    const seed = new Float32Array(count);
    const rank01 = new Float32Array(count);
    const weight = new Float32Array(count);

    const rank = new Uint16Array(24);
    const scratch = new Vector3();

    for (let i = 0; i < count; i += 1) {
      const minute = points.minute[i];
      const h = Math.floor(minute / 60);
      const within = rank[h] / Math.max(1, atlas.hourly[h] - 1);
      rank[h] += 1;

      // The exact minute sets the angle, so a blade is a fifteen-degree fan of
      // real times rather than a stack on one line.
      const continuous = minute / 60;
      const wobble = (hash(i * 3.17) - 0.5) * 1.6;
      CircadianScene.ringPoint(continuous, R_RING + wobble, scratch);

      position[i * 3] = scratch.x;
      position[i * 3 + 1] = within * HOUR_SHARE[h] * MAX_BLADE * 0.98 + 0.15;
      position[i * 3 + 2] = scratch.z;

      hour[i] = continuous;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      seed[i] = hash(i * 7.31);
      rank01[i] = within;
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.22, 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aHour', new BufferAttribute(hour, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aRank', new BufferAttribute(rank01, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: MOTE_VERTEX,
        fragmentShader: MOTE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 3;
    return cloud;
  }

  /** The sweep: a standing sheet of light at the current hour. */
  private buildHand(): Mesh {
    const geometry = new BufferGeometry();
    // A unit quad in the plane of the hand; the vertex shader puts it on the
    // ring at whatever hour the sweep has reached.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 3)
    );
    geometry.setAttribute(
      'aLocal',
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2)
    );

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: HAND_VERTEX,
        fragmentShader: HAND_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.hour = 4.4;
    this.pinned = null;
    this.flight = 0;
    this.orbit = 0;
    this.orbitTarget = 0;
    // The chapter opens looking straight down — a clock — and falls into the
    // skyline as it lands, which is the whole reading of the piece in one move.
    this.tilt = 0.04;
    this.tiltTarget = 0.62;
    this.zoom = 1.34;
    this.zoomTarget = 1;
    this.pinchPrevious = 0;
    this.readoutKey = '';
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.8, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const radius = Math.hypot(tap.world.x, tap.world.z);
      if (radius < R_RING * 0.55) {
        // The middle of the ring carries no hour: it is the release.
        this.pinned = null;
      } else {
        const hour = Math.floor(hourAt(tap.world.x, tap.world.z));
        this.pinned = this.pinned === hour ? null : hour;
        if (this.pinned !== null) this.hour = this.pinned + 0.5;
      }
    }

    this.handleNavigation(ctx);

    if (this.pinned === null) {
      this.hour = (this.hour + ctx.delta / SECONDS_PER_HOUR) % 24;
    }

    this.uniforms.uHour.value = this.hour;
    this.uniforms.uPinned.value = this.pinned ?? -1;
    this.uniforms.uPinStrength.value = damp(
      this.uniforms.uPinStrength.value,
      this.pinned === null ? 0 : 1,
      3,
      ctx.delta
    );

    this.flight = Math.min(1, this.flight + ctx.delta / 4.5);
    this.updateCamera(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  /**
   * Sideways walks around the ring, up and down falls between a clock face and a
   * skyline, two fingers close in. The hour under the hand is not dragged — it
   * is touched — so the gesture that moves the camera can be about the camera.
   */
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
      if (wheel !== 0) this.zoomTarget *= Math.pow(0.86, wheel);

      const drag = ctx.pointer.dragWithInertia;
      if (Math.abs(drag.x) > 1e-6) this.orbitTarget -= drag.x * 3.4;
      if (Math.abs(drag.y) > 1e-6) this.tiltTarget = clamp(this.tiltTarget + drag.y * 2.2, 0, 1);
    }

    this.zoomTarget = clamp(this.zoomTarget, 0.62, 1.9);

    // Left alone the crown keeps turning, and settles back to the angle it was
    // composed at — a panel that has been spun and abandoned still looks made.
    this.orbitTarget += ctx.delta * ctx.idle * 0.08;
    if (ctx.idle > 0.5) {
      this.tiltTarget = damp(this.tiltTarget, 0.62, 0.35 * ctx.idle, ctx.delta);
      this.zoomTarget = damp(this.zoomTarget, 1, 0.35 * ctx.idle, ctx.delta);
    }
  }

  private updateCamera(ctx: FrameContext): void {
    this.orbit = damp(this.orbit, this.orbitTarget, 3.0, ctx.delta);
    this.tilt = damp(this.tilt, this.tiltTarget, 2.4, ctx.delta);
    this.zoom = damp(this.zoom, this.zoomTarget, 2.2, ctx.delta);

    const landed = 1 - Math.pow(1 - this.flight, 3);

    // Distance that fits the ring across the short edge of the panel, whatever
    // its shape, with a little more room while the opening move is still coming
    // down.
    const halfV = MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * ctx.aspect);
    // Generous, because the crown is not only the ring: the dawn blades stand
    // eleven units above it and a held hour throws its motes outward past it.
    const framed = (R_RING * 1.52) / Math.tan(Math.min(halfV, halfH));
    const distance = framed * this.zoom * (1 + (1 - landed) * 0.35);

    // Plan view at tilt 0, a low three-quarter at tilt 1.
    const phi = MathUtils.lerp(0.16, 1.16, this.tilt);
    const theta = this.orbit + Math.sin(ctx.time * 0.07) * 0.03 + ctx.pointer.centroid.x * 0.08;

    this.camera.position.set(
      Math.sin(theta) * Math.sin(phi) * distance,
      Math.cos(phi) * distance,
      Math.cos(theta) * Math.sin(phi) * distance
    );
    // Looking a little above the ground keeps the tall blades in frame when the
    // camera is low, and does nothing when it is overhead.
    this.camera.lookAt(0, MAX_BLADE * 0.28 * this.tilt, 0);

    this.uniforms.uTilt.value = this.tilt;
  }

  /** The marker points at the top of whichever blade is being held. */
  private updateMarker(): void {
    if (this.pinned === null) {
      this.marker = undefined;
      return;
    }
    CircadianScene.ringPoint(this.pinned + 0.5, R_RING, this.probe);
    this.probe.y = HOUR_SHARE[this.pinned] * MAX_BLADE + 0.6;
    this.probe.project(this.camera);
    this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
  }

  // ----------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const current = this.pinned ?? Math.floor(this.hour) % 24;
    const key = `${current}-${this.pinned === null ? 'sweep' : 'held'}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout = this.hourReadout(current);
    }
    this.cachedReadout.marker = this.marker;
  }

  private hourReadout(hour: number): Readout {
    const held = this.pinned !== null;
    const count = atlas.hourly[hour];
    const top = speciesAtHour(hour, held ? 6 : 3);
    const guild = HOUR_GUILD[hour];

    // Which side of the sun this hour falls on, using the hour's own span rather
    // than a night/day label pinned to round numbers.
    const dark = hour + 1 <= SUNRISE_HOUR || hour >= SUNSET_HOUR;
    const straddles =
      (hour < SUNRISE_HOUR && hour + 1 > SUNRISE_HOUR) || (hour < SUNSET_HOUR && hour + 1 > SUNSET_HOUR);
    const light = straddles
      ? hour < 12
        ? `Le soleil se lève à ${formatClock(SUN.sunrise)}`
        : `Le soleil se couche à ${formatClock(SUN.sunset)}`
      : dark
        ? 'Avant le lever du soleil'
        : 'En plein jour';

    return {
      eyebrow: held ? 'Chapitre II · Heure maintenue' : 'Chapitre II · Circadien',
      title: formatHour(hour),
      body:
        top.length > 0
          ? `${light} · ${guildLabel(guild)} en majorité. ${top.map(s => s.name).join(' · ')}.`
          : `${light} · aucune détection à cette heure.`,
      stats: [
        { label: 'Détections', value: String(count) },
        { label: 'Part du total', value: `${((count / atlas.meta.total) * 100).toFixed(1)} %` },
        {
          label: 'Avant le lever',
          value: `${Math.round((DARK.before / DARK.total) * 100)} % du corpus`,
        },
        { label: 'Lever · coucher', value: `${formatClock(SUN.sunrise)} · ${formatClock(SUN.sunset)}` },
      ],
      spark: atlas.hourly.map(v => v / maxHourly),
      accent: dark || straddles ? PALETTE.dusk : guildCss(guild),
    };
  }

  private overviewReadout(): Readout {
    return this.hourReadout(Math.floor(this.hour) % 24);
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uHour: { value: 0 },
    uPinned: { value: -1 },
    uPinStrength: { value: 0 },
    uTilt: { value: 0 },
    uRing: { value: R_RING },
    uSunrise: { value: SUNRISE_HOUR },
    uSunset: { value: SUNSET_HOUR },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uDusk: { value: color(PALETTE.dusk) },
    uWine: { value: color(PALETTE.wine) },
    ...touch,
  };
}

/** Where on the clock a ground position falls, in hours. */
function hourAt(x: number, z: number): number {
  const angle = Math.atan2(-z, x);
  return ((((Math.PI / 2 - angle) / (Math.PI * 2)) * 24) % 24 + 24) % 24;
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

/** Hours, the sweep and the held hour — every shader here needs all three. */
const CLOCK = /* glsl */ `
uniform float uHour;
uniform float uPinned;
uniform float uPinStrength;
uniform float uRing;
uniform float uSunrise;
uniform float uSunset;

/** Shortest distance between two positions on a 24-hour clock. */
float hourDistance(float a, float b){
  float d = abs(a - b);
  return min(d, 24.0 - d);
}

/** 1 inside the hour the visitor is holding. */
float isHeld(float hour){
  return uPinned < -0.5 ? 0.0 : step(abs(floor(hour) - uPinned), 0.5);
}

/** Where on the clock the ground position sits, in hours. */
float hourOf(vec2 ground){
  float angle = atan(-ground.y, ground.x);
  float hour = ((1.5707963 - angle) / 6.2831853) * 24.0;
  return mod(mod(hour, 24.0) + 24.0, 24.0);
}
`;

const GROUND_VERTEX = /* glsl */ `
attribute vec2 aLocal;
varying vec2 vLocal;
varying vec3 vWorld;

void main(){
  vLocal = aLocal;
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GROUND_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uGold;
uniform vec3 uDusk;
uniform vec3 uBone;
varying vec2 vLocal;
varying vec3 vWorld;

${CLOCK}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  float radius = length(vWorld.xz);
  float hour = hourOf(vWorld.xz);

  // The day is drawn as a band under the crown rather than as a filled disc: a
  // disc becomes a pie chart, and a pie chart of the hours would be a second,
  // wrong reading of the same numbers the blades already carry.
  float band = exp(-pow((radius - uRing) / 2.6, 2.0));
  float wash = (1.0 - smoothstep(uRing * 0.15, uRing * 1.25, radius)) * 0.35;

  // Gold between sunrise and sunset, violet either side, with the sun's own two
  // crossings as the only hard marks on the ground.
  float day = smoothstep(uSunrise - 0.35, uSunrise + 0.35, hour)
            * (1.0 - smoothstep(uSunset - 0.35, uSunset + 0.35, hour));
  float dawn = exp(-pow((hour - uSunrise) * 6.0, 2.0));
  float dusk = exp(-pow((hour - uSunset) * 6.0, 2.0));

  // An hour mark on the band every hour, weightier every six.
  float edge = fract(hour);
  float tick = 1.0 - smoothstep(0.0, 0.022, min(edge, 1.0 - edge));
  float major = mod(floor(hour), 6.0) < 0.5 ? 1.0 : 0.4;

  float held = isHeld(floor(hour)) * uPinStrength;
  float sweep = exp(-pow(hourDistance(hour, uHour) * 2.6, 2.0)) * (1.0 - uPinStrength);

  vec3 tint = mix(uDusk * 0.9, uGold * 0.75, day);
  tint = mix(tint, uBone, (dawn + dusk) * 0.55);

  float a = band * (0.075 + tick * major * 0.10 + (dawn + dusk) * 0.22 + sweep * 0.10 + held * 0.10)
          + wash * 0.03
          + touchGlow(vWorld, 5.0) * 0.05
          + rippleField(vWorld, 9.0, 2.6, 1.8) * 0.10;

  a *= uReveal;
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

const BLADE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aHour;
attribute float aUp;
attribute float aAcross;
attribute float aGuild;
attribute float aHeight;
varying float vUp;
varying float vAcross;
varying float vHour;
varying float vHeld;
varying float vSweep;
varying vec3 vColor;
varying vec3 vWorld;

${SIMPLEX3}
${EASING}
${CLOCK}
${TOUCH_UNIFORMS}

uniform vec3 uGuildColors[6];
uniform vec3 uBone;

void main(){
  vec3 pos = position;

  // The blades breathe: a slow vertical swell, strongest at the top where a
  // veil would be loosest.
  float sway = snoise(vec3(aHour * 0.7, uTime * 0.22, aAcross * 2.0)) * aUp * 0.5;
  pos.x += sway * 0.5;
  pos.z += sway * 0.5;

  vHeld = isHeld(aHour) * uPinStrength;
  // The sweep parks on whatever hour is being held, so its own emphasis is
  // faded out there rather than added to the held one — three highlights on the
  // same blade is not three times as clear, it is a white flare.
  vSweep = exp(-pow(hourDistance(aHour + 0.5, uHour) * 1.6, 2.0)) * (1.0 - uPinStrength);

  // Held hours stand taller and the swept hour lifts as the light passes.
  pos.y *= 1.0 + vHeld * 0.13 + vSweep * 0.06;
  pos += touchDisplace(pos, 5.0, 0.5);

  // The crown grows out of the ground on entry, hour by hour around the clock.
  float grow = easeOutQuart(clamp(uReveal * 1.9 - aHour / 24.0 * 0.85, 0.0, 1.0));
  pos.y *= grow;

  vUp = aUp;
  vAcross = aAcross;
  vHour = aHour;
  vColor = mix(uGuildColors[int(aGuild)], uBone, 0.12) * (0.55 + aHeight * 0.7);
  vWorld = pos;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const BLADE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uBone;
varying float vUp;
varying float vAcross;
varying float vHour;
varying float vHeld;
varying float vSweep;
varying vec3 vColor;
varying vec3 vWorld;

${HASH}
${CLOCK}

void main(){
  // Vertical filaments: the veil is made of threads, not of paint.
  float threads = 0.5 + 0.5 * sin(vAcross * 78.0 + hash11(floor(vHour)) * 40.0);
  threads = pow(threads, 1.6);

  // Bright at the foot, thinning out at the top, with a lit edge at the crest.
  float body = pow(1.0 - vUp, 1.35);
  float crest = exp(-pow((vUp - 0.97) * 26.0, 2.0));
  // A pulse climbing the blade the moment the sweep crosses it.
  float pulse = exp(-pow((vUp - fract(uTime * 0.35)) * 7.0, 2.0)) * vSweep;

  float a = (body * (0.055 + threads * 0.075) + crest * 0.24 + pulse * 0.16)
          * (0.55 + vSweep * 0.7 + vHeld * 0.45);

  // Everything else steps back when an hour is held, but nothing goes dark: the
  // shape of the day is the point.
  a *= mix(1.0, 0.34, uPinStrength * (1.0 - vHeld));

  vec3 tint = mix(vColor, uBone, vHeld * 0.4 + crest * 0.3);
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a, a);
}
`;

const MOTE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uTilt;
uniform vec3 uGuildColors[6];
uniform vec3 uBone;
attribute float aHour;
attribute float aGuild;
attribute float aSeed;
attribute float aRank;
attribute float aWeight;
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

${SIMPLEX3}
${EASING}
${CLOCK}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  vHeld = isHeld(aHour) * uPinStrength;
  float sweep = exp(-pow(hourDistance(aHour, uHour) * 2.0, 2.0)) * (1.0 - uPinStrength);

  // Each mote drifts on its own small orbit — the crown is never still.
  float t = uTime * 0.3 + aSeed * 6.2831;
  pos += vec3(sin(t), cos(t * 1.21) * 0.6, cos(t)) * (0.18 + aRank * 0.3);

  // A held hour opens: its motes push outward off the ring into a fan you can
  // actually count, and lift clear of the blade they were standing in.
  vec3 outward = normalize(vec3(pos.x, 0.0, pos.z) + 1e-5);
  // A held hour opens into a comb rather than a flare. Outward and upward is not
  // enough on its own — a hundred records in fifteen degrees is still a single
  // bright mass — so the sector itself fans open to about three times its width
  // around its own centre, which is what makes the individual records countable.
  float within = fract(aHour) - 0.5;
  float fan = -within * vHeld * 2.2 * 0.2617994;
  float cs = cos(fan);
  float sn = sin(fan);
  pos.xz = mat2(cs, -sn, sn, cs) * pos.xz;

  pos += outward * vHeld * (0.7 + aRank * 1.9);
  pos.y += vHeld * (0.4 + aRank * 1.0);

  pos += touchDisplace(pos, 5.0, 1.2);
  float ripple = rippleField(pos, 9.0, 2.6, 1.8);
  pos.y += ripple * 0.7;

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = mix(guild, mix(guild, uBone, 0.4) * 1.25, vHeld);
  vColor += vec3(0.30, 0.20, 0.09) * (sweep * 0.5 + ripple);

  float grow = easeOutQuart(clamp(uReveal * 1.9 - aHour / 24.0 * 0.8, 0.0, 1.0));
  float dim = mix(1.0, 0.2, uPinStrength * (1.0 - vHeld));
  vAlpha = (0.26 + aWeight * 0.32 + sweep * 0.4) * grow * dim;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.16 + aWeight * 0.2 + vHeld * 0.12 + sweep * 0.1, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.55, d);
  float halo = exp(-d * 2.8) * 0.5;
  float ring = (1.0 - smoothstep(0.03, 0.09, abs(d - 0.8))) * vHeld * 0.5;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.75 + vec3(ring) * 0.12, a);
}
`;

const HAND_VERTEX = /* glsl */ `
uniform float uReveal;
attribute vec2 aLocal;
varying vec2 vLocal;

${CLOCK}

void main(){
  // The quad is built in the plane of the hand: across the ring and up from it.
  float angle = 1.5707963 - (uHour / 24.0) * 6.2831853;
  vec3 outward = vec3(cos(angle), 0.0, -sin(angle));

  // Standing across the ring itself rather than reaching in from the middle:
  // the sweep marks where on the clock the light is, and the middle of the ring
  // is not on the clock.
  float inner = uRing * 0.74;
  float span = uRing * 0.52;
  vec3 pos = outward * (inner + aLocal.x * span);
  pos.y = aLocal.y * ${MAX_BLADE.toFixed(1)} * 0.62 * uReveal;

  vLocal = aLocal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const HAND_FRAGMENT = /* glsl */ `
uniform vec3 uBone;
uniform vec3 uGold;
varying vec2 vLocal;

${CLOCK}

void main(){
  // Bright where it meets the ring and burning out upward, tapered at both ends
  // so it reads as a beam standing in the ring rather than as a wall across it.
  float up = pow(1.0 - vLocal.y, 2.6);
  float along = sin(clamp(vLocal.x, 0.0, 1.0) * 3.14159);

  // Softened while an hour is held: the sweep is no longer what the visitor is
  // looking at.
  // Nearly gone while an hour is held: the sweep is not what is being read, and
  // it stands exactly where the held hour is.
  float a = up * along * 0.11 * mix(1.0, 0.1, uPinStrength);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uGold, uBone, up * 0.5) * a, a);
}
`;
