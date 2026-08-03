import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineSegments,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Points,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { CURL, EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, SPRITE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildIndex, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, maxStationTotal, points, speciesAtStation } from '../data/atlas';
import {
  CHATEAU,
  METRES_TO_SCENE,
  VERTICAL_EXAGGERATION,
  WATER_LEVEL_METRES,
  chateauScene,
  createHeightTexture,
  elevationAt,
  elevationToY,
  groundY,
  slopeAt,
  stationSites,
  terrain,
  waterY,
} from '../data/terrain';
import { buildChateau } from './chateau';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Terrain mesh resolution. The DEM is 72 posts; this interpolates between them. */
const MESH_X = 224;
const MESH_Z = 320;

/** Contour interval in metres, and how often a heavier index contour falls. */
const CONTOUR_INTERVAL = 10;
const CONTOUR_INDEX = 50;

/** Vineyard rows only where the ground is plateau and not too steep. */
const VINE_MIN_ELEVATION = 52;
const VINE_MAX_SLOPE = 26;
const VINE_ROW_SPACING = 0.62;
const VINE_STEP = 0.5;
const VINE_AREA = { minX: -15, maxX: 23, minZ: -19, maxZ: 41 };

const TAP_RADIUS = 0.11;

type Focus = { kind: 'station'; index: number } | { kind: 'chateau' } | null;

/**
 * Chapter I — Terroir.
 *
 * The real landform, from 30 m SRTM: a vineyard plateau at about 155 m that
 * breaks and falls 150 m to the Dniester floodplain in the north. The château
 * stands at the foot of that break, and the two recorders that logged more than
 * all the others combined stand within a few hundred metres of it, down where
 * the vines meet the water. Every heron, bittern, crake and crane in the survey
 * came from those two.
 *
 * The terrain is drawn as a contour map that happens to be three-dimensional —
 * elevation lines every 10 m, a heavier one every 50 — rather than as a lit
 * surface, so the landform reads as information and the light in the scene
 * belongs to the buildings, the water and the birds.
 */
export class TerroirScene extends ChapterBase {
  readonly id = 'terroir' as const;
  readonly look = { exposure: 1.0, bloom: 0.62, grain: 0.02, aberration: 1.05, vignette: 1.08 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly chateauGroupPosition: Vector3;
  private readonly chateauRadius: number;

  private focus: Focus = null;
  private focusStrength = 0;

  /** 0 at the start of the establishing flight, 1 when it has landed. */
  private flight = 0;
  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();

  /** Camera framing the rig eases toward; focus and idle drift both move it. */
  private readonly shotTarget = new Vector3();
  private shotRadius = 66;
  private shotPhi = Math.PI * 0.315;
  private shotTheta = 0.22;

  constructor() {
    super(38);

    this.minPolar = Math.PI * 0.1;
    this.maxPolar = Math.PI * 0.48;
    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = -elevationToY(70);

    this.uniforms = createUniforms(this.touch);

    this.buildTerrain();
    this.buildWater();
    this.buildVines();
    const chateau = this.buildChateau();
    this.chateauGroupPosition = chateau.position;
    this.chateauRadius = chateau.radius;
    this.buildBeacons();
    this.buildMotes();
    this.buildMist();

    this.shotTarget.copy(this.establishingTarget());
    this.target.copy(this.shotTarget);
    this.spherical.set(this.shotRadius, this.shotPhi, this.shotTheta);
    this.desired.copy(this.spherical);

    this.cachedReadout = this.overviewReadout();
  }

  private establishingTarget(): Vector3 {
    // The middle of the escarpment, a little above the ground, so the frame holds
    // the plateau, the break of slope and the floodplain at once.
    return new Vector3(3.0, groundY(3.0, -6) + 5, -6);
  }

  // ------------------------------------------------------------------ build --

  /** The DEM as a displaced plane; the shader does the contouring. */
  private buildTerrain(): void {
    const geometry = new PlaneGeometry(terrain.width, terrain.depth, MESH_X, MESH_Z);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(terrain.centerX, 0, terrain.centerZ);

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: TERRAIN_VERTEX,
        fragmentShader: TERRAIN_FRAGMENT,
        // Opaque. The ground is the one solid thing in the piece: it has to
        // occlude the far side of a ridge, and drawing it in the opaque pass
        // also decouples its brightness from its coverage, which is what keeps
        // the contour lines under the bloom threshold instead of smearing the
        // whole escarpment into a haze.
        transparent: false,
        depthWrite: true,
        blending: NormalBlending,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    mesh.name = 'terrain';
    this.scene.add(mesh);
  }

  /** The floodplain water, masked in the shader to ground below the waterline. */
  private buildWater(): void {
    const geometry = new PlaneGeometry(terrain.width, terrain.depth, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(terrain.centerX, waterY, terrain.centerZ);

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.name = 'water';
    this.scene.add(mesh);
  }

  /**
   * Vine rows draped on the real ground, laid only where the plateau is broad
   * and gentle enough to plant — which is what puts them on the high south and
   * stops them at the break of slope, without that edge being drawn by hand.
   */
  private buildVines(): void {
    const position: number[] = [];
    const along: number[] = [];
    const row: number[] = [];

    let rowIndex = 0;
    for (let x = VINE_AREA.minX; x <= VINE_AREA.maxX; x += VINE_ROW_SPACING) {
      const rt = (x - VINE_AREA.minX) / (VINE_AREA.maxX - VINE_AREA.minX);
      let previous: [number, number, number] | null = null;
      let length = 0;

      for (let z = VINE_AREA.minZ; z <= VINE_AREA.maxZ; z += VINE_STEP) {
        const elevation = elevationAt(x, z);
        const planted = elevation > VINE_MIN_ELEVATION && slopeAt(x, z) < VINE_MAX_SLOPE;
        if (!planted) {
          previous = null;
          continue;
        }
        const current: [number, number, number] = [x, elevationToY(elevation), z];
        if (previous) {
          position.push(previous[0], previous[1], previous[2], current[0], current[1], current[2]);
          along.push(length, length + 1);
          row.push(rt, rt);
          length += 1;
        }
        previous = current;
      }
      rowIndex += 1;
    }
    void rowIndex;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position), 3));
    geometry.setAttribute('aAlong', new BufferAttribute(Float32Array.from(along), 1));
    geometry.setAttribute('aRow', new BufferAttribute(Float32Array.from(row), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VINE_VERTEX,
        fragmentShader: VINE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    lines.renderOrder = 2;
    lines.name = 'vines';
    this.scene.add(lines);
  }

  private buildChateau(): { position: Vector3; radius: number } {
    const model = buildChateau();
    const base = new Vector3(chateauScene.x, chateauScene.y, chateauScene.z);

    const mass = new Mesh(
      model.mass,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CHATEAU_MASS_VERTEX,
        fragmentShader: CHATEAU_MASS_FRAGMENT,
        transparent: true,
        depthWrite: true,
        side: DoubleSide,
        blending: NormalBlending,
      })
    );
    mass.position.copy(base);
    mass.renderOrder = 3;

    const edges = new LineSegments(
      model.edges,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CHATEAU_EDGE_VERTEX,
        fragmentShader: CHATEAU_EDGE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    edges.position.copy(base);
    edges.renderOrder = 4;

    const windowGeometry = new BufferGeometry();
    windowGeometry.setAttribute('position', new BufferAttribute(model.windows, 3));
    const seeds = new Float32Array(model.windows.length / 3);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = (i * 0.618034) % 1;
    windowGeometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));

    const windows = new Points(
      windowGeometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: WINDOW_VERTEX,
        fragmentShader: WINDOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    windows.position.copy(base);
    windows.renderOrder = 5;

    // The alley: a trunk line and a canopy sprite per tree, sat on real ground.
    const trunkPositions: number[] = [];
    const canopyPositions: number[] = [];
    const canopySize: number[] = [];
    const canopySeed: number[] = [];
    for (const [i, tree] of model.trees.entries()) {
      const x = base.x + tree.x;
      const z = base.z + tree.z;
      const y = groundY(x, z);
      trunkPositions.push(x, y, z, x, y + tree.height * 0.65, z);
      canopyPositions.push(x, y + tree.height, z);
      canopySize.push(tree.radius);
      canopySeed.push((i * 0.382) % 1);
    }

    const trunkGeometry = new BufferGeometry();
    trunkGeometry.setAttribute('position', new BufferAttribute(Float32Array.from(trunkPositions), 3));
    const trunks = new LineSegments(
      trunkGeometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: TRUNK_VERTEX,
        fragmentShader: TRUNK_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    trunks.renderOrder = 3;

    const canopyGeometry = new BufferGeometry();
    canopyGeometry.setAttribute('position', new BufferAttribute(Float32Array.from(canopyPositions), 3));
    canopyGeometry.setAttribute('aSize', new BufferAttribute(Float32Array.from(canopySize), 1));
    canopyGeometry.setAttribute('aSeed', new BufferAttribute(Float32Array.from(canopySeed), 1));
    const canopies = new Points(
      canopyGeometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CANOPY_VERTEX,
        fragmentShader: CANOPY_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    canopies.frustumCulled = false;
    canopies.renderOrder = 3;

    mass.name='mass'; edges.name='edges'; windows.name='windows'; trunks.name='trunks'; canopies.name='canopies';
    this.scene.add(mass, edges, windows, trunks, canopies);
    this.uniforms.uChateau.value.copy(base);

    return { position: base, radius: model.radius };
  }

  private buildBeacons(): void {
    const positions: Vector3[] = [];
    for (const site of stationSites) {
      const world = new Vector3(site.scene.x, site.scene.y, site.scene.z);
      positions.push(world);

      const height = shaftHeight(site.total);
      const radius = 0.35 + (site.total / maxStationTotal) * 0.9;

      const shaft = new Mesh(
        buildShaftGeometry(radius, height),
        new ShaderMaterial({
          uniforms: { ...this.uniforms, uIndex: { value: site.id } },
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
      shaft.renderOrder = 6;

      const halo = new Mesh(
        new RingGeometry(radius * 0.5, radius * 4.2 + 0.8, 64, 1),
        new ShaderMaterial({
          uniforms: { ...this.uniforms, uIndex: { value: site.id }, uInner: { value: radius * 0.5 } },
          vertexShader: HALO_VERTEX,
          fragmentShader: HALO_FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          ...ADDITIVE,
        })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.copy(world).setY(world.y + 0.06);
      halo.frustumCulled = false;
      halo.renderOrder = 6;

      shaft.name='shaft'; halo.name='halo';
      this.scene.add(shaft, halo);
    }
    this.uniforms.uStations.value = positions;
  }

  /** One mote per detection, released from its own station in clock order. */
  private buildMotes(): void {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const phase = new Float32Array(count);
    const guild = new Float32Array(count);
    const weight = new Float32Array(count);
    const station = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const site = stationSites[points.station[i]];
      position[i * 3] = site.scene.x;
      position[i * 3 + 1] = site.scene.y;
      position[i * 3 + 2] = site.scene.z;
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
    motes.renderOrder = 7;
    motes.name = 'motes';
    this.scene.add(motes);
  }

  /**
   * Mist over the floodplain. River valleys hold fog in the small hours, which is
   * exactly when the dawn chorus starts — so it is also the layer the earliest
   * detections rise through.
   */
  private buildMist(): void {
    const count = 460;
    const position = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);

    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts += 1;
      const x = terrain.minX + hash(attempts * 1.37) * terrain.width;
      const z = terrain.minZ + hash(attempts * 7.13) * terrain.depth;
      // Only in the low ground, which is where valley fog actually sits.
      if (elevationAt(x, z) > 16) continue;
      position[placed * 3] = x;
      position[placed * 3 + 1] = waterY + hash(attempts * 3.1) * 0.7;
      position[placed * 3 + 2] = z;
      size[placed] = 0.30 + hash(attempts * 9.7) * 0.85;
      seed[placed] = hash(attempts * 5.3);
      placed += 1;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position.slice(0, placed * 3), 3));
    geometry.setAttribute('aSize', new BufferAttribute(size.slice(0, placed), 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed.slice(0, placed), 1));

    const mist = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: MIST_VERTEX,
        fragmentShader: MIST_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    mist.frustumCulled = false;
    mist.renderOrder = 8;
    mist.name = 'mist';
    this.scene.add(mist);
    applyLayerDebug(this.scene);
  }

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.flight = 0;
    this.focus = null;
    this.focusStrength = 0;
    this.shotTarget.copy(this.establishingTarget());
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uIdle.value = ctx.idle;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.85, ctx.delta);
    this.flight = Math.min(1, this.flight + ctx.delta / 5.5);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.focus = sameFocus(hit, this.focus) ? null : hit;
    }

    this.focusStrength = damp(this.focusStrength, this.focus ? 1 : 0, 2.2, ctx.delta);
    this.uniforms.uFocus.value =
      this.focus?.kind === 'station' ? this.focus.index : this.focus?.kind === 'chateau' ? -2 : -1;
    this.uniforms.uFocusStrength.value = this.focusStrength;

    this.updateShot(ctx);
    this.updateCameraRig(ctx);
    this.refreshReadout();
  }

  /**
   * The camera framing. On entering, it eases down from high and far into the
   * establishing shot; left alone it drifts along a slow arc rather than spinning
   * at a constant rate; selecting something moves the whole framing to it.
   */
  private updateShot(ctx: FrameContext): void {
    let radius = 66;
    let phi = Math.PI * 0.315;
    const target = this.establishingTarget();

    if (this.focus?.kind === 'station') {
      const site = stationSites[this.focus.index];
      target.set(site.scene.x, site.scene.y + shaftHeight(site.total) * 0.4, site.scene.z);
      radius = 20;
      phi = Math.PI * 0.4;
    } else if (this.focus?.kind === 'chateau') {
      target.copy(this.chateauGroupPosition).setY(this.chateauGroupPosition.y + this.chateauRadius * 0.6);
      radius = this.chateauRadius * 3.6;
      phi = Math.PI * 0.43;
    }

    // Establishing flight: start high and distant, settle over about five seconds.
    const landed = easeOutCubic(this.flight);
    radius *= 1 + (1 - landed) * 1.15;
    phi -= (1 - landed) * Math.PI * 0.16;

    // Idle drift: a long, slow arc across the site instead of a turntable.
    const drift = Math.sin(ctx.time * 0.055) * 0.34 + Math.sin(ctx.time * 0.021) * 0.16;
    const breathe = Math.sin(ctx.time * 0.037) * 0.05;

    this.shotTarget.lerp(target, 1 - Math.exp(-1.8 * ctx.delta));
    this.shotRadius = damp(this.shotRadius, radius * (1 + breathe), 1.6, ctx.delta);
    this.shotPhi = damp(this.shotPhi, phi, 1.6, ctx.delta);
    this.shotTheta = 0.22 + drift;

    this.desiredTarget.copy(this.shotTarget);
    // The rig owns drag and inertia; the shot supplies what it relaxes back to.
    this.restSpherical.set(this.shotRadius, this.shotPhi, this.shotTheta);
    this.desired.radius = damp(this.desired.radius, this.shotRadius, 1.4, ctx.delta);
    this.desired.phi = damp(this.desired.phi, this.shotPhi, 1.1, ctx.delta);
    this.desired.theta = damp(this.desired.theta, this.shotTheta, this.focus ? 1.1 : 0.5, ctx.delta);
    this.recentres = false;
    this.idleSpin = 0;
  }

  /** Nearest station beacon or the château, within a screen-space radius. */
  private pick(ndcX: number, ndcY: number): Focus {
    let best: Focus = null;
    let bestDistance = TAP_RADIUS;

    for (const site of stationSites) {
      this.probe.set(site.scene.x, site.scene.y + shaftHeight(site.total) * 0.4, site.scene.z);
      this.probe.project(this.camera);
      if (this.probe.z > 1) continue;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { kind: 'station', index: site.id };
      }
    }

    this.probe.copy(this.chateauGroupPosition).setY(this.chateauGroupPosition.y + this.chateauRadius * 0.6);
    this.probe.project(this.camera);
    if (this.probe.z <= 1) {
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) best = { kind: 'chateau' };
    }

    return best;
  }

  // ---------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = !this.focus ? 'overview' : this.focus.kind === 'chateau' ? 'chateau' : `station-${this.focus.index}`;
    if (key === this.readoutKey) return;
    this.readoutKey = key;
    this.cachedReadout = !this.focus
      ? this.overviewReadout()
      : this.focus.kind === 'chateau'
        ? this.chateauReadout()
        : this.stationReadout(this.focus.index);
  }

  private overviewReadout(): Readout {
    return {
      eyebrow: 'Chapitre I',
      title: 'Terroir',
      body:
        'Le vignoble occupe un plateau à 155 m qui bascule de 150 m vers la plaine ' +
        'alluviale du Dniestr. Les deux stations les plus riches se tiennent au pied ' +
        'de cette rupture de pente, là où la vigne rencontre l’eau.',
      stats: [
        { label: 'Dénivelé', value: `${Math.round(terrain.maxElevation - terrain.minElevation)} m` },
        { label: 'Stations', value: String(atlas.meta.stationCount) },
        { label: 'Détections', value: atlas.meta.total.toLocaleString('fr-FR') },
        { label: 'Espèces', value: String(atlas.meta.speciesCount) },
      ],
      accent: PALETTE.gold,
    };
  }

  private chateauReadout(): Readout {
    const nearest = [...stationSites].sort(
      (a, b) =>
        Math.hypot(a.scene.x - chateauScene.x, a.scene.z - chateauScene.z) -
        Math.hypot(b.scene.x - chateauScene.x, b.scene.z - chateauScene.z)
    )[0];
    const metres = Math.round(
      (Math.hypot(nearest.scene.x - chateauScene.x, nearest.scene.z - chateauScene.z) / METRES_TO_SCENE) / 10
    ) * 10;

    return {
      eyebrow: `Fondé en ${CHATEAU.founded}`,
      title: CHATEAU.name,
      body:
        `Le domaine se tient à la rupture de pente, à ${metres} m de la station ` +
        `${nearest.code.toUpperCase()} — celle qui a enregistré le plus de détections de toute la campagne.`,
      stats: [
        { label: 'Altitude', value: `${Math.round(elevationAt(chateauScene.x, chateauScene.z))} m` },
        { label: 'Station la plus proche', value: nearest.code.toUpperCase() },
        { label: 'Ses détections', value: nearest.total.toLocaleString('fr-FR') },
        { label: 'Ses espèces', value: String(nearest.species) },
      ],
      accent: PALETTE.bone,
    };
  }

  private stationReadout(index: number): Readout {
    const site = stationSites[index];
    const top = speciesAtStation(index, 4);
    const nearWater = site.elevation < 45;

    return {
      eyebrow: `Station ${site.code.toUpperCase()} · ${Math.round(site.elevation)} m`,
      title: `${site.total.toLocaleString('fr-FR')} détections`,
      body:
        (top.length > 0 ? `Espèces dominantes : ${top.map(s => s.name).join(' · ')}. ` : '') +
        (nearWater ? 'En bas de pente, au contact de la plaine alluviale.' : 'Sur le plateau viticole.'),
      stats: [
        { label: 'Espèces', value: String(site.species) },
        { label: 'Altitude', value: `${Math.round(site.elevation)} m` },
        { label: 'Latitude', value: `${site.lat.toFixed(4)}°N` },
        { label: 'Longitude', value: `${site.lon.toFixed(4)}°E` },
      ],
      spark: normalise(site.hourly),
      accent: PALETTE.gold,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}

/** Temporary: ?hide=water,mist isolates layers while tuning shaders. */
function applyLayerDebug(scene: { traverse(cb: (o: { name: string; visible: boolean }) => void): void }): void {
  const hide = new URLSearchParams(window.location.search).get('hide');
  if (!hide) return;
  const names = new Set(hide.split(','));
  scene.traverse(o => {
    if (names.has(o.name)) o.visible = false;
  });
}

function sameFocus(a: Focus, b: Focus): boolean {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  return a.kind === 'station' && b.kind === 'station' ? a.index === b.index : true;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uIdle: { value: 0 },
    uFocus: { value: -1 },
    uFocusStrength: { value: 0 },
    uStations: { value: stationSites.map(s => new Vector3(s.scene.x, s.scene.y, s.scene.z)) },
    uChateau: { value: new Vector3() },
    uHeight: { value: createHeightTexture() },
    uTerrainMin: { value: [terrain.minX, terrain.minZ] },
    uTerrainSize: { value: [terrain.width, terrain.depth] },
    uElevationScale: { value: METRES_TO_SCENE * VERTICAL_EXAGGERATION },
    uWaterLevel: { value: WATER_LEVEL_METRES },
    uWaterY: { value: waterY },
    uContour: { value: CONTOUR_INTERVAL },
    uContourIndex: { value: CONTOUR_INDEX },
    uGuildColors: { value: guildColorArray() },
    uBone: { value: color(PALETTE.bone) },
    uVine: { value: color(PALETTE.vine) },
    uGold: { value: color(PALETTE.gold) },
    uDusk: { value: color(PALETTE.dusk) },
    uWine: { value: color(PALETTE.wine) },
    ...touch,
  };
}

/** Beacon height in scene units. Logarithmic, so 9 detections still reads. */
function shaftHeight(total: number): number {
  return 1.6 + Math.log2(total + 1) * 0.78;
}

function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => v / max);
}

function hash(n: number): number {
  const s = Math.sin(n * 43.7581) * 43758.5453;
  return s - Math.floor(s);
}

function buildShaftGeometry(radius: number, height: number): BufferGeometry {
  const radial = 28;
  const rings = 12;
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  for (let y = 0; y <= rings; y += 1) {
    const v = y / rings;
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

/** Height lookup shared by everything that has to sit on the ground. */
const TERRAIN_SAMPLER = /* glsl */ `
uniform sampler2D uHeight;
uniform vec2 uTerrainMin;
uniform vec2 uTerrainSize;
uniform float uElevationScale;
uniform float uWaterLevel;

vec2 terrainUv(vec2 xz){
  return (xz - uTerrainMin) / uTerrainSize;
}

/** Elevation in metres. */
float elevationAt(vec2 xz){
  return texture2D(uHeight, terrainUv(xz)).r;
}

float groundY(vec2 xz){
  return elevationAt(xz) * uElevationScale;
}
`;

const STATION_FIELD = /* glsl */ `
#define STATION_COUNT 5
uniform vec3 uStations[STATION_COUNT];
uniform vec3 uChateau;
uniform float uFocus;
uniform float uFocusStrength;

/** Falls off from each recorder, in plan. */
float stationField(vec2 p, float radius){
  float sum = 0.0;
  for (int i = 0; i < STATION_COUNT; i++){
    sum += 1.0 - smoothstep(0.0, radius, distance(p, uStations[i].xz));
  }
  return sum;
}

/** 1 when this object is the selected one, dimming otherwise. */
float focusFade(float index){
  if (uFocus < -1.5) return mix(1.0, 0.22, uFocusStrength);   // château selected
  if (uFocus < -0.5) return 1.0;                              // nothing selected
  return abs(uFocus - index) < 0.5 ? 1.0 : mix(1.0, 0.16, uFocusStrength);
}
`;

const TERRAIN_VERTEX = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vElevation;
varying float vSlope;

${TERRAIN_SAMPLER}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;
  float elevation = elevationAt(pos.xz);
  pos.y = elevation * uElevationScale;

  // Central-difference gradient, in metres of elevation per scene unit. The
  // fragment shader needs it to keep contour lines an even width on any slope.
  float step = uTerrainSize.x / 220.0;
  float ex = elevationAt(pos.xz + vec2(step, 0.0)) - elevationAt(pos.xz - vec2(step, 0.0));
  float ez = elevationAt(pos.xz + vec2(0.0, step)) - elevationAt(pos.xz - vec2(0.0, step));
  vSlope = length(vec2(ex, ez)) / (2.0 * step);

  float ripple = rippleField(pos, 14.0, 2.6, 2.6);
  pos.y += ripple * 0.9;
  pos += touchDisplace(pos, 7.0, 0.5);

  vWorld = pos;
  vElevation = elevation;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const TERRAIN_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uContour;
uniform float uContourIndex;
uniform vec3 uBone;
uniform vec3 uGold;
uniform vec3 uVine;
uniform vec3 uDusk;
uniform vec3 uWine;
varying vec3 vWorld;
varying float vElevation;
varying float vSlope;

${SIMPLEX3}
${TERRAIN_SAMPLER}
${STATION_FIELD}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

/**
 * One contour band. The width is derived from the local gradient rather than
 * from screen derivatives, so lines stay even where the escarpment is steep and
 * do not smear into a wash where the plateau is flat.
 */
float contour(float elevation, float interval, float slope, float widthScenceUnits){
  float f = fract(elevation / interval);
  float d = min(f, 1.0 - f);
  // Capped so the escarpment, where the lines bunch, resolves into a glow
  // rather than a moire of overlapping bands.
  // Capped tight: where the escarpment bunches the lines they should merge
  // into a dense hatch, never into a solid band.
  float w = clamp(slope * widthScenceUnits / interval, 0.010, 0.085);
  return 1.0 - smoothstep(w * 0.55, w, d);
}

void main(){
  // --- surface -------------------------------------------------------------
  // Cool in the floodplain, warmer on the planted plateau. This is the only
  // place the two halves of the site are separated by colour, and it is what
  // makes the break of slope legible from across a room.
  float plateau = smoothstep(30.0, 90.0, vElevation);
  vec3 base = mix(uDusk * 0.055, mix(uVine, uWine, 0.45) * 0.05, plateau);

  // A faint grain in the surface so the large flat areas are not dead.
  float grain = snoise(vec3(vWorld.xz * 0.35, uTime * 0.02)) * 0.5 + 0.5;
  base *= 0.75 + grain * 0.5;

  // --- contours ------------------------------------------------------------
  float minor = contour(vElevation, uContour, vSlope, 0.10);
  float major = contour(vElevation, uContourIndex, vSlope, 0.30);

  vec3 lineColor = mix(mix(uDusk, uBone, 0.3) * 0.5, uGold, plateau * 0.7);
  float lines = minor * 0.15 + major * 0.38;

  // --- light in the scene --------------------------------------------------
  float station = stationField(vWorld.xz, 9.0);
  float chateau = 1.0 - smoothstep(0.0, 7.0, distance(vWorld.xz, uChateau.xz));
  float ripple = rippleField(vWorld, 14.0, 2.6, 2.6);
  float touch = touchGlow(vWorld, 7.0);

  vec3 lit = base + lineColor * lines;
  lit += uGold * (station * 0.055 + chateau * 0.075);
  lit += uGold * ripple * 0.12 + uBone * touch * 0.07;

  // The waterline itself, picked out as a shore.
  float shore = 1.0 - smoothstep(0.0, 3.5, abs(vElevation - uWaterLevel));
  lit += uDusk * shore * 0.20;

  // --- depth ---------------------------------------------------------------
  // Aerial perspective as a fade to black rather than to transparency, so the
  // surface stays a solid occluder all the way to the horizon.
  float depth = length(vWorld - cameraPosition);
  float haze = 1.0 - smoothstep(55.0, 190.0, depth);

  // The DEM is a rectangle and would otherwise end in four hard straight cuts.
  // Falling to black at the border lets it disappear into the dark instead.
  vec2 uvT = terrainUv(vWorld.xz);
  vec2 edge = min(uvT, 1.0 - uvT);
  float border = smoothstep(0.0, 0.075, min(edge.x, edge.y));

  gl_FragColor = vec4(lit * haze * border * uReveal, 1.0);
}
`;

const WATER_VERTEX = /* glsl */ `
varying vec3 vWorld;

void main(){
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uDusk;
uniform vec3 uBone;
uniform vec3 uGold;
varying vec3 vWorld;

${SIMPLEX3}
${TERRAIN_SAMPLER}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  // Only where the real ground is below the waterline; the shoreline is the
  // DEM's, not a drawn shape.
  //
  // Sampled here rather than in the vertex shader: the water is a single quad,
  // so a varying would interpolate the ground height between its four corners
  // and flood the entire map instead of the floodplain.
  float ground = elevationAt(vWorld.xz);
  float wet = 1.0 - smoothstep(uWaterLevel - 1.0, uWaterLevel + 2.0, ground);
  if (wet < 0.01) discard;

  // Two noise fields at different speeds read as a slow current.
  float a = snoise(vec3(vWorld.xz * 0.30 + vec2(uTime * 0.05, 0.0), uTime * 0.05));
  float b = snoise(vec3(vWorld.xz * 0.75 - vec2(0.0, uTime * 0.09), uTime * 0.08));
  float surface = a * 0.6 + b * 0.4;

  // Specular filaments where the surface tilts toward the light. Kept far below
  // the bloom threshold: the shoreline the DEM draws here is the real braid of
  // Dniester channels, and at full strength it read as snow rather than water.
  float glint = pow(max(surface, 0.0), 6.0) * 0.30;
  float sheen = smoothstep(0.15, 0.85, surface * 0.5 + 0.5) * 0.035;

  float ripple = rippleField(vWorld, 14.0, 2.6, 2.6);
  float touch = touchGlow(vWorld, 8.0);

  vec3 tint = mix(uDusk * 0.7, mix(uDusk, uBone, 0.5), glint);
  vec3 lit = tint * (sheen + glint * 0.35) + uGold * (ripple * 0.18 + touch * 0.12);

  float depth = length(vWorld - cameraPosition);
  float haze = 1.0 - smoothstep(45.0, 175.0, depth);

  vec2 uvT = terrainUv(vWorld.xz);
  vec2 edgeUv = min(uvT, 1.0 - uvT);
  float border = smoothstep(0.0, 0.075, min(edgeUv.x, edgeUv.y));

  float intensity = wet * haze * border * uReveal;
  gl_FragColor = vec4(lit * intensity, intensity);
}
`;

const VINE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aAlong;
attribute float aRow;
varying float vGlow;
varying float vDepth;
varying float vRow;

${SIMPLEX3}
${EASING}
${TERRAIN_SAMPLER}
${STATION_FIELD}
${TOUCH_UNIFORMS}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  // A hand's breadth above the ground so the rows are not z-fighting the terrain.
  pos.y += 0.045;
  pos.y += sin(pos.z * 0.5 + uTime * 0.4 + aRow * 7.0) * 0.02;

  pos += touchDisplace(pos, 6.0, 0.7);
  float ripple = rippleField(pos, 14.0, 2.6, 2.4);
  pos.y += ripple * 0.7;

  // Rows draw on outward from the middle of the block when the chapter opens.
  float draw = clamp(uReveal * 1.7 - abs(aRow - 0.5) * 0.9, 0.0, 1.0);
  pos.y -= (1.0 - easeOutQuart(draw)) * 2.5;

  vGlow = stationField(pos.xz, 9.0) + ripple * 1.4 + touchGlow(pos, 6.0);
  vRow = aRow;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const VINE_FRAGMENT = /* glsl */ `
uniform vec3 uVine;
uniform vec3 uGold;
uniform float uReveal;
varying float vGlow;
varying float vDepth;
varying float vRow;

void main(){
  float far = 1.0 - smoothstep(40.0, 130.0, vDepth);
  float near = smoothstep(2.0, 9.0, vDepth);
  vec3 tint = mix(uVine * 1.4, uGold, clamp(vGlow * 0.5, 0.0, 1.0));
  float intensity = (0.075 + vGlow * 0.09) * far * near * uReveal;
  gl_FragColor = vec4(tint * intensity * 1.5, intensity);
}
`;

const CHATEAU_MASS_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main(){
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const CHATEAU_MASS_FRAGMENT = /* glsl */ `
uniform float uReveal;
uniform vec3 uWine;
uniform vec3 uGold;
varying vec3 vNormal;
varying vec3 vWorld;

void main(){
  // Near-black solid whose only job is to occlude the contours behind it, with
  // a faint rim so the volume is still legible against the dark ground.
  vec3 view = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(normalize(vNormal), view)), 3.0);
  vec3 lit = uWine * 0.055 + uGold * rim * 0.14;
  gl_FragColor = vec4(lit * uReveal, (0.82 + rim * 0.18) * uReveal);
}
`;

const CHATEAU_EDGE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aSeed;
varying float vGlow;
varying float vDepth;

${HASH}
${EASING}
${STATION_FIELD}
${TOUCH_UNIFORMS}

void main(){
  vec3 pos = position;
  vec3 world = (modelMatrix * vec4(pos, 1.0)).xyz;

  // The outline is traced on rather than faded up: edges arrive in a sequence
  // keyed off their index, which reads as the building being drawn.
  float order = hash11(aSeed * 0.37);
  float trace = clamp(uReveal * 1.9 - order * 0.8, 0.0, 1.0);

  vGlow = easeOutQuart(trace) * (0.6 + 0.4 * focusFade(-2.0) * 2.0) + touchGlow(world, 5.0) * 0.6;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const CHATEAU_EDGE_FRAGMENT = /* glsl */ `
uniform vec3 uGold;
uniform vec3 uBone;
uniform float uReveal;
varying float vGlow;
varying float vDepth;

void main(){
  float far = 1.0 - smoothstep(50.0, 150.0, vDepth);
  vec3 tint = mix(uGold, uBone, 0.3);
  float intensity = vGlow * 0.34 * far * uReveal;
  gl_FragColor = vec4(tint * intensity * 1.8, intensity);
}
`;

const WINDOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aSeed;
varying float vAlpha;

${HASH}
${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vec3 pos = position;
  // Windows come on at their own pace and flicker like lamps, not like LEDs.
  float lit = step(0.25, hash11(aSeed * 13.7 + floor(uTime * 0.09)));
  float flicker = 0.75 + 0.25 * sin(uTime * (1.4 + aSeed * 2.0) + aSeed * 31.0);
  vAlpha = lit * flicker * uReveal;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.10, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const WINDOW_FRAGMENT = /* glsl */ `
uniform vec3 uGold;
varying float vAlpha;
${SPRITE}

void main(){
  float a = spriteAlpha(gl_PointCoord, 0.7) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uGold, vec3(1.0, 0.86, 0.6), 0.5) * a * 0.8, a);
}
`;

const TRUNK_VERTEX = /* glsl */ `
uniform float uReveal;
varying float vDepth;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const TRUNK_FRAGMENT = /* glsl */ `
uniform vec3 uVine;
uniform float uReveal;
varying float vDepth;
void main(){
  float far = 1.0 - smoothstep(40.0, 120.0, vDepth);
  float intensity = 0.09 * far * uReveal;
  gl_FragColor = vec4(uVine * intensity * 1.6, intensity);
}
`;

const CANOPY_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aSize;
attribute float aSeed;
varying float vAlpha;

${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vec3 pos = position;
  // The alley sways; poplars never stand still.
  pos.x += sin(uTime * 0.55 + aSeed * 20.0) * 0.06;
  pos.z += cos(uTime * 0.43 + aSeed * 14.0) * 0.05;
  pos += touchDisplace(pos, 5.0, 0.6);

  vAlpha = uReveal * (0.55 + 0.45 * sin(uTime * 0.7 + aSeed * 9.0));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(aSize * 2.2, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const CANOPY_FRAGMENT = /* glsl */ `
uniform vec3 uVine;
varying float vAlpha;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  // Hollow, so the canopy reads as foliage rather than a ball of light.
  float shell = smoothstep(1.0, 0.72, d) * smoothstep(0.15, 0.55, d);
  float a = shell * vAlpha * 0.16;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uVine * a * 1.7, a);
}
`;

const SHAFT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uIndex;
varying vec2 vUv;
varying float vFresnel;
varying float vFocus;

${STATION_FIELD}

void main(){
  vUv = uv;
  vec3 pos = position;
  pos.x += sin(uTime * 0.4 + uv.y * 3.0 + uIndex) * uv.y * 0.35;
  pos.z += cos(uTime * 0.31 + uv.y * 2.4 + uIndex * 2.0) * uv.y * 0.35;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec3 viewNormal = normalize(normalMatrix * normal);
  vFresnel = 1.0 - abs(dot(viewNormal, normalize(-mv.xyz)));
  vFocus = focusFade(uIndex);
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

void main(){
  float falloff = pow(1.0 - vUv.y, 2.2);
  float shimmer = 0.75 + 0.25 * sin(uTime * 1.6 + vUv.y * 12.0 + uIndex * 2.1);
  float edge = pow(vFresnel, 2.0);
  float intensity = falloff * edge * shimmer * 0.5 * uReveal * vFocus;
  gl_FragColor = vec4(mix(uGold, uBone, vUv.y * 0.7) * intensity * 1.1, intensity);
}
`;

const HALO_VERTEX = /* glsl */ `
uniform float uIndex;
varying float vRadius;
varying float vFocus;

${STATION_FIELD}

void main(){
  vRadius = length(position.xy);
  vFocus = focusFade(uIndex);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uIndex;
uniform float uReveal;
uniform float uInner;
uniform vec3 uGold;
varying float vRadius;
varying float vFocus;

void main(){
  float t = clamp((vRadius - uInner) / 6.0, 0.0, 1.0);
  float glow = pow(1.0 - t, 3.0) * 0.04;

  float pulse = fract(uTime * 0.22 + uIndex * 0.37);
  float ring = exp(-pow((t - pulse) * 6.0, 2.0)) * (1.0 - pulse) * 0.5;
  float pulse2 = fract(uTime * 0.22 + uIndex * 0.37 + 0.5);
  ring += exp(-pow((t - pulse2) * 6.0, 2.0)) * (1.0 - pulse2) * 0.32;

  float intensity = (glow + ring) * uReveal * vFocus;
  gl_FragColor = vec4(uGold * intensity * 0.34, intensity);
}
`;

const MOTE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
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
${TERRAIN_SAMPLER}
${STATION_FIELD}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  // Released, rising and dissipating on a loop whose offset is the detection's
  // own time of day, so the swarm pulses with the dawn chorus.
  float life = fract(uTime * 0.055 + aPhase);
  float rise = easeOutQuart(life);

  float angle = aSeed * 6.2831853 + life * 3.4 + uTime * 0.08;
  float radius = mix(0.2, 1.6 + aWeight * 1.4, rise) * (0.6 + hash11(aSeed * 91.7) * 0.8);

  vec3 pos = position;
  pos += vec3(cos(angle) * radius, rise * (2.0 + aWeight * 4.5), sin(angle) * radius);

  pos += curlNoise(pos * 0.12 + vec3(0.0, uTime * 0.04, 0.0)) * (0.25 + rise * 0.8);
  pos += touchDisplace(pos, 6.0, 1.4);

  float ripple = rippleField(pos, 14.0, 2.6, 2.4);
  pos.y += ripple * 1.2;

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = guild + vec3(0.3, 0.2, 0.07) * ripple + vec3(0.32) * touchGlow(pos, 6.0);
  vAlpha = sin(life * 3.14159) * (0.35 + aWeight * 0.65) * uReveal * focusFade(aStation);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.055 + aWeight * 0.13 + ripple * 0.2, mv.z);
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
  gl_FragColor = vec4(vColor * a * 0.55, a);
}
`;

const MIST_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aSize;
attribute float aSeed;
varying float vAlpha;

${SIMPLEX3}
${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vec3 pos = position;
  // Drifting downstream, very slowly, and breathing in thickness.
  pos.x += sin(uTime * 0.045 + aSeed * 30.0) * 1.6;
  pos.z += uTime * 0.05 + sin(uTime * 0.03 + aSeed * 12.0) * 1.2;
  pos.y += sin(uTime * 0.12 + aSeed * 18.0) * 0.25;
  pos += touchDisplace(pos, 10.0, 2.2);

  float breathe = 0.5 + 0.5 * sin(uTime * 0.09 + aSeed * 25.0);
  vAlpha = (0.04 + breathe * 0.08) * uReveal;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(aSize * (0.7 + breathe * 0.5), mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MIST_FRAGMENT = /* glsl */ `
uniform vec3 uDusk;
uniform vec3 uBone;
varying float vAlpha;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float soft = exp(-d * d * 2.4);
  float a = soft * vAlpha * 0.5;
  if (a < 0.002) discard;
  gl_FragColor = vec4(mix(uDusk, uBone, 0.35) * a * 1.2, a);
}
`;
