import type { AtlasSpecies } from '../data/atlas';

/**
 * A voice for a species, synthesised from what the survey knows about it.
 *
 * **Nothing here is a recording.** The survey kept detections, not audio, and
 * the piece ships no samples and fetches nothing; every sound in it is made by
 * oscillators at runtime. So this is a portrait, not a playback, and the
 * chapter that uses it says so on screen in as many words.
 *
 * What the portrait is made of is real, though, and that is the point:
 *
 * - **register** follows nocturnality — the more of a species' record falls
 *   between 21:00 and 05:00, the lower it speaks, which is roughly how the
 *   night half of this survey actually sounds against the day half;
 * - **how many syllables** follows the log of its detections, so a bird heard
 *   two hundred times says more than one heard once;
 * - **the shape of a syllable** follows its guild — a warbler's rising trill,
 *   an owl's two hoots, a wader's flat call, a raptor's falling cry;
 * - **the exact pitch** is a hash of the name, so a species sounds like itself
 *   every time without pretending the number came from anywhere.
 */

interface Shape {
  /** Base frequency before the nocturnality shift, in Hz. */
  base: number;
  /** Where the syllable ends up, as a multiple of where it started. */
  sweep: number;
  /** Seconds of one syllable. */
  length: number;
  /** Seconds between syllables. */
  gap: number;
  type: OscillatorType;
  /** Breath: how much band-passed noise rides along, 0..1. */
  air: number;
  /** Depth of the frequency wobble, 0..1. */
  vibrato: number;
}

const SHAPES: Record<string, Shape> = {
  // A trill that climbs: fast, bright, several syllables to a phrase.
  songbird: { base: 2600, sweep: 1.55, length: 0.075, gap: 0.055, type: 'triangle', air: 0.1, vibrato: 0.08 },
  // Two long hoots, an octave under everything else, barely moving.
  nocturnal: { base: 400, sweep: 0.92, length: 0.34, gap: 0.42, type: 'sine', air: 0.05, vibrato: 0.03 },
  // Flat and hard, the way a call carries over open water.
  water: { base: 900, sweep: 0.97, length: 0.16, gap: 0.14, type: 'sawtooth', air: 0.22, vibrato: 0.02 },
  // One long cry, falling.
  raptor: { base: 2300, sweep: 0.55, length: 0.42, gap: 0.3, type: 'sawtooth', air: 0.3, vibrato: 0.05 },
  // Not a song at all: two short low barks.
  mammal: { base: 260, sweep: 0.8, length: 0.13, gap: 0.19, type: 'square', air: 0.16, vibrato: 0.0 },
  unknown: { base: 1400, sweep: 1.2, length: 0.12, gap: 0.1, type: 'triangle', air: 0.12, vibrato: 0.05 },
};

/** Stable per-name randomness, so a species sounds like itself every time. */
function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface Voice {
  /** Hz of the first syllable, after every shift is applied. */
  pitch: number;
  syllables: number;
  /** Seconds the whole phrase lasts. */
  duration: number;
}

/** What a species would sound like, without making any sound. */
export function voiceOf(species: AtlasSpecies): Voice {
  const shape = SHAPES[species.guild] ?? SHAPES.unknown;
  const seed = hashName(species.name);

  // Night lowers the voice; the hash moves it a fifth either way so two
  // warblers are never the same bird.
  const pitch = shape.base * (1 - species.nocturnality * 0.55) * (0.78 + seed * 0.44);
  const syllables = Math.max(
    1,
    Math.min(7, Math.round(1 + Math.log(species.count + 1) / Math.log(3.1) + seed * 0.9))
  );
  const duration = syllables * (shape.length + shape.gap);
  return { pitch, syllables, duration };
}

/**
 * Plays that portrait once.
 *
 * Everything is scheduled ahead on the audio clock rather than driven from the
 * frame loop: a phrase whose syllables arrive on animation frames stutters the
 * moment the renderer does, and a stuttering bird is worse than none.
 */
export function speak(
  context: AudioContext,
  destination: AudioNode,
  species: AtlasSpecies,
  level = 1
): number {
  const shape = SHAPES[species.guild] ?? SHAPES.unknown;
  const voice = voiceOf(species);
  const seed = hashName(species.name);
  const now = context.currentTime + 0.03;

  // A little room, so the bird is somewhere rather than inside the speaker.
  const room = context.createGain();
  room.gain.value = 0.22;
  const delay = context.createDelay(0.5);
  delay.delayTime.value = 0.11 + seed * 0.06;
  const feedback = context.createGain();
  feedback.gain.value = 0.24;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(room);
  room.connect(destination);

  const voiceBus = context.createGain();
  voiceBus.gain.value = level;
  voiceBus.connect(destination);
  voiceBus.connect(delay);

  for (let s = 0; s < voice.syllables; s += 1) {
    const at = now + s * (shape.length + shape.gap);
    // The phrase drifts up as it goes — a bird repeating itself is never quite
    // repeating itself.
    const drift = 1 + s * 0.035 * (seed > 0.5 ? 1 : -1);
    const from = voice.pitch * drift;
    const to = from * shape.sweep;

    const osc = context.createOscillator();
    osc.type = shape.type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + shape.length);

    if (shape.vibrato > 0) {
      const lfo = context.createOscillator();
      lfo.frequency.value = 5.5 + seed * 4;
      const depth = context.createGain();
      depth.gain.value = from * shape.vibrato;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(at);
      lfo.stop(at + shape.length + 0.05);
    }

    // A bandpass that tracks the note keeps a sawtooth from turning into a
    // buzzer at the top of a warbler's range.
    const tone = context.createBiquadFilter();
    tone.type = 'bandpass';
    tone.frequency.setValueAtTime(from * 1.2, at);
    tone.frequency.exponentialRampToValueAtTime(Math.max(60, to * 1.2), at + shape.length);
    tone.Q.value = 1.1;

    const envelope = context.createGain();
    const attack = Math.min(0.03, shape.length * 0.35);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.5, at + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + shape.length);

    osc.connect(tone);
    tone.connect(envelope);
    envelope.connect(voiceBus);
    osc.start(at);
    osc.stop(at + shape.length + 0.05);

    if (shape.air > 0) {
      const noise = context.createBufferSource();
      noise.buffer = breath(context);
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = from * 1.6;
      band.Q.value = 0.9;
      const airGain = context.createGain();
      airGain.gain.setValueAtTime(0.0001, at);
      airGain.gain.exponentialRampToValueAtTime(shape.air * 0.4, at + attack);
      airGain.gain.exponentialRampToValueAtTime(0.0001, at + shape.length);
      noise.connect(band);
      band.connect(airGain);
      airGain.connect(voiceBus);
      noise.start(at);
      noise.stop(at + shape.length + 0.05);
    }
  }

  return voice.duration;
}

/** One second of white noise, made once and reused by every voice. */
let breathBuffer: AudioBuffer | null = null;
function breath(context: AudioContext): AudioBuffer {
  if (breathBuffer && breathBuffer.sampleRate === context.sampleRate) return breathBuffer;
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  breathBuffer = buffer;
  return buffer;
}
