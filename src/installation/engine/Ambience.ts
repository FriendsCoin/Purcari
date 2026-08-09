import { atlas, maxHourly } from '../data/atlas';

/**
 * Seconds for one full day of the soundscape — the same cycle the prologue's
 * wave flies through the murmuration, so what is heard swells with what is seen.
 */
const DAY_SECONDS = 34;

/**
 * A warm pentatonic on D, low notes first. Chimes pick from the bottom of the
 * list in the quiet hours and reach higher as the chorus builds, so the night is
 * two dark notes and the dawn is the whole handful.
 */
const SCALE = [293.66, 349.23, 392.0, 440.0, 587.33, 698.46, 880.0];

/**
 * The soundscape. Three layers, all synthesised — no samples, nothing fetched:
 *
 * - a low drone, two detuned sines and a soft triangle an octave up, whose
 *   brightness follows the hour of the piece's 34-second day;
 * - a breath of filtered noise, the room tone of a summer night;
 * - sparse chimes whose density and register follow the survey's own hourly
 *   histogram — dense through the dawn chorus, nearly silent overnight.
 *
 * Browsers only allow audio after a user gesture, so the whole graph is built
 * lazily by start(), which Installation calls from the first touch. Until then
 * the piece is silent, which is also the correct behaviour for a wall panel
 * that boots unattended.
 */
export class Ambience {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private muted = false;
  private readonly level = 0.14;
  private nextChime = 0;
  /** The engine clock as of the last update, so duck() can push the chimes. */
  private lastTime = 0;

  /** Builds the graph. Must be called from a user-gesture call stack. */
  start(): void {
    if (this.context) {
      // A suspended context (tab switch, autoplay policy) resumes on the next touch.
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const context = new Ctor();
    this.context = context;

    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    this.master = master;
    // The room fades up over several seconds; sound that arrives as a cut reads
    // as a malfunction in a quiet space.
    master.gain.linearRampToValueAtTime(this.muted ? 0 : this.level, context.currentTime + 7);

    // ---- drone -------------------------------------------------------------
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 200;
    droneFilter.Q.value = 0.5;
    const droneGain = context.createGain();
    droneGain.gain.value = 0.34;
    droneFilter.connect(droneGain);
    droneGain.connect(master);
    this.droneFilter = droneFilter;

    const voices: [number, OscillatorType, number][] = [
      [55, 'sine', 1],
      [55.7, 'sine', 0.75],
      [110.4, 'triangle', 0.2],
    ];
    for (const [frequency, type, gain] of voices) {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const g = context.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(droneFilter);
      osc.start();
    }

    // ---- night air ---------------------------------------------------------
    const seconds = 2;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i += 1) {
      brown = brown * 0.96 + (Math.random() * 2 - 1) * 0.04;
      data[i] = brown * 3;
    }
    const air = context.createBufferSource();
    air.buffer = buffer;
    air.loop = true;
    const airBand = context.createBiquadFilter();
    airBand.type = 'bandpass';
    airBand.frequency.value = 1200;
    airBand.Q.value = 0.4;
    const airGain = context.createGain();
    airGain.gain.value = 0.045;
    air.connect(airBand);
    airBand.connect(airGain);
    airGain.connect(master);
    air.start();
  }

  /** Once per frame, on the engine's own clock. Cheap no-op until started. */
  update(time: number): void {
    this.lastTime = time;
    const context = this.context;
    if (!context || !this.master || this.muted) return;

    const hour = Math.floor(((time % DAY_SECONDS) / DAY_SECONDS) * 24) % 24;
    const activity = atlas.hourly[hour] / maxHourly;

    // The drone opens with the day and closes overnight.
    this.droneFilter?.frequency.setTargetAtTime(150 + activity * 340, context.currentTime, 0.9);

    if (time >= this.nextChime) {
      // Dense through the chorus, a note a minute overnight — the histogram
      // as rhythm rather than as a bar chart.
      const gap = 0.55 + (1 - activity) * (1 - activity) * 7.5 + Math.random() * 1.3;
      this.nextChime = time + gap;
      if (activity > 0.03) this.chime(activity);
    }
  }

  private chime(activity: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    // Register climbs with activity; the loudest hours get the highest notes.
    const reach = Math.min(SCALE.length - 1, Math.floor(activity * SCALE.length + Math.random() * 2));
    const frequency = SCALE[Math.max(0, reach - Math.floor(Math.random() * 3))];

    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    const envelope = context.createGain();
    const now = context.currentTime;
    const peak = 0.035 + activity * 0.045;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(peak, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0004, now + 1.6 + Math.random() * 1.4);

    const pan = context.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;

    osc.connect(envelope);
    envelope.connect(pan);
    pan.connect(master);
    osc.start(now);
    osc.stop(now + 3.4);
  }

  /**
   * The graph, for a chapter that needs to make a sound of its own. Null until
   * a gesture has started it, which is also the honest answer: before the first
   * touch there is nowhere to play.
   */
  get bus(): { context: AudioContext; destination: GainNode } | null {
    if (!this.context || !this.master || this.muted) return null;
    return { context: this.context, destination: this.master };
  }

  /**
   * Steps the room back for a moment. A chapter that puts one voice forward
   * wants the drone and the chimes out of its way, and a duck reads as the
   * room listening rather than as the sound cutting out.
   */
  duck(seconds: number, amount = 0.35): void {
    const context = this.context;
    if (!context || !this.master || this.muted) return;
    const now = context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.level * amount, now, 0.12);
    this.master.gain.setTargetAtTime(this.level, now + seconds, 0.5);
    // Chimes are scheduled ahead on the engine clock, so hold them off too.
    this.nextChime = Math.max(this.nextChime, this.lastTime + seconds + 0.6);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.level, this.context.currentTime, 0.4);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isRunning(): boolean {
    return this.context !== null;
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.droneFilter = null;
  }
}
