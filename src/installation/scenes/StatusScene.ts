import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { ENGRAVE, POINT_SIZE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas } from '../data/atlas';
import { basemap, CHATEAU, loadLayerTexture, lonLatToScene, lonLatToUv, METRES_PER_UNIT } from '../data/basemap';
import { passages } from '../data/passages';
import { status, type RedbookEntry, type StatusSpecies, TIER_COLORS, TIER_LABELS } from '../data/status';
import { figure, type FigureId } from './figures';
import { ChapterBase, damp, type TouchUniforms } from './ChapterBase';

/** Subdivision of the ground plane. */
const MAP_ROWS = 28;
const MAP_COLS = 28;

/** How high above its ground the figure of an animal stands, in scene units. */
const STAND = 26;

/** Half-height of a figure, in scene units. One unit is thirty metres. */
const FIGURE_SIZE = 8.2;

/** Points walked round an outline. */
const OUTLINE_STEPS = 220;

/** The rest of the national list, ringed far beyond the estate. */
const BOOK_RADIUS = 210;

const TAP_RADIUS = 0.085;

/**
 * Birth choreography. A resident is not standing there by default — its
 * territory is: a faint shivering hint of the outline over the posts that
 * recorded it. Touch it and the animal is *performed into being*, in the order
 * a draughtsman would work: the outline draws itself around the perimeter,
 * the interior strokes follow, the hatch breathes in last — and all the while
 * its detections stream up the threads from the posts that heard it and take
 * their places inside the figure. What assembles the animal is literally its
 * own evidence arriving.
 */
const RESIDENT_SLOTS = 16;
const BIRTH_SECONDS = 2.6;
const FADE_SECONDS = 1.1;
/** Idle seconds before the chapter starts performing its residents itself. */
const SHOWCASE_IDLE = 9;
/** Seconds each showcased animal is held before the next is drawn. */
const SHOWCASE_HOLD = 8;

interface Resident {
  species: StatusSpecies;
  entry: RedbookEntry | null;
  shape: FigureId;
  /** Where the figure stands: over the posts that recorded it. */
  anchor: Vector3;
  /** Those posts, on the ground. */
  posts: { code: string; position: Vector3 }[];
  tier: number;
}

interface Distant {
  entry: RedbookEntry;
  anchor: Vector3;
  tier: number;
}

/**
 * Chapter VIII — Livre rouge.
 *
 * The protected animals of the estate, standing on the estate.
 *
 * This chapter used to be a tower of abstract rings, which answered the
 * question *how many* and not the question anyone actually asks, which is *who
 * is here, and what has it got to do with this place*. So the ground is the
 * ground: the real aerial imagery of Purcari, the vineyard blocks, the park
 * ponds and the château where they are. Above it stand the twelve species from
 * both surveys that carry a conservation status — each one a figure of its own
 * guild, drawn as an outline and filled with its own detections, so the animal
 * you recognise is made of the evidence that it was here. A thread runs from
 * every figure down to each post that recorded it: the wildcat hangs over the
 * camera trap that photographed it, the eagle owl over the three recorders that
 * heard it, the swan over four.
 *
 * The colour of a figure is how threatened it is; the light inside it is how
 * often it was found. A species recorded once is an outline with a single spark
 * in it, and that is the honest picture of one clip in seventeen days.
 *
 * Far out beyond the estate, on the dark, the rest of Moldova's Red Book waits
 * as a ring of unlit marks — the forty species the transcription carries that
 * neither instrument found here. That is the measure the chapter exists to
 * give: this is a working vineyard, and this much of the national list lives on
 * it.
 *
 * The national layer is **partial and the chapter says so on screen**: it is
 * transcribed from the published tables, 39 birds and 14 mammals against the
 * third edition's 62 and 30.
 */
export class StatusScene extends ChapterBase {
  readonly id = 'status' as const;
  readonly look = { exposure: 1.0, bloom: 0.72, grain: 0.024, aberration: 0.98, vignette: 1.18, trail: 0.55 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly residents: Resident[] = [];
  private readonly distant: Distant[] = [];

  private figures!: Points;
  private threads!: LineSegments;
  private postMarks!: Points;
  private bookMarks!: Points;

  private selected: number | null = null;
  private selectStrength = 0;
  private flight = 0;

  /** 0..1 per resident: how far through its birth it is drawn. */
  private readonly births = new Float32Array(RESIDENT_SLOTS);
  /** Which resident the idle showcase is currently performing. */
  private showcase = -1;
  private showcaseClock = SHOWCASE_HOLD;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  private readonly estate = new Vector3();

  constructor() {
    super(44);
    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = 0;
    this.uniforms = createUniforms(this.touch);

    this.layout();
    this.buildMap();
    this.threads = this.buildThreads();
    this.postMarks = this.buildPosts();
    this.bookMarks = this.buildBook();
    this.figures = this.buildFigures();
    this.scene.add(this.threads, this.postMarks, this.bookMarks, this.figures);

    // Framed on the animals rather than on the imagery: the estate is the
    // stage, but the residents are what the chapter is about.
    const spread = Math.max(
      28,
      ...this.residents.map(r => Math.hypot(r.anchor.x - this.estate.x, r.anchor.z - this.estate.z))
    );
    this.restSpherical.set(spread * 1.8, Math.PI * 0.34, Math.PI * 0.12);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.target.copy(this.estate);
    this.desiredTarget.copy(this.estate);
    this.idleSpin = 0.028;
    this.minPolar = Math.PI * 0.16;
    this.maxPolar = Math.PI * 0.44;
    this.dragSensitivity = 1.9;

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  /** Which figure a species is drawn with — its guild, or its class. */
  private static shapeFor(species: StatusSpecies): FigureId {
    if (species.kind === 'mammal') return 'mammal';
    const guild = atlas.species.find(s => s.name === species.fr)?.guild;
    if (guild === 'nocturnal') return 'owl';
    if (guild === 'raptor') return 'raptor';
    if (guild === 'water') return 'water';
    return 'songbird';
  }

  private layout(): void {
    const acoustic = new Map(atlas.stations.map(s => [s.code.toUpperCase(), s]));
    const cameras = new Map(passages.cameras.map(c => [c.code.toUpperCase(), c]));

    for (const species of status.species) {
      const posts: { code: string; position: Vector3 }[] = [];
      for (const code of species.stations) {
        const key = code.toUpperCase();
        const place = acoustic.get(key) ?? cameras.get(key);
        if (!place) continue;
        const scene = lonLatToScene(place.lon, place.lat);
        posts.push({ code: key, position: new Vector3(scene.x, 0, scene.z) });
      }
      if (posts.length === 0) continue;

      // Over the middle of the posts that found it, so a bird heard everywhere
      // stands over the estate and a wildcat stands over its one camera.
      const anchor = new Vector3();
      for (const post of posts) anchor.add(post.position);
      anchor.divideScalar(posts.length);
      anchor.y = STAND;

      this.residents.push({
        species,
        entry: status.redbook.find(e => e.scientific === species.scientific) ?? null,
        shape: StatusScene.shapeFor(species),
        anchor,
        posts,
        tier: status.meta.tiers.indexOf(species.tier),
      });
    }

    // Spread the figures apart where two of them share the same posts: three
    // birds heard at the same three recorders would otherwise stand inside one
    // another.
    const byKey = new Map<string, Resident[]>();
    for (const resident of this.residents) {
      const key = resident.posts.map(p => p.code).sort().join('+');
      const list = byKey.get(key);
      if (list) list.push(resident);
      else byKey.set(key, [resident]);
    }
    for (const group of byKey.values()) {
      if (group.length === 1) continue;
      group.forEach((resident, i) => {
        const angle = (i / group.length) * Math.PI * 2;
        const reach = FIGURE_SIZE * 1.35 * Math.min(2.2, group.length * 0.55);
        resident.anchor.x += Math.cos(angle) * reach;
        resident.anchor.z += Math.sin(angle) * reach * 0.7;
        resident.anchor.y += (i % 2) * FIGURE_SIZE * 0.75;
      });
    }

    // Then relax the whole set apart: most of these birds were heard at the
    // same two or three recorders, and grouping by an identical post list only
    // separates the exact ties. A few passes of mutual repulsion in the plane
    // keep every figure legible without moving any of them far from the posts
    // they belong to.
    const keep = FIGURE_SIZE * 2.3;
    for (let pass = 0; pass < 24; pass += 1) {
      for (let i = 0; i < this.residents.length; i += 1) {
        for (let j = i + 1; j < this.residents.length; j += 1) {
          const a = this.residents[i].anchor;
          const c = this.residents[j].anchor;
          let dx = c.x - a.x;
          let dz = c.z - a.z;
          const dy = Math.abs(c.y - a.y);
          let distance = Math.hypot(dx, dz);
          if (distance > keep || dy > FIGURE_SIZE * 1.6) continue;
          if (distance < 1e-4) {
            dx = Math.cos(i * 2.4) * 0.1;
            dz = Math.sin(i * 2.4) * 0.1;
            distance = 0.1;
          }
          const push = ((keep - distance) / distance) * 0.28;
          a.x -= dx * push;
          a.z -= dz * push;
          c.x += dx * push;
          c.z += dz * push;
        }
      }
    }

    for (const resident of this.residents) this.estate.add(resident.anchor);
    this.estate.divideScalar(Math.max(1, this.residents.length));
    // The camera looks at the animals, not at their shadows: framing on the
    // ground puts every figure above the top of the panel.
    this.estate.y = STAND * 0.8;

    // The rest of the book, ringed far out on the dark. Worst category nearest
    // the estate, so the ring reads outward as the trouble eases.
    const unfound = status.redbook.filter(e => !e.found);
    unfound.forEach((entry, i) => {
      const angle = (i / unfound.length) * Math.PI * 2 + 0.4;
      const tier = status.meta.tiers.indexOf(entry.category);
      const radius = BOOK_RADIUS + tier * 26;
      this.distant.push({
        entry,
        anchor: new Vector3(
          this.estate.x + Math.cos(angle) * radius,
          STAND * 0.55 + hash(i * 3.3) * STAND * 0.9,
          this.estate.z + Math.sin(angle) * radius
        ),
        tier,
      });
    });
  }

  // ------------------------------------------------------------------- build --

  /** The estate itself, projected exactly the way Chapter I projects it. */
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

  /**
   * Every figure, as an outline of its guild filled with its own detections.
   *
   * The outline is what makes it recognisable; the fill is what makes it true.
   * A species with one record gets one mote inside the figure, and a chapter
   * that drew fifty for it would be inventing evidence.
   */
  private buildFigures(): Points {
    const offset: number[] = [];
    const anchor: number[] = [];
    const which: number[] = [];
    const tier: number[] = [];
    const role: number[] = [];
    const seed: number[] = [];
    const order: number[] = [];
    const home: number[] = [];

    this.residents.forEach((resident, index) => {
      const built = figure(resident.shape, OUTLINE_STEPS);
      const scale = FIGURE_SIZE * (0.78 + Math.min(0.5, Math.log(resident.species.count + 1) / 9));
      const push = (x: number, y: number, kind: number, s: number, o: number, h: Vector3): void => {
        offset.push(x * scale, y * scale);
        anchor.push(resident.anchor.x, resident.anchor.y, resident.anchor.z);
        which.push(index);
        tier.push(resident.tier);
        role.push(kind);
        seed.push(s);
        order.push(o);
        home.push(h.x, h.y, h.z);
      };

      // The drawing: outline, the strokes inside it, and the engraver's hatch.
      // aOrder is where each point stands in its own pass — the outline is in
      // perimeter order, the strokes in the order a hand would cut them — and
      // it is what lets the shader draw the figure rather than fade it in.
      built.outline.forEach((p, i) =>
        push(p.x, p.y, 0, hash(index * 7.1 + i * 0.37), i / built.outline.length, resident.anchor));
      built.detail.forEach((p, i) =>
        push(p.x, p.y, 2, hash(index * 2.3 + i * 0.41), i / built.detail.length, resident.anchor));
      built.hatch.forEach((p, i) =>
        push(p.x, p.y, 3, hash(index * 5.7 + i * 0.29), i / built.hatch.length, resident.anchor));
      // Then the evidence: one mote per detection, each flying up from one of
      // the posts that actually recorded this species.
      const motes = Math.min(built.fill.length, resident.species.count);
      for (let i = 0; i < motes; i += 1) {
        const post = resident.posts[i % resident.posts.length];
        push(built.fill[i].x, built.fill[i].y, 1, hash(index * 3.9 + i * 1.7), i / motes, post.position);
      }
    });

    const geometry = new BufferGeometry();
    // Position is filled by the shader from the anchor and the billboard basis;
    // the attribute exists only because three wants one.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(anchor), 3));
    geometry.setAttribute('aOffset', new BufferAttribute(Float32Array.from(offset), 2));
    geometry.setAttribute('aWhich', new BufferAttribute(Float32Array.from(which), 1));
    geometry.setAttribute('aTier', new BufferAttribute(Float32Array.from(tier), 1));
    geometry.setAttribute('aRole', new BufferAttribute(Float32Array.from(role), 1));
    geometry.setAttribute('aSeed', new BufferAttribute(Float32Array.from(seed), 1));
    geometry.setAttribute('aOrder', new BufferAttribute(Float32Array.from(order), 1));
    geometry.setAttribute('aHome', new BufferAttribute(Float32Array.from(home), 3));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: FIGURE_VERTEX,
        fragmentShader: FIGURE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 3;
    return cloud;
  }

  /** A thread from each animal down to every post that recorded it. */
  private buildThreads(): LineSegments {
    const position: number[] = [];
    const along: number[] = [];
    const which: number[] = [];
    const tier: number[] = [];
    const segments = 14;

    this.residents.forEach((resident, index) => {
      for (const post of resident.posts) {
        for (let s = 0; s < segments; s += 1) {
          for (const step of [s, s + 1]) {
            const t = step / segments;
            // Bowed, so several threads from one post read as several threads.
            const bow = Math.sin(t * Math.PI) * 1.6;
            position.push(
              resident.anchor.x + (post.position.x - resident.anchor.x) * t + bow * 0.3,
              resident.anchor.y * (1 - t * t),
              resident.anchor.z + (post.position.z - resident.anchor.z) * t
            );
            along.push(t);
            which.push(index);
            tier.push(resident.tier);
          }
        }
      }
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position), 3));
    geometry.setAttribute('aAlong', new BufferAttribute(Float32Array.from(along), 1));
    geometry.setAttribute('aWhich', new BufferAttribute(Float32Array.from(which), 1));
    geometry.setAttribute('aTier', new BufferAttribute(Float32Array.from(tier), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: THREAD_VERTEX,
        fragmentShader: THREAD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    return lines;
  }

  /** The posts themselves, and the château, on the ground. */
  private buildPosts(): Points {
    const position: number[] = [];
    const kind: number[] = [];
    const seen = new Set<string>();

    for (const resident of this.residents) {
      for (const post of resident.posts) {
        if (seen.has(post.code)) continue;
        seen.add(post.code);
        position.push(post.position.x, 0.12, post.position.z);
        kind.push(0);
      }
    }
    const chateau = lonLatToScene(CHATEAU.lon, CHATEAU.lat);
    position.push(chateau.x, 0.12, chateau.z);
    kind.push(1);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position), 3));
    geometry.setAttribute('aKind', new BufferAttribute(Float32Array.from(kind), 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: POST_VERTEX,
        fragmentShader: POST_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 2;
    return cloud;
  }

  /** The rest of the national list, out on the dark. */
  private buildBook(): Points {
    const position: number[] = [];
    const tier: number[] = [];
    for (const mark of this.distant) {
      position.push(mark.anchor.x, mark.anchor.y, mark.anchor.z);
      tier.push(mark.tier);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(position), 3));
    geometry.setAttribute('aTier', new BufferAttribute(Float32Array.from(tier), 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: BOOK_VERTEX,
        fragmentShader: BOOK_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 2;
    return cloud;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.selectStrength = 0;
    this.flight = 0;
    this.readoutKey = '';
    this.desired.copy(this.restSpherical);
    this.desired.radius *= 1.35;

    this.births.fill(0);
    this.showcase = -1;
    this.showcaseClock = SHOWCASE_HOLD * 0.8;

    const carried = speciesSelection.name;
    const index = carried ? this.residents.findIndex(r => r.species.fr === carried) : -1;
    this.selected = index >= 0 ? index : null;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.8, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.selected = hit === this.selected ? null : hit;
      const held = this.selected !== null && this.selected < this.residents.length
        ? this.residents[this.selected].species.fr
        : null;
      speciesSelection.set(held);
    }

    // Untouched, the chapter performs its own residents: one animal at a time
    // draws itself over its territory, holds, and hands over to the next — a
    // wall panel has to make the argument without a visitor's finger.
    if (this.selected === null && ctx.pointer.idleTime > SHOWCASE_IDLE) {
      this.showcaseClock += ctx.delta;
      if (this.showcaseClock >= SHOWCASE_HOLD) {
        this.showcaseClock = 0;
        this.showcase = (this.showcase + 1) % this.residents.length;
      }
    } else if (this.selected !== null) {
      this.showcase = -1;
      this.showcaseClock = SHOWCASE_HOLD * 0.6;
    }

    // Births run on their own clock, not on a damp: a drawing has a beginning,
    // a middle and an end, and an exponential approach has none of them.
    const uBirth = this.uniforms.uBirth.value as number[];
    for (let i = 0; i < this.residents.length; i += 1) {
      const wanted = i === this.selected || (this.selected === null && i === this.showcase);
      const step = ctx.delta / (wanted ? BIRTH_SECONDS : -FADE_SECONDS);
      this.births[i] = Math.min(1, Math.max(0, this.births[i] + step));
      uBirth[i] = this.births[i];
    }

    // The camera keeps the billboards square to it, so a figure is an animal
    // from wherever the visitor happens to be standing.
    this.camera.getWorldDirection(this.probe);
    this.uniforms.uRight.value.set(-this.probe.z, 0, this.probe.x).normalize();
    this.uniforms.uUp.value.crossVectors(this.probe, this.uniforms.uRight.value).normalize().negate();

    this.selectStrength = damp(this.selectStrength, this.selected === null ? 0 : 1, 2.6, ctx.delta);
    this.uniforms.uSelected.value = this.selected ?? -1;
    this.uniforms.uSelectStrength.value = this.selectStrength;

    if (this.selected !== null && this.selected < this.residents.length) {
      const resident = this.residents[this.selected];
      this.desiredTarget.set(resident.anchor.x, resident.anchor.y * 0.7, resident.anchor.z);
      this.desired.radius = damp(this.desired.radius, FIGURE_SIZE * 6.5, 1.6, ctx.delta);
      this.recentres = false;
    } else {
      this.desiredTarget.copy(this.estate);
      this.recentres = true;
    }

    this.flight = Math.min(1, this.flight + ctx.delta / 4);
    const landed = 1 - Math.pow(1 - this.flight, 3);
    this.desired.phi = damp(this.desired.phi, this.restSpherical.phi + (1 - landed) * 0.22, 1.8, ctx.delta);

    this.updateCameraRig(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  /** Figures first, then the far ring — a near animal always wins a tap. */
  private pick(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    let bestDistance = TAP_RADIUS;
    this.residents.forEach((resident, i) => {
      this.probe.copy(resident.anchor).project(this.camera);
      if (this.probe.z > 1) return;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    if (best !== null) return best;

    this.distant.forEach((mark, i) => {
      this.probe.copy(mark.anchor).project(this.camera);
      if (this.probe.z > 1) return;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = this.residents.length + i;
      }
    });
    return best;
  }

  private updateMarker(): void {
    if (this.selected === null) {
      this.marker = undefined;
      return;
    }
    const anchor =
      this.selected < this.residents.length
        ? this.residents[this.selected].anchor
        : this.distant[this.selected - this.residents.length].anchor;
    this.probe.copy(anchor).project(this.camera);
    this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
  }

  // ----------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.selected === null ? 'estate' : `sel-${this.selected}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout =
        this.selected === null
          ? this.overviewReadout()
          : this.selected < this.residents.length
            ? this.residentReadout(this.selected)
            : this.bookReadout(this.selected - this.residents.length);
    }
    this.cachedReadout.marker = this.marker;
  }

  private frame(): Readout {
    return {
      legend: status.meta.tiers.map(tier => ({ label: TIER_LABELS[tier], color: TIER_COLORS[tier] })),
      source: `Cartea Roșie a Republicii Moldova · Liste rouge UICN · Every1Counts & BirdNET · imagerie ${basemap.attribution}`,
    };
  }

  private overviewReadout(): Readout {
    const national = status.meta.national;
    return {
      ...this.frame(),
      eyebrow: 'Chapitre VIII',
      title: 'Livre rouge',
      body:
        `Le domaine, et les ${this.residents.length} espèces protégées que les deux relevés y ont ` +
        'trouvées. Chacune se tient au-dessus des postes qui l’ont enregistrée — un fil par poste — ' +
        'et son territoire n’est qu’un frisson de lumière — touchez-le, et l’animal se dessine : ' +
        'le trait d’abord, puis ses propres détections montent des postes le remplir. Au loin, dans le noir, le reste de la Carte ' +
        `Rouge : ${national.listed - national.found} espèces du livre qu’on n’a pas vues ici. ` +
        'Touchez un animal.',
      stats: [
        { label: 'Espèces protégées ici', value: String(this.residents.length) },
        { label: 'Du livre national', value: `${national.found} / ${national.listed}` },
        { label: 'Postes concernés', value: String(new Set(this.residents.flatMap(r => r.posts.map(p => p.code))).size) },
        { label: 'Domaine', value: `${CHATEAU.founded}` },
      ],
      accent: PALETTE.gold,
    };
  }

  /**
   * Who it is, why it counts, and what it has to do with this ground. The three
   * sentences are in that order every time.
   */
  private residentReadout(index: number): Readout {
    const { species, entry, posts } = this.residents[index];
    const where = posts.map(p => p.code).join(' · ');
    const listing = species.national
      ? `Carte Rouge de Moldavie : ${TIER_LABELS[species.national.category].toLowerCase()}` +
        (species.globalLabel === 'least concern' ? ', préoccupation mineure au niveau mondial' : '')
      : `Liste rouge mondiale UICN : ${TIER_LABELS[species.tier].toLowerCase()}`;
    const range = entry?.whereFr ? ` En Moldavie, le livre la donne : ${entry.whereFr}.` : '';
    const evidence =
      species.survey === 'camera'
        ? `Ici : ${species.count} passage${species.count > 1 ? 's' : ''} devant le piège ${where}, en quatre-vingts nuits.`
        : `Ici : ${species.count} détection${species.count > 1 ? 's' : ''} à ${where}` +
          (species.confidence ? `, confiance BirdNET ${species.confidence.median.toFixed(2)}` : '') +
          ', en dix-sept jours.';

    return {
      ...this.frame(),
      eyebrow: `${TIER_LABELS[species.tier]} · ${species.scientific}`,
      title: species.fr,
      body: `${listing}.${range} ${evidence}`,
      stats: [
        { label: species.survey === 'camera' ? 'Passages' : 'Détections', value: String(species.count) },
        { label: species.survey === 'camera' ? 'Pièges' : 'Postes', value: String(posts.length) },
        { label: 'Distance au château', value: `${Math.round(this.distanceToChateau(index))} m` },
        { label: 'La nuit', value: `${Math.round(species.nocturnality * 100)} %` },
      ],
      accent: TIER_COLORS[species.tier],
    };
  }

  /** Metres from the château to the nearest post that recorded it. */
  private distanceToChateau(index: number): number {
    const chateau = lonLatToScene(CHATEAU.lon, CHATEAU.lat);
    return Math.min(
      ...this.residents[index].posts.map(
        post => Math.hypot(post.position.x - chateau.x, post.position.z - chateau.z) * METRES_PER_UNIT
      )
    );
  }

  private bookReadout(index: number): Readout {
    const entry = this.distant[index].entry;
    const name = entry.fr ?? entry.scientific;
    return {
      ...this.frame(),
      eyebrow: `${TIER_LABELS[entry.category]} · ${entry.accepted ?? entry.scientific}`,
      title: name,
      body:
        `${entry.ro}, dans la Carte Rouge de la République de Moldova. ` +
        `Aire connue en Moldavie : ${entry.whereFr ?? entry.where}. ` +
        'Ni les micros ni les pièges photo ne l’ont trouvée sur le domaine. ' +
        'Le livre transcrit ici compte 39 oiseaux et 14 mammifères, contre 62 et 30 dans la ' +
        'troisième édition — ce cercle est plus court que la liste réelle.',
      stats: [
        { label: 'Catégorie', value: entry.category },
        { label: 'Groupe', value: entry.kind === 'mammal' ? 'Mammifère' : 'Oiseau' },
        { label: 'À Purcari', value: 'non trouvée' },
      ],
      accent: TIER_COLORS[entry.category],
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
    uSelected: { value: -1 },
    uSelectStrength: { value: 0 },
    uBirth: { value: Array.from({ length: RESIDENT_SLOTS }, () => 0) },
    uRight: { value: new Vector3(1, 0, 0) },
    uUp: { value: new Vector3(0, 1, 0) },
    uMap: { value: loadLayerTexture(basemap.context) },
    uDetail: { value: loadLayerTexture(basemap.detail) },
    uTierColors: { value: status.meta.tiers.map(tier => color(TIER_COLORS[tier])) },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uMist: { value: color(PALETTE.mist) },
    ...touch,
  };
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const SELECTION = /* glsl */ `
uniform float uSelected;
uniform float uSelectStrength;
float isSelected(float index){
  return uSelected < -0.5 ? 0.0 : step(abs(uSelected - index), 0.5);
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
uniform float uReveal;
uniform vec3 uGold;
uniform vec3 uBone;
uniform vec3 uMist;
varying vec2 vUv;
varying vec2 vDetailUv;
varying vec3 vWorld;

${ENGRAVE}

vec3 toLinear(vec3 c){
  vec3 cutoff = step(c, vec3(0.04045));
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, cutoff);
}

void main(){
  vec3 wide = toLinear(texture2D(uMap, vUv).rgb);
  vec2 e = min(vDetailUv, 1.0 - vDetailUv);
  float inDetail = smoothstep(0.0, 0.012, min(e.x, e.y));
  vec3 sharp = toLinear(texture2D(uDetail, clamp(vDetailUv, 0.0, 1.0)).rgb);
  vec3 ground = mix(wide, sharp, inDetail);

  // Inked rather than photographed, so the land is drawn in the same hand as
  // the animals standing on it.
  // Wider and quieter than the default: the selected-animal camera comes down
  // to fifty units, and a tight bright hatch at that range reads as a net
  // thrown over the vineyard rather than as engraving.
  ground = engrave(ground, vWorld.xz, 0.78, 1.3,
                   vec3(0.03, 0.02, 0.05), uMist * 0.32, uGold * 0.6);
  ground *= 0.62 + inDetail * 0.3;

  // Away into the dark, so the estate reads as an island of ground under a
  // night sky rather than as a photograph with edges.
  float fade = 1.0 - smoothstep(95.0, 230.0, length(vWorld.xz));
  gl_FragColor = vec4(ground * fade * uReveal, 1.0);
}
`;

const FIGURE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uBirth[16];
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uTierColors[4];
uniform vec3 uBone;
uniform vec3 uGold;
attribute vec2 aOffset;
attribute float aWhich;
attribute float aTier;
attribute float aRole;
attribute float aSeed;
attribute float aOrder;
attribute vec3 aHome;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;
varying float vRole;
varying float vFlight;

${SELECTION}
${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vSelected = isSelected(aWhich) * uSelectStrength;
  vRole = aRole;

  float birth = uBirth[int(aWhich + 0.5)];

  // Always square to the camera: a silhouette seen edge-on is a line.
  float breathe = 1.0 + sin(uTime * 0.7 + aWhich * 1.7) * 0.012;
  float isEvidence = step(0.5, aRole) * step(aRole, 1.5);
  float isStroke = step(1.5, aRole) * step(aRole, 2.5);
  float isHatch = step(2.5, aRole);
  float isOutline = 1.0 - isEvidence - isStroke - isHatch;

  // The draughtsman's schedule. The outline is drawn around the perimeter over
  // the first two thirds of the birth; the interior strokes are cut once it is
  // half there; the hatch breathes in last. Each pass follows aOrder, so the
  // figure appears the way a hand would make it, not the way a fade would.
  float outlineP = smoothstep(aOrder, aOrder + 0.1, birth * 1.55);
  float strokeP = smoothstep(aOrder, aOrder + 0.14, clamp(birth * 2.2 - 0.9, 0.0, 1.0));
  float hatchP = clamp(birth * 3.4 - 2.4, 0.0, 1.0) * smoothstep(aOrder, aOrder + 0.3, birth * 3.0 - 1.9);

  // The evidence flies: each mote leaves its own post as its turn comes and
  // arcs up the height of the stand into its place inside the figure.
  float flightP = clamp(birth * 1.9 - aOrder * 0.8, 0.0, 1.0);
  flightP = flightP * flightP * (3.0 - 2.0 * flightP);
  vFlight = flightP * (1.0 - flightP) * 4.0;

  vec3 figurePos = position + (uRight * aOffset.x + uUp * aOffset.y) * breathe;
  figurePos += (uRight * sin(uTime * 0.9 + aSeed * 30.0) + uUp * cos(uTime * 0.75 + aSeed * 21.0))
       * isEvidence * 0.11;

  // Mid-flight the mote swings sideways and overshoots upward a little, so the
  // stream up the thread reads as a flock arriving rather than as an elevator.
  vec3 flightPos = mix(aHome, figurePos, flightP)
    + vec3(0.0, sin(flightP * 3.14159) * (3.0 + aSeed * 4.0), 0.0)
    + uRight * sin(flightP * 6.28318 + aSeed * 21.0) * (1.0 - flightP) * 2.2;

  vec3 pos = mix(figurePos, flightPos, isEvidence);

  vec3 tint = uTierColors[int(aTier)];
  vec3 line = mix(tint * 0.95, uBone, 0.18);
  vColor = line;
  vColor = mix(vColor, mix(uBone, tint, 0.3), isEvidence);
  vColor = mix(vColor, tint * 0.7, isHatch);
  // The pen's nib: the freshly drawn tip of the outline runs hot.
  float nib = smoothstep(0.08, 0.0, abs(birth * 1.55 - aOrder)) * isOutline * step(birth, 0.99);
  vColor = mix(vColor, uGold * 1.6, nib * 0.8 + vFlight * 0.35 * isEvidence);
  vColor *= 1.0 + vSelected * 0.7;

  // Ungrown, a territory is a hint: the outline shivers at the edge of
  // visibility over the posts, so a visitor knows where to touch — and the
  // whole drawing above that hint is earned by the birth.
  float ghost = isOutline * 0.12 * (0.55 + 0.45 * sin(uTime * 1.4 + aSeed * 40.0));
  float drawn = outlineP * isOutline + strokeP * isStroke + hatchP * isHatch + flightP * isEvidence;

  float weight = isOutline * 0.62 + isStroke * 0.5 + isHatch * 0.17 + isEvidence * 1.0;
  vAlpha = uReveal * (0.55 + vSelected * 0.65)
         * mix(1.0, 0.34, uSelectStrength * (1.0 - vSelected))
         * max(ghost, weight * drawn + nib * 0.5 + vFlight * 0.4 * isEvidence);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float size = isOutline * 0.3 + isStroke * 0.26 + isHatch * 0.2 + isEvidence * 0.66;
  gl_PointSize = pointSizeFor(size * (1.0 + vSelected * 0.5 + nib * 0.8 + vFlight * 0.4), mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FIGURE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;
varying float vRole;
varying float vFlight;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.55, d);
  float evidence = step(0.5, vRole) * step(vRole, 1.5);
  float halo = exp(-d * 2.6) * (0.22 + evidence * 0.55 + vSelected * 0.35 + vFlight * 0.4);
  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const THREAD_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uBirth[16];
uniform vec3 uTierColors[4];
uniform vec3 uMist;
attribute float aAlong;
attribute float aWhich;
attribute float aTier;
varying vec3 vColor;
varying float vAlpha;
varying float vAlong;
varying float vSelected;

${SELECTION}

void main(){
  vSelected = isSelected(aWhich) * uSelectStrength;
  vAlong = aAlong;
  float birth = uBirth[int(aWhich + 0.5)];
  vColor = mix(uMist, uTierColors[int(aTier)], 0.4 + vSelected * 0.5 + birth * 0.3);
  // At rest a slow pulse runs down toward the post — the link is a direction.
  // While the animal is being born the thread reverses and hurries: the
  // evidence is streaming up it, and the line carries the same traffic.
  float pulse = exp(-pow(fract(aAlong - uTime * 0.16) - 0.5, 2.0) * 30.0) * (1.0 - birth);
  float rush = exp(-pow(fract(aAlong + uTime * 0.55) - 0.5, 2.0) * 22.0) * birth;
  vAlpha = uReveal * (0.1 + pulse * 0.3 + rush * 0.55 + vSelected * 0.5 + birth * 0.12)
         * mix(1.0, 0.25, uSelectStrength * (1.0 - vSelected));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const THREAD_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vAlong;
void main(){
  float taper = 0.35 + 0.65 * sin(vAlong * 3.14159);
  float a = vAlpha * taper;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const POST_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uGold;
uniform vec3 uBone;
attribute float aKind;
varying vec3 vColor;
varying float vAlpha;

${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vColor = mix(uGold, uBone, aKind);
  float beat = 0.75 + 0.25 * sin(uTime * 1.3 + aKind * 2.0);
  vAlpha = uReveal * (0.5 + aKind * 0.35) * beat;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = pointSizeFor(mix(1.1, 1.7, aKind), mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const POST_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  // A ring on the ground, not a blob: this is a place, not a reading.
  float ring = 1.0 - smoothstep(0.06, 0.16, abs(d - 0.66));
  float core = (1.0 - smoothstep(0.0, 0.3, d)) * 0.6;
  float a = (ring + core) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const BOOK_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uTierColors[4];
attribute float aTier;
varying vec3 vColor;
varying float vAlpha;

${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vColor = uTierColors[int(aTier)];
  vAlpha = uReveal * (0.3 + 0.14 * sin(uTime * 0.5 + position.x * 0.2));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = pointSizeFor(0.42, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const BOOK_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.6, d);
  float a = core * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;
