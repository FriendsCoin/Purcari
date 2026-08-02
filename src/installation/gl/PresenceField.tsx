import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstallationData, SensorState, Species } from '../core/types';
import { activityAtHour, withWariness } from '../core/data';
import { GUILD_COLORS, PALETTE, toRGB } from '../core/palette';
import { SIMPLEX_3D, DITHER, TONEMAP } from './chunks';
import { soundField } from '../core/audio';

/**
 * "Presence" — the outdoor chapter, and the one interaction the whole piece is
 * built around.
 *
 * Every mote is one animal drawn from the species genuinely active at the current
 * hour, sampled from the survey's own hourly profiles. Approach it, move, make
 * noise, and the field scatters exactly as real fauna does. Stand still and stay
 * quiet and the animals come back — in the order the data says they should, the
 * bold and common first, the wary and rare last. Holding still for a full minute
 * restores the entire chorus.
 *
 * The mechanic is the argument: the report's dawn-chorus measure is a measure of
 * *undisturbedness*, and the only way to see the estate at its richest is to stop
 * disturbing it.
 */

/** How many motes represent one species at full presence. */
const MOTES_PER_SPECIES = 26;
const MAX_MOTES = 4200;

interface Mote {
  speciesIndex: number;
  /** Home position — where this animal rests when undisturbed. */
  home: THREE.Vector3;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  seed: number;
  /** 0 = fled, 1 = fully present. */
  presence: number;
}

const FIELD_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aScale;
attribute float aPresence;
attribute float aSeed;
uniform float uTime;
varying vec3 vColor;
varying float vPresence;
varying float vSeed;

void main(){
  vColor = aColor;
  vPresence = aPresence;
  vSeed = aSeed;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Fled motes shrink rather than vanish — the ghost of an absent animal.
  float size = aScale * (0.25 + aPresence * 0.75);
  float flicker = 1.0 + sin(uTime * 2.2 + aSeed * 6.2831) * 0.12 * aPresence;
  gl_PointSize = size * flicker * (320.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FIELD_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vPresence;
varying float vSeed;

void main(){
  vec2 coord = gl_PointCoord - 0.5;
  float d = length(coord) * 2.0;
  if (d > 1.0) discard;

  float core = 1.0 - smoothstep(0.0, 0.30, d);
  float halo = pow(1.0 - d, 2.6);

  // Present animals burn warm and solid; fleeing ones go cold and thin.
  vec3 warm = vColor;
  vec3 cold = vec3(0.30, 0.34, 0.52);
  vec3 color = mix(cold, warm, vPresence);
  color += vec3(1.0, 0.94, 0.80) * core * vPresence * 0.7;

  float a = (core * 1.0 + halo * 0.6) * (0.14 + vPresence * 0.86);
  gl_FragColor = vec4(color * a, a);
}
`;

/** Ground haze that reddens and contracts as the field is disturbed. */
const HAZE_FRAG = /* glsl */ `
${SIMPLEX_3D}
${DITHER}
${TONEMAP}
uniform float uTime;
uniform float uDisturbance;
uniform float uStillness;
uniform vec3 uCalm;
uniform vec3 uAlarm;
varying vec2 vUv;

void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);

  float drift = fbm(vec3(p * 1.6, uTime * 0.05));
  // Calm breathes slowly outward; disturbance pulls the light back to the centre.
  float reach = mix(1.05, 0.55, uDisturbance);
  float body = smoothstep(reach, 0.0, r) * (0.55 + drift * 0.45);

  vec3 color = mix(uAlarm, uCalm, uStillness);
  color *= body * (0.35 + uStillness * 0.65);

  // A slow ring travels outward each time stillness deepens — a held breath.
  float ring = sin(r * 5.0 - uTime * 0.9) * 0.5 + 0.5;
  color += uCalm * ring * uStillness * 0.06 * smoothstep(1.0, 0.2, r);

  gl_FragColor = vec4(dither(aces(color), vUv), body * 0.85);
}
`;

const HAZE_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export interface PresenceFieldProps {
  data: InstallationData;
  /** Live sensor signals, read every frame — never a React state object. */
  sensors: React.MutableRefObject<SensorState>;
  /** Called when the roster of present species changes materially, for the UI. */
  onPresenceChange?: (present: number, total: number, newest: Species | null) => void;
  /** Play a synthesised voice as each species returns. */
  audio?: boolean;
}

export function PresenceField({ data, sensors, onPresenceChange, audio = true }: PresenceFieldProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const hazeRef = useRef<THREE.Mesh>(null);
  const lastReport = useRef(0);
  const reportedCount = useRef(-1);

  /**
   * Species ordered by wariness — the return sequence. The boldest animals come
   * back almost immediately; the otter, seen three times in a year, comes back
   * only after a long silence.
   */
  const roster = useMemo(() => {
    const scored = withWariness(data);
    scored.sort((a, b) => a.wariness - b.wariness);
    return scored;
  }, [data]);

  const rosterColors = useMemo(
    () => roster.map((entry) => toRGB(GUILD_COLORS[entry.species.guild] ?? PALETTE.foil)),
    [roster],
  );

  /** Per-species presence, 0..1, eased toward its target every frame. */
  const speciesPresence = useRef<Float32Array>(new Float32Array(roster.length));
  const speciesAnnounced = useRef<Uint8Array>(new Uint8Array(roster.length));

  /* ---- motes ---- */
  const motes = useMemo(() => {
    const list: Mote[] = [];
    // Weight allocation toward bolder species so the field is not mostly rarities.
    const budget = Math.min(MAX_MOTES, roster.length * MOTES_PER_SPECIES);
    const perSpecies = Math.max(3, Math.floor(budget / roster.length));

    roster.forEach((entry, speciesIndex) => {
      for (let i = 0; i < perSpecies; i++) {
        // Wary species sit further out; bold ones come close to the viewer.
        const ring = 1.4 + entry.wariness * 7.5 + Math.random() * 2.4;
        const angle = Math.random() * Math.PI * 2;
        const height =
          // Birds fly, mammals keep to the ground — guild decides the stratum.
          entry.species.guild === 'carnivore' || entry.species.guild === 'herbivore' ||
          entry.species.guild === 'rodent' || entry.species.guild === 'mammal'
            ? 0.1 + Math.random() * 0.5
            : 0.8 + Math.random() * 3.6;

        const home = new THREE.Vector3(
          Math.cos(angle) * ring,
          height,
          Math.sin(angle) * ring,
        );
        list.push({
          speciesIndex,
          home,
          position: home.clone(),
          velocity: new THREE.Vector3(),
          seed: Math.random(),
          presence: 0,
        });
      }
    });
    return list;
  }, [roster]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = motes.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const scales = new Float32Array(n);
    const presence = new Float32Array(n);
    const seeds = new Float32Array(n);

    motes.forEach((mote, i) => {
      positions[i * 3] = mote.home.x;
      positions[i * 3 + 1] = mote.home.y;
      positions[i * 3 + 2] = mote.home.z;
      const [r, g2, b] = rosterColors[mote.speciesIndex];
      colors[i * 3] = r;
      colors[i * 3 + 1] = g2;
      colors[i * 3 + 2] = b;
      // World units, converted to pixels by distance in the vertex shader.
      // Rarer animals read as slightly larger marks so they stay findable.
      scales[i] = 0.7 + roster[mote.speciesIndex].wariness * 1.5;
      presence[i] = 0;
      seeds[i] = mote.seed;
    });

    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    g.setAttribute('aPresence', new THREE.BufferAttribute(presence, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    return g;
  }, [motes, rosterColors, roster]);

  const fieldUniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const hazeUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDisturbance: { value: 0 },
      uStillness: { value: 0 },
      uCalm: { value: new THREE.Color(PALETTE.foil) },
      uAlarm: { value: new THREE.Color(PALETTE.garnet) },
    }),
    [],
  );

  const scratch = useRef({
    focus: new THREE.Vector3(),
    away: new THREE.Vector3(),
  });

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const t = state.clock.elapsedTime;
    const s = sensors.current;

    fieldUniforms.uTime.value = t;
    hazeUniforms.uTime.value = t;

    // Stillness ramps in over a minute; the last species need the full minute.
    const calm = Math.min(1, s.stillnessSeconds / 60);
    hazeUniforms.uDisturbance.value +=
      (s.disturbance - hazeUniforms.uDisturbance.value) * Math.min(1, delta * 4);
    hazeUniforms.uStillness.value += (calm - hazeUniforms.uStillness.value) * Math.min(1, delta * 1.5);

    /* ---- decide who is present ---- */
    let presentCount = 0;
    let awakeCount = 0;
    let newest: Species | null = null;

    for (let i = 0; i < roster.length; i++) {
      const { species, wariness } = roster[i];

      // Awake right now? Straight from the species' own hourly profile.
      const awake = activityAtHour(species, s.clockHour);
      if (awake > 0.1) awakeCount++;

      // A species tolerates disturbance up to its wariness threshold, and needs
      // proportionally more accumulated stillness before it will return.
      const tolerated = s.disturbance <= 1 - wariness * 0.92;
      const earned = calm >= wariness * 0.95;
      const target = awake > 0.1 && (tolerated || earned) ? Math.min(1, awake * 1.4) : 0;

      const current = speciesPresence.current[i];
      // Animals flee fast and return slowly — the asymmetry is the whole point.
      const rate = target > current ? 0.55 : 3.4;
      const next = current + (target - current) * Math.min(1, delta * rate);
      speciesPresence.current[i] = next;

      if (next > 0.25) {
        presentCount++;
        if (!speciesAnnounced.current[i]) {
          speciesAnnounced.current[i] = 1;
          newest = species;
          if (audio && soundField.ready) {
            soundField.play(species, 0.35 + (1 - wariness) * 0.4, (Math.random() - 0.5) * 1.4);
          }
        }
      } else if (next < 0.1) {
        speciesAnnounced.current[i] = 0;
      }
    }

    /* ---- move the motes ---- */
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const presenceAttr = geometry.getAttribute('aPresence') as THREE.BufferAttribute;
    const positions = positionAttr.array as Float32Array;
    const presences = presenceAttr.array as Float32Array;

    // Where the visitor is, mapped into the field's own space.
    scratch.current.focus.set((s.focus.x - 0.5) * 12, 1.0, (s.focus.y - 0.5) * 12);

    for (let i = 0; i < motes.length; i++) {
      const mote = motes[i];
      const speciesP = speciesPresence.current[mote.speciesIndex];
      mote.presence += (speciesP - mote.presence) * Math.min(1, delta * 2.2);

      const i3 = i * 3;
      const px = positions[i3];
      const py = positions[i3 + 1];
      const pz = positions[i3 + 2];

      // Wander: slow noise-driven drift around home.
      const phase = t * 0.25 + mote.seed * 40;
      const wanderX = Math.sin(phase * 0.9 + mote.seed * 12) * 0.4;
      const wanderY = Math.sin(phase * 1.3 + mote.seed * 7) * 0.2;
      const wanderZ = Math.cos(phase * 0.75 + mote.seed * 19) * 0.4;

      const targetX = mote.home.x + wanderX;
      const targetY = mote.home.y + wanderY;
      const targetZ = mote.home.z + wanderZ;

      mote.velocity.x += (targetX - px) * delta * 1.6;
      mote.velocity.y += (targetY - py) * delta * 1.6;
      mote.velocity.z += (targetZ - pz) * delta * 1.6;

      // Flight response — scale with disturbance and with how close the visitor is.
      if (s.disturbance > 0.15) {
        const dx = px - scratch.current.focus.x;
        const dz = pz - scratch.current.focus.z;
        const distance = Math.hypot(dx, dz) + 0.001;
        // Flight initiation distance grows with the animal's wariness.
        const trigger = 2.5 + roster[mote.speciesIndex].wariness * 7;
        if (distance < trigger) {
          const push = (1 - distance / trigger) * s.disturbance * 22 * delta;
          mote.velocity.x += (dx / distance) * push;
          mote.velocity.z += (dz / distance) * push;
          mote.velocity.y += push * 0.35;
        }
      }

      mote.velocity.multiplyScalar(1 - Math.min(0.9, delta * 2.4));

      positions[i3] = px + mote.velocity.x * delta * 6;
      positions[i3 + 1] = Math.max(0.05, py + mote.velocity.y * delta * 6);
      positions[i3 + 2] = pz + mote.velocity.z * delta * 6;
      presences[i] = mote.presence;
    }

    positionAttr.needsUpdate = true;
    presenceAttr.needsUpdate = true;

    /* ---- report to the UI, cheaply ---- */
    if (t - lastReport.current > 0.25) {
      lastReport.current = t;
      if (presentCount !== reportedCount.current || newest) {
        reportedCount.current = presentCount;
        // The denominator is how many species are awake at this hour, not the
        // full year's roster. At 03:00 only the nocturnal animals can possibly
        // appear, and counting against 210 would read as failure however still
        // the visitor stands.
        onPresenceChange?.(presentCount, Math.max(1, awakeCount), newest);
      }
    }
  });

  return (
    <group>
      <mesh ref={hazeRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <circleGeometry args={[16, 96]} />
        <shaderMaterial
          vertexShader={HAZE_VERT}
          fragmentShader={HAZE_FRAG}
          uniforms={hazeUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <points ref={pointsRef} geometry={geometry}>
        <shaderMaterial
          vertexShader={FIELD_VERT}
          fragmentShader={FIELD_FRAG}
          uniforms={fieldUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}
