import {
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildCss, guildIndex, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, normalisedHourly, type AtlasSpecies } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

const R_MIN = 3.4;
const R_SPAN = 13.5;

/** Neighbours each species is linked to, by similarity of daily rhythm. */
const LINKS_PER_NODE = 3;
const LINK_SEGMENTS = 14;

const TAP_RADIUS = 0.075;

interface Node {
  species: AtlasSpecies;
  position: Vector3;
  /** Circular mean of the species' hourly profile, 0..24. */
  meanHour: number;
  /** 0 = active around the clock, 1 = active in a single narrow window. */
  concentration: number;
}

/**
 * Chapter III — Espèces.
 *
 * 121 species, positioned by *when* they were heard rather than by any arbitrary
 * layout. The angle of each node is the circular mean of its 24-hour activity
 * profile — so the dawn chorus gathers on one side and the owls, nightjars and
 * scops owls drift to the other. Distance from the centre is inverse abundance:
 * the five species that account for a third of all detections sit in the hub,
 * the single-record rarities hang at the rim.
 *
 * Links join species with similar daily rhythms, which is why the web reads as
 * bands rather than as noise.
 */
export class SpeciesScene extends ChapterBase {
  readonly id = 'species' as const;
  readonly look = { exposure: 0.98, bloom: 0.6, grain: 0.022, aberration: 0.95, vignette: 1.1 };

  private readonly nodes: Node[] = [];
  private readonly nodeCloud: Points;
  private readonly links: LineSegments;
  private readonly uniforms: ReturnType<typeof createUniforms>;

  /** Indices of the species linked to the selected one. */
  private readonly neighbours: number[][] = [];

  private selected: number | null = null;
  private selectStrength = 0;
  /** 0 on entering, 1 once the opening move has landed. */
  private flight = 0;
  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly markerProbe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  constructor() {
    super(44);

    this.restSpherical.set(46, Math.PI * 0.5, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.idleSpin = 0.035;
    this.minPolar = Math.PI * 0.2;
    this.maxPolar = Math.PI * 0.8;
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    this.layout();
    this.neighbours = this.buildNeighbours();

    this.uniforms = createUniforms(this.touch);

    this.links = this.buildLinks();
    this.nodeCloud = this.buildNodes();
    this.scene.add(this.links, this.nodeCloud);

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ layout --

  private layout(): void {
    const maxCount = atlas.species[0].count;
    atlas.species.forEach((species, index) => {
      const { meanHour, concentration } = circularStats(species.hourly);

      // Same clock mapping as the circadian dial, so a visitor moving between
      // chapters keeps their bearings: midnight up, hours clockwise.
      const angle = Math.PI / 2 - (meanHour / 24) * Math.PI * 2;

      // Inverse abundance on a log scale: the hub is the handful of species that
      // dominate the recording, the rim is everything heard once or twice.
      const abundance = Math.log(species.count + 1) / Math.log(maxCount + 1);
      const radius = R_MIN + (1 - abundance) * R_SPAN;

      // Deterministic jitter so equal-count species do not stack into one dot.
      const jitterAngle = (hash(index * 12.9898) - 0.5) * 0.34;
      const jitterRadius = (hash(index * 78.233) - 0.5) * 1.5;
      const r = radius + jitterRadius;
      const a = angle + jitterAngle;

      // Specialists rise, generalists settle — the web gains a third dimension
      // that says something rather than being decorative depth.
      const y = (concentration * 2 - 1) * 5.5 + (hash(index * 3.7) - 0.5) * 1.2;

      this.nodes.push({
        species,
        position: new Vector3(Math.cos(a) * r, Math.sin(a) * r, y),
        meanHour,
        concentration,
      });
    });
  }

  /**
   * Nearest neighbours by cosine similarity of the normalised hourly profile.
   * 121 species means the full 121x121 comparison is trivial, so no index needed.
   */
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

  private buildNodes(): Points {
    const count = this.nodes.length;
    const position = new Float32Array(count * 3);
    const guild = new Float32Array(count);
    const size = new Float32Array(count);
    const index = new Float32Array(count);
    const seed = new Float32Array(count);

    const maxCount = atlas.species[0].count;
    this.nodes.forEach((node, i) => {
      position[i * 3] = node.position.x;
      position[i * 3 + 1] = node.position.y;
      position[i * 3 + 2] = node.position.z;
      guild[i] = guildIndex(node.species.guild);
      size[i] = clamp(Math.log(node.species.count + 1) / Math.log(maxCount + 1), 0.16, 1);
      index[i] = i;
      seed[i] = hash(i * 5.31);
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
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
    return cloud;
  }

  /** Links as subdivided quadratic curves, bowed toward the centre of the web. */
  private buildLinks(): LineSegments {
    const pairs = new Set<string>();
    const edges: [number, number][] = [];
    this.neighbours.forEach((targets, i) => {
      for (const j of targets) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (pairs.has(key)) continue;
        pairs.add(key);
        edges.push([i, j]);
      }
    });

    const vertexCount = edges.length * LINK_SEGMENTS * 2;
    const position = new Float32Array(vertexCount * 3);
    const along = new Float32Array(vertexCount);
    const endA = new Float32Array(vertexCount);
    const endB = new Float32Array(vertexCount);

    const control = new Vector3();
    const sample = new Vector3();
    let v = 0;

    for (const [i, j] of edges) {
      const a = this.nodes[i].position;
      const b = this.nodes[j].position;
      // Pull the control point toward the hub so links arc through the middle
      // instead of chording straight across the ring.
      control.addVectors(a, b).multiplyScalar(0.5).multiplyScalar(0.62);

      for (let s = 0; s < LINK_SEGMENTS; s += 1) {
        for (const t of [s / LINK_SEGMENTS, (s + 1) / LINK_SEGMENTS]) {
          quadratic(a, control, b, t, sample);
          position[v * 3] = sample.x;
          position[v * 3 + 1] = sample.y;
          position[v * 3 + 2] = sample.z;
          along[v] = t;
          endA[v] = i;
          endB[v] = j;
          v += 1;
        }
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aAlong', new BufferAttribute(along, 1));
    geometry.setAttribute('aEndA', new BufferAttribute(endA, 1));
    geometry.setAttribute('aEndB', new BufferAttribute(endB, 1));

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

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.selectStrength = 0;
    this.flight = 0;
    this.desired.radius = this.restSpherical.radius * 1.3;

    // Whatever was held elsewhere, if this survey heard it.
    const carried = speciesSelection.name;
    const index = carried ? atlas.species.findIndex(s => s.name === carried) : -1;
    this.selected = index >= 0 ? index : null;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.9, ctx.delta);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pickNode(tap.ndc.x, tap.ndc.y);
      this.selected = hit === this.selected ? null : hit;
      speciesSelection.set(this.selected === null ? null : atlas.species[this.selected].name);
    }

    this.selectStrength = damp(this.selectStrength, this.selected === null ? 0 : 1, 2.6, ctx.delta);
    this.uniforms.uSelected.value = this.selected ?? -1;
    this.uniforms.uSelectStrength.value = this.selectStrength;

    if (this.selected !== null) {
      const node = this.nodes[this.selected];
      // Drift the frame toward the selection without snapping onto it — the web
      // has to stay legible around whatever is chosen.
      this.desiredTarget.copy(node.position).multiplyScalar(0.45);
      this.desired.radius = damp(this.desired.radius, 37, 1.4, ctx.delta);
      this.recentres = false;
    } else {
      this.desiredTarget.set(0, 0, 0);
      this.recentres = true;
    }

    // Opening move: the web unrolls from a steep angle into its resting one.
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
      // Larger nodes claim a slightly larger tap area, matching what is drawn.
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
    // The marker moves every frame while the camera drifts. It is mutated in
    // place rather than spread into a new object, because the overlay uses
    // reference equality to decide whether to re-render — and the marker is
    // written straight to the DOM, so it never needs one.
    this.cachedReadout.marker = this.marker;
  }

  private overviewReadout(): Readout {
    const nocturnal = atlas.species.filter(s => s.nocturnality > 0.5).length;
    return {
      eyebrow: 'Chapitre III',
      title: 'Espèces',
      body:
        'Chaque nœud est une espèce, placée selon l’heure moyenne de ses détections. ' +
        'Les liens relient les espèces qui partagent le même rythme quotidien. Touchez un nœud.',
      stats: [
        { label: 'Espèces', value: String(atlas.meta.speciesCount) },
        { label: 'Nocturnes', value: String(nocturnal) },
        { label: 'Vues une seule fois', value: String(atlas.species.filter(s => s.count === 1).length) },
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

/**
 * Circular mean and concentration of an hourly histogram. Treating the clock as
 * a circle is the only correct way to average times: a species heard at 23:00
 * and 01:00 peaks at midnight, not at noon.
 */
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

function quadratic(a: Vector3, control: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const inv = 1 - t;
  return out.set(
    inv * inv * a.x + 2 * inv * t * control.x + t * t * b.x,
    inv * inv * a.y + 2 * inv * t * control.y + t * t * b.y,
    inv * inv * a.z + 2 * inv * t * control.z + t * t * b.z
  );
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

${SIMPLEX3}
${HASH}
${EASING}
${SELECTION}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

void main(){
  vec3 pos = position;

  // Every node drifts on its own slow orbit; without it the web looks printed.
  float t = uTime * 0.16 + aSeed * 6.2831;
  pos += vec3(sin(t), cos(t * 1.13), sin(t * 0.87)) * (0.28 + aSize * 0.5);
  pos += vec3(snoise(vec3(pos.xy * 0.09, uTime * 0.07))) * 0.35;

  pos += touchDisplace(pos, 5.5, 1.6);
  float ripple = rippleField(pos, 9.0, 2.6, 1.8);
  pos += normalize(pos + 1e-4) * ripple * 0.9;

  float selected = isSelected(aIndex);
  vSelected = selected * uSelectStrength;
  pos += normalize(pos + 1e-4) * vSelected * 0.8;

  // Reveal sweeps outward from the hub.
  float radius = length(position.xy);
  float grow = easeOutQuart(clamp(uReveal * 1.5 - radius / 26.0, 0.0, 1.0));
  pos *= mix(0.25, 1.0, grow);

  vec3 guild = uGuildColors[int(aGuild)];
  vColor = guild * (0.85 + vSelected * 1.6) + vec3(0.45, 0.32, 0.14) * ripple;
  vColor += vec3(0.3) * touchGlow(pos, 5.5);

  // Unselected nodes recede but never vanish: the shape of the web is the point.
  float dim = mix(1.0, 0.3, uSelectStrength * (1.0 - selected));
  vAlpha = (0.4 + aSize * 0.6) * grow * dim;

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
  // Selected nodes gain a thin ring, the one hard edge in the whole piece.
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
varying float vAlpha;
varying float vHighlight;
varying float vAlong;

${SIMPLEX3}
${EASING}
${SELECTION}
${TOUCH_UNIFORMS}

void main(){
  vec3 pos = position;
  pos += vec3(snoise(vec3(pos.xy * 0.1, uTime * 0.06))) * 0.28;
  pos += touchDisplace(pos, 5.5, 1.0);

  float touching = max(isSelected(aEndA), isSelected(aEndB));
  vHighlight = touching * uSelectStrength;
  pos += normalize(pos + 1e-4) * vHighlight * 0.5;

  float radius = length(position.xy);
  float grow = easeOutQuart(clamp(uReveal * 1.4 - radius / 30.0, 0.0, 1.0));
  pos *= mix(0.25, 1.0, grow);

  vAlong = aAlong;
  // Links fade back hard when something is selected, so the chosen species' own
  // connections are the only ones legible.
  vAlpha = mix(0.16, 0.66, vHighlight) * mix(1.0, 0.25, uSelectStrength * (1.0 - touching)) * grow;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
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

void main(){
  // Taper toward both ends so links read as filaments, not as struts.
  float taper = sin(vAlong * 3.14159);
  // A pulse travels along highlighted links, in the direction of the curve.
  float pulse = exp(-pow(fract(vAlong - uTime * 0.28) - 0.5, 2.0) * 26.0) * vHighlight;

  // Warmed toward bone so the web sits inside the palette instead of reading
  // as cool wireframe over a warm scene.
  vec3 tint = mix(mix(uMist, uBone, 0.45) * 0.8, uGold, vHighlight * 0.8 + pulse);
  float a = vAlpha * taper + pulse * 0.5;
  if (a < 0.003) discard;
  gl_FragColor = vec4(tint * a * 0.85, a);
}
`;
