import { BufferAttribute, BufferGeometry, DoubleSide, MathUtils, Mesh, Points, ShaderMaterial, Vector3 } from 'three';
import { ADDITIVE } from '../engine/blending';
import { EASING, HASH, POINT_SIZE, RIPPLE_UNIFORMS, SIMPLEX3, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, PALETTE } from '../engine/palette';
import type { FrameContext, Readout } from '../engine/Scene';
import {
  overlap,
  overlapCount,
  overlapExtremes,
  overlapKindLabel,
  overlapMatrix,
  overlapOrder,
  overlapPairs,
  overlapSpecies,
} from '../data/overlap';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

const RING_RADIUS = 11.5;

/** Subdivisions along each chord. */
const CHORD_SEGMENTS = 26;

/** Seconds each species holds the highlight when nobody is touching. */
const CYCLE_SECONDS = 5.5;

const TAP_RADIUS = 0.085;

/**
 * Chapter V — Chevauchement.
 *
 * Eighteen species that share the estate, and the Spearman correlation between
 * their activity through the day. A warm chord means two species are out at the
 * same hours; a cool one means they avoid each other in time.
 *
 * The ring order is not a design choice. It is the dominant eigenvector of the
 * correlation matrix — the axis the data is actually built around — and it
 * separates the mammals from the birds on its own, with the red fox landing
 * almost exactly at zero and the dog filed among the birds because dogs are
 * walked in daylight. Neighbours on the ring share their hours; opposite sides
 * never meet.
 *
 * Source: Every1Counts, ten months of camera-trap data, June 2025 – March 2026.
 */
export class OverlapScene extends ChapterBase {
  readonly id = 'overlap' as const;
  readonly look = { exposure: 0.98, bloom: 0.6, grain: 0.022, aberration: 0.9, vignette: 1.12 };

  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly nodePositions: Vector3[] = [];
  /** Ring slot of each species, indexed by species id. */
  private readonly slotOf: number[] = [];

  private selected: number | null = null;
  private cycleIndex = 0;
  private cycleTimer = 0;
  private held = false;
  private flight = 0;

  private cachedReadout: Readout;
  private readoutKey = '';
  private readonly probe = new Vector3();
  private marker: { x: number; y: number } | undefined;

  constructor() {
    super(42);

    this.restSpherical.set(34, Math.PI / 2, 0);
    this.spherical.copy(this.restSpherical);
    this.desired.copy(this.restSpherical);
    this.desiredTarget.set(0, 0, 0);
    this.target.set(0, 0, 0);
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = 0;

    overlapOrder.indices.forEach((speciesIndex, slot) => {
      this.slotOf[speciesIndex] = slot;
      // Midnight-up, clockwise: the same convention as every other clock here.
      const angle = Math.PI / 2 - (slot / overlapCount) * Math.PI * 2;
      this.nodePositions[speciesIndex] = new Vector3(
        Math.cos(angle) * RING_RADIUS,
        Math.sin(angle) * RING_RADIUS,
        0
      );
    });

    this.uniforms = createUniforms(this.touch);
    this.buildChords();
    this.buildNodes();

    this.cachedReadout = this.overviewReadout();
  }

  // ------------------------------------------------------------------ build --

  /**
   * Every pair as a tapered ribbon bowed through the middle of the ring.
   *
   * Ribbons rather than lines because the weight of a relationship is the point,
   * and WebGL line width is one pixel whatever you ask for. No threshold is
   * applied: alpha runs as the square of |rho|, so weak pairs fade to nothing on
   * their own and the ring keeps its full texture instead of a cut-off.
   */
  private buildChords(): void {
    const pairs = overlapPairs;
    const vertexCount = pairs.length * (CHORD_SEGMENTS + 1) * 2;

    const position = new Float32Array(vertexCount * 3);
    const rho = new Float32Array(vertexCount);
    const along = new Float32Array(vertexCount);
    const endA = new Float32Array(vertexCount);
    const endB = new Float32Array(vertexCount);
    const index: number[] = [];

    const a = new Vector3();
    const b = new Vector3();
    const control = new Vector3();
    const point = new Vector3();
    const next = new Vector3();

    let v = 0;
    for (const pair of pairs) {
      a.copy(this.nodePositions[pair.i]);
      b.copy(this.nodePositions[pair.j]);
      // Pulling the control point most of the way to the centre bundles the
      // chords, so the ring reads as a woven interior rather than a scribble.
      control.addVectors(a, b).multiplyScalar(0.5).multiplyScalar(0.16);

      const weight = Math.abs(pair.rho);
      const width = 0.05 + weight * weight * 0.62;
      const base = v;

      for (let s = 0; s <= CHORD_SEGMENTS; s += 1) {
        const t = s / CHORD_SEGMENTS;
        quadratic(a, control, b, t, point);
        quadratic(a, control, b, Math.min(1, t + 0.01), next);

        // Perpendicular in the ring plane; every chord is flat in z.
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.hypot(dx, dy) || 1;
        const nx = -dy / length;
        const ny = dx / length;

        // Taper to a point at both ends so chords meet the nodes cleanly.
        const taper = Math.sqrt(Math.sin(t * Math.PI));
        const half = (width * taper) / 2;

        for (const side of [-1, 1]) {
          position[v * 3] = point.x + nx * half * side;
          position[v * 3 + 1] = point.y + ny * half * side;
          position[v * 3 + 2] = point.z;
          rho[v] = pair.rho;
          along[v] = t;
          endA[v] = pair.i;
          endB[v] = pair.j;
          v += 1;
        }
      }

      for (let s = 0; s < CHORD_SEGMENTS; s += 1) {
        const q = base + s * 2;
        index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aRho', new BufferAttribute(rho, 1));
    geometry.setAttribute('aAlong', new BufferAttribute(along, 1));
    geometry.setAttribute('aEndA', new BufferAttribute(endA, 1));
    geometry.setAttribute('aEndB', new BufferAttribute(endB, 1));
    geometry.setIndex(index);

    const mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CHORD_VERTEX,
        fragmentShader: CHORD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        ...ADDITIVE,
      })
    );
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  private buildNodes(): void {
    const position = new Float32Array(overlapCount * 3);
    const kind = new Float32Array(overlapCount);
    const index = new Float32Array(overlapCount);
    const weight = new Float32Array(overlapCount);
    const axis = new Float32Array(overlapCount);

    for (let i = 0; i < overlapCount; i += 1) {
      const p = this.nodePositions[i];
      position[i * 3] = p.x;
      position[i * 3 + 1] = p.y;
      position[i * 3 + 2] = p.z;
      kind[i] = overlapSpecies[i].kind === 'mammal' ? 0 : overlapSpecies[i].kind === 'bird' ? 1 : 2;
      index[i] = i;
      // How strongly a species is tied into the community at all.
      let total = 0;
      for (let j = 0; j < overlapCount; j += 1) if (j !== i) total += Math.abs(overlapMatrix[i][j]);
      weight[i] = clamp(total / (overlapCount - 1), 0.1, 1);
      axis[i] = overlapOrder.axis[i];
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aKind', new BufferAttribute(kind, 1));
    geometry.setAttribute('aIndex', new BufferAttribute(index, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));
    geometry.setAttribute('aAxis', new BufferAttribute(axis, 1));

    const nodes = new Points(
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
    nodes.frustumCulled = false;
    this.scene.add(nodes);
  }

  // ----------------------------------------------------------------- update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.selected = null;
    this.held = false;
    this.cycleIndex = 0;
    this.cycleTimer = 0;
    this.flight = 0;
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.85, ctx.delta);
    this.flight = Math.min(1, this.flight + ctx.delta / 4.0);

    for (const tap of ctx.pointer.consumeTaps()) {
      const hit = this.pickNode(tap.ndc.x, tap.ndc.y);
      if (hit === null || hit === this.selected) {
        // Tapping the selection again, or tapping the empty middle, hands the
        // ring back to the automatic walk.
        this.selected = null;
        this.held = false;
      } else {
        this.selected = hit;
        this.held = true;
        this.cycleTimer = 0;
      }
    }

    if (!this.held) {
      this.cycleTimer += ctx.delta;
      if (this.cycleTimer > CYCLE_SECONDS) {
        this.cycleTimer = 0;
        this.cycleIndex = (this.cycleIndex + 1) % overlapCount;
      }
      // The walk follows the ring, not the species list, so it reads as a sweep.
      this.selected = overlapOrder.indices[this.cycleIndex];
    }

    this.uniforms.uSelected.value = this.selected ?? -1;
    this.uniforms.uHeld.value = damp(this.uniforms.uHeld.value, this.held ? 1 : 0, 3, ctx.delta);

    this.frameCamera(ctx);
    this.updateMarker();
    this.refreshReadout();
  }

  private frameCamera(ctx: FrameContext): void {
    const halfV = MathUtils.degToRad(this.camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * ctx.aspect);
    const framed = (RING_RADIUS * 1.32) / Math.tan(Math.min(halfV, halfH));

    // Opening move: the ring arrives edge-on and rolls flat to the panel.
    const landed = 1 - Math.pow(1 - this.flight, 3);
    const distance = framed * (1 + (1 - landed) * 0.7);
    const tilt = Math.cos(ctx.time * 0.15) * 0.03 + ctx.pointer.centroid.y * 0.05 + (1 - landed) * 0.75;
    const sway = Math.sin(ctx.time * 0.19) * 0.04 + ctx.pointer.centroid.x * 0.06;

    this.spherical.radius = damp(this.spherical.radius, distance, 2.0, ctx.delta);
    this.spherical.theta = damp(this.spherical.theta, sway, 1.6, ctx.delta);
    this.spherical.phi = damp(this.spherical.phi, Math.PI / 2 - tilt, 1.6, ctx.delta);

    this.camera.position.setFromSpherical(this.spherical);
    this.camera.lookAt(0, 0, 0);
  }

  private pickNode(ndcX: number, ndcY: number): number | null {
    let best: number | null = null;
    let bestDistance = TAP_RADIUS;
    for (let i = 0; i < overlapCount; i += 1) {
      this.probe.copy(this.nodePositions[i]).project(this.camera);
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
    this.probe.copy(this.nodePositions[this.selected]).project(this.camera);
    this.marker = { x: (this.probe.x + 1) / 2, y: (1 - this.probe.y) / 2 };
  }

  // ---------------------------------------------------------------- readout --

  private refreshReadout(): void {
    const key = this.selected === null ? 'overview' : `s-${this.selected}-${this.held ? 'held' : 'walk'}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout = this.selected === null ? this.overviewReadout() : this.speciesReadout(this.selected);
    }
    this.cachedReadout.marker = this.marker;
  }

  private overviewReadout(): Readout {
    return {
      eyebrow: 'Chapitre V · Chevauchement temporel',
      title: 'Deux équipes',
      body:
        'Dix-huit espèces partagent le domaine sans se croiser. L’anneau est ordonné ' +
        'par l’axe dominant de leurs rythmes : les mammifères d’un côté, les oiseaux ' +
        'de l’autre, et le renard exactement à la charnière.',
      stats: [
        { label: 'Espèces', value: String(overlapCount) },
        { label: 'Paires', value: String(overlapPairs.length) },
        { label: 'Période', value: '10 mois' },
      ],
      accent: PALETTE.gold,
      ...PROVENANCE,
    };
  }

  private speciesReadout(index: number): Readout {
    const species = overlapSpecies[index];
    const { closest, furthest } = overlapExtremes(index);
    const rhoClose = overlapMatrix[index][closest];
    const rhoFar = overlapMatrix[index][furthest];

    return {
      eyebrow: overlapKindLabel(species.kind),
      title: species.fr,
      body:
        `Sort aux mêmes heures que ${overlapSpecies[closest].fr.toLowerCase()} ` +
        `(ρ ${rhoClose >= 0 ? '+' : ''}${rhoClose.toFixed(2)}), et jamais en même temps que ` +
        `${overlapSpecies[furthest].fr.toLowerCase()} (ρ ${rhoFar.toFixed(2)}).`,
      stats: [
        { label: 'Plus proche', value: `${rhoClose >= 0 ? '+' : ''}${rhoClose.toFixed(2)}` },
        { label: 'Plus éloigné', value: rhoFar.toFixed(2) },
        { label: 'Sur l’axe', value: overlapOrder.axis[index] < 0 ? 'Nuit' : 'Jour' },
      ],
      accent: species.kind === 'mammal' ? PALETTE.wine : species.kind === 'bird' ? PALETTE.gold : PALETTE.mist,
      marker: this.marker,
      ...PROVENANCE,
    };
  }

  readout(): Readout {
    return this.cachedReadout;
  }
}


/** This chapter comes from a different survey; the overlay has to say so. */
const PROVENANCE = {
  period: 'juin 2025 — mars 2026',
  source: '18 espèces · pièges photographiques · Every1Counts',
  legend: [
    { label: 'Mammifères', color: PALETTE.wine },
    { label: 'Oiseaux', color: PALETTE.gold },
    { label: 'Domestiques', color: PALETTE.mist },
    { label: 'Mêmes heures', color: PALETTE.gold },
    { label: 'Heures opposées', color: PALETTE.dusk },
  ],
};

function createUniforms(touch: TouchUniforms) {
  return {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uSelected: { value: -1 },
    uHeld: { value: 0 },
    uRadius: { value: RING_RADIUS },
    uGold: { value: color(PALETTE.gold) },
    uBone: { value: color(PALETTE.bone) },
    uDusk: { value: color(PALETTE.dusk) },
    uWine: { value: color(PALETTE.wine) },
    uMist: { value: color(PALETTE.mist) },
    ...touch,
  };
}

function quadratic(a: Vector3, control: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const inv = 1 - t;
  return out.set(
    inv * inv * a.x + 2 * inv * t * control.x + t * t * b.x,
    inv * inv * a.y + 2 * inv * t * control.y + t * t * b.y,
    inv * inv * a.z + 2 * inv * t * control.z + t * t * b.z
  );
}

export const overlapSource = overlap.meta.source;

// ------------------------------------------------------------------ shaders --

const SELECTION = /* glsl */ `
uniform float uSelected;
uniform float uHeld;

float isSelected(float index){
  return uSelected < -0.5 ? 0.0 : step(abs(uSelected - index), 0.5);
}
`;

const CHORD_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
attribute float aRho;
attribute float aAlong;
attribute float aEndA;
attribute float aEndB;
varying float vRho;
varying float vAlong;
varying float vTouching;
varying float vAlpha;

${SIMPLEX3}
${EASING}
${SELECTION}
${TOUCH_UNIFORMS}

void main(){
  vec3 pos = position;

  // The weave breathes, so the ring is never a printed diagram.
  float breath = snoise(vec3(pos.xy * 0.14, uTime * 0.07));
  pos.z += breath * 0.5 * sin(aAlong * 3.14159);
  pos += touchDisplace(pos, 5.0, 0.9);

  vTouching = max(isSelected(aEndA), isSelected(aEndB));

  // Chords draw on from their ends toward the middle as the chapter opens.
  float draw = easeOutQuart(clamp(uReveal * 1.8 - abs(aRho) * 0.3, 0.0, 1.0));
  pos.xy *= mix(0.25, 1.0, draw);

  vRho = aRho;
  vAlong = aAlong;

  // Weight by the square of the correlation: no threshold, weak pairs simply
  // fall away and the strong ones carry the image.
  float weight = aRho * aRho;
  float base = 0.045 + weight * 0.42;
  // Everything not attached to the highlighted species recedes rather than
  // disappearing — the shape of the whole community stays readable.
  vAlpha = base * mix(1.0, mix(0.13, 1.0, vTouching), uHeld * 0.55 + 0.45) * draw;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const CHORD_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uGold;
uniform vec3 uDusk;
uniform vec3 uBone;
varying float vRho;
varying float vAlong;
varying float vTouching;
varying float vAlpha;

void main(){
  // Warm when two species share their hours, cool when they avoid each other.
  vec3 tint = vRho >= 0.0 ? mix(uGold * 0.8, uGold, vRho) : mix(uDusk * 0.7, uDusk * 1.25, -vRho);
  tint = mix(tint, mix(tint, uBone, 0.32), vTouching);

  // A pulse runs the length of a highlighted chord, from the selected species out.
  float pulse = exp(-pow(fract(vAlong - uTime * 0.3) - 0.5, 2.0) * 30.0) * vTouching;

  float a = vAlpha + pulse * 0.14;
  if (a < 0.003) discard;
  gl_FragColor = vec4(tint * a * 0.85, a);
}
`;

const NODE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uRadius;
attribute float aKind;
attribute float aIndex;
attribute float aWeight;
attribute float aAxis;
varying vec3 vColor;
varying float vAlpha;
varying float vSelected;

${HASH}
${EASING}
${SELECTION}
${TOUCH_UNIFORMS}
${POINT_SIZE}
${RIPPLE_UNIFORMS}

uniform vec3 uWine;
uniform vec3 uGold;
uniform vec3 uMist;
uniform vec3 uBone;

void main(){
  vec3 pos = position;
  vSelected = isSelected(aIndex);

  // Selected node steps out of the ring.
  pos.xy *= 1.0 + vSelected * 0.045;
  pos.z += vSelected * 0.6;

  pos += touchDisplace(pos, 4.5, 1.2);
  float ripple = rippleField(pos, 9.0, 2.6, 1.6);
  pos.xy += normalize(pos.xy + 1e-4) * ripple * 0.5;

  float grow = easeOutQuart(clamp(uReveal * 2.0 - abs(aAxis) * 0.35, 0.0, 1.0));
  pos.xy *= mix(0.25, 1.0, grow);

  vec3 kindColor = aKind < 0.5 ? uWine * 1.6 : aKind < 1.5 ? uGold : uMist * 1.4;
  vColor = mix(kindColor, mix(kindColor, uBone, 0.5) * 1.5, vSelected);
  vAlpha = (0.5 + aWeight * 0.5) * grow * (0.55 + vSelected * 0.45);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor(0.3 + aWeight * 0.5 + vSelected * 0.55 + ripple * 0.3, mv.z);
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

  float core = 1.0 - smoothstep(0.0, 0.5, d);
  float halo = exp(-d * 2.8) * 0.45;
  float ring = (1.0 - smoothstep(0.03, 0.08, abs(d - 0.8))) * vSelected;

  float a = (core + halo + ring) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a * 0.8 + vec3(ring) * 0.25, a);
}
`;
