import { BufferAttribute, BufferGeometry, LineSegments, MathUtils, Points, ShaderMaterial, Vector3 } from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import {
  status,
  type RedbookEntry,
  type StatusSpecies,
  TIER_COLORS,
  TIER_LABELS,
} from '../data/status';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Radius of the rings the tiers stand on. */
const R_RING = 8.5;

/** Vertical gap between one tier and the next. */
const TIER_GAP = 4.2;

/** Tallest column, in scene units. */
const MAX_COLUMN = 5.5;

/** Motes drawn per species, however many detections it has. */
const MAX_MOTES = 54;

const TAP_RADIUS = 0.08;

const TIERS = status.meta.tiers;

/**
 * How far a species the surveys never found stands above its ring. Enough to
 * clear the dashed rail: at the rail's own height the marks read as more dashes
 * rather than as the species they are.
 */
const MARK_HEIGHT = 0.5;

interface Node {
  /** The record, when one of the two surveys found it. */
  species: StatusSpecies | null;
  /** The book's own entry, for everything on the national list. */
  entry: RedbookEntry | null;
  tier: number;
  /** Foot of the column, on its tier's ring. */
  base: Vector3;
  /** Top of it, where the crown sits. */
  top: Vector3;
}

/**
 * Chapter VIII — Livre rouge.
 *
 * Moldova's own Red Book, as far as it has been transcribed, and the part of it
 * that lives at Purcari.
 *
 * Each ring is a category of the book and carries the whole of it: thirty-nine
 * critically endangered species on the top ring, nine endangered, four
 * vulnerable. Most of those are dark marks — species neither the microphones
 * nor the camera traps saw in eighty nights — and touching one gives what the
 * book gives: its name, its category, and where in Moldova it is known from.
 * A fourth ring below carries the near-threatened species of the global IUCN
 * list, a category the national book does not use.
 *
 * Of everything the two surveys recorded, twelve species carry a status: eight
 * of them are on those national rings, four on the global one. They are the lit
 * ones, and each stands as a column of its own detections.
 *
 * Each species is a column of its own detections. How *loose* that column is
 * drawn is the BirdNET score behind it: a tight column was identified with
 * confidence, a haze was not. This is the whole reason the chapter exists in
 * this form rather than as a list. A category is a statement about a species; a
 * detection is a statement about three seconds of audio, and the two are not the
 * same claim. The turtle dove — globally vulnerable, and the only threatened
 * species here that is genuinely common on the estate — stands as a tight column
 * of fifty-four records at a median score of 0.93. The single booted eagle, a
 * nationally critically endangered bird, scored 0.97 on one clip and nothing
 * else in seventeen days, and is drawn as what it is: one point of light. The
 * fourteen barn owls sit at 0.57, which is a coin flip fourteen times over.
 *
 * The camera-trap species carry no score at all, because a person identified
 * them from a photograph rather than a model from a spectrogram, and they are
 * drawn solid. Two of them are on the national list: the pine marten and, on two
 * frames in eighty nights, the wildcat.
 *
 * The national layer is **partial and under-reports**: it is transcribed from
 * the published tables, which carry 39 birds and 14 mammals against the third
 * edition's 62 and 30. A species shown here without a national category may
 * simply be missing from the transcription. The chapter says so on screen.
 */
export class StatusScene extends ChapterBase {
  readonly id = 'status' as const;
  readonly look = { exposure: 1.0, bloom: 0.7, grain: 0.022, aberration: 0.95, vignette: 1.16 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly rails: LineSegments;
  private readonly columns: Points;
  private readonly crowns: Points;

  private readonly nodes: Node[] = [];

  private orbit = 0;
  private orbitTarget = 0;
  private zoom = 1.3;
  private zoomTarget = 1;
  private pinchPrevious = 0;

  /** The tier the camera is level with, 0..3, continuous while it travels. */
  private level = 0;
  private levelTarget = 0;

  private selected: number | null = null;
  private selectStrength = 0;
  private flight = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  constructor() {
    super(42);

    this.interactionPlane.normal.set(0, 1, 0);
    this.interactionPlane.constant = 0;

    this.uniforms = createUniforms(this.touch);
    this.layout();
    this.rails = this.buildRails();
    this.columns = this.buildColumns();
    this.crowns = this.buildCrowns();
    this.scene.add(this.rails, this.columns, this.crowns);

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  private static heightOf(tier: number): number {
    // Worst at the top, so the eye starts where the trouble is.
    return (TIERS.length - 1 - tier) * TIER_GAP;
  }

  /**
   * Each ring holds a whole category of the book, not only the part of it the
   * surveys found: thirty-nine critically endangered species stand on the top
   * ring, and three of them are lit.
   *
   * The found species are dealt into evenly spaced slots around the ring rather
   * than left wherever the alphabet put them, so their columns never bunch into
   * one quarter of the storey and the dark marks read as the field they stand
   * in.
   */
  private layout(): void {
    TIERS.forEach((tier, tierIndex) => {
      const found = status.species.filter(s => s.tier === tier);
      const unfound = status.redbook.filter(e => e.category === tier && !e.found);
      const total = found.length + unfound.length;
      if (total === 0) return;

      const byScientific = new Map(status.redbook.map(e => [e.scientific, e]));
      const slots: Node[] = new Array(total);
      found.forEach((species, k) => {
        const slot = Math.round((k * total) / found.length) % total;
        slots[slot] = {
          species,
          entry: byScientific.get(species.scientific) ?? null,
          tier: tierIndex,
          base: new Vector3(),
          top: new Vector3(),
        };
      });
      let cursor = 0;
      for (let i = 0; i < total; i += 1) {
        if (slots[i]) continue;
        slots[i] = {
          species: null,
          entry: unfound[cursor],
          tier: tierIndex,
          base: new Vector3(),
          top: new Vector3(),
        };
        cursor += 1;
      }

      const y = StatusScene.heightOf(tierIndex);
      slots.forEach((node, i) => {
        // Offset per tier so the columns of one storey do not hide the storey
        // below.
        const angle = (i / total) * Math.PI * 2 + tierIndex * 0.6;
        node.base.set(Math.cos(angle) * R_RING, y, -Math.sin(angle) * R_RING);
        const height = node.species
          ? 0.9 + (Math.log(node.species.count + 1) / Math.log(56)) * MAX_COLUMN
          : MARK_HEIGHT;
        node.top.set(node.base.x, y + height, node.base.z);
        this.nodes.push(node);
      });
    });
  }

  // ------------------------------------------------------------------- build --

  /** One ring per category, drawn as a dashed rail. */
  private buildRails(): LineSegments {
    const position: number[] = [];
    const tierAttr: number[] = [];
    const along: number[] = [];
    const segments = 180;

    TIERS.forEach((_, tier) => {
      const y = StatusScene.heightOf(tier);
      for (let i = 0; i < segments; i += 1) {
        for (const step of [i, i + 1]) {
          const t = step / segments;
          const angle = t * Math.PI * 2;
          position.push(Math.cos(angle) * R_RING, y, -Math.sin(angle) * R_RING);
          tierAttr.push(tier);
          along.push(t);
        }
      }
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aTier', new BufferAttribute(new Float32Array(tierAttr), 1));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: RAIL_VERTEX,
        fragmentShader: RAIL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    return lines;
  }

  /**
   * Every species as a column of its own detections.
   *
   * The scatter is the evidence: a column drawn tight was identified with
   * confidence, a column drawn as a haze was not, and a camera record — seen by
   * a person rather than scored by a model — is drawn tight because there is no
   * score to be uncertain about.
   */
  private buildColumns(): Points {
    const position: number[] = [];
    const index: number[] = [];
    const along: number[] = [];
    const scatter: number[] = [];
    const seed: number[] = [];
    const kind: number[] = [];
    const tierAttr: number[] = [];

    this.nodes.forEach((node, i) => {
      const species = node.species;
      // A species the surveys never found has no column, because it has no
      // detections. It stands on the ring as a mark and nothing more.
      if (!species) return;
      // One detection is one mote. A species heard once is drawn as what it is:
      // a single point of light, not a column pretending to be evidence.
      const motes = Math.min(MAX_MOTES, species.count);
      // 0 for a firm identification, 1 for a coin flip. Camera records are
      // identified by eye and carry no score, so they are drawn firm.
      const loose = species.confidence ? clamp((0.95 - species.confidence.median) / 0.45, 0, 1) : 0;

      for (let m = 0; m < motes; m += 1) {
        const t = motes === 1 ? 0.5 : m / (motes - 1);
        position.push(node.base.x, node.base.y + t * (node.top.y - node.base.y), node.base.z);
        index.push(i);
        along.push(t);
        scatter.push(loose);
        seed.push(hash(i * 31.7 + m * 5.13));
        kind.push(species.kind === 'mammal' ? 1 : 0);
        tierAttr.push(node.tier);
      }
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
    geometry.setAttribute('aIndex', new BufferAttribute(new Float32Array(index), 1));
    geometry.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
    geometry.setAttribute('aScatter', new BufferAttribute(new Float32Array(scatter), 1));
    geometry.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 1));
    geometry.setAttribute('aKind', new BufferAttribute(new Float32Array(kind), 1));
    geometry.setAttribute('aTier', new BufferAttribute(new Float32Array(tierAttr), 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: COLUMN_VERTEX,
        fragmentShader: COLUMN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 2;
    return cloud;
  }

  /** A single bright head per species, which is what a finger aims at. */
  private buildCrowns(): Points {
    const position = new Float32Array(this.nodes.length * 3);
    const index = new Float32Array(this.nodes.length);
    const tierAttr = new Float32Array(this.nodes.length);
    const weight = new Float32Array(this.nodes.length);
    const found = new Float32Array(this.nodes.length);

    this.nodes.forEach((node, i) => {
      position[i * 3] = node.top.x;
      position[i * 3 + 1] = node.top.y;
      position[i * 3 + 2] = node.top.z;
      index[i] = i;
      tierAttr[i] = node.tier;
      weight[i] = node.species
        ? clamp(Math.log(node.species.count + 1) / Math.log(60), 0.25, 1)
        : 0;
      found[i] = node.species ? 1 : 0;
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aIndex', new BufferAttribute(index, 1));
    geometry.setAttribute('aTier', new BufferAttribute(tierAttr, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));
    geometry.setAttribute('aFound', new BufferAttribute(found, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CROWN_VERTEX,
        fragmentShader: CROWN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 3;
    return cloud;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.orbit = 0;
    this.orbitTarget = 0;
    this.zoom = 1.3;
    this.zoomTarget = 1;
    this.level = 0;
    this.levelTarget = 0;
    this.flight = 0;
    this.pinchPrevious = 0;
    this.selectStrength = 0;
    this.readoutKey = '';

    const carried = speciesSelection.name;
    const index = carried ? this.nodes.findIndex(n => n.species?.fr === carried) : -1;
    this.selected = index >= 0 ? index : null;
    if (index >= 0) this.levelTarget = this.nodes[index].tier;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.8, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pick(tap.ndc.x, tap.ndc.y);
      this.selected = hit === this.selected ? null : hit;
      // Only a species one of the surveys actually recorded can be carried to
      // the other chapters; the rest of the book exists nowhere else in the
      // piece, and handing them a name they cannot find would strand them.
      const held = this.selected === null ? null : this.nodes[this.selected].species;
      speciesSelection.set(held?.fr ?? null);
      if (this.selected !== null) this.levelTarget = this.nodes[this.selected].tier;
    }

    this.handleNavigation(ctx);

    this.selectStrength = damp(this.selectStrength, this.selected === null ? 0 : 1, 2.6, ctx.delta);
    this.uniforms.uSelected.value = this.selected ?? -1;
    this.uniforms.uSelectStrength.value = this.selectStrength;

    this.flight = Math.min(1, this.flight + ctx.delta / 4.2);
    this.updateCamera(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  /** Sideways turns the tower, up and down climbs it, two fingers close in. */
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
      if (wheel !== 0) this.zoomTarget *= Math.pow(0.87, wheel);

      const drag = ctx.pointer.dragWithInertia;
      if (Math.abs(drag.x) > 1e-6) this.orbitTarget -= drag.x * 3.2;
      if (Math.abs(drag.y) > 1e-6) {
        this.levelTarget = clamp(this.levelTarget + drag.y * 4.5, 0, TIERS.length - 1);
        this.selected = null;
      }
    }

    this.zoomTarget = clamp(this.zoomTarget, 0.62, 1.7);
    this.orbitTarget += ctx.delta * ctx.idle * 0.07;

    // Left alone the camera climbs the tower on its own and starts again at the
    // top — the four categories in order, worst first.
    if (ctx.idle > 0.4 && this.selected === null) {
      this.levelTarget += ctx.delta * ctx.idle * 0.22;
      if (this.levelTarget > TIERS.length - 1 + 0.4) this.levelTarget = 0;
    }
  }

  private updateCamera(ctx: FrameContext): void {
    this.orbit = damp(this.orbit, this.orbitTarget, 3, ctx.delta);
    this.zoom = damp(this.zoom, this.zoomTarget, 2.2, ctx.delta);
    this.level = damp(this.level, clamp(this.levelTarget, 0, TIERS.length - 1), 2.4, ctx.delta);

    const landed = 1 - Math.pow(1 - this.flight, 3);
    const halfV = MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * ctx.aspect);
    // The tower is taller than it is wide, so the frame has to answer to both.
    const reach = Math.max(R_RING * 1.35, (TIERS.length - 1) * TIER_GAP * 0.62);
    const framed = reach / Math.tan(Math.min(halfV, halfH));
    const distance = framed * this.zoom * (1 + (1 - landed) * 0.3);

    const focus = StatusScene.heightOf(this.level);
    const theta = this.orbit + Math.sin(ctx.time * 0.06) * 0.03 + ctx.pointer.centroid.x * 0.07;

    this.camera.position.set(
      Math.sin(theta) * distance * 0.82,
      focus + 3.4 + ctx.pointer.centroid.y * 1.2,
      Math.cos(theta) * distance * 0.82
    );
    this.camera.lookAt(0, focus + 0.6, 0);

    this.uniforms.uLevel.value = this.level;
  }

  private pick(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    let bestDistance = TAP_RADIUS;
    for (let i = 0; i < this.nodes.length; i += 1) {
      this.probe.copy(this.nodes[i].top).project(this.camera);
      if (this.probe.z > 1) continue;
      const distance = Math.hypot(this.probe.x - ndcX, this.probe.y - ndcY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  private updateMarker(): void {
    if (this.selected === null) {
      this.marker = undefined;
      return;
    }
    this.probe.copy(this.nodes[this.selected].top).project(this.camera);
    this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
  }

  // ----------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.selected === null ? `tier-${Math.round(this.level)}` : `species-${this.selected}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout =
        this.selected === null
          ? this.overviewReadout()
          : this.nodes[this.selected].species
            ? this.speciesReadout(this.selected)
            : this.bookReadout(this.selected);
    }
    this.cachedReadout.marker = this.marker;
  }

  private frame(): Readout {
    return {
      legend: TIERS.map(tier => ({ label: TIER_LABELS[tier], color: TIER_COLORS[tier] })),
      // A credit line, not a footnote. What the piece must never do is state a
      // status that is not in a source; which of the true ones it shows is
      // curation, and this is an installation, not a report.
      source: 'Cartea Roșie a Republicii Moldova · Liste rouge UICN · Every1Counts & BirdNET',
    };
  }

  private overviewReadout(): Readout {
    const tier = TIERS[clamp(Math.round(this.level), 0, TIERS.length - 1)];
    const onRing = this.nodes.filter(node => TIERS[node.tier] === tier);
    const lit = onRing.filter(node => node.species).length;
    const national = status.meta.national;

    // The near-threatened ring is the one category the national book does not
    // use, so it needs its own sentence rather than a wrong one.
    const body =
      tier === 'NT'
        ? `Cette couronne est celle de la liste mondiale : ${lit} espèces quasi menacées, ` +
          'entendues ici. La Carte Rouge de Moldavie n’emploie pas cette catégorie — ses trois ' +
          'échelons sont au-dessus.'
        : `${onRing.length} espèces de la Carte Rouge de la République de Moldova portent cette ` +
          `catégorie${lit > 0 ? `, et ${lit} d’entre elles ont été trouvées ici` : ''}. ` +
          'Les marques sombres sont le reste du livre : des espèces que ni les micros ni les ' +
          'pièges photo n’ont vues en quatre-vingts nuits. Touchez-en une. ' +
          // The transcription is short of the book and the chapter has to say so
          // where it is showing the book, not only in the credits.
          'Relevé des tables publiées : 39 oiseaux et 14 mammifères, contre 62 et 30 dans la ' +
          'troisième édition du livre — ce mur est donc plus court que la liste réelle.';

    return {
      ...this.frame(),
      eyebrow: `Chapitre VIII · ${TIER_LABELS[tier]}`,
      title: 'Livre rouge',
      body,
      stats: [
        { label: TIER_LABELS[tier], value: `${lit} / ${onRing.length}` },
        { label: 'Livre transcrit', value: `${national.listed} espèces` },
        { label: 'Trouvées ici', value: `${national.found} du livre` },
        { label: 'Confiance médiane', value: status.meta.confidence.median.toFixed(2) },
      ],
      spark: status.meta.confidence.histogram.map(v => v / Math.max(...status.meta.confidence.histogram)),
      accent: TIER_COLORS[tier],
    };
  }

  /**
   * A species of the book that neither survey found. There is no evidence to
   * show, so the readout gives what the book itself gives: the name it is
   * listed under, its category, and where in Moldova it is known from.
   */
  private bookReadout(index: number): Readout {
    const entry = this.nodes[index].entry;
    if (!entry) return this.overviewReadout();

    const name = entry.fr ?? entry.scientific;
    const science = entry.accepted ?? entry.scientific;
    const range = entry.whereFr ?? entry.where;

    return {
      ...this.frame(),
      eyebrow: `${TIER_LABELS[entry.category]} · ${science}`,
      title: name,
      body:
        `${entry.ro}, dans la Carte Rouge de la République de Moldova. ` +
        `Aire connue en Moldavie : ${range}. ` +
        'Aucun des deux relevés ne l’a trouvée à Purcari.',
      stats: [
        { label: 'Catégorie', value: entry.category },
        { label: 'Groupe', value: entry.kind === 'mammal' ? 'Mammifère' : 'Oiseau' },
        { label: 'À Purcari', value: 'non trouvée' },
      ],
      accent: TIER_COLORS[entry.category],
    };
  }

  private speciesReadout(index: number): Readout {
    const species = this.nodes[index].species;
    if (!species) return this.overviewReadout();
    const where = species.stations.join(' · ');
    const peak = species.hourly.indexOf(Math.max(...species.hourly));

    const listing = species.national
      ? `Carte Rouge de Moldavie : ${species.national.category}` +
        (species.national.whereFr ? `, connue en Moldavie ${prefixed(species.national.whereFr)}` : '') +
        // A bird can be protected here and unremarkable elsewhere; saying both
        // is the whole point of carrying two lists.
        (species.globalLabel === 'least concern' ? ', préoccupation mineure au niveau mondial' : '')
      : `Liste rouge mondiale UICN : ${species.global}`;
    const evidence = species.confidence
      ? `Confiance BirdNET ${species.confidence.median.toFixed(2)} sur ${species.confidence.n} ` +
        `détection${species.confidence.n > 1 ? 's' : ''} (de ${species.confidence.min.toFixed(2)} à ${species.confidence.max.toFixed(2)}).`
      : 'Identifiée à vue sur les photos du piège, sans score de modèle.';

    return {
      ...this.frame(),
      eyebrow: `${TIER_LABELS[species.tier]} · ${species.scientific}`,
      title: species.fr,
      body:
        `${listing}. ${evidence} ` +
        `${species.survey === 'camera' ? 'Photographiée' : 'Entendue'} à ${where}, ` +
        `heure de pointe ${String(peak).padStart(2, '0')}:00.`,
      stats: [
        { label: species.survey === 'camera' ? 'Passages' : 'Détections', value: String(species.count) },
        { label: species.survey === 'camera' ? 'Pièges' : 'Stations', value: String(species.stations.length) },
        {
          label: 'Confiance',
          value: species.confidence ? species.confidence.median.toFixed(2) : 'à vue',
        },
        { label: 'La nuit', value: `${Math.round(species.nocturnality * 100)} %` },
      ],
      spark: normalise(species.hourly),
      accent: TIER_COLORS[species.tier],
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
    uLevel: { value: 0 },
    uSelected: { value: -1 },
    uSelectStrength: { value: 0 },
    uTierColors: { value: TIERS.map(tier => color(TIER_COLORS[tier])) },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uWine: { value: color(PALETTE.wine) },
    uMist: { value: color(PALETTE.mist) },
    ...touch,
  };
}

/**
 * The book's range notes are bare noun phrases — "cours inférieur du Prut",
 * "partout, mais en faible densité" — and want different French prepositions.
 * Anything that already opens with an adverb is left to stand on its own.
 */
function prefixed(range: string): string {
  return /^(partout|rare|tout le)/i.test(range) ? `— ${range}` : `dans ${range}`;
}

function normalise(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map(v => v / max);
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const TOWER = /* glsl */ `
uniform float uLevel;
uniform float uSelected;
uniform float uSelectStrength;
uniform vec3 uTierColors[4];

/** 1 on the tier the camera is level with, falling away above and below. */
float tierFocus(float tier){
  return exp(-pow((tier - uLevel) * 1.15, 2.0));
}

float isSelected(float index){
  return uSelected < -0.5 ? 0.0 : step(abs(uSelected - index), 0.5);
}
`;

const RAIL_VERTEX = /* glsl */ `
uniform float uReveal;
attribute float aTier;
attribute float aAlong;
varying float vAlong;
varying float vFocus;
varying vec3 vColor;

${TOWER}

void main(){
  vAlong = aAlong;
  vFocus = tierFocus(aTier);
  vColor = uTierColors[int(aTier)];
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RAIL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReveal;
varying float vAlong;
varying float vFocus;
varying vec3 vColor;

void main(){
  // Dashed, so a rail reads as a scale rather than as a solid hoop.
  float dash = step(0.45, fract(vAlong * 96.0));
  float a = dash * (0.09 + vFocus * 0.30) * uReveal;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const COLUMN_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uWine;
uniform vec3 uGold;
uniform vec3 uBone;
attribute float aIndex;
attribute float aAlong;
attribute float aScatter;
attribute float aSeed;
attribute float aKind;
attribute float aTier;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;
varying float vScatter;

${SIMPLEX3}
${EASING}
${TOWER}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  // The evidence, drawn: a record the model was sure of sits on the column, one
  // it was not drifts off it. Nothing about the count changes — only how firmly
  // the light stands.
  float wander = snoise(vec3(aSeed * 12.0, uTime * 0.22, aAlong * 3.0));
  float sideways = snoise(vec3(aSeed * 7.0 + 40.0, uTime * 0.19, aAlong * 2.0));
  pos.x += sideways * aScatter * 1.5;
  pos.z += wander * aScatter * 1.5;
  pos.y += wander * aScatter * 0.55;

  // Everything breathes a little, sure or not.
  float t = uTime * 0.3 + aSeed * 6.2831;
  pos += vec3(sin(t), cos(t * 1.2) * 0.5, cos(t)) * 0.06;

  pos += touchDisplace(pos, 4.0, 0.8);
  float ripple = rippleField(pos, 8.0, 2.6, 1.6);
  pos.y += ripple * 0.4;

  vSelected = isSelected(aIndex) * uSelectStrength;
  vScatter = aScatter;
  float focus = tierFocus(aTier);

  vec3 base = mix(uGold, uWine * 1.5, aKind);
  vColor = mix(base, mix(base, uBone, 0.5) * 1.5, vSelected) + vec3(0.28, 0.19, 0.08) * ripple;

  float grow = easeOutQuart(clamp(uReveal * 1.7 - aAlong * 0.4, 0.0, 1.0));
  float dim = mix(1.0, 0.32, uSelectStrength * (1.0 - vSelected));
  vAlpha = (0.34 + focus * 0.55 + vSelected * 0.45) * grow * dim * mix(1.0, 0.7, aScatter);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.17 + vSelected * 0.1 + ripple * 0.07, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const COLUMN_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;
varying float vScatter;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  // A firm record has a hard little core; an uncertain one is all halo.
  float core = (1.0 - smoothstep(0.0, mix(0.45, 0.9, vScatter), d)) * mix(1.0, 0.55, vScatter);
  float halo = exp(-d * mix(3.2, 2.0, vScatter)) * 0.5;

  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.8, a);
}
`;

const CROWN_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uBone;
attribute float aIndex;
attribute float aTier;
attribute float aWeight;
attribute float aFound;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

${EASING}
${TOWER}
${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  vec3 pos = position;
  vSelected = isSelected(aIndex) * uSelectStrength;
  pos.y += vSelected * 0.2 + sin(uTime * 0.8 + aIndex) * 0.05;
  pos += touchDisplace(pos, 4.0, 0.5);

  float focus = tierFocus(aTier);
  // A species the surveys never found is on the ring as a dark mark: the book's
  // own colour, kept low, so a lit column reads as a find against a field of
  // species this estate has not seen.
  float lit = mix(0.44, 1.0, aFound);
  vColor = mix(uTierColors[int(aTier)], uBone, 0.25 + vSelected * 0.5)
         * (1.0 + vSelected * 0.6) * mix(0.75, 1.0, aFound);
  vAlpha = (0.5 + focus * 0.7) * lit * easeOutQuart(clamp(uReveal * 1.6, 0.0, 1.0))
         * mix(1.0, 0.35, uSelectStrength * (1.0 - vSelected));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(mix(0.2, 0.34 + aWeight * 0.42, aFound) + vSelected * 0.3, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const CROWN_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.5, d);
  float halo = exp(-d * 2.6) * 0.5;
  float ring = (1.0 - smoothstep(0.03, 0.09, abs(d - 0.8))) * vSelected;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.8 + vec3(ring) * 0.18, a);
}
`;
