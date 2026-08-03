import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { InstallationData, SensorState, Species } from '../core/types';
import { activityAtHour, withWariness } from '../core/data';
import { GUILD_COLORS, PALETTE, toRGB } from '../core/palette';
import { SIMPLEX_3D, DITHER, TONEMAP } from './chunks';
import { soundField, Chorus } from '../core/audio';

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

/** How many arrivals can be in the air at once. */
const FLARE_SLOTS = 24;
/** Seconds an arrival flare takes to open and fade. */
const FLARE_LIFE = 3.0;

/** Seconds an alarm ring takes to cross the field. */
const SHOCK_LIFE = 2.8;
/** Below this, a rise in disturbance is just noise and fires nothing. */
const SHOCK_TRIGGER = 0.22;

interface Mote {
  speciesIndex: number;
  /** Home position — where this animal rests when undisturbed. */
  home: THREE.Vector3;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /**
   * A lagged copy of `position`, chasing it a few frames behind. The segment
   * between the two is the animal's trail: at rest the two coincide and there is
   * nothing to see, and under flight it stretches into a streak. The motion is
   * the reading, so the reading should be visible.
   */
  trail: THREE.Vector3;
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
/** (x, y, z) of the startle in world space, and its age in seconds. */
uniform vec4 uShock;
uniform float uShockLife;
uniform float uShockReach;
varying vec3 vColor;
varying float vPresence;
varying float vSeed;
varying float vAlarm;

void main(){
  vColor = aColor;
  vPresence = aPresence;
  vSeed = aSeed;

  // The alarm passing through the field.
  //
  // The ground haze carries the same ring, but at this camera the ground is
  // nearly edge-on and a ring drawn on it is invisible. On the motes it cannot
  // be missed: the animals themselves light up in a front travelling out from
  // wherever the visitor moved.
  float age = clamp(uShock.w / uShockLife, 0.0, 1.0);
  float front = age * uShockReach;
  float wave = age >= 1.0
    ? 0.0
    : exp(-pow((length(position.xz - uShock.xz) - front) / 1.1, 2.0)) * pow(1.0 - age, 1.4);
  vAlarm = wave;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Fled motes shrink rather than vanish — the ghost of an absent animal.
  float size = aScale * (0.25 + aPresence * 0.75) * (1.0 + wave * 0.85);
  float flicker = 1.0 + sin(uTime * 2.2 + aSeed * 6.2831) * 0.12 * aPresence;
  gl_PointSize = size * flicker * (320.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uAlarmColor;
varying vec3 vColor;
varying float vPresence;
varying float vSeed;
varying float vAlarm;

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
  color = mix(color, uAlarmColor, clamp(vAlarm, 0.0, 1.0) * 0.7);

  float a = (core * 1.0 + halo * 0.6) * (0.14 + vPresence * 0.86);
  a += vAlarm * (core + halo * 0.5) * 0.45;
  gl_FragColor = vec4(color * a, a);
}
`;

const TRAIL_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aPresence;
attribute float aSpeed;
attribute float aEnd;      // 0 = the tail, 1 = the animal

varying vec3 vColor;
varying float vAlpha;

void main(){
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vColor = aColor;
  // Nothing at rest, everything in flight — and the tail end always fainter than
  // the head, so the streak reads as a direction of travel.
  // The threshold is deliberately low: the streak is the distance the animal
  // covered in a fraction of a second, which even in full flight is a small
  // fraction of a world unit.
  vAlpha = aPresence * smoothstep(0.006, 0.16, aSpeed) * mix(0.15, 1.0, aEnd);
}
`;

const TRAIL_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main(){
  float a = vAlpha * 0.30;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

/**
 * One flare per species that comes back.
 *
 * The count in the corner says eleven animals have returned; this says *which
 * moment* each of them returned in, out in the dark where the visitor is looking.
 * Each flare is one arrival, in that animal's own guild colour, and nothing fires
 * one but a genuine change of state in the field.
 */
const FLARE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAge;      // seconds since this arrival, or > life when spent
attribute float aScale;

uniform float uLife;

varying vec3 vColor;
varying float vAge;

void main(){
  float life = clamp(aAge / uLife, 0.0, 1.0);
  vAge = aAge >= uLife ? 1.0 : life;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Opens fast and keeps widening as it dies — a ring leaving the animal.
  float grow = 0.4 + 3.2 * pow(life, 0.55);
  gl_PointSize = aScale * grow * (320.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
}
`;

const FLARE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAge;

void main(){
  if (vAge >= 1.0) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;

  // A ring that thins as it expands, with a soft centre left behind.
  float ring = exp(-pow((d - 0.72) / 0.16, 2.0));
  float centre = (1.0 - smoothstep(0.0, 0.55, d)) * (1.0 - vAge);
  float fade = pow(1.0 - vAge, 2.0);
  float a = (ring * 0.75 + centre * 0.5) * fade;
  if (a <= 0.002) discard;

  vec3 color = vColor + vec3(1.0, 0.93, 0.78) * ring * 0.55;
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
/** (centre.x, centre.y) in this disc's own 0..1 uv, and the ring's age in seconds. */
uniform vec3 uShock;
uniform float uShockLife;
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

  // The alarm: a single ring leaving the visitor at the instant they startle the
  // field, racing out to the edge and gone. It is fired by the same threshold
  // crossing the animals themselves respond to, so what the visitor sees expand
  // is exactly the disturbance the field just measured.
  float age = uShock.z / uShockLife;
  if (age < 1.0) {
    float front = age * 1.15;
    float shock = exp(-pow((length(p - uShock.xy) - front) / 0.07, 2.0));
    color += uAlarm * shock * pow(1.0 - age, 1.6) * 0.55;
  }

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
          trail: home.clone(),
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

  /**
   * Trails: two vertices per mote, the lagged tail and the animal itself. Built
   * from the same colours and in the same order as the motes, so index i of the
   * mote buffer is always vertices 2i and 2i+1 here.
   */
  const trailGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = motes.length;
    const positions = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    const presence = new Float32Array(n * 2);
    const speed = new Float32Array(n * 2);
    const end = new Float32Array(n * 2);

    motes.forEach((mote, i) => {
      const [r, g2, b] = rosterColors[mote.speciesIndex];
      for (const v of [i * 2, i * 2 + 1]) {
        positions[v * 3] = mote.home.x;
        positions[v * 3 + 1] = mote.home.y;
        positions[v * 3 + 2] = mote.home.z;
        colors[v * 3] = r;
        colors[v * 3 + 1] = g2;
        colors[v * 3 + 2] = b;
      }
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    });

    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aPresence', new THREE.BufferAttribute(presence, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    return g;
  }, [motes, rosterColors]);

  /** A ring buffer of arrival flares — one slot per return still in the air. */
  const flareGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(FLARE_SLOTS * 3);
    const colors = new Float32Array(FLARE_SLOTS * 3);
    const ages = new Float32Array(FLARE_SLOTS).fill(FLARE_LIFE * 2);
    const scales = new Float32Array(FLARE_SLOTS).fill(1);
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
    g.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    // Flares are placed anywhere in the field and expand well past their point;
    // an automatic bound computed from an all-zero buffer would cull them all.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 24);
    return g;
  }, []);

  /** Wall-clock birth time per slot, and the next slot to overwrite. */
  const flareBirth = useRef<Float32Array>(new Float32Array(FLARE_SLOTS).fill(-999));
  const flareCursor = useRef(0);

  const fieldUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uShock: { value: new THREE.Vector4(0, 0, 0, SHOCK_LIFE * 2) },
      uShockLife: { value: SHOCK_LIFE },
      // How far the front travels in one life, in world units — a little past
      // the wariest animal's home ring, so nothing is left out of the wave.
      uShockReach: { value: 13 },
      uAlarmColor: { value: new THREE.Color(PALETTE.garnet) },
    }),
    [],
  );
  const flareUniforms = useMemo(() => ({ uLife: { value: FLARE_LIFE } }), []);
  const hazeUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDisturbance: { value: 0 },
      uStillness: { value: 0 },
      uCalm: { value: new THREE.Color(PALETTE.foil) },
      uAlarm: { value: new THREE.Color(PALETTE.garnet) },
      uShock: { value: new THREE.Vector3(0, 0, SHOCK_LIFE * 2) },
      uShockLife: { value: SHOCK_LIFE },
    }),
    [],
  );

  /** Time of the last alarm ring, and the disturbance reading that fired it. */
  const shockAt = useRef(-999);
  const lastDisturbance = useRef(0);

  /** Where each species' motes live in the buffer, so a flare can be put on one. */
  const speciesSlice = useMemo(() => {
    const start = new Int32Array(roster.length).fill(-1);
    const count = new Int32Array(roster.length);
    motes.forEach((mote, i) => {
      if (start[mote.speciesIndex] < 0) start[mote.speciesIndex] = i;
      count[mote.speciesIndex]++;
    });
    return { start, count };
  }, [motes, roster.length]);

  const scratch = useRef({
    focus: new THREE.Vector3(),
    away: new THREE.Vector3(),
  });

  /** Keeps the soundscape running between arrivals, not only on each arrival. */
  const chorus = useRef(new Chorus(soundField));
  const presentSpecies = useRef<Species[]>([]);

  /**
   * Light one arrival, on one of that species' own motes. The ring buffer means
   * a burst of returns after a long stillness overwrites the oldest flare rather
   * than allocating — the field can be flooded and the cost stays fixed.
   */
  const fireFlare = (speciesIndex: number, now: number) => {
    const start = speciesSlice.start[speciesIndex];
    if (start < 0) return;
    const mote = motes[start + Math.floor(Math.random() * speciesSlice.count[speciesIndex])];
    const slot = flareCursor.current;
    flareCursor.current = (slot + 1) % FLARE_SLOTS;

    const positions = flareGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = flareGeometry.getAttribute('aColor') as THREE.BufferAttribute;
    const scales = flareGeometry.getAttribute('aScale') as THREE.BufferAttribute;
    positions.setXYZ(slot, mote.position.x, mote.position.y, mote.position.z);
    const [r, g, b] = rosterColors[speciesIndex];
    colors.setXYZ(slot, r, g, b);
    // The wary animals announce themselves more loudly: a three-sighting otter
    // coming back after a minute of stillness is the rarer event, and reads so.
    scales.setX(slot, 1.15 + roster[speciesIndex].wariness * 2.1);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    scales.needsUpdate = true;
    flareBirth.current[slot] = now;
  };

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

    /* ---- the alarm ring ---- */
    // Fired on the rising edge only — the same smoothed disturbance the animals
    // themselves respond to, crossing from below. An edge and not a level: while
    // a visitor keeps moving the reading stays high, and a level test would emit
    // a ring every frame instead of one ring per startle.
    if (
      s.disturbance > SHOCK_TRIGGER &&
      lastDisturbance.current <= SHOCK_TRIGGER &&
      t - shockAt.current > SHOCK_LIFE * 0.5
    ) {
      shockAt.current = t;
      // The haze disc is 16 units across in world XZ and lies flat; its local +y
      // becomes world −z under the −90° X rotation, hence the sign.
      hazeUniforms.uShock.value.x = ((s.focus.x - 0.5) * 12) / 16;
      hazeUniforms.uShock.value.y = -((s.focus.y - 0.5) * 12) / 16;
      // The motes live in world space, so they get the startle point directly.
      fieldUniforms.uShock.value.set((s.focus.x - 0.5) * 12, 1, (s.focus.y - 0.5) * 12, 0);
    }
    lastDisturbance.current = s.disturbance;
    hazeUniforms.uShock.value.z = t - shockAt.current;
    fieldUniforms.uShock.value.w = t - shockAt.current;

    /* ---- decide who is present ---- */
    let presentCount = 0;
    let awakeCount = 0;
    let newest: Species | null = null;
    const roll = presentSpecies.current;
    roll.length = 0;

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
        roll.push(species);
        if (!speciesAnnounced.current[i]) {
          speciesAnnounced.current[i] = 1;
          newest = species;
          if (audio && soundField.ready) {
            soundField.play(species, 0.35 + (1 - wariness) * 0.4, (Math.random() - 0.5) * 1.4);
          }
          fireFlare(i, t);
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

    const trailPositionAttr = trailGeometry.getAttribute('position') as THREE.BufferAttribute;
    const trailPresenceAttr = trailGeometry.getAttribute('aPresence') as THREE.BufferAttribute;
    const trailSpeedAttr = trailGeometry.getAttribute('aSpeed') as THREE.BufferAttribute;
    const trailPositions = trailPositionAttr.array as Float32Array;
    const trailPresences = trailPresenceAttr.array as Float32Array;
    const trailSpeeds = trailSpeedAttr.array as Float32Array;
    // Frame-rate independent lag: the tail always sits the same fraction of a
    // second behind the animal, so a streak is the same length at 30 and 144 fps.
    const trailLag = 1 - Math.exp(-delta * 7);

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

      const nx = px + mote.velocity.x * delta * 6;
      const ny = Math.max(0.05, py + mote.velocity.y * delta * 6);
      const nz = pz + mote.velocity.z * delta * 6;
      positions[i3] = nx;
      positions[i3 + 1] = ny;
      positions[i3 + 2] = nz;
      presences[i] = mote.presence;

      // The trail: tail chases the animal, head is the animal.
      mote.trail.x += (nx - mote.trail.x) * trailLag;
      mote.trail.y += (ny - mote.trail.y) * trailLag;
      mote.trail.z += (nz - mote.trail.z) * trailLag;

      const t0 = i * 6;
      trailPositions[t0] = mote.trail.x;
      trailPositions[t0 + 1] = mote.trail.y;
      trailPositions[t0 + 2] = mote.trail.z;
      trailPositions[t0 + 3] = nx;
      trailPositions[t0 + 4] = ny;
      trailPositions[t0 + 5] = nz;

      // Length of the streak itself, not the velocity — it is exactly what the
      // eye is being asked to read, and it needs no separate tuning.
      const streak = Math.hypot(nx - mote.trail.x, ny - mote.trail.y, nz - mote.trail.z);
      trailSpeeds[i * 2] = streak;
      trailSpeeds[i * 2 + 1] = streak;
      trailPresences[i * 2] = mote.presence;
      trailPresences[i * 2 + 1] = mote.presence;
    }

    positionAttr.needsUpdate = true;
    presenceAttr.needsUpdate = true;
    trailPositionAttr.needsUpdate = true;
    trailPresenceAttr.needsUpdate = true;
    trailSpeedAttr.needsUpdate = true;

    /* ---- age the arrival flares ---- */
    const ageAttr = flareGeometry.getAttribute('aAge') as THREE.BufferAttribute;
    const ages = ageAttr.array as Float32Array;
    for (let i = 0; i < FLARE_SLOTS; i++) {
      const age = t - flareBirth.current[i];
      // Parked past its life once spent, which is what the shader discards on.
      ages[i] = age >= FLARE_LIFE ? FLARE_LIFE * 2 : age;
    }
    ageAttr.needsUpdate = true;

    /* ---- keep the chorus alive ---- */
    if (audio) {
      // Density follows how much of the awake community is actually here, so
      // the soundscape thins out under disturbance and fills as they return.
      const fraction = awakeCount > 0 ? presentCount / awakeCount : 0;
      chorus.current.update(roll, s.clockHour, fraction);
      // The bed swells with calm and the wind rises with disturbance.
      soundField.setDrone(0.35 + calm * 0.65, 3);
      soundField.setWind(0.2 + s.disturbance * 0.8, 2);
    }

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

      {/* Under the motes, so an animal is always brighter than its own wake. */}
      <lineSegments geometry={trailGeometry}>
        <shaderMaterial
          vertexShader={TRAIL_VERT}
          fragmentShader={TRAIL_FRAG}
          uniforms={fieldUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

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

      <points geometry={flareGeometry}>
        <shaderMaterial
          vertexShader={FLARE_VERT}
          fragmentShader={FLARE_FRAG}
          uniforms={flareUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}
