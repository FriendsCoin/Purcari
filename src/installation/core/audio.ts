import type { Species } from './types';

/**
 * Sonification engine.
 *
 * IMPORTANT: these are not field recordings. The survey ships detection metadata
 * only — no audio was exported with it. Every voice here is *synthesised from the
 * species' own numbers*: guild sets the timbre, rank sets the register, peak hour
 * sets the phrasing, night ratio sets the reverb. The result is a chorus that is
 * structurally truthful about the data without pretending to be a recording, and
 * the wall text should say so.
 *
 * If real BirdNET audio segments are supplied later, `SpeciesVoice.play` is the
 * single seam to swap for buffer playback.
 */

/** Register by guild, in Hz — loosely tracks real body size / vocal range. */
const GUILD_REGISTER: Record<string, [number, number]> = {
  songbird: [1800, 4200],
  gamebird: [420, 900],
  waterbird: [300, 1100],
  carnivore: [180, 620],
  raptor: [500, 1400],
  woodpecker: [900, 2600],
  herbivore: [220, 700],
  corvid: [400, 1200],
  rodent: [2200, 5200],
  mammal: [200, 800],
};

/** Timbre per guild: how the voice is built. */
type Timbre = 'whistle' | 'trill' | 'rasp' | 'hoot' | 'knock' | 'bark';

const GUILD_TIMBRE: Record<string, Timbre> = {
  songbird: 'trill',
  gamebird: 'rasp',
  waterbird: 'hoot',
  carnivore: 'bark',
  raptor: 'whistle',
  woodpecker: 'knock',
  herbivore: 'bark',
  corvid: 'rasp',
  rodent: 'trill',
  mammal: 'bark',
};

/** Deterministic hash so a species always sounds like itself across sessions. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export interface VoiceParams {
  frequency: number;
  timbre: Timbre;
  /** Notes per phrase. */
  notes: number;
  /** Seconds between notes. */
  spacing: number;
  /** 0..1 — how much tail the voice carries. Nocturnal animals sound far away. */
  space: number;
  /** 0..1 — pitch sweep depth. */
  glide: number;
}

export function voiceFor(species: Species): VoiceParams {
  const seed = hash(species.sci);
  const [lo, hi] = GUILD_REGISTER[species.guild] ?? GUILD_REGISTER.songbird;
  // Rarer species sit higher in their register — they cut through the chorus.
  const rarity = 1 - Math.min(1, Math.log1p(species.total) / Math.log1p(6200));
  const frequency = lo + (hi - lo) * (0.25 + rarity * 0.5 + seed * 0.25);

  return {
    frequency,
    timbre: GUILD_TIMBRE[species.guild] ?? 'whistle',
    notes: 2 + Math.floor(seed * 4),
    spacing: 0.07 + seed * 0.11,
    space: 0.25 + species.nightRatio * 0.7,
    glide: seed,
  };
}

/** Generates a decaying-noise impulse response — a stone cellar, roughly. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return impulse;
}

export class SoundField {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private droneGain: GainNode | null = null;
  private droneNodes: OscillatorNode[] = [];
  private lastVoiceAt = 0;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture — browsers block audio otherwise. */
  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    reverb.connect(wet);
    wet.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.reverb = reverb;

    this.fadeMaster(0.7, 2.5);
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

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.fadeMaster(0, 0.8);
      window.setTimeout(() => void this.ctx?.suspend(), 900);
    }
  }

  /**
   * A low sustained bed tuned to the estate's overall diversity — the room tone
   * of the piece. Richer data means a fuller chord.
   */
  startDrone(shannon: number) {
    if (!this.ctx || !this.master || this.droneNodes.length) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.connect(this.master);

    // Root ~55 Hz, with partials whose count follows Shannon diversity.
    const root = 55;
    const ratios = [1, 1.5, 2, 3, 4.02, 6].slice(0, 2 + Math.round(shannon));
    ratios.forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = root * ratio;
      // Slow detune keeps the bed from sounding synthetic.
      osc.detune.value = (i - ratios.length / 2) * 4;

      const partial = ctx.createGain();
      partial.gain.value = 0.5 / (i + 1) ** 1.4;

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + i * 0.017;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = partial.gain.value * 0.6;
      lfo.connect(lfoDepth);
      lfoDepth.connect(partial.gain);
      lfo.start();

      osc.connect(partial);
      partial.connect(gain);
      osc.start();
      this.droneNodes.push(osc, lfo);
    });

    gain.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 6);
    this.droneGain = gain;
  }

  setDrone(level: number, seconds = 2) {
    if (!this.ctx || !this.droneGain) return;
    const now = this.ctx.currentTime;
    this.droneGain.gain.cancelScheduledValues(now);
    this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, now);
    this.droneGain.gain.linearRampToValueAtTime(Math.max(0, level) * 0.2, now + seconds);
  }

  /** Rate-limit so a hundred simultaneous returns do not turn into white noise. */
  canPlay(minGap = 0.045): boolean {
    if (!this.ctx) return false;
    return this.ctx.currentTime - this.lastVoiceAt > minGap;
  }

  play(species: Species, gainScale = 1, pan = 0): void {
    if (!this.ctx || !this.master || !this.reverb) return;
    if (!this.canPlay()) return;
    const ctx = this.ctx;
    this.lastVoiceAt = ctx.currentTime;

    const params = voiceFor(species);
    const out = ctx.createGain();
    out.gain.value = 0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    panner.connect(this.master);

    const send = ctx.createGain();
    send.gain.value = params.space;
    panner.connect(send);
    send.connect(this.reverb);

    const start = ctx.currentTime + 0.01;
    const peak = 0.16 * gainScale;

    for (let n = 0; n < params.notes; n++) {
      const t = start + n * params.spacing;
      this.emitNote(params, t, out, peak * (1 - n / (params.notes + 2)));
    }

    const total = start + params.notes * params.spacing + 0.9;
    window.setTimeout(() => {
      out.disconnect();
      panner.disconnect();
      send.disconnect();
    }, (total - ctx.currentTime) * 1000 + 200);
  }

  private emitNote(params: VoiceParams, at: number, dest: GainNode, peak: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.connect(dest);
    dest.gain.setValueAtTime(1, at);

    const { timbre, frequency, glide } = params;

    if (timbre === 'knock' || timbre === 'rasp') {
      // Percussive voices: filtered noise burst.
      const length = timbre === 'knock' ? 0.05 : 0.16;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = timbre === 'knock' ? 3 : 8;
      src.connect(filter);
      filter.connect(env);
      env.gain.linearRampToValueAtTime(peak, at + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.1);
      src.start(at);
      src.stop(at + length + 0.12);
      return;
    }

    const osc = ctx.createOscillator();
    osc.type = timbre === 'hoot' ? 'sine' : timbre === 'bark' ? 'sawtooth' : 'triangle';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency * 3.5;
    filter.Q.value = 1.2;

    const duration = timbre === 'hoot' ? 0.42 : timbre === 'trill' ? 0.1 : 0.22;

    osc.frequency.setValueAtTime(frequency, at);
    if (timbre === 'trill') {
      // Rapid up-down warble — the songbird signature.
      const depth = 1 + glide * 0.5;
      osc.frequency.exponentialRampToValueAtTime(frequency * depth, at + duration * 0.4);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.85, at + duration);
    } else if (timbre === 'whistle') {
      osc.frequency.exponentialRampToValueAtTime(frequency * (0.55 + glide * 0.2), at + duration);
    } else if (timbre === 'hoot') {
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.92, at + duration);
    } else {
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, at + duration);
    }

    env.gain.linearRampToValueAtTime(peak, at + duration * 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration + 0.25);

    osc.connect(filter);
    filter.connect(env);
    osc.start(at);
    osc.stop(at + duration + 0.3);
  }
}

export const soundField = new SoundField();
