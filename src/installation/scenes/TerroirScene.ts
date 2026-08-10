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
import { CURL, EASING, HASH, RAMP3, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, SPRITE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildCss, guildIndex, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { ChapterId, FrameContext, Readout } from '../engine/Scene';
import { atlas, maxStationTotal, points, speciesAtStation } from '../data/atlas';
import { passages, type PassageSpecies } from '../data/passages';
import { figure, type FigureId } from './figures';
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

/**
 * The listening post.
 *
 * Touching a recorder does not just frame it — it drops the camera to about
 * eighty metres above the ground at that exact spot and unfolds the station's
 * own record around it, standing on the imagery of the ground it was recorded
 * from. One scene unit is thirty metres, so the instrument below is roughly a
 * hundred metres across: the size of the clearing a recorder actually listens
 * over, not a diagram floating in space.
 */
const POST_ALTITUDE = 3.4;
const POST_RADIUS = 1.85;
/**
 * Lean, not horizon. Past about forty degrees the frame stops being the clearing
 * the recorder listens over and becomes the next village, and the instrument —
 * a hundred and fifty metres across — turns into a speck on a landscape.
 */
const POST_TILT_DEGREES = 38;
const POST_BEADS = 9;

/** Filaments a post shows. Beyond this the ring becomes a hedge. */
const POST_SPECIES_LIMIT = 34;

const POST_TAP_RADIUS = 0.075;

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

type Focus =
  | { kind: 'station'; index: number }
  | { kind: 'chateau' }
  | { kind: 'zone'; index: number }
  | { kind: 'camera'; index: number }
  | null;

/**
 * The map as the way in.
 *
 * Every other chapter is reached from the list down the side, which is a menu
 * bolted to an artwork. These are the same chapters standing on the ground they
 * are about: touch the plot, read what it opens, open it. The places are chosen
 * for what each chapter is of — the ponds for the birds that live on them, the
 * plateau blocks for the ones that cross them — and they are laid on the
 * vineyard between the château and the southern posts, where there is room.
 */
const ZONES: { id: ChapterId; label: string; note: string; lon: number; lat: number }[] = [
  {
    id: 'circadian',
    label: 'Circadien',
    note: 'Le jour du domaine, heure par heure : vingt-quatre lames debout sur le vrai lever et le vrai coucher du soleil d’ici.',
    lon: 29.8663,
    lat: 46.52806,
  },
  {
    id: 'species',
    label: 'Espèces',
    note: 'Les 121 espèces entendues, tenues ensemble par leurs rythmes — et les mêmes espèces rangées autrement, pour voir ce que chaque classement coûte.',
    lon: 29.869596,
    lat: 46.526344,
  },
  {
    id: 'flux',
    label: 'Flux',
    note: 'Les dix-sept jours du relevé acoustique, du 31 juillet au 16 août, comme une rivière qui s’amincit.',
    lon: 29.874141,
    lat: 46.526323,
  },
  {
    id: 'overlap',
    label: 'Chevauchement',
    note: 'Les dix-huit espèces des pièges photo et les heures qu’elles partagent ou qu’elles s’évitent.',
    lon: 29.877492,
    lat: 46.528006,
  },
  {
    id: 'passages',
    label: 'Passages',
    note: 'Quatre-vingts nuits en quatre-vingts lignes : les 367 animaux passés devant un piège, à la minute près.',
    lon: 29.877848,
    lat: 46.530491,
  },
  {
    id: 'status',
    label: 'Livre rouge',
    note: 'Les douze espèces protégées trouvées ici, debout sur le domaine, et le reste de la Carte Rouge au loin.',
    lon: 29.875019,
    lat: 46.532441,
  },
  {
    id: 'call',
    label: 'L’appel',
    note: 'Le chœur autour de vous : visez une espèce du téléphone et elle se rassemble, puis elle parle.',
    lon: 29.870524,
    lat: 46.53281,
  },
];

/** One species as it was heard at one station. */
interface PostSpecies {
  /** Index into atlas.species. */
  species: number;
  /** Detections of it at this station — not its total across the survey. */
  count: number;
  /** Circular mean of the hours it was heard at, here. */
  meanHour: number;
  /** Where its filament stands, for picking and for the marker. */
  position: Vector3;
}

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
  private readonly zones: { id: ChapterId; label: string; note: string; position: Vector3 }[] = [];

  /**
   * The camera-trap dive. Tapping a diamond falls to the trap and raises a
   * theatre of everything it photographed: each species as its guild silhouette
   * drawing itself in around the instrument, each of its passings a spark on a
   * 24-hour ring on the ground. Three numbers of text; the rest is figures.
   */
  private trap: number | null = null;
  private trapSpecies: number | null = null;
  private trapElapsed = 0;
  private trapTheatre: Points[] = [];
  private trapCast: { species: PassageSpecies; here: number; anchor: Vector3 }[] = [];
  private navigate: ((id: ChapterId) => void) | null = null;
  private focusStrength = 0;
  private pinchPrevious = 0;

  /** The station whose post is open, or null while the map is the whole chapter. */
  private post: number | null = null;
  private postStrength = 0;
  private postOrbit = 0;
  private postOrbitTarget = 0;
  /** Index into postList[post] — the filament being held. */
  private postSpecies: number | null = null;
  private postSelectStrength = 0;
  /** Altitude the map was left at, restored on the way back up. */
  private mapAltitude = HOME_ALTITUDE;

  /** Every species each station heard, as that station heard it. */
  private readonly postList: PostSpecies[][] = [];

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
    this.buildPostList();
    this.buildPostDial();
    this.buildPostFilaments();

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

    // The camera traps. Most stand beside an acoustic recorder — the surveys
    // paired their deployments — so each mark is stepped eighteen metres east
    // of its true point, the way a cartographer offsets a label, or the two
    // instruments would be a single unpickable dot.
    passages.cameras.forEach((camera, i) => {
      const c = lonLatToScene(camera.lon, camera.lat);
      this.markers.push({
        focus: { kind: 'camera', index: i },
        position: new Vector3(c.x + 0.6, 0, c.z),
        label: camera.code,
      });
    });

    // The chapters, standing on the estate. They join the markers so that
    // picking, framing and the selection ring all treat them like any other
    // place on the map.
    ZONES.forEach((zone, i) => {
      const p = lonLatToScene(zone.lon, zone.lat);
      const position = new Vector3(p.x, 0, p.z);
      this.zones.push({ id: zone.id, label: zone.label, note: zone.note, position });
      this.markers.push({ focus: { kind: 'zone', index: i }, position, label: zone.label });
    });

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
      isEstate[i] =
        m.focus?.kind === 'chateau' ? 1 : m.focus?.kind === 'zone' ? 2 : m.focus?.kind === 'camera' ? 3 : 0;
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

  // ------------------------------------------------------------------- post --

  /**
   * What each station heard, from its own detections.
   *
   * The atlas carries a species' total across the survey and the list of
   * stations that heard it, but not how many times each one did — and that is
   * exactly what a post is about. Two thousand six hundred rows is nothing to
   * walk once at boot, so it is counted here rather than baked, and the hours
   * are averaged on the circle: a bird heard at 23:00 and at 01:00 peaks at
   * midnight, not at noon.
   */
  private buildPostList(): void {
    const tally = atlas.stations.map(() => new Map<number, { n: number; sx: number; sy: number }>());

    for (let i = 0; i < points.count; i += 1) {
      const station = points.station[i];
      const species = points.species[i];
      let entry = tally[station].get(species);
      if (!entry) {
        entry = { n: 0, sx: 0, sy: 0 };
        tally[station].set(species, entry);
      }
      const angle = (points.minute[i] / 1440) * Math.PI * 2;
      entry.n += 1;
      entry.sx += Math.cos(angle);
      entry.sy += Math.sin(angle);
    }

    atlas.stations.forEach((station, s) => {
      const site = lonLatToScene(station.lon, station.lat);
      const list = [...tally[s].entries()]
        .map(([species, e]) => ({
          species,
          count: e.n,
          meanHour: (((Math.atan2(e.sy, e.sx) / (Math.PI * 2)) * 24 + 24) % 24),
          position: new Vector3(),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, POST_SPECIES_LIMIT);

      const loudest = list[0]?.count ?? 1;
      list.forEach((entry, i) => {
        // Angle is when it was heard, so the dawn chorus gathers on one side of
        // the post and the owls on the other — the same clock as every other
        // chapter. Radius is rank, so the loudest stand nearest the recorder.
        const angle = Math.PI / 2 - (entry.meanHour / 24) * Math.PI * 2;
        const radius = POST_RADIUS * (0.46 + (i / Math.max(1, list.length - 1)) * 0.54);
        entry.position.set(
          site.x + Math.cos(angle) * radius,
          (Math.log(entry.count + 1) / Math.log(loudest + 1)) * POST_RADIUS * 1.03,
          site.z - Math.sin(angle) * radius
        );
      });

      this.postList.push(list);
    });
  }

  /**
   * The station's own twenty-four hours, engraved on the ground around it.
   *
   * Every post gets its own rhythm rather than the survey's: ct47 at the ponds
   * spikes through the night, the plateau recorders do not.
   */
  private buildPostDial(): void {
    const position: number[] = [];
    const station: number[] = [];
    const along: number[] = [];
    const share: number[] = [];
    const hour: number[] = [];

    atlas.stations.forEach((entry, s) => {
      const site = lonLatToScene(entry.lon, entry.lat);
      const peak = Math.max(...entry.hourly, 1);

      for (let h = 0; h < 24; h += 1) {
        const length = POST_RADIUS * (0.12 + Math.pow(entry.hourly[h] / peak, 0.7) * 0.54);
        const a0 = Math.PI / 2 - ((h + 0.12) / 24) * Math.PI * 2;
        const a1 = Math.PI / 2 - ((h + 0.88) / 24) * Math.PI * 2;
        const inner = POST_RADIUS * 0.24;

        const corner = (angle: number, radius: number): [number, number] => [
          site.x + Math.cos(angle) * radius,
          site.z - Math.sin(angle) * radius,
        ];

        const [x0i, z0i] = corner(a0, inner);
        const [x1i, z1i] = corner(a1, inner);
        const [x0o, z0o] = corner(a0, inner + length);
        const [x1o, z1o] = corner(a1, inner + length);

        const quad: [number, number, number][] = [
          [x0i, z0i, 0],
          [x1i, z1i, 0],
          [x1o, z1o, 1],
          [x0i, z0i, 0],
          [x1o, z1o, 1],
          [x0o, z0o, 1],
        ];
        for (const [x, z, t] of quad) {
          position.push(x, 0.012, z);
          station.push(s);
          along.push(t);
          share.push(entry.hourly[h] / peak);
          hour.push(h);
        }
      }
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aStation', new BufferAttribute(new Float32Array(station), 1));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
    geometry.setAttribute('aShare', new BufferAttribute(new Float32Array(share), 1));
    geometry.setAttribute('aHour', new BufferAttribute(new Float32Array(hour), 1));

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DIAL_VERTEX,
        fragmentShader: DIAL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
  }

  /** One filament per species the station heard, standing where it was heard. */
  private buildPostFilaments(): void {
    const position: number[] = [];
    const station: number[] = [];
    const local: number[] = [];
    const guild: number[] = [];
    const up: number[] = [];
    const weight: number[] = [];

    this.postList.forEach((list, s) => {
      const loudest = list[0]?.count ?? 1;
      list.forEach((entry, i) => {
        const species = atlas.species[entry.species];
        const beads = Math.max(3, Math.round((entry.count / loudest) * POST_BEADS) + 2);
        for (let b = 0; b < beads; b += 1) {
          const t = b / (beads - 1);
          position.push(entry.position.x, 0.02 + t * entry.position.y, entry.position.z);
          station.push(s);
          local.push(i);
          guild.push(guildIndex(species.guild));
          up.push(t);
          weight.push(entry.count / loudest);
        }
      });
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aStation', new BufferAttribute(new Float32Array(station), 1));
    geometry.setAttribute('aLocal', new BufferAttribute(new Float32Array(local), 1));
    geometry.setAttribute('aGuild', new BufferAttribute(new Float32Array(guild), 1));
    geometry.setAttribute('aUp', new BufferAttribute(new Float32Array(up), 1));
    geometry.setAttribute('aWeight', new BufferAttribute(new Float32Array(weight), 1));

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
    cloud.renderOrder = 5;
    this.scene.add(cloud);
  }

  /** Drops into a station's post, from wherever the map happens to be. */
  setNavigator(go: (id: ChapterId) => void): void {
    this.navigate = go;
  }

  /** The chip under a zone's name: the second touch, which opens it. */
  setMode(id: string): void {
    if (id !== 'open' || this.focus?.kind !== 'zone') return;
    const zone = this.zones[this.focus.index];
    this.focus = null;
    this.navigate?.(zone.id);
  }

  private enterTrap(index: number): void {
    const camera = passages.cameras[index];
    const site = lonLatToScene(camera.lon, camera.lat);
    this.mapAltitude = this.altitudeTarget;
    this.altitudeTarget = POST_ALTITUDE;
    this.trap = index;
    this.trapSpecies = null;
    this.trapElapsed = 0;
    this.centreTarget.set(site.x, 0, site.z);
    this.focus = { kind: 'camera', index };
    this.buildTrapTheatre(index, site.x, site.z);
  }

  private leaveTrap(): void {
    this.trap = null;
    this.trapSpecies = null;
    this.altitudeTarget = this.mapAltitude;
    for (const mesh of this.trapTheatre) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    }
    this.trapTheatre = [];
    this.trapCast = [];
  }

  /** Everything this trap saw, staged around it. Built fresh on each dive. */
  private buildTrapTheatre(index: number, cx: number, cz: number): void {
    // Who, and how often *here* — counted from the per-event record, because a
    // species' total is not this camera's total.
    const byHere = passages.species
      .map(species => ({ species, here: 0 }))
      .filter(entry => entry.species.cameras.includes(index));
    const speciesIndex = new Map(passages.species.map((sp, i) => [i, sp]));
    const counts = new Map<number, number>();
    for (let e = 0; e < passages.events.species.length; e += 1) {
      if (passages.events.camera[e] !== index) continue;
      counts.set(passages.events.species[e], (counts.get(passages.events.species[e]) ?? 0) + 1);
    }
    for (const entry of byHere) {
      const i = passages.species.indexOf(entry.species);
      entry.here = counts.get(i) ?? 0;
    }
    byHere.sort((a, b) => b.here - a.here);

    // The cast stands in a ring, most-seen first, facing inward at the trap.
    const R = 1.7;
    this.trapCast = byHere.map((entry, rank) => {
      const angle = Math.PI * 0.5 - (rank / byHere.length) * Math.PI * 2;
      return {
        species: entry.species,
        here: entry.here,
        anchor: new Vector3(cx + Math.cos(angle) * R, 1.05, cz - Math.sin(angle) * R),
      };
    });

    // -- the figures ---------------------------------------------------------
    const offset: number[] = [];
    const centre: number[] = [];
    const rankAttr: number[] = [];
    const role: number[] = [];
    const order: number[] = [];
    const seed: number[] = [];
    this.trapCast.forEach((member, rank) => {
      const shape: FigureId = member.species.kind === 'bird' ? 'songbird' : 'mammal';
      const built = figure(shape, 170);
      const scale = 0.6 + Math.min(0.45, Math.log(member.here + 1) / 7);
      const push = (x: number, y: number, kind: number, o: number, i: number): void => {
        offset.push(x * scale, y * scale);
        centre.push(member.anchor.x, member.anchor.y, member.anchor.z);
        rankAttr.push(rank);
        role.push(kind);
        order.push(o);
        seed.push(hash(rank * 9.31 + i * 0.71));
      };
      built.outline.forEach((pt, i) => push(pt.x, pt.y, 0, i / built.outline.length, i));
      built.detail.forEach((pt, i) => push(pt.x, pt.y, 1, i / built.detail.length, i));
    });

    const fig = new BufferGeometry();
    fig.setAttribute('position', new BufferAttribute(Float32Array.from(centre), 3));
    fig.setAttribute('aOffset', new BufferAttribute(Float32Array.from(offset), 2));
    fig.setAttribute('aRank', new BufferAttribute(Float32Array.from(rankAttr), 1));
    fig.setAttribute('aRole', new BufferAttribute(Float32Array.from(role), 1));
    fig.setAttribute('aOrder', new BufferAttribute(Float32Array.from(order), 1));
    fig.setAttribute('aSeed', new BufferAttribute(Float32Array.from(seed), 1));
    const figures = new Points(
      fig,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: TRAP_FIGURE_VERTEX,
        fragmentShader: TRAP_FIGURE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    figures.frustumCulled = false;
    figures.renderOrder = 4;

    // -- the passings, on the day's own dial ---------------------------------
    const sp: number[] = [];
    const sMinute: number[] = [];
    const sSeed: number[] = [];
    for (let e = 0; e < passages.events.species.length; e += 1) {
      if (passages.events.camera[e] !== index) continue;
      const count = passages.events.count[e];
      const who = speciesIndex.get(passages.events.species[e]);
      for (let c = 0; c < count; c += 1) {
        const minute = passages.events.minute[e];
        const angle = Math.PI * 0.5 - (minute / 1440) * Math.PI * 2;
        const r = 1.35 + hash(e * 3.7 + c) * 0.22;
        sp.push(cx + Math.cos(angle) * r, 0.06, cz - Math.sin(angle) * r);
        // Night is 21:00–05:00, the atlas' own convention.
        sMinute.push(minute >= 1260 || minute < 300 ? 1 : 0);
        sSeed.push(hash(e * 1.91 + c * 7.3) + (who ? 0 : 0));
      }
    }
    const dial = new BufferGeometry();
    dial.setAttribute('position', new BufferAttribute(Float32Array.from(sp), 3));
    dial.setAttribute('aNight', new BufferAttribute(Float32Array.from(sMinute), 1));
    dial.setAttribute('aSeed', new BufferAttribute(Float32Array.from(sSeed), 1));
    const sparks = new Points(
      dial,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: TRAP_SPARK_VERTEX,
        fragmentShader: TRAP_SPARK_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    sparks.frustumCulled = false;
    sparks.renderOrder = 3;

    this.trapTheatre = [figures, sparks];
    this.scene.add(figures, sparks);
  }

  private pickTrapFigure(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    // Generous: a silhouette is a hand-sized target, not a pin.
    let bestDistance = 0.24;
    this.trapCast.forEach((member, i) => {
      this.probe.copy(member.anchor).project(this.camera);
      if (this.probe.z > 1) return;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  private enterPost(index: number): void {
    const station = atlas.stations[index];
    const site = lonLatToScene(station.lon, station.lat);
    this.mapAltitude = this.altitudeTarget;
    this.altitudeTarget = POST_ALTITUDE;
    this.post = index;
    this.postSpecies = null;
    this.postOrbit = 0;
    this.postOrbitTarget = 0;
    this.centreTarget.set(site.x, 0, site.z);
    this.focus = { kind: 'station', index };
  }

  /** Back up to the map, to the altitude it was left at. */
  private leavePost(): void {
    this.post = null;
    this.postSpecies = null;
    this.altitudeTarget = Math.max(this.mapAltitude, HOME_ALTITUDE * 0.8);
  }

  private pickFilament(ndcX: number, ndcY: number): number | null {
    if (this.post === null) return null;
    const list = this.postList[this.post];
    let best: number | null = null;
    let bestDistance = POST_TAP_RADIUS;

    for (let i = 0; i < list.length; i += 1) {
      // The whole filament is the target, not just its tip.
      this.probe.copy(list[i].position).project(this.camera);
      if (this.probe.z > 1) continue;
      const topX = this.probe.x;
      const topY = this.probe.y;
      this.probe.set(list[i].position.x, 0.02, list[i].position.z).project(this.camera);
      const dx = topX - this.probe.x;
      const dy = topY - this.probe.y;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq < 1e-9 ? 0 : clamp(((ndcX - this.probe.x) * dx + (ndcY - this.probe.y) * dy) / lengthSq, 0, 1);
      const distance = Math.hypot(this.probe.x + dx * t - ndcX, this.probe.y + dy * t - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.focus = null;
    this.focusStrength = 0;
    this.pinchPrevious = 0;
    this.post = null;
    this.postStrength = 0;
    this.postSpecies = null;
    this.postSelectStrength = 0;
    this.postOrbit = 0;
    this.postOrbitTarget = 0;
    this.mapAltitude = HOME_ALTITUDE;
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
      if (this.trap !== null) {
        // Inside the trap theatre a silhouette is a species; anything else is
        // the way back up to the map.
        const hit = this.pickTrapFigure(tap.ndc.x, tap.ndc.y);
        if (hit !== null) {
          this.trapSpecies = this.trapSpecies === hit ? null : hit;
          speciesSelection.set(this.trapSpecies === null ? null : this.trapCast[hit].species.fr);
        } else {
          speciesSelection.clear();
          this.leaveTrap();
        }
        continue;
      }
      if (this.post !== null) {
        // Inside a post: a filament is a species, and the ground outside the
        // instrument is the way back up to the map.
        const filament = this.pickFilament(tap.ndc.x, tap.ndc.y);
        if (filament !== null) {
          this.postSpecies = this.postSpecies === filament ? null : filament;
          const entry = this.postList[this.post][filament];
          speciesSelection.set(this.postSpecies === null ? null : atlas.species[entry.species].name);
        } else {
          // Anything that is not a filament is the way out. Holding a species
          // and letting it go is the same filament twice, so this rule costs
          // nothing and it is the only one a visitor finds without being told —
          // which matters on a phone, where the sentence that explains it is
          // folded away behind the title.
          speciesSelection.clear();
          this.leavePost();
        }
        continue;
      }

      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.focus = sameFocus(hit, this.focus) ? null : hit;
      if (this.focus) {
        const marker = this.markers.find(m => sameFocus(m.focus, this.focus));
        if (marker) {
          this.centreTarget.set(marker.position.x, 0, marker.position.z + this.altitudeTarget * 0.06);
          this.altitudeTarget = this.focus.kind === 'chateau' ? 11 : 13;
        }
        // A recorder is not a pin on a map, it is a place that listened: touching
        // one flies down to it and opens its own record on the ground it stands
        // on.
        if (this.focus.kind === 'station') this.enterPost(this.focus.index);
        if (this.focus.kind === 'camera') this.enterTrap(this.focus.index);
      }
    }

    this.handleNavigation(ctx);

    if (this.trap !== null) {
      this.trapElapsed += ctx.delta;
      this.uniforms.uTrapTime.value = this.trapElapsed;
      this.uniforms.uTrapSel.value = this.trapSpecies ?? -1;
      this.camera.getWorldDirection(this.probe);
      this.uniforms.uFigRight.value.set(-this.probe.z, 0, this.probe.x).normalize();
      this.uniforms.uFigUp.value
        .crossVectors(this.probe, this.uniforms.uFigRight.value)
        .normalize()
        .negate();
    }

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

    // Inside a post the map's gestures would make no sense: there is nowhere to
    // pan to. A drag walks around the instrument instead, and a pinch changes
    // how close the visitor stands to it.
    if (this.post !== null) {
      if (active.length >= 2) {
        const separation = active[0].ndc.distanceTo(active[1].ndc);
        if (this.pinchPrevious > 0.001 && separation > 0.001) {
          this.altitudeTarget = clamp(
            this.altitudeTarget * (this.pinchPrevious / separation),
            POST_ALTITUDE * 0.55,
            POST_ALTITUDE * 2.4
          );
        }
        this.pinchPrevious = separation;
      } else {
        this.pinchPrevious = 0;
        const wheel = ctx.pointer.consumeWheel();
        if (wheel !== 0) {
          this.altitudeTarget = clamp(
            this.altitudeTarget * Math.pow(0.86, wheel),
            POST_ALTITUDE * 0.55,
            POST_ALTITUDE * 2.4
          );
        }
        const drag = ctx.pointer.dragWithInertia;
        if (Math.abs(drag.x) > 1e-6) this.postOrbitTarget -= drag.x * 3.2;
      }
      // Left alone, a post turns slowly on its own.
      this.postOrbitTarget += ctx.delta * ctx.idle * 0.06;
      return;
    }

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
    // Entering a post is a fall, not a cut: the map's own altitude keeps going
    // down and the tilt comes up with it, so the visitor watches the ground rise
    // instead of arriving somewhere new. One damping, not two — easing a target
    // that is itself being eased turns a two-second fall into a ten-second one.
    this.altitude = damp(this.altitude, this.altitudeTarget, this.post === null ? 2.2 : 2.6, ctx.delta);
    this.centre.lerp(this.centreTarget, 1 - Math.exp(-2.6 * ctx.delta));
    this.postStrength = damp(this.postStrength, this.post === null ? 0 : 1, 2.2, ctx.delta);
    this.postOrbit = damp(this.postOrbit, this.postOrbitTarget, 3.0, ctx.delta);
    this.postSelectStrength = damp(this.postSelectStrength, this.postSpecies === null ? 0 : 1, 3, ctx.delta);

    // A very slow drift, so an untouched panel is never quite still.
    const driftX = Math.sin(ctx.time * 0.045) * this.altitude * 0.012;
    const driftZ = Math.cos(ctx.time * 0.037) * this.altitude * 0.012;

    const eased = this.postStrength * this.postStrength * (3 - 2 * this.postStrength);
    const tilt = MathUtils.degToRad(MathUtils.lerp(TILT_DEGREES, POST_TILT_DEGREES, eased));
    const back = this.altitude * Math.tan(tilt);
    // The post turns; the map does not, so its offset stays due south of centre.
    const swing = this.postOrbit * eased;

    this.camera.position.set(
      this.centre.x + Math.sin(swing) * back + driftX + ctx.pointer.centroid.x * this.altitude * 0.02,
      this.altitude,
      this.centre.z + Math.cos(swing) * back + driftZ - ctx.pointer.centroid.y * this.altitude * 0.02
    );
    // Looking a little above the ground inside a post, so the filaments stand in
    // the frame rather than pointing out of the top of it.
    this.camera.lookAt(this.centre.x, 1.4 * eased, this.centre.z);

    this.uniforms.uAltitude.value = this.altitude;
    this.uniforms.uPost.value = this.post ?? -1;
    this.uniforms.uPostStrength.value = this.postStrength;
    this.uniforms.uPostSpecies.value = this.postSpecies ?? -1;
    this.uniforms.uPostSelect.value = this.postSelectStrength;
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
    // Inside a post the marker belongs to the filament being held, not to the
    // recorder the camera is already standing on.
    if (this.post !== null) {
      if (this.postSpecies !== null) {
        this.probe.copy(this.postList[this.post][this.postSpecies].position).project(this.camera);
        this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
      } else {
        this.marker = undefined;
      }
      this.updateScaleBar(ctx);
      return;
    }

    const marker = this.focus ? this.markers.find(m => sameFocus(m.focus, this.focus)) : undefined;
    if (marker) {
      this.probe.copy(marker.position).project(this.camera);
      this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
    } else {
      this.marker = undefined;
    }

    this.updateScaleBar(ctx);
  }

  /** A round number of metres, at its true length on screen. */
  private updateScaleBar(ctx: FrameContext): void {
    // Measured at the point the camera is looking at, along the distance to it
    // rather than straight down. Overhead the two are the same; leaning in at a
    // post they are not, and a scale bar that quietly assumes a plan view would
    // be reporting a third of the distance it draws.
    const tilt = MathUtils.degToRad(MathUtils.lerp(TILT_DEGREES, POST_TILT_DEGREES, this.postStrength));
    const range = this.altitude / Math.cos(tilt);
    // The bar is drawn at its true length, so it has to stay short enough to sit
    // in the masthead: a round step near a twelfth of the screen width.
    const groundHalfWidth = Math.tan(MathUtils.degToRad(this.camera.fov) / 2) * range * ctx.aspect;
    const metresAcross = groundHalfWidth * 2 * METRES_PER_UNIT;
    const wanted = metresAcross / 12;
    const magnitude = 10 ** Math.floor(Math.log10(wanted));
    const step = [1, 2, 5, 10].map(m => m * magnitude).find(m => m >= wanted) ?? magnitude * 10;
    this.scale = { metres: step, fraction: step / metresAcross };
  }

  // ---------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key =
      this.trap !== null
        ? `trap-${this.trap}-${this.trapSpecies ?? 'all'}`
        : this.post !== null
        ? `post-${this.post}-${this.postSpecies ?? 'all'}`
        : !this.focus
          ? 'overview'
          : this.focus.kind === 'chateau'
            ? 'chateau'
            : this.focus.kind === 'zone'
              ? `zone-${this.focus.index}`
              : `station-${this.focus.index}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout =
        this.trap !== null
          ? this.trapSpecies === null
            ? this.trapReadout(this.trap)
            : this.trapSpeciesReadout(this.trapSpecies)
          : this.post !== null
          ? this.postSpecies === null
            ? this.postReadout(this.post)
            : this.postSpeciesReadout(this.post, this.postSpecies)
          : !this.focus
            ? this.overviewReadout()
            : this.focus.kind === 'chateau'
              ? this.chateauReadout()
              : this.focus.kind === 'zone'
                ? this.zoneReadout(this.focus.index)
                : this.stationReadout(this.focus.index);
    }
    this.cachedReadout.marker = this.marker;
    this.cachedReadout.scale = this.scale;
    return;
  }

  /** Three numbers and a sentence; the theatre carries the rest. */
  private trapReadout(index: number): Readout {
    const camera = passages.cameras[index];
    return {
      eyebrow: 'Piège photo',
      title: camera.code,
      body: 'Touchez une silhouette.',
      stats: [
        { label: 'Passages', value: String(camera.total) },
        { label: 'Espèces', value: String(camera.species) },
        { label: 'La nuit', value: `${Math.round(camera.nightShare * 100)} %` },
      ],
      period: '29 mai — 16 août 2025',
      source: `Every1Counts · pièges photo · imagerie ${basemap.attribution}`,
      accent: PALETTE.ember,
    };
  }

  private trapSpeciesReadout(member: number): Readout {
    const cast = this.trapCast[member];
    return {
      eyebrow: cast.species.kind === 'bird' ? 'Oiseau' : 'Mammifère',
      title: cast.species.fr,
      body: `${cast.species.scientific}.`,
      stats: [
        { label: 'Ici', value: String(cast.here) },
        { label: 'Partout', value: String(cast.species.count) },
        { label: 'La nuit', value: `${Math.round(cast.species.nightShare * 100)} %` },
      ],
      spark: cast.species.hourly.map(v => v / Math.max(1, ...cast.species.hourly)),
      period: '29 mai — 16 août 2025',
      source: `Every1Counts · pièges photo · imagerie ${basemap.attribution}`,
      accent: PALETTE.ember,
    };
  }

  /** A chapter standing on the estate: what it is, and the way in. */
  private zoneReadout(index: number): Readout {
    const zone = this.zones[index];
    return {
      eyebrow: 'Sur le domaine',
      title: zone.label,
      body: zone.note,
      modes: [{ id: 'open', label: `Ouvrir · ${zone.label}`, active: false }],
      accent: PALETTE.bone,
      source: `Every1Counts & BirdNET · imagerie ${basemap.attribution}`,
    };
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

  /**
   * A post, from the inside: what this one recorder heard, in its own hours.
   */
  private postReadout(index: number): Readout {
    const station = atlas.stations[index];
    const list = this.postList[index];
    const elevation = Math.round(elevationAtLonLat(station.lon, station.lat));
    const peak = station.hourly.indexOf(Math.max(...station.hourly));
    const night = station.hourly.reduce((sum, n, h) => (h >= 21 || h < 5 ? sum + n : sum), 0);

    return {
      eyebrow: `Poste d’écoute ${station.code.toUpperCase()} · ${elevation} m`,
      title: `${station.total.toLocaleString('fr-FR')} détections`,
      body:
        `Chaque filament est une espèce entendue ici, dressée à l’heure où elle chante ; ` +
        `les rayons au sol sont les vingt-quatre heures de cette station. ` +
        `Touchez un filament, ou le sol autour pour remonter à la carte.`,
      stats: [
        { label: 'Espèces', value: String(station.species) },
        { label: 'Heure de pointe', value: `${String(peak).padStart(2, '0')}:00` },
        { label: 'La nuit', value: `${Math.round((night / Math.max(1, station.total)) * 100)} %` },
        {
          label: 'Part du corpus',
          value: `${((station.total / atlas.meta.total) * 100).toFixed(1)} %`,
        },
      ],
      spark: normalise(station.hourly),
      accent: PALETTE.gold,
      source: `Every1Counts & BirdNET · ${list.length} espèces représentées · imagerie ${basemap.attribution}`,
    };
  }

  /**
   * One species as this one recorder heard it.
   *
   * The sparkline is the species' hours *here*, not across the survey — which is
   * the whole reason to stand at a post rather than read the atlas: the same
   * bird keeps different hours at the ponds and on the plateau.
   */
  private postSpeciesReadout(index: number, local: number): Readout {
    const station = atlas.stations[index];
    const entry = this.postList[index][local];
    const species = atlas.species[entry.species];

    const hourly = new Array<number>(24).fill(0);
    for (let i = 0; i < points.count; i += 1) {
      if (points.station[i] === index && points.species[i] === entry.species) {
        hourly[Math.floor(points.minute[i] / 60)] += 1;
      }
    }
    const guild = atlas.guilds.find(g => g.id === species.guild);

    return {
      eyebrow: `${guild?.label ?? 'Espèce'} · ${station.code.toUpperCase()}`,
      title: species.name,
      body:
        `${entry.count} détection${entry.count > 1 ? 's' : ''} à ce poste, ` +
        `sur ${species.count} dans tout le relevé. ` +
        `Ici, son heure moyenne est ${String(Math.round(entry.meanHour) % 24).padStart(2, '0')}:00.`,
      stats: [
        { label: 'Ici', value: String(entry.count) },
        { label: 'Part du poste', value: `${((entry.count / station.total) * 100).toFixed(1)} %` },
        { label: 'Dans le relevé', value: String(species.count) },
        { label: 'Stations', value: `${species.stations.length} / ${atlas.meta.stationCount}` },
      ],
      spark: normalise(hourly),
      accent: guildCss(species.guild),
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
    uPost: { value: -1 },
    uPostStrength: { value: 0 },
    uPostSpecies: { value: -1 },
    uPostSelect: { value: 0 },
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
    uTrapTime: { value: 0 },
    uTrapSel: { value: -1 },
    uFigRight: { value: new Vector3(1, 0, 0) },
    uFigUp: { value: new Vector3(0, 1, 0) },
    uDusk: { value: color(PALETTE.dusk) },
    ...touch,
  };
}

function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => v / max);
}

// ------------------------------------------------------------------ shaders --

/** Which post is open, how far in, and which filament is being held. */
const POST_UNIFORMS = /* glsl */ `
uniform float uPost;
uniform float uPostStrength;
uniform float uPostSpecies;
uniform float uPostSelect;

/** 1 for the station whose post is open. */
float isPost(float station){
  return uPost < -0.5 ? 0.0 : step(abs(uPost - station), 0.5);
}
`;

const DIAL_VERTEX = /* glsl */ `
uniform float uTime;
attribute float aStation;
attribute float aAlong;
attribute float aShare;
attribute float aHour;
varying float vAlong;
varying float vShare;
varying float vHour;
varying float vOpen;
varying vec3 vWorld;

${POST_UNIFORMS}

void main(){
  vAlong = aAlong;
  vShare = aShare;
  vHour = aHour;
  vOpen = isPost(aStation) * uPostStrength;

  // The spokes grow out of the ground as the post opens, hour by hour around
  // the clock, so the dial draws itself while the camera is still falling.
  vec3 pos = position;
  vec3 centre = vec3(pos.x, pos.y, pos.z);
  vWorld = pos;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const DIAL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uGold;
uniform vec3 uBone;
uniform vec3 uDusk;
varying float vAlong;
varying float vShare;
varying float vHour;
varying float vOpen;
varying vec3 vWorld;

${POST_UNIFORMS}
${TOUCH_UNIFORMS}

void main(){
  if (vOpen < 0.01) discard;

  // Each spoke is bright at the recorder and fades outward, with a lit tip that
  // says how far it reaches — the station's own count for that hour.
  float body = pow(1.0 - vAlong, 1.4);
  float tip = exp(-pow((vAlong - 0.94) * 12.0, 2.0));

  // Night hours violet, day hours gold: the same reading as Chapter II, so a
  // visitor who has seen the crown recognises this ground.
  float night = step(21.0, vHour) + (1.0 - step(5.0, vHour));
  vec3 tint = mix(uGold, uDusk * 1.5, clamp(night, 0.0, 1.0));

  // The dial unrolls clockwise as the post opens.
  float unroll = smoothstep(vHour / 24.0, vHour / 24.0 + 0.35, uPostStrength * 1.35);

  float a = (body * 0.14 + tip * 0.3) * (0.35 + vShare * 0.9) * vOpen * unroll;
  a += touchGlow(vWorld, 1.1) * 0.08 * vOpen;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(tint, uBone, tip * 0.5) * a, a);
}
`;

const FILAMENT_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uGuildColors[6];
uniform vec3 uBone;
attribute float aStation;
attribute float aLocal;
attribute float aGuild;
attribute float aUp;
attribute float aWeight;
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

${SIMPLEX3}
${EASING}
${POST_UNIFORMS}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  float open = isPost(aStation) * uPostStrength;
  if (open < 0.01){
    // Parked behind the camera rather than drawn: a post that is not open costs
    // nothing but the vertex.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vColor = vec3(0.0);
    vHeld = 0.0;
    return;
  }

  vHeld = (uPostSpecies < -0.5 ? 0.0 : step(abs(uPostSpecies - aLocal), 0.5)) * uPostSelect;

  vec3 pos = position;
  // The filaments sway; they are made of air and birdsong, not of masonry.
  float sway = snoise(vec3(aLocal * 0.6, uTime * 0.25, aUp * 1.6)) * aUp * 0.07;
  pos.x += sway;
  pos.z += sway * 0.7;
  pos.y += vHeld * 0.12;
  pos += touchDisplace(pos, 1.2, 0.09);

  float ripple = rippleField(pos, 2.4, 2.6, 0.5);

  // They rise as the post opens, tallest last.
  float grow = easeOutQuart(clamp(uPostStrength * 1.6 - aWeight * 0.3, 0.0, 1.0));
  pos.y *= grow;

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = mix(guild, mix(guild, uBone, 0.5) * 1.5, vHeld) + vec3(0.3, 0.2, 0.08) * ripple;

  // Bright at the foot, thinning upward; everything but the held one steps back.
  float taper = mix(1.0, 0.4, aUp);
  vAlpha = open * taper * (0.3 + aWeight * 0.55) * mix(1.0, 0.3, uPostSelect * (1.0 - vHeld));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.04 + aWeight * 0.07 + vHeld * 0.05, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FILAMENT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.58, d);
  float halo = exp(-d * 2.7) * 0.5;
  float ring = (1.0 - smoothstep(0.03, 0.09, abs(d - 0.8))) * vHeld * 0.6;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.8 + vec3(ring) * 0.15, a);
}
`;

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
${RAMP3}
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

  // Painted, not posterised. The luminance is walked along three colours of the
  // cellar palette with softly banded, noise-wobbled edges — so the estate is
  // rendered in the piece's own hand while keeping the vineyard rows and the
  // treeline that make it recognisable as this place. The ramp is bounded by
  // the two colours it is given, which is what makes it safe: it cannot blow
  // the map out and it cannot crush it to black.
  float band = clamp(luma * 2.3, 0.0, 1.0);
  float wobble = snoise(vec3(vWorld.xz * 0.24, 4.7)) * 0.07;
  // Deep shade, a restrained middle, hot gold at the top — and a contrast lift
  // after the mix. The first pass of this wash was pale: mid and lit sat too
  // close together and the whole estate read as fog.
  vec3 painted = ramp3(band, vec3(0.014, 0.010, 0.028), mix(uBone, uWine, 0.55) * 0.33, uGold * 1.5, 0.17, wobble);
  graded = mix(graded, painted, 0.56);
  graded = clamp((graded - 0.045) * 1.34, 0.0, 4.0);
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
uniform vec3 uWine;
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

  float isZone = step(1.5, vEstate) * step(vEstate, 2.5);
  float isCam = step(2.5, vEstate);
  // A zone is a doorway, not a reading: a bracketed square, so a visitor can
  // tell at a glance which marks are places that listened and which are ways in.
  vec2 q = abs(uv) * 2.0;
  float box = max(q.x, q.y);
  float frame = (1.0 - smoothstep(0.03, 0.07, abs(box - 0.44)))
              * step(min(q.x, q.y), 0.34);
  float centre = 1.0 - smoothstep(0.05, 0.12, box);
  float mark = mix(dot0 + ring + pulse + halo, frame + centre * 0.7 + halo, isZone);
  // A camera is a diamond with a shutter dot: distinct from the recorder's
  // ring at a glance, because they stand side by side on this estate.
  vec2 r45 = abs(vec2(uv.x + uv.y, uv.x - uv.y)) * 1.41421;
  float dia = max(r45.x, r45.y);
  float diamond = (1.0 - smoothstep(0.02, 0.055, abs(dia - 0.42))) + (1.0 - smoothstep(0.04, 0.1, dia)) * 0.7;
  mark = mix(mark, diamond + halo * 0.6, isCam);
  vec3 tint = mix(uGold, uBone, min(vEstate, 1.0) * 0.75 + vSelected * 0.25);
  tint = mix(tint, uBone, isZone * 0.55);
  tint = mix(tint, mix(uWine * 1.9, uBone, 0.42), isCam);

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
${POST_UNIFORMS}
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
  vAlpha = sin(life * 3.14159) * (0.10 + aWeight * 0.20) * uReveal * focusFade(aStation)
         * mix(1.0, 0.45, uPostStrength);

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

function hash(n: number): number {
  const v = Math.sin(n) * 43758.5453;
  return v - Math.floor(v);
}

// ---------------------------------------------------------- trap theatre --

const TRAP_FIGURE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uTrapTime;
uniform float uTrapSel;
uniform vec3 uFigRight;
uniform vec3 uFigUp;
uniform vec3 uBone;
uniform vec3 uGold;
uniform vec3 uWine;
attribute vec2 aOffset;
attribute float aRank;
attribute float aRole;
attribute float aOrder;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;

${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  // Each member of the cast draws itself in turn, outline first, the interior
  // strokes once it is half there — the same draughtsman's schedule as the
  // Red Book, at hand scale.
  float start = aRank * 0.34;
  float local = clamp((uTrapTime * 0.8 - start), 0.0, 1.0);
  float draw = aRole < 0.5
    ? smoothstep(aOrder, aOrder + 0.09, local * 1.35)
    : smoothstep(aOrder, aOrder + 0.12, clamp(local * 1.8 - 0.7, 0.0, 1.0));

  float held = uTrapSel < -0.5 ? 0.0 : step(abs(uTrapSel - aRank), 0.5);
  float nib = smoothstep(0.07, 0.0, abs(local * 1.35 - aOrder)) * (1.0 - step(1.0, local));

  vec3 pos = position + (uFigRight * aOffset.x + uFigUp * aOffset.y) * (1.0 + sin(uTime * 0.8 + aRank) * 0.015);

  vColor = mix(mix(uWine * 1.6, uBone, 0.42), uGold * 1.3, held * 0.6 + nib * 0.8);
  vAlpha = draw * mix(0.55, 1.0, held) * (uTrapSel < -0.5 ? 1.0 : mix(0.3, 1.0, held));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor((aRole < 0.5 ? 0.055 : 0.045) * (1.0 + held * 0.4 + nib * 0.9), mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const TRAP_FIGURE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.6, d);
  float a = (core + exp(-d * 2.8) * 0.3) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const TRAP_SPARK_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uTrapTime;
uniform vec3 uGold;
uniform vec3 uWine;
uniform vec3 uBone;
attribute float aNight;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;

${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  // The trap's whole record on a 24-hour dial around the instrument: midnight
  // away from the visitor, each passing at the minute it happened. Day passes
  // burn gold, night passes violet-blue — the same night the actogram keeps.
  vec3 pos = position;
  pos.y += sin(uTime * 1.1 + aSeed * 30.0) * 0.02;

  float reveal = smoothstep(aSeed, aSeed + 0.25, uTrapTime * 0.55);
  vColor = mix(uGold, mix(uWine, vec3(0.42, 0.4, 0.85), 0.6), aNight);
  vAlpha = reveal * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 44.0));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.05 + aSeed * 0.02, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const TRAP_SPARK_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float a = (1.0 - smoothstep(0.0, 0.55, d)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;
