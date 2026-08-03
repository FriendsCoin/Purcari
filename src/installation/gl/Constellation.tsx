import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstallationData, Site } from '../core/types';
import { layoutSites, logScale } from '../core/data';
import { PALETTE, toRGB, TYPOLOGY_COLORS, CLASS_COLORS } from '../core/palette';
import { SIMPLEX_3D, DITHER, SPRITE, TONEMAP } from './chunks';

/**
 * "The Estate" — the twelve monitoring stations as a constellation standing on
 * the real ground of Purcari, at their true relative positions.
 *
 * The chapter's argument is the one the survey makes: the same land classifies
 * differently depending on which animals you ask. `lens` cross-fades between the
 * mammal reading, the bird reading, and the combined typology, recolouring the
 * stations in place — so the visitor watches one landscape become three.
 */

export type Lens = 'both' | 'camera' | 'sound';

function siteColor(site: Site, lens: Lens): [number, number, number] {
  if (lens === 'camera') return toRGB(CLASS_COLORS[site.cameraClass] ?? PALETTE.ash);
  if (lens === 'sound') return toRGB(CLASS_COLORS[site.soundClass] ?? PALETTE.ash);
  return toRGB(TYPOLOGY_COLORS[site.typology] ?? PALETTE.ash);
}

/* ------------------------------------------------------------------ ground */

/**
 * The terroir beneath the fauna. A displaced disc whose height field is layered
 * noise biased along the NNE–SSW axis of the Dniester valley, washed with the
 * estate's three landscape units — Podiș on the high ground, Coline on the
 * slopes, Poale at the foot. It is an evocation of the estate's form, not a DEM:
 * no elevation model ships with the survey.
 */
const GROUND_VERT = /* glsl */ `
${SIMPLEX_3D}
uniform float uTime;
uniform float uReveal;
varying vec2 vUv;
varying float vHeight;
varying vec3 vWorld;

void main(){
  vUv = uv;
  vec3 p = position;

  // This is a PlaneGeometry: its vertices lie in LOCAL XY with z = 0, and the
  // mesh is rotated -90 deg about X so local +Z becomes world +Y. So the noise
  // domain is p.xy and the displacement goes along p.z — sampling p.xz would be
  // constant in one axis, and displacing p.y would push the terrain sideways.
  float axis = p.x * 0.42 + p.y * 0.91;   // valley runs NNE-SSW
  float ridge = sin(axis * 0.34) * 0.75;
  float detail = fbm(vec3(p.xy * 0.16, 0.0)) * 0.85;
  float fine = snoise(vec3(p.xy * 0.55, uTime * 0.008)) * 0.12;
  float h = (ridge + detail + fine) * uReveal;
  p.z += h;

  vHeight = h;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GROUND_FRAG = /* glsl */ `
${SIMPLEX_3D}
${DITHER}
${TONEMAP}
uniform float uTime;
uniform float uReveal;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uGlow;
uniform vec3 uPulse;   // xy = focus point in local space, z = strength
varying vec2 vUv;
varying float vHeight;
varying vec3 vWorld;

void main(){
  // Fade the ground out well before the geometry ends, so the estate floats in
  // the dark rather than sitting on a visible square.
  float radius = length(vUv - 0.5) * 2.0;
  float rim = 1.0 - smoothstep(0.30, 0.86, radius);
  if (rim <= 0.001) discard;

  // Landscape units by elevation band: Poale -> Coline -> Podis.
  float t = clamp(vHeight * 0.55 + 0.5, 0.0, 1.0);
  vec3 soil = mix(uLow, uMid, smoothstep(0.25, 0.62, t));
  soil = mix(soil, uHigh, smoothstep(0.62, 0.95, t));

  // Hillshade. The chapter is framed almost plan-view, where colour alone cannot
  // convey relief; reconstructing the surface normal from screen-space
  // derivatives and raking a low light across it is what makes the ground read
  // as land rather than as a stain. No lights in the scene — this is the only
  // shading in the piece.
  vec3 dx = dFdx(vWorld);
  vec3 dy = dFdy(vWorld);
  vec3 normal = normalize(cross(dx, dy));
  vec3 sun = normalize(vec3(-0.55, 0.62, -0.55));
  float shade = clamp(dot(normal, sun) * 0.5 + 0.5, 0.0, 1.0);
  // Kept deliberately dim. The contour lines carry the landform; the colour
  // fills are only a wash, and the twelve stations must stay the brightest
  // thing on screen once bloom is applied.
  soil *= (0.25 + pow(shade, 1.6) * 0.75) * 0.20;

  // Contour lines — an echo of the estate's own geophysical survey. Screen-space
  // derivative keeps them a constant hairline instead of banding into moiré.
  float h = vHeight * 3.0;
  float grid = abs(fract(h) - 0.5) / max(fwidth(h), 0.0001);
  float lines = (1.0 - smoothstep(0.0, 1.4, grid)) * 0.45;

  // Vine rows, only on the mid slopes where the vineyard actually sits.
  float rows = sin((vWorld.x * 0.94 - vWorld.z * 0.34) * 6.0) * 0.5 + 0.5;
  float rowMask = smoothstep(0.25, 0.5, t) * (1.0 - smoothstep(0.68, 0.92, t));
  soil += uGlow * rows * rowMask * 0.035;

  // A slow ripple outward from wherever the visitor last touched.
  float d = distance(vWorld.xz, uPulse.xy);
  float ripple = sin(d * 1.6 - uTime * 1.7) * exp(-d * 0.28) * uPulse.z;
  soil += uGlow * max(ripple, 0.0) * 0.22;

  vec3 color = (soil + uGlow * lines) * rim;
  gl_FragColor = vec4(dither(aces(color * uReveal), vUv), rim * uReveal * 0.9);
}
`;

/* ---------------------------------------------------------------- stations */

/**
 * One instanced quad per station, drawn as an additive sprite. Size follows
 * log-scaled detection volume so H10's 7,859 songs do not swallow H7's six
 * encounters; the inner core follows species richness.
 */
/**
 * Points variant of the station shader. `gl_PointSize` gives camera-facing
 * sprites for free — cheaper and steadier than billboarded quads for twelve
 * marks — and `gl_PointCoord` replaces a uv varying.
 */
const STATION_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aScale;
attribute float aRichness;
attribute float aSeed;
attribute float aSelected;
uniform float uTime;
uniform float uReveal;
varying vec3 vColor;
varying float vRichness;
varying float vSelected;

void main(){
  vColor = aColor;
  vRichness = aRichness;
  vSelected = aSelected;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float breathe = 1.0 + sin(uTime * 0.7 + aSeed * 6.2831) * 0.06;
  // Selected stations swell and pulse harder so a fingertip has clear feedback.
  float pulse = 1.0 + vSelected * (0.35 + sin(uTime * 3.0) * 0.12);
  gl_PointSize = aScale * breathe * pulse * uReveal * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const STATION_FRAG = /* glsl */ `
${SPRITE}
varying vec3 vColor;
varying float vRichness;
varying float vSelected;

void main(){
  vec2 coord = gl_PointCoord;
  float d = length(coord - 0.5) * 2.0;
  if (d > 1.0) discard;

  // Bright core sized by richness, wide soft halo by volume.
  float core = 1.0 - smoothstep(0.0, 0.10 + vRichness * 0.20, d);
  float halo = pow(1.0 - d, 3.0);

  // A thin ring that tightens when the station is selected.
  float ringR = 0.62 - vSelected * 0.06;
  float ring = (1.0 - smoothstep(0.0, 0.035, abs(d - ringR))) * (0.22 + vSelected * 0.65);

  float a = core + halo * 0.55 + ring;
  vec3 color = vColor * (0.6 + core * 1.9) + vec3(1.0, 0.92, 0.75) * core * 0.55;
  gl_FragColor = vec4(color * a, a);
}
`;

/* ------------------------------------------------------------------ shared */

interface ConstellationProps {
  data: InstallationData;
  /** 0..1 chapter fade. */
  reveal?: number;
  /** Which classification of the land to show. */
  lens?: Lens;
  selectedSite?: string | null;
  onSelectSite?: (siteId: string | null) => void;
}

export function Constellation({
  data,
  reveal = 1,
  lens = 'both',
  selectedSite = null,
  onSelectSite,
}: ConstellationProps) {
  const groupRef = useRef<THREE.Group>(null);
  const groundRef = useRef<THREE.Mesh>(null);
  const stationsRef = useRef<THREE.Points>(null);
  const linksRef = useRef<THREE.LineSegments>(null);
  const pulse = useRef(new THREE.Vector3(0, 0, 0));
  const revealRef = useRef(0);

  // The estate is a narrow NNE–SSW lozenge, so its long axis sets the scale:
  // sized to fill the frame vertically with north kept up.
  const placed = useMemo(() => layoutSites(data.sites, 6.5), [data.sites]);

  /* ---- ground ---- */
  const groundUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReveal: { value: 0 },
      // Poale (footslopes) -> Coline (hillslopes) -> Podiș (plateau), the estate's
      // own three landscape units. Kept low-saturation so the stations stay the
      // brightest thing on screen.
      uLow: { value: new THREE.Color(PALETTE.sediment) },
      uMid: { value: new THREE.Color(PALETTE.brandNavy) },
      uHigh: { value: new THREE.Color(PALETTE.brandBronze) },
      uGlow: { value: new THREE.Color(PALETTE.brandBronze) },
      uPulse: { value: new THREE.Vector3(0, 0, 0) },
    }),
    [],
  );

  /**
   * A densely tessellated plane, not a CircleGeometry — a circle is a triangle
   * fan with a single centre vertex and no interior tessellation, so displacing
   * it in the vertex shader produces radial spikes rather than terrain. The disc
   * shape comes from the rim fade in the fragment shader instead.
   */
  const groundGeometry = useMemo(() => new THREE.PlaneGeometry(24, 24, 200, 200), []);

  /* ---- stations, as a single Points draw ---- */
  const { stationGeometry, stationOrder } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const n = placed.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const scales = new Float32Array(n);
    const richness = new Float32Array(n);
    const seeds = new Float32Array(n);
    const selected = new Float32Array(n);

    const maxDetections = Math.max(...data.sites.map((s) => s.detections));
    const maxRichness = Math.max(...data.sites.map((s) => s.richness));

    placed.forEach((entry, i) => {
      positions[i * 3] = entry.position[0];
      positions[i * 3 + 1] = 0.55;
      positions[i * 3 + 2] = entry.position[2];

      const [r, g, b] = siteColor(entry.site, lens);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // Size is in world units; the vertex shader converts to pixels by distance.
      // Log-scaled so H10's 7,981 detections don't erase H7's six.
      scales[i] = 1.0 + logScale(entry.site.detections, maxDetections) * 3.2;
      richness[i] = entry.site.richness / maxRichness;
      seeds[i] = i / n;
      selected[i] = entry.site.id === selectedSite ? 1 : 0;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geometry.setAttribute('aRichness', new THREE.BufferAttribute(richness, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSelected', new THREE.BufferAttribute(selected, 1));
    return { stationGeometry: geometry, stationOrder: placed.map((p) => p.site.id) };
  }, [placed, data.sites, lens, selectedSite]);

  const stationUniforms = useMemo(
    () => ({ uTime: { value: 0 }, uReveal: { value: 0 } }),
    [],
  );

  /* ---- filaments between stations ---- */
  /**
   * Every pair that shares more than half its species list. Thickness is not
   * available on WebGL lines, so shared-species weight rides on vertex alpha
   * instead — the strongest ties simply burn brighter.
   */
  const linkGeometry = useMemo(() => {
    const byId = new Map(placed.map((p) => [p.site.id, p.position]));
    const positions: number[] = [];
    const colors: number[] = [];
    const base = new THREE.Color(PALETTE.foil);
    const strong = new THREE.Color(PALETTE.candle);

    data.links
      .filter((link) => link.jaccard > 0.5)
      .forEach((link) => {
        const a = byId.get(link.a);
        const b = byId.get(link.b);
        if (!a || !b) return;
        // Bow each filament gently so the web reads as volume without becoming
        // vertical streaks — the chapter is framed nearly plan-view, where a tall
        // arc projects as a spike rather than a curve.
        const lift = 0.12 + link.jaccard * 0.5;
        const segments = 24;
        for (let s = 0; s < segments; s++) {
          for (const t of [s / segments, (s + 1) / segments]) {
            const x = a[0] + (b[0] - a[0]) * t;
            const z = a[2] + (b[2] - a[2]) * t;
            const y = 0.55 + Math.sin(t * Math.PI) * lift;
            positions.push(x, y, z);
            // Floors at 0.4 so even the weakest kept filament stays legible
            // against the ground; the strongest ties reach full foil.
            const weight = 0.4 + Math.min(1, (link.jaccard - 0.5) / 0.25) * 0.6;
            const color = base.clone().lerp(strong, Math.min(1, weight));
            const fade = Math.sin(t * Math.PI) * 0.7 + 0.3;
            colors.push(color.r * fade * weight, color.g * fade * weight, color.b * fade * weight);
          }
        }
      });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geometry;
  }, [placed, data.links]);

  /* ---- interaction ---- */
  const handlePointer = (event: { point: THREE.Vector3; stopPropagation: () => void }) => {
    event.stopPropagation();
    pulse.current.set(event.point.x, event.point.z, 1);

    // Nearest station within a generous touch radius — fingers are imprecise.
    let nearest: string | null = null;
    let best = 1.9;
    placed.forEach((entry) => {
      const dx = entry.position[0] - event.point.x;
      const dz = entry.position[2] - event.point.z;
      const distance = Math.hypot(dx, dz);
      if (distance < best) {
        best = distance;
        nearest = entry.site.id;
      }
    });
    onSelectSite?.(nearest);
  };

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    revealRef.current += (reveal - revealRef.current) * Math.min(1, delta * 2.2);
    const r = revealRef.current;

    groundUniforms.uTime.value = t;
    groundUniforms.uReveal.value = r;
    groundUniforms.uPulse.value.set(pulse.current.x, pulse.current.y, pulse.current.z);
    pulse.current.z *= 1 - Math.min(1, delta * 0.75);

    stationUniforms.uTime.value = t;
    stationUniforms.uReveal.value = r;

    if (linksRef.current) {
      const material = linksRef.current.material as THREE.LineBasicMaterial;
      // Filaments breathe slightly out of phase with the stations.
      material.opacity = r * (0.82 + Math.sin(t * 0.4) * 0.14);
    }

    if (groupRef.current) {
      // A very slow drift keeps the tableau alive without inducing motion sickness
      // on a screen someone stands in front of for twenty minutes.
      groupRef.current.rotation.y = Math.sin(t * 0.035) * 0.09;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={groundRef}
        geometry={groundGeometry}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handlePointer}
      >
        <shaderMaterial
          vertexShader={GROUND_VERT}
          fragmentShader={GROUND_FRAG}
          uniforms={groundUniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <lineSegments ref={linksRef} geometry={linkGeometry}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      <points ref={stationsRef} geometry={stationGeometry} userData={{ stationOrder }}>
        <shaderMaterial
          vertexShader={STATION_VERT}
          fragmentShader={STATION_FRAG}
          uniforms={stationUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          depthTest={false}
        />
      </points>
    </group>
  );
}

