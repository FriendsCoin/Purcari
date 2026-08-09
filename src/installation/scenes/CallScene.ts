import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';
import type { Ambience } from '../engine/Ambience';
import { ADDITIVE } from '../engine/blending';
import { POINT_SIZE, TOUCH_UNIFORMS } from '../engine/glsl';
import { color, guildColorArray, guildCss, guildIndex, PALETTE } from '../engine/palette';
import { speciesSelection } from '../engine/selection';
import { speak, voiceOf } from '../engine/voices';
import type { FrameContext, Readout } from '../engine/Scene';
import { atlas, formatHour, normalisedHourly, peakHour, points } from '../data/atlas';
import { ChapterBase, clamp, damp, type TouchUniforms } from './ChapterBase';

/** Radius of the shell of detections the visitor stands inside. */
const SHELL = 40;

/** Half-angle of the sight, in radians. Inside it, a species starts to gather. */
const CONE = 0.2;

/** Seconds of holding a species in the sight before it is fully gathered. */
const DWELL = 1.1;

/** How far through the gather the voice fires. */
const VOICE_AT = 0.72;

/** Seconds before the same species will speak again. */
const VOICE_HOLD = 2.6;

interface SpeciesSky {
  index: number;
  /** Unit direction of the species in the sky around the visitor. */
  direction: Vector3;
  /** Tangent basis, for laying its own detections out facing the visitor. */
  right: Vector3;
  up: Vector3;
  meanHour: number;
  /** Below 1 for a species with a lot of detections: an easier thing to hit. */
  reach: number;
}

/**
 * Chapter X — L'appel.
 *
 * The chorus, turned inside out and put in the hand.
 *
 * The other chapters hold the record at arm's length; this one puts the visitor
 * inside it. All 2,665 detections hang on a shell around them, every species in
 * its own patch of sky: the azimuth is the hour it sings — the same clock the
 * whole piece runs on, so turning toward the dawn finds the dawn chorus — and
 * the elevation is its nocturnality, which puts the owls and the nightjars
 * overhead and the day birds down at the horizon.
 *
 * Aim the phone at a patch and that species starts to gather: its own
 * detections leave the shell and draw together into a small figure of its
 * hours, the rest of the record dims, and it speaks. Look away and it lets go.
 *
 * **The voice is synthesised, and the chapter says so.** The survey kept
 * detections, not audio; there is no recording in this piece to play. What is
 * played is built from the numbers — register from nocturnality, syllables from
 * the detection count, phrasing from the guild — and is a portrait rather than
 * a playback. Calling it anything else would be the one lie this piece cannot
 * afford.
 *
 * The sight follows the device's own orientation where the platform grants it,
 * which is what makes this a phone chapter; where it does not — a wall panel, a
 * desktop, an iOS device before the visitor has agreed — a finger does the same
 * job, and the chapter opens in that mode so it is never dead on arrival.
 */
export class CallScene extends ChapterBase {
  readonly id = 'call' as const;
  readonly look = { exposure: 1.02, bloom: 0.82, grain: 0.026, aberration: 1.05, vignette: 1.24, trail: 0.72 };

  private readonly cloud: Points;
  private readonly uniforms: ReturnType<typeof createUniforms>;
  private readonly sky: SpeciesSky[] = [];

  private ambience: Ambience | null = null;

  /** Where the sight is pointed, in radians. */
  private yaw = 0;
  private pitch = 0;
  private readonly forward = new Vector3(0, 0, -1);

  /** Sensor aiming, once the platform and the visitor have both agreed. */
  private sensor = false;
  private sensorDenied = false;
  private baseAlpha: number | null = null;
  private baseBeta = 0;
  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    if (!this.sensor || event.beta === null) return;
    const alpha = event.alpha;
    if (alpha !== null) {
      if (this.baseAlpha === null) {
        this.baseAlpha = alpha;
        this.baseBeta = event.beta;
      }
      // Compass degrees climb anticlockwise, so turning right has to lower
      // them; unwrapped through 360 or the sight snaps round on every pass.
      let delta = this.baseAlpha - alpha;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      this.yaw = (delta / 180) * Math.PI;
    }
    this.pitch = clamp(((event.beta - this.baseBeta) / 180) * Math.PI, -0.95, 0.95);
  };

  /** The species the sight is closest to right now, if any. */
  private sighted: number | null = null;
  private held: number | null = null;
  private capture = 0;
  private spokeAt = -99;
  private spoken: number | null = null;

  private cachedReadout: Readout;
  private readoutKey = '';

  constructor() {
    super(62);
    this.camera.position.set(0, 0, 0);
    this.interactionPlane.normal.set(0, 0, 1);
    this.interactionPlane.constant = -SHELL;

    this.buildSky();
    this.uniforms = createUniforms(this.touch);
    this.cloud = this.buildCloud();
    this.scene.add(this.cloud);

    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', this.onOrientation);
    }

    this.cachedReadout = this.overviewReadout();
  }

  setAmbience(ambience: Ambience): void {
    this.ambience = ambience;
  }

  // ------------------------------------------------------------------ layout --

  /** A patch of sky per species: azimuth is its hour, elevation its night. */
  private buildSky(): void {
    // Elevation goes by rank, not by the raw figure. Nocturnality is a heap at
    // zero with a long thin tail — nineteen species of a hundred and twenty-one
    // are properly nocturnal — so a linear mapping buries nine tenths of the
    // record under the horizon and leaves the sky empty. By rank the ordering
    // still holds (the more of a species' record is at night, the higher it
    // hangs) and every band of sky has birds in it.
    const byNight = atlas.species
      .map((species, index) => ({ index, night: species.nocturnality }))
      .sort((a, b) => a.night - b.night);
    const height = new Float32Array(atlas.species.length);
    byNight.forEach((entry, rank) => {
      height[entry.index] = -0.42 + (rank / Math.max(1, byNight.length - 1)) * 1.32;
    });

    atlas.species.forEach((species, index) => {
      const meanHour = circularMeanHour(species.hourly);
      // Midnight behind the visitor, noon in front, so the day sweeps past as
      // they turn — the same clock as every other chapter.
      const azimuth = (meanHour / 24) * Math.PI * 2 + Math.PI;
      const elevation = height[index] + (hash(index * 7.3) - 0.5) * 0.18;

      const direction = new Vector3(
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        -Math.cos(azimuth) * Math.cos(elevation)
      ).normalize();

      const right = new Vector3(0, 1, 0).cross(direction).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      const up = direction.clone().cross(right).normalize();

      const reach = 1 - clamp(Math.log(species.count + 1) / Math.log(260), 0, 1) * 0.6;
      this.sky.push({ index, direction, right, up, meanHour, reach });
    });
  }

  /**
   * Every detection twice over: where it hangs in the sky, and where it goes
   * when its species is called. The gathered figure is the species' own clock —
   * each detection at the angle of the hour it was recorded — so what assembles
   * is made of the same records that were scattered a second earlier.
   */
  private buildCloud(): Points {
    const count = points.count;
    const position = new Float32Array(count * 3);
    const gathered = new Float32Array(count * 3);
    const speciesAttr = new Float32Array(count);
    const guild = new Float32Array(count);
    const seed = new Float32Array(count);
    const weight = new Float32Array(count);

    // Rank inside its own species, for laying the gathered figure out evenly.
    const seen = new Uint16Array(atlas.species.length);
    const total = new Uint16Array(atlas.species.length);
    for (let i = 0; i < count; i += 1) total[points.species[i]] += 1;

    const scratch = new Vector3();
    for (let i = 0; i < count; i += 1) {
      const index = points.species[i];
      const patch = this.sky[index];
      const species = atlas.species[index];
      const rank = seen[index];
      seen[index] += 1;

      // Scattered: a loose swarm around its species' patch, wide enough that a
      // common species reads as a crowd and a rare one as a couple of sparks.
      const spread = 0.07 + Math.min(0.085, Math.log(total[index] + 1) * 0.018);
      const a = hash(i * 3.11) * Math.PI * 2;
      const r = Math.sqrt(hash(i * 5.77)) * spread;
      scratch
        .copy(patch.direction)
        .addScaledVector(patch.right, Math.cos(a) * r)
        .addScaledVector(patch.up, Math.sin(a) * r)
        .normalize()
        .multiplyScalar(SHELL * (0.9 + hash(i * 9.13) * 0.2));
      position[i * 3] = scratch.x;
      position[i * 3 + 1] = scratch.y;
      position[i * 3 + 2] = scratch.z;

      // Gathered: its own clock, the hour of this very detection as the angle.
      // Wide enough to be a figure rather than a dot — a hundred detections
      // drawn additively inside a couple of degrees is one white blob, which
      // is neither beautiful nor readable.
      const hour = points.minute[i] / 60;
      const angle = Math.PI / 2 - (hour / 24) * Math.PI * 2;
      const ring = 0.1 + (rank / Math.max(1, total[index])) * 0.26;
      scratch
        .copy(patch.direction)
        .addScaledVector(patch.right, Math.cos(angle) * ring)
        .addScaledVector(patch.up, Math.sin(angle) * ring)
        .normalize()
        .multiplyScalar(SHELL * 0.82);
      gathered[i * 3] = scratch.x;
      gathered[i * 3 + 1] = scratch.y;
      gathered[i * 3 + 2] = scratch.z;

      speciesAttr[i] = index;
      guild[i] = guildIndex(species.guild);
      seed[i] = hash(i * 1.37);
      weight[i] = clamp(Math.log(species.count + 1) / Math.log(260), 0.22, 1);
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aGathered', new BufferAttribute(gathered, 3));
    geometry.setAttribute('aSpecies', new BufferAttribute(speciesAttr, 1));
    geometry.setAttribute('aGuild', new BufferAttribute(guild, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    geometry.setAttribute('aWeight', new BufferAttribute(weight, 1));

    const cloud = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CLOUD_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        ...ADDITIVE,
      })
    );
    cloud.frustumCulled = false;
    return cloud;
  }

  // ------------------------------------------------------------------ update --

  enter(): void {
    super.enter();
    this.uniforms.uReveal.value = 0;
    this.capture = 0;
    this.sighted = null;
    this.held = null;
    this.spoken = null;
    this.spokeAt = -99;
    this.readoutKey = '';
    // Open facing the hour the record is loudest — the dawn chorus is a third
    // of it, and a chapter that opens on empty sky teaches nothing.
    this.yaw = (peakHour / 24) * Math.PI * 2 + Math.PI;
    this.pitch = 0;
    this.baseAlpha = null;
  }

  exit(): void {
    super.exit();
    this.sensor = false;
    this.baseAlpha = null;
  }

  /** The chips: a finger, or the device's own sense of where it is pointed. */
  setMode(id: string): void {
    if (id === 'finger') {
      this.sensor = false;
      this.baseAlpha = null;
      return;
    }
    if (id !== 'sensor' || this.sensor) return;

    const ctor = (
      window as unknown as {
        DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
      }
    ).DeviceOrientationEvent;

    // iOS will not report orientation until it has been asked, and it will only
    // ask from inside a gesture — which is exactly where a chip press puts us.
    if (ctor && typeof ctor.requestPermission === 'function') {
      void ctor
        .requestPermission()
        .then(result => {
          this.sensor = result === 'granted';
          this.sensorDenied = !this.sensor;
          this.baseAlpha = null;
          this.readoutKey = '';
        })
        .catch(() => {
          this.sensorDenied = true;
          this.readoutKey = '';
        });
      return;
    }

    this.sensor = true;
    this.sensorDenied = false;
    this.baseAlpha = null;
    this.readoutKey = '';
  }

  update(ctx: FrameContext): void {
    this.syncTouchUniforms(ctx);
    this.uniforms.uTime.value = ctx.time;
    this.uniforms.uReveal.value = damp(this.uniforms.uReveal.value, 1, 0.9, ctx.delta);

    this.aim(ctx);
    this.acquire(ctx);

    this.uniforms.uTarget.value = this.held ?? -1;
    this.uniforms.uCapture.value = this.capture;
    this.refreshReadout();
  }

  /** Where the sight is pointed: the device, or the finger, or the drift. */
  private aim(ctx: FrameContext): void {
    if (!this.sensor) {
      const drag = ctx.pointer.dragWithInertia;
      if (drag.lengthSq() > 0) {
        this.yaw -= drag.x * 2.4;
        this.pitch = clamp(this.pitch + drag.y * 1.7, -0.95, 0.95);
      }
      // Untouched, the sight drifts along the clock on its own, so an
      // unattended panel keeps finding birds.
      this.yaw += ctx.delta * ctx.idle * 0.06;
    }

    this.forward
      .set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
      .normalize();
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(this.forward);
    this.uniforms.uForward.value.copy(this.forward);
  }

  /** Whatever is closest to the sight gathers; everything else lets go. */
  private acquire(ctx: FrameContext): void {
    let best: number | null = null;
    let bestAngle = CONE;
    for (const patch of this.sky) {
      const angle = Math.acos(clamp(patch.direction.dot(this.forward), -1, 1));
      // Weighted by how much of it there is to aim at. A third of this list was
      // heard once, and unweighted the sight spends its whole time locking onto
      // single sparks the visitor cannot even see.
      if (angle * patch.reach < bestAngle) {
        bestAngle = angle * patch.reach;
        best = patch.index;
      }
    }
    this.sighted = best;

    if (best !== null && (this.held === null || best === this.held || this.capture < 0.25)) {
      this.held = best;
      this.capture = Math.min(1, this.capture + ctx.delta / DWELL);
    } else {
      this.capture = Math.max(0, this.capture - ctx.delta / (DWELL * 0.7));
      if (this.capture <= 0.001) {
        this.held = null;
        this.spoken = null;
      }
    }

    if (
      this.held !== null &&
      this.capture >= VOICE_AT &&
      (this.spoken !== this.held || ctx.time - this.spokeAt > VOICE_HOLD)
    ) {
      this.sing(this.held, ctx.time);
    }

    // The held species travels to the other chapters like any other selection.
    const name = this.capture > 0.5 && this.held !== null ? atlas.species[this.held].name : null;
    if (speciesSelection.name !== name) speciesSelection.set(name);
  }

  private sing(index: number, time: number): void {
    this.spoken = index;
    this.spokeAt = time;
    const bus = this.ambience?.bus;
    if (!bus) return;
    const species = atlas.species[index];
    const seconds = speak(bus.context, bus.destination, species, 0.9);
    this.ambience?.duck(seconds + 0.4);
  }

  // ---------------------------------------------------------------- readout --

  private modes(): { id: string; label: string; active: boolean }[] {
    return [
      { id: 'finger', label: 'Doigt', active: !this.sensor },
      { id: 'sensor', label: 'Capteur', active: this.sensor },
    ];
  }

  private refreshReadout(): void {
    const key =
      this.held === null || this.capture < 0.35
        ? `sky-${this.sensor}-${this.sensorDenied}-${this.sighted ?? -1}`
        : `held-${this.held}-${this.sensor}`;
    if (key !== this.readoutKey) {
      this.readoutKey = key;
      this.cachedReadout =
        this.held === null || this.capture < 0.35
          ? this.overviewReadout()
          : this.speciesReadout(this.held);
    }
    // The sight is the overlay's own ring, parked in the middle of the screen.
    this.cachedReadout.marker = { x: 0.5, y: 0.5 };
  }

  private overviewReadout(): Readout {
    const aiming = this.sighted !== null;
    const how = this.sensor
      ? 'Tournez sur vous-même : le viseur suit le téléphone.'
      : this.sensorDenied
        ? 'Le capteur a été refusé — balayez du doigt pour viser.'
        : 'Balayez du doigt pour viser, ou passez au capteur pour viser en tournant.';

    return {
      eyebrow: aiming ? 'Chapitre X · en visée' : 'Chapitre X',
      title: 'L’appel',
      body:
        `Les ${atlas.meta.total.toLocaleString('fr-FR')} détections vous entourent : chaque espèce a ` +
        'son coin de ciel, à l’heure où elle chante, d’autant plus haut qu’elle est nocturne. ' +
        `Visez-en une et elle se rassemble, puis elle parle. ${how}`,
      modes: this.modes(),
      stats: [
        { label: 'Espèces au ciel', value: String(atlas.meta.speciesCount) },
        { label: 'Détections', value: atlas.meta.total.toLocaleString('fr-FR') },
        { label: 'Visée', value: aiming ? 'espèce en vue' : 'ciel libre' },
      ],
      accent: PALETTE.bone,
    };
  }

  private speciesReadout(index: number): Readout {
    const species = atlas.species[index];
    const voice = voiceOf(species);
    const guild = atlas.guilds.find(g => g.id === species.guild);

    return {
      eyebrow: guild?.label ?? 'Espèce',
      title: species.name,
      body:
        // The one thing this chapter must never leave unsaid.
        'Voix de synthèse : le registre suit la nocturnité de l’espèce, le nombre de syllabes ' +
        'son nombre de détections, le phrasé sa guilde. Aucun enregistrement n’est diffusé — ' +
        'le relevé a gardé des détections, pas de son.',
      modes: this.modes(),
      stats: [
        { label: 'Détections', value: String(species.count) },
        { label: 'Heure moyenne', value: formatHour(Math.round(circularMeanHour(species.hourly)) % 24) },
        { label: 'Nocturnité', value: `${Math.round(species.nocturnality * 100)} %` },
        { label: 'Voix', value: `${Math.round(voice.pitch)} Hz · ${voice.syllables} syll.` },
      ],
      spark: normalisedHourly(species.hourly),
      accent: guildCss(species.guild),
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
    uTarget: { value: -1 },
    uCapture: { value: 0 },
    uForward: { value: new Vector3(0, 0, -1) },
    uGuildColors: { value: guildColorArray() },
    uBone: { value: color(PALETTE.bone) },
    uGold: { value: color(PALETTE.gold) },
    ...touch,
  };
}

function circularMeanHour(hourly: number[]): number {
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
  if (total === 0) return 12;
  return (((Math.atan2(sy, sx) / (Math.PI * 2)) * 24) + 24) % 24;
}

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------------------------ shaders --

const CLOUD_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uTarget;
uniform float uCapture;
uniform vec3 uForward;
uniform vec3 uGuildColors[6];
uniform vec3 uBone;
uniform vec3 uGold;

attribute vec3 aGathered;
attribute float aSpecies;
attribute float aGuild;
attribute float aSeed;
attribute float aWeight;

varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

${TOUCH_UNIFORMS}
${POINT_SIZE}

void main(){
  float held = uTarget < -0.5 ? 0.0 : step(abs(uTarget - aSpecies), 0.5);
  vHeld = held * uCapture;

  // The called species leaves the shell and draws itself together; everything
  // else stays where it hangs and steps back.
  vec3 pos = mix(position, aGathered, vHeld);
  float drift = sin(uTime * 0.5 + aSeed * 25.0) * (0.5 + aSeed);
  pos += normalize(pos) * drift * mix(0.7, 0.12, vHeld);

  // How close this point sits to where the sight is looking, for a soft pool of
  // light around the middle of the screen — the sky answers before it is hit.
  float sight = clamp(dot(normalize(pos), uForward), 0.0, 1.0);
  float pool = pow(sight, 9.0);

  vColor = mix(uGuildColors[int(aGuild)], uBone, 0.12 + pool * 0.25);
  vColor = mix(vColor, uGold, vHeld * 0.55);

  vAlpha = uReveal * (0.24 + aWeight * 0.4) * (0.6 + pool * 0.8);
  // Everything that is not the called species gets out of the way.
  vAlpha *= mix(1.0, mix(0.3, 1.35, held), uCapture);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = pointSizeFor((0.2 + aWeight * 0.34) * (1.0 + vHeld * 0.8 + pool * 0.45), mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHeld;

void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float core = 1.0 - smoothstep(0.0, 0.55, d);
  float halo = exp(-d * 2.8) * (0.28 + vHeld * 0.45);

  float a = (core + halo) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;
