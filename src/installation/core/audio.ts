import type { InstallationData, Species } from './types';
import { activityAtHour } from './data';

/**
 * The installation's sound.
 *
 * IMPORTANT, and it belongs on the wall label: **nothing here is a recording.**
 * The survey ships detection metadata only — no audio was exported with it — so
 * every voice is *synthesised from that species' own numbers*. Guild sets the
 * vocal apparatus, rank sets the register, peak hour sets the phrasing, night
 * ratio sets how much room the voice sits in, and the scientific name seeds a
 * deterministic hash so an animal always sounds like itself.
 *
 * That is deliberate rather than a limitation. A generated imitation of a real
 * tawny owl, played beside "Strix aluco, 716 detections", would be read as a
 * field recording — a fabrication in a scientific frame. A voice audibly built
 * out of the data is honest, and it is the piece's argument in another medium.
 *
 * If real BirdNET segments are supplied later, `SoundField.play` is the single
 * seam to swap for buffer playback; everything else — scheduling, polyphony,
 * spatialisation, the chorus — stays as it is.
 */

/* -------------------------------------------------------------- vocal model */

/** Register by guild, in Hz. Loosely tracks real body size and vocal range. */
const GUILD_REGISTER: Record<string, [number, number]> = {
  songbird: [1900, 4600],
  gamebird: [420, 900],
  dove: [340, 620],
  waterbird: [300, 1100],
  wader: [900, 2600],
  raptor: [700, 1900],
  owl: [280, 780],
  woodpecker: [900, 2600],
  aerial: [1600, 4200],
  corvid: [380, 1100],
  carnivore: [180, 620],
  herbivore: [220, 700],
  rodent: [2400, 5600],
  mammal: [200, 800],
  bird: [800, 2400],
};

/**
 * How the voice is built. Birds are not oscillators: most produce a near-pure
 * whistle with rapid frequency sweeps, which is why `warble` and `trill` carry
 * heavy modulation rather than added harmonics.
 */
type Timbre = 'whistle' | 'trill' | 'warble' | 'coo' | 'rasp' | 'hoot' | 'knock' | 'bark' | 'chatter';

const GUILD_TIMBRE: Record<string, Timbre> = {
  songbird: 'warble',
  gamebird: 'rasp',
  dove: 'coo',
  waterbird: 'hoot',
  wader: 'whistle',
  raptor: 'whistle',
  owl: 'hoot',
  woodpecker: 'knock',
  aerial: 'trill',
  corvid: 'rasp',
  carnivore: 'bark',
  herbivore: 'bark',
  rodent: 'chatter',
  mammal: 'bark',
  bird: 'whistle',
};

/** Deterministic hash so a species always sounds like itself across sessions. */
function hash(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export interface VoiceParams {
  frequency: number;
  timbre: Timbre;
  /** Syllables in one phrase. */
  notes: number;
  /** Seconds between syllables. */
  spacing: number;
  /** Length of one syllable. */
  duration: number;
  /** 0..1 — reverb send. Nocturnal animals sound further away. */
  space: number;
  /** Frequency-sweep depth across a syllable. */
  glide: number;
  /** Vibrato rate in Hz and depth in cents. */
  vibratoRate: number;
  vibratoDepth: number;
  /** Brightness of the formant filter. */
  openness: number;
}

export function voiceFor(species: Species): VoiceParams {
  const seed = hash(species.sci);
  const seed2 = hash(species.sci, 91);
  const seed3 = hash(species.sci, 7717);
  const [lo, hi] = GUILD_REGISTER[species.guild] ?? GUILD_REGISTER.bird;

  // Rarer species sit higher in their register, so they cut through the chorus
  // instead of being buried by the pheasant.
  const rarity = 1 - Math.min(1, Math.log1p(species.total) / Math.log1p(7400));
  const frequency = lo + (hi - lo) * (0.2 + rarity * 0.5 + seed * 0.3);
  const timbre = GUILD_TIMBRE[species.guild] ?? 'whistle';

  const percussive = timbre === 'knock' || timbre === 'chatter';
  const long = timbre === 'hoot' || timbre === 'coo';

  return {
    frequency,
    timbre,
    notes: percussive ? 3 + Math.floor(seed2 * 7) : long ? 1 + Math.floor(seed2 * 3) : 2 + Math.floor(seed2 * 5),
    spacing: percussive ? 0.055 + seed3 * 0.05 : long ? 0.5 + seed3 * 0.45 : 0.09 + seed3 * 0.16,
    duration: long ? 0.34 + seed * 0.22 : percussive ? 0.05 : 0.10 + seed * 0.16,
    space: 0.2 + species.nightRatio * 0.75,
    glide: seed2,
    vibratoRate: 14 + seed3 * 26,
    vibratoDepth: timbre === 'warble' || timbre === 'trill' ? 90 + seed * 320 : 8 + seed * 30,
    openness: 0.35 + seed3 * 0.6,
  };
}

/* ---------------------------------------------------------------- utilities */

/** Decaying-noise impulse response — a stone cellar, roughly. */
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      // Slight inter-channel decorrelation widens the tail.
      const t = i / length;
      samples[i] = (Math.random() * 2 - 1) * (1 - t) ** decay * (channel ? 0.94 : 1);
    }
  }
  return impulse;
}

/** Pink-ish noise, used for the wind bed and for rasp/knock voices. */
function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    // Paul Kellet's economy pink filter — cheap and smooth enough for a bed.
    b0 = 0.99765 * b0 + white * 0.0990460;
    b1 = 0.96300 * b1 + white * 0.2965164;
    b2 = 0.57000 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
  }
  return buffer;
}

export interface PlayOptions {
  gain?: number;
  /** -1..1 stereo position. */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
}

/* --------------------------------------------------------------- the engine */

export class SoundField {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private bedGain: GainNode | null = null;
  private bedNodes: AudioScheduledSourceNode[] = [];
  private windGain: GainNode | null = null;

  /** Voices currently sounding, for polyphony limiting. */
  private active = 0;
  /**
   * Starts at -Infinity, not 0: a fresh context has `currentTime === 0`, so a
   * zero here makes the rate-limit reject the very first voice. It is masked on
   * a live context, which is already past 0 by the time anything plays, but it
   * silences every voice in an OfflineAudioContext render.
   */
  private lastVoiceAt = -Infinity;
  private maxPolyphony = 14;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Must be called from a user gesture — browsers block audio otherwise. */
  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0;

    // A gentle limiter: a hard chorus of 14 voices must not clip the kiosk amp.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 1;
    voiceBus.connect(master);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 3.4, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    reverb.connect(wet);
    wet.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.voiceBus = voiceBus;
    this.reverb = reverb;
    this.noiseBuffer = makeNoise(ctx, 3);

    this.fadeMaster(0.75, 2.5);
  }

  private fadeMaster(to: number, seconds: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(to, now + seconds);
  }

  setVolume(value: number, seconds = 0.6) {
    this.fadeMaster(Math.max(0, Math.min(1, value)), seconds);
  }

  setPolyphony(limit: number) {
    this.maxPolyphony = Math.max(1, Math.min(32, Math.floor(limit)));
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.fadeMaster(0, 0.8);
      window.setTimeout(() => void this.ctx?.suspend(), 900);
    }
  }

  /* ------------------------------------------------------------------- bed */

  /**
   * The room tone: a low sustained chord whose partial count follows the
   * estate's Shannon diversity, plus a filtered-noise wind layer. Richer data
   * literally makes a fuller chord.
   */
  startBed(shannon: number) {
    if (!this.ctx || !this.master || this.bedNodes.length) return;
    const ctx = this.ctx;

    const bed = ctx.createGain();
    bed.gain.value = 0;
    bed.connect(this.master);

    const root = 55;
    const ratios = [1, 1.5, 2, 3, 4.02, 6, 8.03].slice(0, 2 + Math.round(shannon));
    ratios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = root * ratio;
      osc.detune.value = (i - ratios.length / 2) * 5;

      const partial = ctx.createGain();
      const level = 0.42 / (i + 1) ** 1.35;
      partial.gain.value = level;

      // Each partial breathes at its own slow rate, so the chord never sits still.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.021 + i * 0.0143;
      const depth = ctx.createGain();
      depth.gain.value = level * 0.65;
      lfo.connect(depth);
      depth.connect(partial.gain);
      lfo.start();

      osc.connect(partial);
      partial.connect(bed);
      osc.start();
      this.bedNodes.push(osc, lfo);
    });

    // Wind: looping pink noise through a slowly sweeping lowpass.
    if (this.noiseBuffer) {
      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuffer;
      wind.loop = true;

      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.7;

      const sweep = ctx.createOscillator();
      sweep.frequency.value = 0.035;
      const sweepDepth = ctx.createGain();
      sweepDepth.gain.value = 260;
      sweep.connect(sweepDepth);
      sweepDepth.connect(windFilter.frequency);
      sweep.start();

      const windGain = ctx.createGain();
      windGain.gain.value = 0.05;

      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(this.master);
      wind.start();

      this.bedNodes.push(wind, sweep);
      this.windGain = windGain;
    }

    bed.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 6);
    this.bedGain = bed;
  }

  /** Kept for the original call site. */
  startDrone(shannon: number) {
    this.startBed(shannon);
  }

  setDrone(level: number, seconds = 2) {
    if (!this.ctx || !this.bedGain) return;
    const now = this.ctx.currentTime;
    const target = Math.max(0, level) * 0.22;
    this.bedGain.gain.cancelScheduledValues(now);
    this.bedGain.gain.setValueAtTime(this.bedGain.gain.value, now);
    this.bedGain.gain.linearRampToValueAtTime(target, now + seconds);
  }

  setWind(level: number, seconds = 3) {
    if (!this.ctx || !this.windGain) return;
    const now = this.ctx.currentTime;
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setValueAtTime(this.windGain.gain.value, now);
    this.windGain.gain.linearRampToValueAtTime(Math.max(0, level) * 0.12, now + seconds);
  }

  /* ---------------------------------------------------------------- voices */

  canPlay(minGap = 0.035): boolean {
    if (!this.ctx) return false;
    if (this.active >= this.maxPolyphony) return false;
    return this.ctx.currentTime - this.lastVoiceAt > minGap;
  }

  /**
   * Sound one species. Returns the phrase length in seconds, or 0 if the voice
   * was refused (context not running, or polyphony budget spent).
   */
  play(species: Species, gainOrOptions: number | PlayOptions = 1, panArg = 0): number {
    if (!this.ctx || !this.voiceBus || !this.reverb) return 0;

    const options: PlayOptions =
      typeof gainOrOptions === 'number' ? { gain: gainOrOptions, pan: panArg } : gainOrOptions;
    const gain = options.gain ?? 1;
    const pan = options.pan ?? 0;
    const delay = Math.max(0, options.delay ?? 0);

    if (!this.canPlay()) return 0;

    const ctx = this.ctx;
    const params = voiceFor(species);
    const start = ctx.currentTime + 0.015 + delay;
    this.lastVoiceAt = start;
    this.active++;

    const out = ctx.createGain();
    out.gain.value = 1;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    panner.connect(this.voiceBus);

    const send = ctx.createGain();
    send.gain.value = params.space;
    panner.connect(send);
    send.connect(this.reverb);

    // Per-voice level, set against the 14-voice polyphony cap and the limiter:
    // one voice peaks around 0.18 after filtering, and a full incoherent chorus
    // lands near 0.7 rather than clipping.
    const peak = 0.42 * gain;
    for (let n = 0; n < params.notes; n++) {
      const at = start + n * params.spacing;
      // Syllables decay across a phrase — birds rarely repeat at equal weight.
      const weight = peak * (1 - (n / (params.notes + 1)) * 0.55);
      this.emitSyllable(params, at, out, weight, n);
    }

    const total = params.notes * params.spacing + params.duration + 1.2;
    window.setTimeout(
      () => {
        out.disconnect();
        panner.disconnect();
        send.disconnect();
        this.active = Math.max(0, this.active - 1);
      },
      (start - ctx.currentTime + total) * 1000 + 150,
    );

    return total;
  }

  private emitSyllable(
    params: VoiceParams,
    at: number,
    dest: GainNode,
    peakIn: number,
    index: number,
  ) {
    let peak = peakIn;
    if (!this.ctx) return;
    const ctx = this.ctx;
    const { timbre, frequency, glide, duration } = params;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.connect(dest);

    /* ---- percussive voices: shaped noise ---- */
    if (timbre === 'knock' || timbre === 'rasp' || timbre === 'chatter') {
      const length = timbre === 'knock' ? 0.05 : timbre === 'chatter' ? 0.035 : 0.18;
      // A narrow bandpass throws away most of the noise's energy, so these
      // voices need makeup gain to sit level with the tonal ones. Measured
      // without it, the rook and the wood mouse came out ~5x quieter than the
      // finches and disappeared under any chorus.
      peak *= 2.6;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(frequency, at);
      band.Q.value = timbre === 'knock' ? 4 : timbre === 'chatter' ? 9 : 6;

      // A resonant body under the noise gives the knock its woody pitch.
      const body = ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = frequency * 0.5;
      body.Q.value = 7;
      body.gain.value = 9;

      if (timbre === 'rasp') {
        // Rasps sweep downward: crow, pheasant, jay.
        band.frequency.exponentialRampToValueAtTime(frequency * 0.62, at + length);
      }

      src.connect(band);
      band.connect(body);
      body.connect(env);

      env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.12);
      src.start(at);
      src.stop(at + length + 0.15);
      return;
    }

    /* ---- tonal voices: whistle-family ---- */
    const osc = ctx.createOscillator();
    osc.type = timbre === 'bark' ? 'sawtooth' : timbre === 'coo' ? 'sine' : 'triangle';

    // Vibrato — the single thing that most separates a bird from a test tone.
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = params.vibratoRate;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = params.vibratoDepth;
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(osc.detune);
    vibrato.start(at);
    vibrato.stop(at + duration + 0.4);

    // Formant: a resonant band that gives the voice a throat rather than a speaker.
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = frequency * (1.4 + params.openness);
    formant.Q.value = 1.6;

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = frequency * (3.2 + params.openness * 3);
    tone.Q.value = 0.9;

    // Per-syllable pitch drift keeps repeated notes from sounding sequenced.
    const drift = 1 + (index % 2 === 0 ? 0.012 : -0.014) * (1 + glide);
    const f0 = frequency * drift;
    osc.frequency.setValueAtTime(f0, at);

    switch (timbre) {
      case 'warble':
        // Rise then fall — the generic passerine phrase.
        osc.frequency.exponentialRampToValueAtTime(f0 * (1.18 + glide * 0.5), at + duration * 0.35);
        osc.frequency.exponentialRampToValueAtTime(f0 * (0.80 - glide * 0.12), at + duration);
        break;
      case 'trill':
        osc.frequency.exponentialRampToValueAtTime(f0 * (1.05 + glide * 0.22), at + duration * 0.5);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.94, at + duration);
        break;
      case 'whistle':
        osc.frequency.exponentialRampToValueAtTime(f0 * (0.52 + glide * 0.26), at + duration);
        break;
      case 'coo':
        // Doves: a small rise, a long settle.
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.06, at + duration * 0.22);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.95, at + duration);
        break;
      case 'hoot':
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.93, at + duration);
        break;
      default:
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.58, at + duration);
    }

    // Soft attacks for owls and doves, sharp ones for everything else.
    const attack = timbre === 'hoot' || timbre === 'coo' ? duration * 0.3 : duration * 0.14;
    env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.3);

    osc.connect(formant);
    formant.connect(tone);
    tone.connect(env);
    osc.start(at);
    osc.stop(at + duration + 0.35);
  }

  /* --------------------------------------------------------------- offline */

  /**
   * Render one species' phrase to a buffer, without a live context. Used by the
   * audio verification script — the only way to check that these voices are
   * audible and distinct without listening to them.
   */
  static async render(species: Species, seconds = 3, sampleRate = 44100): Promise<AudioBuffer> {
    const OfflineCtor =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    const ctx = new OfflineCtor(1, Math.ceil(sampleRate * seconds), sampleRate);

    const field = new SoundField();
    // Wire the engine's graph onto the offline context.
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    const voiceBus = ctx.createGain();
    voiceBus.connect(master);
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    reverb.connect(wet);
    wet.connect(master);

    // `ctx` here is an OfflineAudioContext; the engine only uses BaseAudioContext
    // members plus currentTime, all of which it provides.
    const engine = field as unknown as {
      ctx: BaseAudioContext;
      master: GainNode;
      voiceBus: GainNode;
      reverb: ConvolverNode;
      noiseBuffer: AudioBuffer;
    };
    engine.ctx = ctx;
    engine.master = master;
    engine.voiceBus = voiceBus;
    engine.reverb = reverb;
    engine.noiseBuffer = makeNoise(ctx, 2);

    field.play(species, { gain: 1 });
    return ctx.startRendering();
  }
}

export const soundField = new SoundField();

/* ---------------------------------------------------------------- chorus */

/**
 * Keeps a living soundscape running from whichever species are currently
 * present, at a density taken from their real hourly activity.
 *
 * Without this the pieces only made sound when touched, which left the outdoor
 * installation silent exactly when it should be most alive — the moment the
 * fauna returns. Call `update` every frame; it is cheap and self-throttling.
 */
export class Chorus {
  private nextAt = 0;
  private pool: Species[] = [];
  private poolHour = -1;

  constructor(private field: SoundField) {}

  /**
   * @param present species currently on screen, in return order
   * @param hour    clock hour, 0..24
   * @param density 0..1 — how full the chorus should be
   */
  update(present: Species[], hour: number, density: number) {
    if (!this.field.ready || present.length === 0 || density <= 0.01) return;

    const now = this.field.currentTime;
    if (now < this.nextAt) return;

    // Refresh the weighted pool when the hour moves on.
    const hourBucket = Math.floor(hour * 2);
    if (hourBucket !== this.poolHour) {
      this.poolHour = hourBucket;
      this.pool = present;
    }

    const candidates = this.pool.length ? this.pool : present;
    // Weight the draw by how active each species actually is at this hour, so
    // the dawn chorus is dominated by the birds that really do sing at dawn.
    let total = 0;
    const weights = candidates.map((s) => {
      const w = 0.05 + activityAtHour(s, hour);
      total += w;
      return w;
    });
    let pick = Math.random() * total;
    let chosen = candidates[0];
    for (let i = 0; i < candidates.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosen = candidates[i];
        break;
      }
    }

    this.field.play(chosen, {
      gain: 0.20 + density * 0.4,
      pan: (Math.random() - 0.5) * 1.7,
    });

    // Gap between voices: dense at full chorus, sparse and lonely when almost
    // nothing is present. Randomised so it never sounds metronomic.
    const base = 2.6 - density * 2.25;
    this.nextAt = now + base * (0.5 + Math.random());
  }

  reset() {
    this.nextAt = 0;
    this.poolHour = -1;
  }
}

/** Convenience: how full a chorus should sound, from the survey's own numbers. */
export function chorusDensity(data: InstallationData, hour: number, presentFraction: number) {
  const awake = data.species.reduce((n, s) => n + (activityAtHour(s, hour) > 0.1 ? 1 : 0), 0);
  const reach = Math.min(1, awake / Math.max(1, data.meta.totalSpecies * 0.45));
  return Math.max(0, Math.min(1, reach * presentFraction));
}
