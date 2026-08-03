import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstallationData, Species } from '../core/types';
import { logScale } from '../core/data';
import { GUILD_COLORS, PALETTE, toRGB } from '../core/palette';
import { SIMPLEX_3D } from './chunks';

/**
 * "The Choir" — every species recorded at Purcari, at once.
 *
 * Each species is one mark. Guild sets the hue and the orbital shell; abundance
 * sets the radius (log-scaled, so a 6,133-call pheasant and a 3-sighting otter
 * can share a frame); nocturnality sets the vertical band, so the night animals
 * literally sink below the day ones. The swarm drifts on a curl-like noise field
 * and pulls apart into guild clusters when the visitor asks it to.
 *
 * Touching a mark selects that species; the surrounding marks dim and the
 * selected one's own hourly rhythm drives its pulse.
 */

const CHOIR_VERT = /* glsl */ `
${SIMPLEX_3D}
attribute vec3 aColor;
attribute float aScale;
attribute float aSeed;
attribute float aNight;
attribute float aGuild;
attribute vec3 aCluster;
attribute float aSelected;
attribute float aDimmed;

uniform float uTime;
uniform float uReveal;
uniform float uCluster;   // 0 = single swarm, 1 = split into guild clusters
uniform float uHour;      // 0..24, drives which marks are awake
uniform float uDrift;

varying vec3 vColor;
varying float vSelected;
varying float vDimmed;
varying float vAwake;

void main(){
  vColor = aColor;
  vSelected = aSelected;
  vDimmed = aDimmed;

  vec3 p = position;

  // Ease between the unified swarm and the guild-sorted arrangement.
  p = mix(p, aCluster, uCluster);

  // Organic drift. Sampling noise at three offsets approximates a curl field
  // cheaply enough to run on every mark every frame.
  float t = uTime * 0.06 + aSeed * 30.0;
  vec3 n = vec3(
    snoise(vec3(p.yz * 0.22, t)),
    snoise(vec3(p.zx * 0.22, t + 11.0)),
    snoise(vec3(p.xy * 0.22, t + 23.0))
  );
  p += n * uDrift * (0.5 + aSeed * 0.9);

  // Night species sit low and rise only when the clock says they are active.
  float dayness = 1.0 - aNight;
  float hourPhase = uHour / 24.0;
  float isNightNow = smoothstep(0.30, 0.05, hourPhase) + smoothstep(0.78, 0.95, hourPhase);
  float awake = mix(1.0 - isNightNow, isNightNow, aNight);
  vAwake = awake;
  p.y += (dayness - 0.5) * 1.6 + awake * 0.5;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  float breathe = 1.0 + sin(uTime * 1.1 + aSeed * 6.2831) * 0.10;
  float pick = 1.0 + aSelected * 1.5;
  // Sleeping species stay clearly present rather than nearly vanishing — the
  // chapter is a census of the whole year, not only of this hour.
  float size = aScale * breathe * pick * uReveal * (0.72 + awake * 0.28);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const CHOIR_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vSelected;
varying float vDimmed;
varying float vAwake;

void main(){
  vec2 coord = gl_PointCoord - 0.5;
  float d = length(coord) * 2.0;
  if (d > 1.0) discard;

  float core = 1.0 - smoothstep(0.0, 0.34, d);
  float halo = pow(1.0 - d, 2.4);

  vec3 color = vColor;
  color += vec3(1.0, 0.93, 0.78) * core * (0.4 + vSelected * 0.9);

  float a = (core * 0.95 + halo * 0.55);
  a *= mix(1.0, 0.16, vDimmed);
  a *= (0.55 + vAwake * 0.45);

  // Selected marks get a tight ring so a fingertip has unambiguous feedback.
  if (vSelected > 0.5) {
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(d - 0.72));
    a += ring * 0.8;
    color += vec3(1.0, 0.94, 0.8) * ring;
  }

  gl_FragColor = vec4(color * a, a);
}
`;

export interface ChoirProps {
  data: InstallationData;
  reveal?: number;
  /** 0 = one swarm, 1 = separated into ecological guilds. */
  cluster?: number;
  /** Clock hour driving which species are lit. */
  hour?: number;
  selected?: Species | null;
  onSelect?: (species: Species | null) => void;
  /**
   * Show only the species the survey singles out — the ones carrying a
   * conservation status or narrative weight. The rest stay faintly present
   * rather than disappearing, so the rare are seen *against* the common:
   * the turtle dove is Vulnerable in a crowd of two hundred that are not.
   */
  flagshipOnly?: boolean;
}

export function Choir({
  data,
  reveal = 1,
  cluster = 0,
  hour = 12,
  selected = null,
  onSelect,
  flagshipOnly = false,
}: ChoirProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const revealRef = useRef(0);
  const clusterRef = useRef(0);
  const hourRef = useRef(hour);
  const { camera, size } = useThree();

  /**
   * Ring order for the guild rosette.
   *
   * `data.guilds` arrives sorted by abundance, which would seat the 88-species
   * songbird cluster next to the other big groups and leave the far side nearly
   * empty. Dealing the size-sorted guilds alternately to opposite sides of the
   * ring keeps the figure balanced without touching any species' membership.
   */
  const guilds = useMemo(() => {
    const bySize = Object.keys(data.guilds).sort(
      (a, b) => data.guilds[b].species - data.guilds[a].species,
    );
    const n = bySize.length;
    const half = Math.floor(n / 2);
    const ring: string[] = new Array(n);
    bySize.forEach((guild, i) => {
      // Even ranks fill the near half, odd ranks the far half, so the two
      // largest guilds land diametrically opposite each other.
      const slot = i % 2 === 0 ? i / 2 : half + (i - 1) / 2;
      ring[slot % n] = guild;
    });
    return ring;
  }, [data.guilds]);

  /**
   * Positions are deterministic per species — the same animal always occupies
   * the same place in the choir, so a returning visitor can find it again.
   */
  const { geometry, species } = useMemo(() => {
    const list = data.species;
    const n = list.length;
    const maxTotal = Math.max(...list.map((s) => s.total));

    const positions = new Float32Array(n * 3);
    const clusters = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const scales = new Float32Array(n);
    const seeds = new Float32Array(n);
    const nights = new Float32Array(n);
    const guildIndex = new Float32Array(n);
    const selectedAttr = new Float32Array(n);
    const dimmed = new Float32Array(n);

    // Deterministic pseudo-random from the species name.
    const rand = (text: string, salt: number) => {
      let h = 2166136261 ^ salt;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) % 100000) / 100000;
    };

    const guildCounts = new Map<string, number>();

    list.forEach((sp, i) => {
      const abundance = logScale(sp.total, maxTotal);

      // Unified swarm: a sphere shell whose radius shrinks with abundance, so
      // the commonest animals sit at the luminous centre.
      const radius = 2.2 + (1 - abundance) * 6.2;
      const theta = rand(sp.sci, 1) * Math.PI * 2;
      const phi = Math.acos(2 * rand(sp.sci, 2) - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.55;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      // Guild arrangement: a rosette of one cluster per guild.
      //
      // Laid out in the screen-facing XY plane rather than the ground plane —
      // an XZ ring seen from the chapter's low camera projects almost edge-on
      // and the clusters smear into a horizontal band. Squashed vertically to
      // suit a 16:9 panel.
      const gi = Math.max(0, guilds.indexOf(sp.guild));
      const seen = guildCounts.get(sp.guild) ?? 0;
      guildCounts.set(sp.guild, seen + 1);
      const guildAngle = (gi / Math.max(1, guilds.length)) * Math.PI * 2;
      const guildRadius = 5.6;
      const inner = 0.45 + (1 - abundance) * 1.7;
      const spin = seen * 2.399963; // golden angle keeps clusters evenly filled
      clusters[i * 3] = Math.cos(guildAngle) * guildRadius + Math.cos(spin) * inner;
      clusters[i * 3 + 1] =
        Math.sin(guildAngle) * guildRadius * 0.58 + Math.sin(spin) * inner * 0.72;
      clusters[i * 3 + 2] = (rand(sp.sci, 3) - 0.5) * 1.4;

      const [r, g, b] = toRGB(GUILD_COLORS[sp.guild] ?? PALETTE.foil);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // World units, converted to pixels by distance in the vertex shader.
      // Flagship species are enlarged so a 3-detection otter stays findable.
      scales[i] = (1.05 + abundance * 2.6) * (sp.flagship ? 1.55 : 1);
      seeds[i] = rand(sp.sci, 4);
      nights[i] = sp.nightRatio;
      guildIndex[i] = gi;
      selectedAttr[i] = 0;
      dimmed[i] = 0;
    });

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aCluster', new THREE.BufferAttribute(clusters, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    g.setAttribute('aNight', new THREE.BufferAttribute(nights, 1));
    g.setAttribute('aGuild', new THREE.BufferAttribute(guildIndex, 1));
    g.setAttribute('aSelected', new THREE.BufferAttribute(selectedAttr, 1));
    g.setAttribute('aDimmed', new THREE.BufferAttribute(dimmed, 1));
    return { geometry: g, species: list };
  }, [data.species, guilds]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uCluster: { value: 0 },
      uHour: { value: hour },
      uDrift: { value: 0.9 },
    }),
    // `hour` seeds the initial value only; it is driven imperatively below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* Selection highlighting is pushed straight into the attribute buffers so a
     tap never triggers a React re-render of 213 marks. */
  const applySelection = useMemo(
    () => (target: Species | null) => {
      const selectedAttr = geometry.getAttribute('aSelected') as THREE.BufferAttribute;
      const dimmed = geometry.getAttribute('aDimmed') as THREE.BufferAttribute;
      const sel = selectedAttr.array as Float32Array;
      const dim = dimmed.array as Float32Array;
      for (let i = 0; i < species.length; i++) {
        const isTarget = target !== null && species[i].sci === target.sci;
        sel[i] = isTarget ? 1 : 0;
        // Dim everything outside the selected animal's own guild.
        let d = target === null ? 0 : species[i].guild === target.guild ? (isTarget ? 0 : 0.55) : 1;
        // The flagship filter pushes everything else back, but never to zero.
        if (filterRef.current && !species[i].flagship && !isTarget) d = Math.max(d, 0.88);
        dim[i] = d;
      }
      selectedAttr.needsUpdate = true;
      dimmed.needsUpdate = true;
    },
    [geometry, species],
  );

  const lastSelected = useRef<string | null>(null);
  const filterRef = useRef(flagshipOnly);
  const lastFilter = useRef(flagshipOnly);

  /**
   * Nearest-mark picking in screen space. Raycasting `Points` with a threshold
   * mis-picks badly when marks vary this much in size, so this projects each
   * mark and takes the closest within a finger-sized radius.
   */
  const pick = (clientX: number, clientY: number): Species | null => {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const clusters = geometry.getAttribute('aCluster') as THREE.BufferAttribute;
    const blend = clusterRef.current;
    const v = new THREE.Vector3();
    let best: Species | null = null;
    let bestDistance = 60; // px

    for (let i = 0; i < species.length; i++) {
      v.set(
        positions.getX(i) * (1 - blend) + clusters.getX(i) * blend,
        positions.getY(i) * (1 - blend) + clusters.getY(i) * blend,
        positions.getZ(i) * (1 - blend) + clusters.getZ(i) * blend,
      );
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDistance) {
        bestDistance = d;
        best = species[i];
      }
    }
    return best;
  };

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    revealRef.current += (reveal - revealRef.current) * Math.min(1, delta * 2);
    clusterRef.current += (cluster - clusterRef.current) * Math.min(1, delta * 1.4);
    hourRef.current += (hour - hourRef.current) * Math.min(1, delta * 1.2);

    uniforms.uTime.value = t;
    uniforms.uReveal.value = revealRef.current;
    uniforms.uCluster.value = clusterRef.current;
    uniforms.uHour.value = hourRef.current;

    filterRef.current = flagshipOnly;
    if (lastSelected.current !== (selected?.sci ?? null) || lastFilter.current !== flagshipOnly) {
      lastSelected.current = selected?.sci ?? null;
      lastFilter.current = flagshipOnly;
      applySelection(selected);
    }

    if (pointsRef.current) {
      // The swarm turns slowly, but the guild rosette is a screen-facing figure —
      // spinning it would hide the very structure the arrangement exists to show.
      pointsRef.current.rotation.y = t * 0.018 * (1 - clusterRef.current);
    }
  });

  return (
    <group>
      <points
        ref={pointsRef}
        geometry={geometry}
        onPointerDown={(event) => {
          event.stopPropagation();
          const hit = pick(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
          onSelect?.(hit);
        }}
      >
        <shaderMaterial
          vertexShader={CHOIR_VERT}
          fragmentShader={CHOIR_FRAG}
          uniforms={uniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* A wide invisible plane so taps on empty space clear the selection. */}
      <mesh
        position={[0, 0, -6]}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect?.(null);
        }}
      >
        <planeGeometry args={[80, 50]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
