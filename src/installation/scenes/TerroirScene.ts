import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineSegments,
  Mesh,
  Points,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import {
  CURL,
  EASING,
  FBM,
  HASH,
  POINT_SIZE,
  RIPPLE_UNIFORMS,
  SIMPLEX3,
  SPRITE,
  TOUCH_UNIFORMS,
} from '../engine/glsl';
import { color, guildColorArray, guildIndex, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, maxStationTotal, points, speciesAtStation, stationScenePosition } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Scene-unit span of the long axis of the survey area. */
const SPREAD = 44;

const ROWS = 64;
const ROW_SEGMENTS = 90;
const ROW_HALF_WIDTH = 19;
const ROW_HALF_DEPTH = 30;

/** Screen-space radius, in NDC, for tapping a station beacon. */
const TAP_RADIUS = 0.14;

/**
 * Chapter I — Terroir.
 *
 * The survey area is a 0.8 x 3.1 km strip of vineyard running north to south,
 * with five recording stations along it. Those five real positions are the whole
 * composition: vine rows recede into the dark, each station stands as a shaft of
 * light scaled to how much it heard, and its detections spiral up out of the
 * ground as motes released in time-of-day order.
 */
export class TerroirScene extends ChapterBase {
  readonly id = 'terroir' as const;
  readonly look = { exposure: 0.98, bloom: 0.5, grain: 0.020, aberration: 1.1, vignette: 1.05 };

  private readonly rows: LineSegments;
  private readonly motes: Points;
  private readonly beacons: Mesh[] = [];
  private readonly halos: Mesh[] = [];

  private readonly stationWorld: Vector3[] = [];
  private readonly uniforms: ReturnType<typeof createUniforms>;

  private focused: number | null = null;
  private focusStrength = 0;
  private cachedReadout: Readout;
  private readoutKey = '';

  constructor() {
    super(40);

    this.restSpherical.set(58, Math.PI * 0.39, 0.6);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 5, 0);
    this.target.copy(this.desiredTarget);
    this.idleSpin = 0.022;
    this.minPolar = Math.PI * 0.16;
    this.maxPolar = Math.PI * 0.49;
    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = 0;

    const stationWeight: number[] = [];
    const stationHeight: number[] = [];
    for (const station of atlas.stations) {
      const [x, z] = stationScenePosition(station, SPREAD);
      this.stationWorld.push(new Vector3(x, 0, z));
      stationWeight.push(station.total / maxStationTotal);
      stationHeight.push(shaftHeight(station.total));
    }

    this.uniforms = createUniforms(this.stationWorld, stationWeight, stationHeight, this.touch);

    this.rows = this.buildRows();
    this.motes = this.buildMotes();
    this.scene.add(this.rows, this.motes);
    this.buildBeacons();

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ build --

  /**
   * The vine rows. Straight lines in the buffer; the shader gives them the roll
   * of the terrain, so the terrain function stays in one place and the motes and
   * beacons can sample the same height.
   */
  private buildRows(): LineSegments {
    const vertexCount = ROWS * ROW_SEGMENTS * 2;
    const position = new Float32Array(vertexCount * 3);
    const along = new Float32Array(vertexCount);
    const row = new Float32Array(vertexCount);

    let v = 0;
    for (let r = 0; r < ROWS; r += 1) {
      const rt = r / (ROWS - 1);
      const x = (rt * 2 - 1) * ROW_HALF_WIDTH;
      for (let s = 0; s < ROW_SEGMENTS; s += 1) {
        const t0 = s / ROW_SEGMENTS;
        const t1 = (s + 1) / ROW_SEGMENTS;
        for (const t of [t0, t1]) {
          position[v * 3] = x;
          position[v * 3 + 1] = 0;
          position[v * 3 + 2] = (t * 2 - 1) * ROW_HALF_DEPTH;
          along[v] = t;
          row[v] = rt;
          v += 1;
        }
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aAlong', new BufferAttribute(along, 1));
    geometry.setAttribute('aRow', new BufferAttribute(row, 1));

    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: ROW_VERTEX,
      fragmentShader: ROW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      ...ADDITIVE,
    });

    const lines = new LineSegments(geometry, material);
    lines.frustumCulled = false;
    return lines;
  }

  /** One mote per detection, parented to the station that recorded it. */
  private buildMotes(): Points {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const phase = new Float32Array(count);
    const guild = new Float32Array(count);
    const weight = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const station = this.stationWorld[points.station[i]];
      position[i * 3] = station.x;
      position[i * 3 + 1] = 0;
      position[i * 3 + 2] = station.z;
      seed[i] = (i * 0.6180339887) % 1;
      // Release order follows the clock, so the swarm pulses with the dawn chorus.
      phase[i] = points.minute[i] / 1440;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.25, 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));
    geometry.setAttribute('aStation', new BufferAttribute(Float32Array.from(points.station), 1));

    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: MOTE_VERTEX,
      fragmentShader: MOTE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      ...ADDITIVE,
    });

    const cloud = new Points(geometry, material);
    cloud.frustumCulled = false;
    return cloud;
  }

  /** A shaft of light and a ground halo per station, scaled by what it recorded. */
  private buildBeacons(): void {
    atlas.stations.forEach((station, index) => {
      const world = this.stationWorld[index];
      const share = station.total / maxStationTotal;
      const height = shaftHeight(station.total);
      const radius = 0.5 + share * 1.5;

      const shaft = new Mesh(
        buildShaftGeometry(radius, height),
        new ShaderMaterial({
          uniforms: { ...this.uniforms, uIndex: { value: index }, uHeight: { value: height } },
          vertexShader: SHAFT_VERTEX,
          fragmentShader: SHAFT_FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          ...ADDITIVE,
        })
      );
      shaft.position.copy(world);
      shaft.frustumCulled = false;
      this.beacons.push(shaft);

      const halo = new Mesh(
        new RingGeometry(radius * 0.6, radius * 5.5 + 2, 72, 1),
        new ShaderMaterial({
          uniforms: { ...this.uniforms, uIndex: { value: index }, uInner: { value: radius * 0.6 } },
          vertexShader: HALO_VERTEX,
          fragmentShader: HALO_FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          ...ADDITIVE,
        })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.copy(world);
      halo.frustumCulled = false;
      this.halos.push(halo);

      this.scene.add(shaft, halo);
    });
  }

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.focused = null;
    this.focusStrength = 0;
    this.desiredTarget.set(0, 5, 0);
    this.desired.radius = this.restSpherical.radius * 1.35;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uIdle.value = ctx.idle;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 1.1, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pickStation(tap.ndc.x, tap.ndc.y);
      this.focused = hit === this.focused ? null : hit;
    }

    const focusTarget = this.focused === null ? 0 : 1;
    this.focusStrength = damp(this.focusStrength, focusTarget, 2.4, ctx.delta);
    this.uniforms.uFocus.value = this.focused ?? -1;
    this.uniforms.uFocusStrength.value = this.focusStrength;

    if (this.focused !== null) {
      const world = this.stationWorld[this.focused];
      this.desiredTarget.set(world.x, 4.5, world.z);
      this.desired.radius = damp(this.desired.radius, 26, 1.6, ctx.delta);
      this.recentres = false;
    } else {
      this.desiredTarget.set(0, damp(this.desiredTarget.y, 5, 2, ctx.delta), 0);
      this.recentres = true;
    }

    this.updateCameraRig(ctx);
    this.refreshReadout();
  }

  /** Nearest station beacon within a screen-space radius of the tap. */
  private pickStation(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    let bestDistance = TAP_RADIUS;
    const probe = new Vector3();
    for (let i = 0; i < this.stationWorld.length; i += 1) {
      probe.copy(this.stationWorld[i]).setY(shaftHeight(atlas.stations[i].total) * 0.35);
      probe.project(this.camera);
      if (probe.z > 1) continue;
      const distance = Math.hypot(probe.x - ndcX, probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.focused === null ? 'overview' : `station-${this.focused}`;
    if (key === this.readoutKey) return;
    this.readoutKey = key;
    this.cachedReadout = this.focused === null ? this.overviewReadout() : this.stationReadout(this.focused);
  }

  private overviewReadout(): Readout {
    return {
      eyebrow: 'Chapitre I',
      title: 'Terroir',
      body:
        'Cinq stations d’écoute réparties sur trois kilomètres de vignoble. ' +
        'La hauteur de chaque faisceau correspond au nombre de détections enregistrées.',
      stats: [
        { label: 'Stations', value: String(atlas.meta.stationCount) },
        { label: 'Détections', value: atlas.meta.total.toLocaleString('fr-FR') },
        { label: 'Espèces', value: String(atlas.meta.speciesCount) },
      ],
      accent: PALETTE.gold,
    };
  }

  private stationReadout(index: number): Readout {
    const station = atlas.stations[index];
    const top = speciesAtStation(index, 4);
    return {
      eyebrow: `Station ${station.code.toUpperCase()}`,
      title: `${station.total.toLocaleString('fr-FR')} détections`,
      body: top.length > 0 ? `Espèces dominantes : ${top.map(s => s.name).join(' · ')}.` : undefined,
      stats: [
        { label: 'Espèces', value: String(station.species) },
        { label: 'Latitude', value: `${station.lat.toFixed(4)}°N` },
        { label: 'Longitude', value: `${station.lon.toFixed(4)}°E` },
      ],
      spark: normalise(station.hourly),
      accent: PALETTE.gold,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

function createUniforms(stations: Vector3[], weight: number[], height: number[], touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uIdle: { value: 0 },
    uFocus: { value: -1 },
    uFocusStrength: { value: 0 },
    uStations: { value: stations },
    uStationWeight: { value: weight },
    uStationHeight: { value: height },
    uGuildColors: { value: guildColorArray() },
    uBone: { value: color(PALETTE.bone) },
    uVine: { value: color(PALETTE.vine) },
    uGold: { value: color(PALETTE.gold) },
    ...touch,
  };
}

/** Beacon height in scene units. Logarithmic, so station 0 (9 detections) still reads. */
function shaftHeight(total: number): number {
  return 2.6 + Math.log2(total + 1) * 1.15;
}

function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => v / max);
}

/**
 * An open cone-ish shaft, wider at the base. Built by hand rather than with
 * CylinderGeometry so the UVs carry the normalised height the shader needs.
 */
function buildShaftGeometry(radius: number, height: number): BufferGeometry {
  const radial = 32;
  const rings = 12;
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  for (let y = 0; y <= rings; y += 1) {
    const v = y / rings;
    // Narrows and drifts as it rises, like smoke rather than a laser.
    const r = radius * (1 - v * 0.55) * (1 + Math.sin(v * Math.PI) * 0.35);
    for (let i = 0; i <= radial; i += 1) {
      const u = i / radial;
      const angle = u * Math.PI * 2;
      position.push(Math.cos(angle) * r, v * height, Math.sin(angle) * r);
      uv.push(u, v);
    }
  }

  for (let y = 0; y < rings; y += 1) {
    for (let i = 0; i < radial; i += 1) {
      const a = y * (radial + 1) + i;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uv), 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// ------------------------------------------------------------------ shaders --

/** Rolling terrain, shared by every element in this chapter. */
const TERRAIN = /* glsl */ `
float terrainHeight(vec2 p){
  return fbm(vec3(p * 0.036, 0.0), 4) * 1.35 - fbm(vec3(p * 0.011, 11.0), 2) * 1.8;
}
`;

const STATION_UNIFORMS = /* glsl */ `
#define STATION_COUNT 5
uniform vec3 uStations[STATION_COUNT];
uniform float uStationWeight[STATION_COUNT];
uniform float uStationHeight[STATION_COUNT];
uniform float uFocus;
uniform float uFocusStrength;

/** Falls off from every station, weighted by how much each one recorded. */
float stationField(vec2 p, float radius){
  float sum = 0.0;
  for (int i = 0; i < STATION_COUNT; i++){
    float d = distance(p, uStations[i].xz);
    sum += (1.0 - smoothstep(0.0, radius, d)) * (0.35 + uStationWeight[i] * 0.65);
  }
  return sum;
}
`;

const ROW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uIdle;
attribute float aAlong;
attribute float aRow;
varying float vGlow;
varying float vDepth;
varying float vRow;
varying float vAlong;

${SIMPLEX3}
${FBM}
${EASING}
${TERRAIN}
${STATION_UNIFORMS}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;
  pos.y = terrainHeight(pos.xz);

  // Rows breathe very slowly, like wind moving down the slope.
  pos.y += sin(pos.z * 0.28 + uTime * 0.35 + aRow * 4.0) * 0.09;

  float field = stationField(pos.xz, 13.0);
  pos.y += field * 0.55;

  vec3 world = pos;
  world += touchDisplace(world, 6.0, 1.15);
  float ripple = rippleField(world, 9.0, 2.6, 1.6);
  world.y += ripple * 1.4;

  // Rows draw on from the centre outward when the chapter opens.
  float revealFront = uReveal * 1.6 - abs(aRow - 0.5) * 0.8;
  float draw = clamp(revealFront, 0.0, 1.0);
  world.y -= (1.0 - easeOutQuart(draw)) * 6.0;

  vGlow = field + ripple * 1.5 + touchGlow(world, 6.0) * 1.2;
  vRow = aRow;
  vAlong = aAlong;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const ROW_FRAGMENT = /* glsl */ `
uniform vec3 uBone;
uniform vec3 uVine;
uniform vec3 uGold;
uniform float uReveal;
varying float vGlow;
varying float vDepth;
varying float vRow;
varying float vAlong;

void main(){
  // Aerial perspective: rows dissolve into the dark rather than ending abruptly.
  float far = 1.0 - smoothstep(30.0, 96.0, vDepth);
  float near = smoothstep(3.0, 12.0, vDepth);
  float fade = far * near;

  // Rows thin out toward the edges of the frame so the strip has no hard border.
  float edge = 1.0 - smoothstep(0.28, 0.5, abs(vRow - 0.5));
  float ends = 1.0 - smoothstep(0.3, 0.5, abs(vAlong - 0.5));

  vec3 base = mix(uVine * 0.5, uBone, 0.25);
  vec3 tint = mix(base, uGold, clamp(vGlow * 0.7, 0.0, 1.0));

  // Held well under the bright-pass threshold: the rows are structure, not a
  // light source. Only the station beacons are meant to bloom.
  float intensity = (0.042 + vGlow * 0.075) * fade * edge * ends * uReveal;
  gl_FragColor = vec4(tint * intensity * 1.6, intensity);
}
`;

const MOTE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uIdle;
uniform vec3 uGuildColors[6];
attribute float aSeed;
attribute float aPhase;
attribute float aGuild;
attribute float aWeight;
attribute float aStation;
varying vec3 vColor;
varying float vAlpha;

${SIMPLEX3}
${FBM}
${CURL}
${HASH}
${EASING}
${TERRAIN}
${STATION_UNIFORMS}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  int station = int(aStation + 0.5);
  float height = uStationHeight[0];
  for (int i = 0; i < STATION_COUNT; i++){
    if (i == station) height = uStationHeight[i];
  }

  // Each mote is released, rises, and dissipates on a loop whose offset is the
  // detection's own time of day.
  float life = fract(uTime * 0.055 + aPhase);
  float rise = easeOutQuart(life);

  float angle = aSeed * 6.2831853 + life * 3.4 + uTime * 0.08;
  float radius = mix(0.4, 4.6 + aWeight * 3.2, rise) * (0.6 + hash11(aSeed * 91.7) * 0.8);

  vec3 pos = position;
  pos.y = terrainHeight(pos.xz);
  pos += vec3(cos(angle) * radius, rise * height, sin(angle) * radius);

  // Turbulence keeps the spiral from reading as a machined helix.
  pos += curlNoise(pos * 0.07 + vec3(0.0, uTime * 0.04, 0.0)) * (0.5 + rise * 1.4);
  pos += touchDisplace(pos, 7.0, 2.4);

  float ripple = rippleField(pos, 9.0, 2.6, 1.8);
  pos.y += ripple * 2.2;

  vec3 guild = uGuildColors[int(aGuild)];
  float focused = uFocus < -0.5 ? 1.0 : (abs(uFocus - aStation) < 0.5 ? 1.0 : mix(1.0, 0.14, uFocusStrength));

  vColor = guild + vec3(0.35, 0.22, 0.08) * ripple + vec3(0.4) * touchGlow(pos, 7.0);
  // Fade in at release, out at dissipation.
  vAlpha = sin(life * 3.14159) * (0.35 + aWeight * 0.65) * uReveal * focused;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.10 + aWeight * 0.26 + ripple * 0.4, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
${SPRITE}

void main(){
  float a = spriteAlpha(gl_PointCoord, 0.85) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.48, a);
}
`;

const SHAFT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uIndex;
uniform float uHeight;
varying vec2 vUv;
varying float vFresnel;
varying float vFocus;

${STATION_UNIFORMS}

void main(){
  vUv = uv;
  vec3 pos = position;
  // A slow lean, so the shafts feel like rising air rather than geometry.
  pos.x += sin(uTime * 0.4 + uv.y * 3.0 + uIndex) * uv.y * 0.5;
  pos.z += cos(uTime * 0.31 + uv.y * 2.4 + uIndex * 2.0) * uv.y * 0.5;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec3 viewNormal = normalize(normalMatrix * normal);
  // Grazing angles glow: the shaft reads as a volume, not a tube.
  vFresnel = 1.0 - abs(dot(viewNormal, normalize(-mv.xyz)));
  vFocus = uFocus < -0.5 ? 1.0 : (abs(uFocus - uIndex) < 0.5 ? 1.0 : mix(1.0, 0.18, uFocusStrength));
  gl_Position = projectionMatrix * mv;
}
`;

const SHAFT_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIndex;
uniform float uReveal;
uniform vec3 uGold;
uniform vec3 uBone;
varying vec2 vUv;
varying float vFresnel;
varying float vFocus;

${HASH}

void main(){
  float rise = 1.0 - vUv.y;
  float falloff = pow(rise, 2.2);
  float shimmer = 0.75 + 0.25 * sin(uTime * 1.6 + vUv.y * 12.0 + uIndex * 2.1);
  float edge = pow(vFresnel, 2.0);

  float intensity = falloff * edge * shimmer * 0.55 * uReveal * vFocus;
  vec3 tint = mix(uGold, uBone, vUv.y * 0.7);
  gl_FragColor = vec4(tint * intensity * 1.05, intensity);
}
`;

const HALO_VERTEX = /* glsl */ `
uniform float uIndex;
varying vec2 vUv;
varying float vRadius;
varying float vFocus;

${STATION_UNIFORMS}

void main(){
  vUv = uv;
  vRadius = length(position.xy);
  vFocus = uFocus < -0.5 ? 1.0 : (abs(uFocus - uIndex) < 0.5 ? 1.0 : mix(1.0, 0.2, uFocusStrength));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIndex;
uniform float uReveal;
uniform float uInner;
uniform vec3 uGold;
varying vec2 vUv;
varying float vRadius;
varying float vFocus;

void main(){
  float t = clamp((vRadius - uInner) / 8.0, 0.0, 1.0);
  float glow = pow(1.0 - t, 3.0) * 0.12;

  // Two rings expanding out of the station on a slow loop.
  float pulse = fract(uTime * 0.22 + uIndex * 0.37);
  float ring = exp(-pow((t - pulse) * 6.0, 2.0)) * (1.0 - pulse) * 0.7;
  float pulse2 = fract(uTime * 0.22 + uIndex * 0.37 + 0.5);
  ring += exp(-pow((t - pulse2) * 6.0, 2.0)) * (1.0 - pulse2) * 0.45;

  float intensity = (glow + ring) * uReveal * vFocus;
  gl_FragColor = vec4(uGold * intensity * 0.55, intensity);
}
`;
