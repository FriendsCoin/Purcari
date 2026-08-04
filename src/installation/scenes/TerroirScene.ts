import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MathUtils,
  Mesh,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { CURL, EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, SPRITE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildIndex, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, maxStationTotal, points, speciesAtStation } from '../data/atlas';
import {
  basemap,
  CHATEAU,
  lonLatToScene,
  lonLatToUv,
  loadLayerTexture,
  mapExtent,
  METRES_PER_UNIT,
} from '../data/basemap';
import { elevationAtLonLat } from '../data/terrain';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Map mesh subdivision. Enough for the Mercator UVs to stay true across 5 km. */
const MAP_COLS = 32;
const MAP_ROWS = 40;

/** Camera altitude floor, in scene units (one unit is 30 m). */
const MIN_ALTITUDE = 7;

/** Where the map opens: the estate, ponds and the two busiest recorders. */
const HOME_ALTITUDE = 34;

const TAP_RADIUS = 0.08;

/** Camera tilt off vertical. Enough that the rising motes have somewhere to go. */
const TILT_DEGREES = 13;

/**
 * How far the frustum reaches across the ground, as multiples of tan(fov/2), at
 * this chapter's tilt. Half the width, how far the view runs away from the
 * camera, and how far it runs back under it — deliberately a little generous,
 * because the corners of a tilted frustum reach further than its centre line.
 *
 * The pan clamp and the zoom ceiling are both derived from these, and they have
 * to agree or the map either shows its own edge or refuses to reach it.
 */
const REACH = { side: 1.25, far: 1.55, near: 0.9 };

type Focus = { kind: 'station'; index: number } | { kind: 'chateau' } | null;

interface Marker {
  focus: Focus;
  position: Vector3;
  label: string;
}

/**
 * Chapter I — Terroir.
 *
 * The estate seen from above, on aerial imagery, with the recorders marked where
 * they actually stand. Drag to pan, pinch to zoom, tap a marker to fly to it.
 *
 * This replaced a three-dimensional rendering of the landform built from a 30 m
 * elevation model. The elevation data was correct — the ground does fall about
 * 130 m from the vineyard plateau to the river over three kilometres — but that
 * is a four percent grade, and drawing it with the seven times vertical
 * exaggeration the earlier version used turned a gentle slope into a cliff face
 * with the château perched on it. A photograph cannot misrepresent the shape of
 * the ground that way. The elevations survive as figures in the readouts, where
 * they are honest.
 *
 * The imagery also corrected the story. The recorder with 1,082 detections, more
 * than any other, sits on the two ponds in the estate park — not on the Dniester
 * floodplain three kilometres north, as the elevation model alone had suggested.
 * That is where the herons, bitterns, crakes and little bitterns come from.
 */
export class TerroirScene extends ChapterBase {
  readonly id = 'terroir' as const;
  // Less bloom and less vignette than the other chapters: the winery roofs and
  // the yard lights are genuinely blown out in the imagery, and a chapter whose
  // job is to be a map cannot afford to lose its corners or halo its buildings.
  readonly look = { exposure: 1.0, bloom: 0.32, grain: 0.02, aberration: 0.6, vignette: 0.8 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly markers: Marker[] = [];

  /** Point on the map under the centre of the screen. */
  private readonly centre = new Vector3();
  private readonly centreTarget = new Vector3();
  private altitude = HOME_ALTITUDE * 2.4;
  private altitudeTarget = HOME_ALTITUDE;

  private focus: Focus = null;
  private focusStrength = 0;
  private pinchPrevious = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;
  private scale: { metres: number; fraction: number } | undefined;

  constructor() {
    super(34);

    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = 0;

    const chateau = lonLatToScene(CHATEAU.lon, CHATEAU.lat);
    this.centre.set(chateau.x, 0, chateau.z + 2.2);
    this.centreTarget.copy(this.centre);

    this.uniforms = createUniforms(this.touch);
    this.buildMap();
    this.buildMarkers();
    this.buildMotes();

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ build --

  /**
   * The basemap as a subdivided plane. Each vertex is placed by projecting its
   * coordinate the same way the rest of the scene does, and carries the Mercator
   * texture coordinate for its own position, so imagery and data agree exactly.
   */
  private buildMap(): void {
    const { bounds } = basemap.context;
    const position: number[] = [];
    const uv: number[] = [];
    const detailUv: number[] = [];
    const index: number[] = [];

    for (let row = 0; row <= MAP_ROWS; row += 1) {
      const lat = bounds.north + (row / MAP_ROWS) * (bounds.south - bounds.north);
      for (let col = 0; col <= MAP_COLS; col += 1) {
        const lon = bounds.west + (col / MAP_COLS) * (bounds.east - bounds.west);
        const p = lonLatToScene(lon, lat);
        const c = lonLatToUv(basemap.context, lon, lat);
        const d = lonLatToUv(basemap.detail, lon, lat);
        position.push(p.x, 0, p.z);
        uv.push(c.u, c.v);
        detailUv.push(d.u, d.v);
      }
    }

    for (let row = 0; row < MAP_ROWS; row += 1) {
      for (let col = 0; col < MAP_COLS; col += 1) {
        const a = row * (MAP_COLS + 1) + col;
        const b = a + MAP_COLS + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position), 3));
    geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(uv), 2));
    geometry.setAttribute('aDetailUv', new BufferAttribute(Float32Array.from(detailUv), 2));
    geometry.setIndex(index);

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: MAP_VERTEX,
        fragmentShader: MAP_FRAGMENT,
        transparent: false,
        depthWrite: true,
        side: DoubleSide,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    this.scene.add(mesh);
  }

  /** A ground ring and a rising light for each recorder, plus one for the estate. */
  private buildMarkers(): void {
    for (const station of atlas.stations) {
      const p = lonLatToScene(station.lon, station.lat);
      this.markers.push({
        focus: { kind: 'station', index: station.id },
        position: new Vector3(p.x, 0, p.z),
        label: station.code.toUpperCase(),
      });
    }
    const chateau = lonLatToScene(CHATEAU.lon, CHATEAU.lat);
    this.markers.push({ focus: { kind: 'chateau' }, position: new Vector3(chateau.x, 0, chateau.z), label: CHATEAU.name });

    const count = this.markers.length;
    const position = new Float32Array(count * 3);
    const weight = new Float32Array(count);
    const index = new Float32Array(count);
    const isEstate = new Float32Array(count);

    this.markers.forEach((m, i) => {
      position[i * 3] = m.position.x;
      position[i * 3 + 1] = m.position.y;
      position[i * 3 + 2] = m.position.z;
      const station = m.focus?.kind === 'station' ? atlas.stations[m.focus.index] : null;
      weight[i] = station ? clamp(station.total / maxStationTotal, 0.16, 1) : 0.7;
      index[i] = i;
      isEstate[i] = m.focus?.kind === 'chateau' ? 1 : 0;
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));
    geometry.setAttribute('aIndex', new BufferAttribute(index, 1));
    geometry.setAttribute('aEstate', new BufferAttribute(isEstate, 1));

    const pins = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        ...ADDITIVE,
      })
    );
    pins.frustumCulled = false;
    pins.renderOrder = 3;
    this.scene.add(pins);
  }

  /** One mote per detection, rising from the recorder that logged it. */
  private buildMotes(): void {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const phase = new Float32Array(count);
    const guild = new Float32Array(count);
    const weight = new Float32Array(count);
    const station = new Float32Array(count);

    const sites = atlas.stations.map(s => lonLatToScene(s.lon, s.lat));

    for (let i = 0; i < count; i += 1) {
      const site = sites[points.station[i]];
      position[i * 3] = site.x;
      position[i * 3 + 1] = 0;
      position[i * 3 + 2] = site.z;
      seed[i] = (i * 0.6180339887) % 1;
      phase[i] = points.minute[i] / 1440;
      const species = atlas.species[points.species[i]];
      guild[i] = guildIndex(species.guild);
      weight[i] = clamp(Math.log2(species.count + 1) / 8, 0.25, 1);
      station[i] = points.station[i];
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));
    geometry.setAttribute('aStation', new BufferAttribute(station, 1));

    const motes = new Points(
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
    motes.frustumCulled = false;
    motes.renderOrder = 2;
    this.scene.add(motes);
  }

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.focus = null;
    this.focusStrength = 0;
    this.pinchPrevious = 0;
    const chateau = lonLatToScene(CHATEAU.lon, CHATEAU.lat);
    this.centreTarget.set(chateau.x, 0, chateau.z + 2.2);
    this.altitude = HOME_ALTITUDE * 2.4;
    this.altitudeTarget = HOME_ALTITUDE;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 1.0, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.focus = sameFocus(hit, this.focus) ? null : hit;
      if (this.focus) {
        const marker = this.markers.find(m => sameFocus(m.focus, this.focus));
        if (marker) {
          this.centreTarget.set(marker.position.x, 0, marker.position.z + this.altitudeTarget * 0.06);
          this.altitudeTarget = this.focus.kind === 'chateau' ? 11 : 13;
        }
      }
    }

    this.handleNavigation(ctx);

    this.focusStrength = damp(this.focusStrength, this.focus ? 1 : 0, 2.4, ctx.delta);
    this.uniforms.uFocus.value =
      this.focus?.kind === 'station' ? this.focus.index : this.focus?.kind === 'chateau' ? 5 : -1;
    this.uniforms.uFocusStrength.value = this.focusStrength;

    this.updateCamera(ctx);
    this.updateOverlayAnchors(ctx);
    this.refreshReadout();
  }

  /**
   * Pan and zoom, the way a map behaves: one finger drags the ground, two
   * fingers pinch. The drag is converted through the camera so a point under a
   * finger stays under it, which is what makes it feel like a map rather than
   * like a slider.
   */
  private handleNavigation(ctx: FrameContext): void {
    const active = [...ctx.pointer.touches.values()].filter(t => t.down);

    if (active.length >= 2) {
      const separation = active[0].ndc.distanceTo(active[1].ndc);
      if (this.pinchPrevious > 0.001 && separation > 0.001) {
        this.altitudeTarget = this.altitudeTarget * (this.pinchPrevious / separation);
        this.focus = null;
      }
      this.pinchPrevious = separation;
    } else {
      this.pinchPrevious = 0;

      // Wheel is the laptop stand-in for a pinch; the panel never sends one.
      const wheel = ctx.pointer.consumeWheel();
      if (wheel !== 0) {
        this.altitudeTarget *= Math.pow(0.82, wheel);
        this.focus = null;
      }

      const drag = ctx.pointer.dragWithInertia;
      if (drag.lengthSq() > 1e-9) {
        // NDC to ground units at the current altitude.
        const halfV = Math.tan(MathUtils.degToRad(this.camera.fov) / 2) * this.altitude;
        this.centreTarget.x -= drag.x * halfV * ctx.aspect;
        this.centreTarget.z += drag.y * halfV;
        this.focus = null;
      }
    }

    this.clampToMap(ctx.aspect);
  }

  /**
   * Keeps the frame inside the imagery.
   *
   * Both limits come from the same reach: the altitude may not rise past the
   * point where the frustum is wider than the map, and the centre may not travel
   * so far that an edge comes into view. When the map is narrower than the frame
   * in one axis — a very tall panel, say — the centre is pinned rather than
   * clamped to an empty range.
   */
  private clampToMap(aspect: number): void {
    const t = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);

    const byWidth = mapExtent.width / (2 * t * REACH.side * aspect);
    const byDepth = mapExtent.depth / (t * (REACH.far + REACH.near));
    this.altitudeTarget = clamp(this.altitudeTarget, MIN_ALTITUDE, Math.min(byWidth, byDepth));

    const side = t * this.altitudeTarget * REACH.side * aspect;
    const far = t * this.altitudeTarget * REACH.far;
    const near = t * this.altitudeTarget * REACH.near;

    this.centreTarget.x =
      mapExtent.width > side * 2
        ? clamp(this.centreTarget.x, mapExtent.minX + side, mapExtent.maxX - side)
        : mapExtent.centerX;
    this.centreTarget.z =
      mapExtent.depth > far + near
        ? clamp(this.centreTarget.z, mapExtent.minZ + far, mapExtent.maxZ - near)
        : mapExtent.centerZ;
  }

  /**
   * Almost overhead, with a few degrees of tilt so the rising motes have
   * somewhere to go and the map does not read as a flat texture.
   */
  private updateCamera(ctx: FrameContext): void {
    this.altitude = damp(this.altitude, this.altitudeTarget, 2.2, ctx.delta);
    this.centre.lerp(this.centreTarget, 1 - Math.exp(-2.6 * ctx.delta));

    // A very slow drift, so an untouched panel is never quite still.
    const driftX = Math.sin(ctx.time * 0.045) * this.altitude * 0.012;
    const driftZ = Math.cos(ctx.time * 0.037) * this.altitude * 0.012;

    const tilt = MathUtils.degToRad(TILT_DEGREES);
    const back = this.altitude * Math.tan(tilt);

    this.camera.position.set(
      this.centre.x + driftX + ctx.pointer.centroid.x * this.altitude * 0.02,
      this.altitude,
      this.centre.z + back + driftZ - ctx.pointer.centroid.y * this.altitude * 0.02
    );
    this.camera.lookAt(this.centre.x, 0, this.centre.z);

    this.uniforms.uAltitude.value = this.altitude;
  }

  private pick(ndcX: number, ndcY: number): Focus {
    let best: Focus = null;
    let bestDistance = TAP_RADIUS;
    for (const marker of this.markers) {
      this.probe.copy(marker.position).project(this.camera);
      if (this.probe.z > 1) continue;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = marker.focus;
      }
    }
    return best;
  }

  /** Screen anchor for the selected marker, and the scale bar length. */
  private updateOverlayAnchors(ctx: FrameContext): void {
    const marker = this.focus ? this.markers.find(m => sameFocus(m.focus, this.focus)) : undefined;
    if (marker) {
      this.probe.copy(marker.position).project(this.camera);
      this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
    } else {
      this.marker = undefined;
    }

    // A round number of metres landing near a twelfth of the screen width — the
    // bar is drawn at its true length, so it has to stay short enough to sit in
    // the masthead.
    const groundHalfWidth = Math.tan(MathUtils.degToRad(this.camera.fov) / 2) * this.altitude * ctx.aspect;
    const metresAcross = groundHalfWidth * 2 * METRES_PER_UNIT;
    const wanted = metresAcross / 12;
    const magnitude = 10 ** Math.floor(Math.log10(wanted));
    const step = [1, 2, 5, 10].map(m => m * magnitude).find(m => m >= wanted) ?? magnitude * 10;
    this.scale = { metres: step, fraction: step / metresAcross };
  }

  // ---------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = !this.focus ? 'overview' : this.focus.kind === 'chateau' ? 'chateau' : `station-${this.focus.index}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout = !this.focus
        ? this.overviewReadout()
        : this.focus.kind === 'chateau'
          ? this.chateauReadout()
          : this.stationReadout(this.focus.index);
    }
    this.cachedReadout.marker = this.marker;
    this.cachedReadout.scale = this.scale;
    return;
  }

  private overviewReadout(): Readout {
    return {
      eyebrow: 'Chapitre I',
      title: 'Terroir',
      body:
        'Cinq points d’écoute sur le domaine. Les deux plus riches se tiennent aux ' +
        'étangs du parc, à deux pas du château — c’est de là que viennent les hérons, ' +
        'les butors et les marouettes.',
      stats: [
        { label: 'Stations', value: String(atlas.meta.stationCount) },
        { label: 'Détections', value: atlas.meta.total.toLocaleString('fr-FR') },
        { label: 'Espèces', value: String(atlas.meta.speciesCount) },
      ],
      accent: PALETTE.gold,
      source: `${atlas.meta.total.toLocaleString('fr-FR')} détections · Every1Counts & BirdNET · imagerie ${basemap.attribution}`,
    };
  }

  private chateauReadout(): Readout {
    const chateau = lonLatToScene(CHATEAU.lon, CHATEAU.lat);
    const nearest = [...atlas.stations]
      .map(s => {
        const p = lonLatToScene(s.lon, s.lat);
        return { station: s, distance: Math.hypot(p.x - chateau.x, p.z - chateau.z) * METRES_PER_UNIT };
      })
      .sort((a, b) => a.distance - b.distance)[0];

    return {
      eyebrow: `Fondé en ${CHATEAU.founded}`,
      title: CHATEAU.name,
      body:
        `Le domaine et ses deux étangs. La station ${nearest.station.code.toUpperCase()}, à ` +
        `${Math.round(nearest.distance / 10) * 10} m d’ici, a enregistré plus de détections que ` +
        `toutes les autres réunies.`,
      stats: [
        { label: 'Altitude', value: `${Math.round(elevationAtLonLat(CHATEAU.lon, CHATEAU.lat))} m` },
        { label: 'Station la plus proche', value: nearest.station.code.toUpperCase() },
        { label: 'Ses détections', value: nearest.station.total.toLocaleString('fr-FR') },
        { label: 'Ses espèces', value: String(nearest.station.species) },
      ],
      accent: PALETTE.bone,
      source: `Every1Counts & BirdNET · imagerie ${basemap.attribution}`,
    };
  }

  private stationReadout(index: number): Readout {
    const station = atlas.stations[index];
    const top = speciesAtStation(index, 4);
    const elevation = Math.round(elevationAtLonLat(station.lon, station.lat));

    return {
      eyebrow: `Station ${station.code.toUpperCase()} · ${elevation} m`,
      title: `${station.total.toLocaleString('fr-FR')} détections`,
      body: top.length > 0 ? `Espèces dominantes : ${top.map(s => s.name).join(' · ')}.` : undefined,
      stats: [
        { label: 'Espèces', value: String(station.species) },
        { label: 'Altitude', value: `${elevation} m` },
        { label: 'Latitude', value: `${station.lat.toFixed(4)}°N` },
        { label: 'Longitude', value: `${station.lon.toFixed(4)}°E` },
      ],
      spark: normalise(station.hourly),
      accent: PALETTE.gold,
      source: `Every1Counts & BirdNET · imagerie ${basemap.attribution}`,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

function sameFocus(a: Focus, b: Focus): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  return a.kind === 'station' && b.kind === 'station' ? a.index === b.index : true;
}

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uAltitude: { value: HOME_ALTITUDE },
    uFocus: { value: -1 },
    uFocusStrength: { value: 0 },
    uMap: { value: loadLayerTexture(basemap.context) },
    uDetail: { value: loadLayerTexture(basemap.detail) },
    uMapMin: { value: new Vector2(mapExtent.minX, mapExtent.minZ) },
    uMapSize: { value: new Vector2(mapExtent.width, mapExtent.depth) },
    uStations: {
      value: atlas.stations.map(s => {
        const p = lonLatToScene(s.lon, s.lat);
        return new Vector3(p.x, 0, p.z);
      }),
    },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uWine: { value: color(PALETTE.wine) },
    uDusk: { value: color(PALETTE.dusk) },
    ...touch,
  };
}

function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => v / max);
}

// ------------------------------------------------------------------ shaders --

const STATION_FIELD = /* glsl */ `
#define STATION_COUNT 5
uniform vec3 uStations[STATION_COUNT];
uniform float uFocus;
uniform float uFocusStrength;

float stationField(vec2 p, float radius){
  float sum = 0.0;
  for (int i = 0; i < STATION_COUNT; i++){
    sum += 1.0 - smoothstep(0.0, radius, distance(p, uStations[i].xz));
  }
  return sum;
}

/** 1 for the selected marker, dimmed for the rest. Index 5 is the estate. */
float focusFade(float index){
  if (uFocus < -0.5) return 1.0;
  return abs(uFocus - index) < 0.5 ? 1.0 : mix(1.0, 0.28, uFocusStrength);
}
`;

const MAP_VERTEX = /* glsl */ `
attribute vec2 aDetailUv;
varying vec2 vUv;
varying vec2 vDetailUv;
varying vec3 vWorld;

void main(){
  vUv = uv;
  vDetailUv = aDetailUv;
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MAP_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uDetail;
uniform float uTime;
uniform float uReveal;
uniform float uAltitude;
uniform vec2 uMapMin;
uniform vec2 uMapSize;
uniform vec3 uGold;
uniform vec3 uBone;
uniform vec3 uWine;
varying vec2 vUv;
varying vec2 vDetailUv;
varying vec3 vWorld;

${SIMPLEX3}
${STATION_FIELD}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

/** sRGB to linear; a raw ShaderMaterial gets no automatic conversion. */
vec3 toLinear(vec3 c){
  vec3 cutoff = step(c, vec3(0.04045));
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, cutoff);
}

void main(){
  // Two levels of the same imagery. The sharp one only covers the station
  // corridor, so it is laid over the wide one and feathered out at its own
  // edges — the seam is the one place the two disagree, and thirty metres of
  // crossfade is enough to hide it at every altitude the camera can reach.
  vec3 wide = toLinear(texture2D(uMap, vUv).rgb);
  vec2 e = min(vDetailUv, 1.0 - vDetailUv);
  float inDetail = smoothstep(0.0, 0.012, min(e.x, e.y));
  vec3 photo = mix(wide, toLinear(texture2D(uDetail, clamp(vDetailUv, 0.0, 1.0)).rgb), inDetail);

  // Graded into the piece rather than shown raw: desaturated, darkened, and
  // pushed toward the cellar palette so the markers and motes are the only
  // saturated things on screen. The land still reads; it just stops competing.
  float luma = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  // Held to a warm, slightly desaturated version of itself: the ground has to
  // stay legible — this is a map, and the map is the subject — while leaving the
  // saturated end of the range to the markers and the detections.
  vec3 graded = mix(vec3(luma), photo, 0.62);
  graded = mix(graded, graded * mix(uWine * 1.4, uGold, luma) * 1.3, 0.34);
  graded *= 1.25;
  // Toe and shoulder in one: a gain of about four near black, so the woodland
  // and the vine rows keep their shape instead of blocking up, and a roll-off at
  // the top so the winery roofs — already clipped in the source — stop short of
  // driving the bloom.
  graded = graded / (graded + 0.32) * 1.32;
  graded += vec3(0.012, 0.010, 0.017) * (1.0 - luma);

  // Light from the recorders spilling onto the ground.
  float station = stationField(vWorld.xz, 1.7);
  float ripple = rippleField(vWorld, 6.0, 2.6, 1.2);
  float touch = touchGlow(vWorld, 3.0);
  graded += uGold * (station * 0.030 + ripple * 0.07) + uBone * touch * 0.035;

  // The camera is clamped so this edge should never come into frame; the fade is
  // insurance against a wide panel or a resize catching it out.
  vec2 outer = min(vUv, 1.0 - vUv);
  float border = smoothstep(0.0, 0.02, min(outer.x, outer.y));

  gl_FragColor = vec4(graded * border * uReveal, 1.0);
}
`;

const MARKER_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uAltitude;
attribute float aWeight;
attribute float aIndex;
attribute float aEstate;
varying float vWeight;
varying float vEstate;
varying float vSelected;
varying float vAlpha;

${EASING}
${STATION_FIELD}
${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vec3 pos = position;
  vWeight = aWeight;
  vEstate = aEstate;
  vSelected = uFocus < -0.5 ? 0.0 : step(abs(uFocus - aIndex), 0.5) * uFocusStrength;

  vAlpha = easeOutQuart(clamp(uReveal * 1.6 - aIndex * 0.06, 0.0, 1.0)) * focusFade(aIndex);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  // Sized in screen space, not in world units: a map pin keeps its size when you
  // zoom, otherwise it swamps the map at altitude and vanishes up close.
  float screenSize = (0.042 + aWeight * 0.055 + vSelected * 0.022) * uAltitude;
  gl_PointSize = pointSizeFor(screenSize, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MARKER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uGold;
uniform vec3 uBone;
varying float vWeight;
varying float vEstate;
varying float vSelected;
varying float vAlpha;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;

  // A dot inside a ring, with a second ring pulsing outward — the vocabulary of
  // a map pin, not of a particle.
  float dot0 = 1.0 - smoothstep(0.10, 0.17, d);
  float ring = (1.0 - smoothstep(0.024, 0.05, abs(d - 0.34))) * 0.85;
  float pulsePhase = fract(uTime * 0.45 + vWeight * 3.0);
  float pulse = (1.0 - smoothstep(0.02, 0.06, abs(d - (0.34 + pulsePhase * 0.6)))) * (1.0 - pulsePhase) * 0.55;
  float halo = exp(-d * 3.4) * 0.16;

  float mark = dot0 + ring + pulse + halo;
  vec3 tint = mix(uGold, uBone, vEstate * 0.75 + vSelected * 0.25);

  float a = mark * vAlpha * (0.72 + vSelected * 0.4);
  if (a < 0.004) discard;
  gl_FragColor = vec4(tint * a * 0.8, a);
}
`;

const MOTE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uAltitude;
uniform vec3 uGuildColors[6];
attribute float aSeed;
attribute float aPhase;
attribute float aGuild;
attribute float aWeight;
attribute float aStation;
varying vec3 vColor;
varying float vAlpha;

${SIMPLEX3}
${CURL}
${HASH}
${EASING}
${STATION_FIELD}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  // Released, rising and dissipating on a loop whose offset is the detection's
  // own time of day, so the swarm pulses with the dawn chorus.
  float life = fract(uTime * 0.055 + aPhase);
  float rise = easeOutQuart(life);

  // Everything scales with altitude so a plume reads the same at any zoom.
  float spread = uAltitude * 0.022;

  // Each detection is released from its own point on a disc rather than from the
  // exact station coordinate. A thousand sprites leaving the same pixel is a
  // white blob; released across twenty metres of ground they are a plume, and
  // the station underneath stays visible as a marker on a map.
  float birth = 0.35 + hash11(aSeed * 37.3) * 0.65;
  float angle = aSeed * 6.2831853 + life * 1.4 + uTime * 0.06;
  float radius = birth * mix(0.5, 1.0 + aWeight * 0.6, rise) * spread;

  vec3 pos = position;
  pos += vec3(cos(angle) * radius, rise * spread * (2.2 + aWeight * 3.4), sin(angle) * radius);
  pos += curlNoise(pos * 0.5 + vec3(0.0, uTime * 0.04, 0.0)) * spread * (0.15 + rise * 0.5);
  pos += touchDisplace(pos, 3.0, 0.5);

  float ripple = rippleField(pos, 6.0, 2.6, 1.2);
  pos.y += ripple * spread * 0.8;

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = guild + vec3(0.3, 0.2, 0.07) * ripple + vec3(0.3) * touchGlow(pos, 3.0);
  vAlpha = sin(life * 3.14159) * (0.10 + aWeight * 0.20) * uReveal * focusFade(aStation);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor((0.0018 + aWeight * 0.0034 + ripple * 0.006) * uAltitude, mv.z);
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
  gl_FragColor = vec4(vColor * a * 0.24, a);
}
`;
