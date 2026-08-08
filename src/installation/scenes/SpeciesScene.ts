import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { POINT_SIZE, RIPPLE_UNIFORMS, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildCss, guildIndex, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, normalisedHourly, type AtlasSpecies } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

const R_MIN = 3.4;
const R_SPAN = 13.5;

/** Neighbours each species is linked to, by similarity of daily rhythm. */
const LINKS_PER_NODE = 3;

/** Straight-line segments a spring is drawn with; the sag needs a few. */
const LINK_SEGMENTS = 6;

const TAP_RADIUS = 0.075;

/** Physics tuning. Substepped Verlet with position-based spring relaxation. */
const DAMPING = 0.972;
const SPRING_ITERATIONS = 2;
const SPRING_STIFFNESS = 0.16;
/** Pull toward the clock anchor, per second. The web may breathe, not wander. */
const ANCHOR_RATE = 2.1;
/** A held finger pushes the web open inside this radius. */
const FINGER_RADIUS = 6.5;
const FINGER_FORCE = 260;
/** A tap thumps everything inside this radius. */
const PLUCK_RADIUS = 7;
const PLUCK_IMPULSE = 9;

interface Node {
  species: AtlasSpecies;
  /** Where the clock says it belongs; the springs argue with this. */
  anchor: Vector3;
  position: Vector3;
  previous: Vector3;
  /** Heavier species move less — the hub holds while the rim swings. */
  mass: number;
  meanHour: number;
  concentration: number;
}

interface Spring {
  a: number;
  b: number;
  rest: number;
}

/**
 * Chapter III — Espèces.
 *
 * 121 species as a living spring web, integrated with Verlet every frame.
 *
 * Each node is anchored to the position the clock gives it — angle from the
 * circular mean of its hours, radius from inverse abundance — and sprung to the
 * three species whose daily rhythm most resembles its own, with the rest length
 * set by how *unlike* the rhythms are. The two systems disagree, and the
 * disagreement is the picture: the springs keep trying to gather the web into
 * rhythm clusters, the clock keeps holding it open, and the shape on screen is
 * the settled argument, still trembling.
 *
 * It is matter, not a diagram. Drag through it and the wake travels down the
 * links, node to node, at the speed the springs carry it. Tap and the web
 * thumps and rings. Hold a finger and it parts around the hand. On a phone the
 * device's own tilt sensor pours gravity through it, so turning the phone lets
 * the whole web hang from its anchors like wet rigging.
 */
export class SpeciesScene extends ChapterBase {
  readonly id = 'species' as const;
  readonly look = { exposure: 0.98, bloom: 0.6, grain: 0.022, aberration: 0.95, vignette: 1.1, trail: 0.6 };

  private readonly nodes: Node[] = [];
  private readonly springs: Spring[] = [];
  private readonly neighbours: number[][] = [];

  private readonly nodeCloud: Points;
  private readonly links: LineSegments;
  private readonly nodePositions: Float32Array;
  private readonly linkPositions: Float32Array;
  private readonly uniforms: ReturnType<typeof createUniforms>;

  /** Tilt-driven gravity, world units/s². Zero until a sensor speaks. */
  private readonly gravity = new Vector3();
  /**
   * The pose the hand settles into is "level" — nobody holds a phone flat, so
   * gravity follows *changes* of tilt against a baseline that drifts after the
   * reading over a few seconds. Tip the phone and the web swings; hold the new
   * pose and it quietly rights itself.
   */
  private baseGamma: number | null = null;
  private baseBeta = 0;
  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta === null || event.gamma === null) return;
    const beta = clamp(event.beta, -80, 80);
    if (this.baseGamma === null) {
      this.baseGamma = event.gamma;
      this.baseBeta = beta;
      return;
    }
    this.baseGamma += (event.gamma - this.baseGamma) * 0.008;
    this.baseBeta += (beta - this.baseBeta) * 0.008;
    const rollDelta = clamp(event.gamma - this.baseGamma, -45, 45);
    const pitchDelta = clamp(beta - this.baseBeta, -45, 45);
    this.gravity.set(
      Math.sin((rollDelta / 180) * Math.PI) * 24,
      -Math.sin((pitchDelta / 180) * Math.PI) * 24,
      0
    );
  };

  private selected: number | null = null;
  private selectStrength = 0;
  private flight = 0;
  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly markerProbe = new Vector3();
  private marker: { x: number; y: number } | undefined;
  private readonly scratch = new Vector3();

  constructor() {
    super(44);

    this.restSpherical.set(46, Math.PI * 0.5, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.idleSpin = 0.035;
    // In this chapter the finger is in the rigging, not on the tripod: a drag
    // stirs the web, and the camera only sways enough to give it depth.
    this.dragSensitivity = 0.45;
    this.minPolar = Math.PI * 0.34;
    this.maxPolar = Math.PI * 0.66;
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.layout();
    this.neighbours.push(...this.buildNeighbours());
    this.buildSprings();

    this.uniforms = createUniforms(this.touch);
    this.nodePositions = new Float32Array(this.nodes.length * 3);
    this.linkPositions = new Float32Array(this.springs.length * LINK_SEGMENTS * 2 * 3);
    this.links = this.buildLinks();
    this.nodeCloud = this.buildNodes();
    this.scene.add(this.links, this.nodeCloud);

    // The tilt sensor, where the platform grants one without ceremony. Where it
    // does not (iOS wants a permission dialog), the handler never fires and the
    // web simply floats — the desktop behaviour.
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', this.onOrientation);
    }

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  private layout(): void {
    const maxCount = atlas.species[0].count;
    atlas.species.forEach((species, index) => {
      const { meanHour, concentration } = circularStats(species.hourly);

      // Same clock mapping as the circadian chapters: midnight up, clockwise.
      const angle = Math.PI / 2 - (meanHour / 24) * Math.PI * 2;
      const abundance = Math.log(species.count + 1) / Math.log(maxCount + 1);
      const radius = R_MIN + (1 - abundance) * R_SPAN;

      const jitterAngle = (hash(index * 12.9898) - 0.5) * 0.34;
      const jitterRadius = (hash(index * 78.233) - 0.5) * 1.5;
      const r = radius + jitterRadius;
      const a = angle + jitterAngle;

      // Specialists float up, generalists settle — depth that says something.
      const z = (concentration * 2 - 1) * 3.4 + (hash(index * 3.7) - 0.5) * 1.0;

      const anchor = new Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
      // Born scattered far outside the frame: the opening seconds are the web
      // pulling itself together, which is the whole argument performed once.
      const start = anchor
        .clone()
        .multiplyScalar(2.6)
        .add(
          new Vector3(
            (hash(index * 9.1) - 0.5) * 30,
            (hash(index * 4.3) - 0.5) * 30,
            (hash(index * 6.7) - 0.5) * 8
          )
        );

      this.nodes.push({
        species,
        anchor,
        position: start,
        previous: start.clone(),
        mass: 0.6 + abundance * 2.6,
        meanHour,
        concentration,
      });
    });
  }

  /** Nearest neighbours by cosine similarity of the normalised hourly profile. */
  private buildNeighbours(): number[][] {
    const profiles = atlas.species.map(s => {
      const norm = Math.hypot(...s.hourly) || 1;
      return s.hourly.map(v => v / norm);
    });

    return profiles.map((a, i) => {
      const scored: { index: number; score: number }[] = [];
      for (let j = 0; j < profiles.length; j += 1) {
        if (i === j) continue;
        let dot = 0;
        for (let h = 0; h < 24; h += 1) dot += a[h] * profiles[j][h];
        scored.push({ index: j, score: dot });
      }
      scored.sort((x, y) => y.score - x.score);
      return scored.slice(0, LINKS_PER_NODE).map(s => s.index);
    });
  }

  /**
   * One spring per unique link. The rest length carries the data twice over:
   * anchored distance sets the scale, and rhythm-dissimilarity stretches it, so
   * species that sing the same hours pull visibly closer than the clock alone
   * would put them.
   */
  private buildSprings(): void {
    const seen = new Set<string>();
    this.neighbours.forEach((targets, i) => {
      for (const j of targets) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const anchored = this.nodes[i].anchor.distanceTo(this.nodes[j].anchor);
        this.springs.push({ a: i, b: j, rest: anchored * 0.82 });
      }
    });
  }

  // ------------------------------------------------------------------- build --

  private buildNodes(): Points {
    const count = this.nodes.length;
    const guild = new Float32Array(count);
    const size = new Float32Array(count);
    const index = new Float32Array(count);
    const seed = new Float32Array(count);

    const maxCount = atlas.species[0].count;
    this.nodes.forEach((node, i) => {
      guild[i] = guildIndex(node.species.guild);
      size[i] = clamp(Math.log(node.species.count + 1) / Math.log(maxCount + 1), 0.16, 1);
      index[i] = i;
      seed[i] = hash(i * 5.31);
    });

    const geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(this.nodePositions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    geometry.setAttribute('aIndex', new BufferAttribute(index, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: NODE_VERTEX,
        fragmentShader: NODE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    cloud.renderOrder = 2;
    return cloud;
  }

  private buildLinks(): LineSegments {
    const vertexCount = this.springs.length * LINK_SEGMENTS * 2;
    const along = new Float32Array(vertexCount);
    const endA = new Float32Array(vertexCount);
    const endB = new Float32Array(vertexCount);
    const strain = new Float32Array(vertexCount);

    let v = 0;
    for (const spring of this.springs) {
      for (let s = 0; s < LINK_SEGMENTS; s += 1) {
        for (const t of [s / LINK_SEGMENTS, (s + 1) / LINK_SEGMENTS]) {
          along[v] = t;
          endA[v] = spring.a;
          endB[v] = spring.b;
          strain[v] = 0;
          v += 1;
        }
      }
    }

    const geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(this.linkPositions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('aAlong', new BufferAttribute(along, 1));
    geometry.setAttribute('aEndA', new BufferAttribute(endA, 1));
    geometry.setAttribute('aEndB', new BufferAttribute(endB, 1));
    const strainAttribute = new BufferAttribute(strain, 1);
    strainAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aStrain', strainAttribute);

    const lines = new LineSegments(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: LINK_VERTEX,
        fragmentShader: LINK_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    lines.frustumCulled = false;
    return lines;
  }

  // ----------------------------------------------------------------- physics --

  /**
   * Substepped Verlet with position-based springs.
   *
   * A hundred and twenty-one nodes and two hundred springs is nothing for a
   * CPU; what matters is that impulses travel the web *through* the springs,
   * link by link, which no shader displacement can imitate — a shader moves
   * points, a solver moves consequences.
   */
  private simulate(ctx: FrameContext): void {
    const dt = Math.min(ctx.delta, 1 / 30);
    const steps = 2;
    const h = dt / steps;

    // Anchor pull weakens while a finger is down, so the web can actually be
    // dragged out of shape and snaps home on release.
    const touching = ctx.pointer.activeCount > 0;
    const anchorAlpha = 1 - Math.exp(-ANCHOR_RATE * (touching ? 0.4 : 1) * h);

    for (let step = 0; step < steps; step += 1) {
      for (const node of this.nodes) {
        // Integrate: inertia, damping, gravity scaled down by mass.
        const inertiaX = (node.position.x - node.previous.x) * DAMPING;
        const inertiaY = (node.position.y - node.previous.y) * DAMPING;
        const inertiaZ = (node.position.z - node.previous.z) * DAMPING;

        node.previous.copy(node.position);
        node.position.x += inertiaX + (this.gravity.x / node.mass) * h * h * 60;
        node.position.y += inertiaY + (this.gravity.y / node.mass) * h * h * 60;
        node.position.z += inertiaZ;

        // A held finger is a hand in the rigging.
        for (const touch of ctx.pointer.touches.values()) {
          if (!touch.down) continue;
          this.scratch.copy(node.position).sub(touch.world);
          const distance = this.scratch.length();
          if (distance > FINGER_RADIUS || distance < 1e-4) continue;
          const push = (1 - distance / FINGER_RADIUS) ** 2 * (FINGER_FORCE / node.mass) * h * h;
          node.position.addScaledVector(this.scratch.normalize(), push);
        }

        // The clock's claim on the node.
        node.position.lerp(node.anchor, anchorAlpha);
      }

      // Springs argue last, so their word carries into the next frame.
      for (let iteration = 0; iteration < SPRING_ITERATIONS; iteration += 1) {
        for (const spring of this.springs) {
          const a = this.nodes[spring.a];
          const b = this.nodes[spring.b];
          this.scratch.copy(b.position).sub(a.position);
          const distance = this.scratch.length();
          if (distance < 1e-5) continue;
          const correction = ((distance - spring.rest) / distance) * SPRING_STIFFNESS;
          const total = a.mass + b.mass;
          a.position.addScaledVector(this.scratch, correction * (b.mass / total));
          b.position.addScaledVector(this.scratch, -correction * (a.mass / total));
        }
      }
    }
  }

  /** A tap is a thump: an impulse into everything near it, carried by the web. */
  private pluck(world: Vector3): void {
    for (const node of this.nodes) {
      this.scratch.copy(node.position).sub(world);
      const distance = this.scratch.length();
      if (distance > PLUCK_RADIUS || distance < 1e-4) continue;
      const kick = (1 - distance / PLUCK_RADIUS) ** 2 * (PLUCK_IMPULSE / node.mass);
      // Verlet takes velocity as displacement of the past.
      node.previous.addScaledVector(this.scratch.normalize(), -kick * 0.016);
    }
  }

  /** Writes the solver's positions into the draw buffers. */
  private upload(): void {
    this.nodes.forEach((node, i) => {
      this.nodePositions[i * 3] = node.position.x;
      this.nodePositions[i * 3 + 1] = node.position.y;
      this.nodePositions[i * 3 + 2] = node.position.z;
    });
    (this.nodeCloud.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;

    const strainAttribute = this.links.geometry.getAttribute('aStrain') as BufferAttribute;
    const strains = strainAttribute.array as Float32Array;

    let v = 0;
    for (const spring of this.springs) {
      const a = this.nodes[spring.a].position;
      const b = this.nodes[spring.b].position;
      const distance = a.distanceTo(b);
      // How hard the spring is working right now, for the shader to show.
      const strain = clamp(Math.abs(distance - spring.rest) / spring.rest, 0, 1);

      // The spring sags: a quadratic bow whose belly follows gravity when there
      // is any, and eases toward the hub when there is none — slack rigging
      // either way, never a ruled line.
      const sag = spring.rest * 0.1 * (1 - strain * 0.85);
      const bellyX = (a.x + b.x) / 2 + (this.gravity.x !== 0 ? this.gravity.x * 0.01 : -(a.x + b.x) * 0.04) * sag;
      const bellyY = (a.y + b.y) / 2 + (this.gravity.lengthSq() > 1 ? this.gravity.y * 0.01 * sag : -sag) - (a.y + b.y) * 0.02;
      const bellyZ = (a.z + b.z) / 2;

      for (let s = 0; s < LINK_SEGMENTS; s += 1) {
        for (const t of [s / LINK_SEGMENTS, (s + 1) / LINK_SEGMENTS]) {
          const inv = 1 - t;
          this.linkPositions[v * 3] = inv * inv * a.x + 2 * inv * t * bellyX + t * t * b.x;
          this.linkPositions[v * 3 + 1] = inv * inv * a.y + 2 * inv * t * bellyY + t * t * b.y;
          this.linkPositions[v * 3 + 2] = inv * inv * a.z + 2 * inv * t * bellyZ + t * t * b.z;
          strains[v] = strain;
          v += 1;
        }
      }
    }
    (this.links.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    strainAttribute.needsUpdate = true;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.selectStrength = 0;
    this.flight = 0;
    this.desired.radius = this.restSpherical.radius * 1.3;

    // Scatter again, so every entry replays the web assembling itself.
    this.nodes.forEach((node, index) => {
      node.position
        .copy(node.anchor)
        .multiplyScalar(2.6)
        .add(
          new Vector3(
            (hash(index * 9.1) - 0.5) * 30,
            (hash(index * 4.3) - 0.5) * 30,
            (hash(index * 6.7) - 0.5) * 8
          )
        );
      node.previous.copy(node.position);
    });

    const carried = speciesSelection.name;
    const index = carried ? atlas.species.findIndex(s => s.name === carried) : -1;
    this.selected = index >= 0 ? index : null;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.9, ctx.delta);

    // A portrait panel sees a narrow slice of the web; pull the camera back
    // until the whole rigging fits the frame.
    const aspectPull = ctx.aspect < 1.25 ? Math.pow(1.25 / ctx.aspect, 0.7) : 1;
    this.restSpherical.radius = 46 * aspectPull;

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pickNode(tap.ndc.x, tap.ndc.y);
      this.selected = hit === this.selected ? null : hit;
      speciesSelection.set(this.selected === null ? null : atlas.species[this.selected].name);
      this.pluck(tap.world);
    }

    this.simulate(ctx);
    this.upload();

    this.selectStrength = damp(this.selectStrength, this.selected === null ? 0 : 1, 2.6, ctx.delta);
    this.uniforms.uSelected.value = this.selected ?? -1;
    this.uniforms.uSelectStrength.value = this.selectStrength;

    if (this.selected !== null) {
      const node = this.nodes[this.selected];
      this.desiredTarget.copy(node.position).multiplyScalar(0.45);
      this.desired.radius = damp(this.desired.radius, 37 * aspectPull, 1.4, ctx.delta);
      this.recentres = false;
    } else {
      this.desiredTarget.set(0, 0, 0);
      this.recentres = true;
    }

    this.flight = Math.min(1, this.flight + ctx.delta / 4.5);
    const landed = 1 - Math.pow(1 - this.flight, 3);
    this.desired.phi = damp(this.desired.phi, this.restSpherical.phi + (1 - landed) * 0.55, 2.0, ctx.delta);

    this.updateCameraRig(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  private pickNode(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    let bestDistance = TAP_RADIUS;
    for (let i = 0; i < this.nodes.length; i += 1) {
      this.markerProbe.copy(this.nodes[i].position).project(this.camera);
      if (this.markerProbe.z > 1) continue;
      const distance = Math.hypot(this.markerProbe.x - ndcX, this.markerProbe.y - ndcY);
      const bias = 1 - Math.log(this.nodes[i].species.count + 1) / Math.log(atlas.species[0].count + 1) * 0.35;
      if (distance * bias < bestDistance) {
        bestDistance = distance * bias;
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
    this.markerProbe.copy(this.nodes[this.selected].position).project(this.camera);
    this.marker = {
      x: (this.markerProbe.x + 1) / 2,
      y: (1 - this.markerProbe.y) / 2,
    };
  }

  // ---------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.selected === null ? 'overview' : `species-${this.selected}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout = this.selected === null ? this.overviewReadout() : this.speciesReadout(this.selected);
    }
    this.cachedReadout.marker = this.marker;
  }

  private overviewReadout(): Readout {
    const nocturnal = atlas.species.filter(s => s.nocturnality > 0.5).length;
    return {
      eyebrow: 'Chapitre III',
      title: 'Espèces',
      body:
        'Une toile de ressorts : chaque nœud est une espèce à l’heure moyenne de son chant, ' +
        'reliée à celles qui partagent son rythme. Traversez-la du doigt — l’onde court de lien en lien. ' +
        'Touchez un nœud pour le tenir.',
      stats: [
        { label: 'Espèces', value: String(atlas.meta.speciesCount) },
        { label: 'Nocturnes', value: String(nocturnal) },
        { label: 'Ressorts', value: String(this.springs.length) },
      ],
      accent: PALETTE.bone,
    };
  }

  private speciesReadout(index: number): Readout {
    const node = this.nodes[index];
    const species = node.species;
    const guild = atlas.guilds.find(g => g.id === species.guild);
    const linked = this.neighbours[index].map(i => atlas.species[i].name);

    return {
      eyebrow: guild?.label ?? 'Espèce',
      title: species.name,
      body: `Rythme proche de : ${linked.join(' · ')}.`,
      stats: [
        { label: 'Détections', value: String(species.count) },
        { label: 'Heure moyenne', value: formatHour(Math.round(node.meanHour) % 24) },
        { label: 'Nocturnité', value: `${Math.round(species.nocturnality * 100)} %` },
        { label: 'Stations', value: `${species.stations.length} / ${atlas.meta.stationCount}` },
      ],
      spark: normalisedHourly(species.hourly),
      accent: guildCss(species.guild),
      marker: this.marker,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('deviceorientation', this.onOrientation);
    }
    super.dispose();
  }
}

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uSelected: { value: -1 },
    uSelectStrength: { value: 0 },
    uGuildColors: { value: guildColorArray() },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uMist: { value: color(PALETTE.mist) },
    ...touch,
  };
}

/** Circular mean and concentration of an hourly histogram. */
function circularStats(hourly: number[]): { meanHour: number; concentration: number } {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (let h = 0; h < 24; h += 1) {
    const weight = hourly[h];
    if (weight === 0) continue;
    const angle = (h / 24) * Math.PI * 2;
    sx += weight * Math.cos(angle);
    sy += weight * Math.sin(angle);
    total += weight;
  }
  if (total === 0) return { meanHour: 12, concentration: 0 };
  const meanAngle = Math.atan2(sy, sx);
  const meanHour = (((meanAngle / (Math.PI * 2)) * 24) + 24) % 24;
  return { meanHour, concentration: Math.hypot(sx, sy) / total };
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

const NODE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform vec3 uGuildColors[6];
attribute float aGuild;
attribute float aSize;
attribute float aIndex;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

${SELECTION}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  // The solver owns the motion; the shader only lights what it is handed.
  vec3 pos = position;

  float selected = isSelected(aIndex);
  vSelected = selected * uSelectStrength;

  float ripple = rippleField(pos, 9.0, 2.6, 1.8);

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = guild * (0.85 + vSelected * 1.6) + vec3(0.45, 0.32, 0.14) * ripple;
  vColor += vec3(0.3) * touchGlow(pos, 5.5);

  float dim = mix(1.0, 0.3, uSelectStrength * (1.0 - selected));
  vAlpha = (0.4 + aSize * 0.6) * uReveal * dim;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.22 + aSize * 1.0 + vSelected * 0.9 + ripple * 0.4, mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const NODE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;

  float core = 1.0 - smoothstep(0.0, 0.55, d);
  float halo = exp(-d * 2.6) * 0.5;
  float ring = (1.0 - smoothstep(0.02, 0.06, abs(d - 0.78))) * vSelected;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.7 + vec3(ring) * 0.25, a);
}
`;

const LINK_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aAlong;
attribute float aEndA;
attribute float aEndB;
attribute float aStrain;
varying float vAlpha;
varying float vHighlight;
varying float vAlong;
varying float vStrain;

${SELECTION}

void main(){
  float touching = max(isSelected(aEndA), isSelected(aEndB));
  vHighlight = touching * uSelectStrength;
  vAlong = aAlong;
  vStrain = aStrain;

  vAlpha = mix(0.16, 0.66, vHighlight) * mix(1.0, 0.25, uSelectStrength * (1.0 - touching)) * uReveal;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LINK_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uMist;
uniform vec3 uGold;
uniform vec3 uBone;
varying float vAlpha;
varying float vHighlight;
varying float vAlong;
varying float vStrain;

void main(){
  float taper = sin(vAlong * 3.14159);
  float pulse = exp(-pow(fract(vAlong - uTime * 0.28) - 0.5, 2.0) * 26.0) * vHighlight;

  // A spring under strain heats toward gold: the physics is visible as light,
  // and a wake crossing the web reads as a run of warming threads.
  vec3 tint = mix(mix(uMist, uBone, 0.45) * 0.8, uGold, clamp(vStrain * 2.2, 0.0, 0.85) + vHighlight * 0.8 + pulse);
  float a = (vAlpha + vStrain * 0.5) * taper + pulse * 0.5;
  if (a < 0.003) discard;
  gl_FragColor = vec4(tint * a * 0.85, a);
}
`;
