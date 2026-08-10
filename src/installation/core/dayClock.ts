import { useEffect, useRef, useState } from 'react';

/**
 * The estate's day, running on its own.
 *
 * The hour used to be React state written on every `input` event of the
 * scrubber, which re-rendered the whole chapter tree — scene elements included
 * — for each pointer move. That is where the visible judder came from: the GL
 * loop was being interrupted by reconciliation at pointer rate, and the eased
 * hour inside the scene arrived in bursts rather than as a ramp.
 *
 * So the hour lives in a plain object whose identity never changes. The scenes
 * read `clock.hour` inside their own frame loop and never re-render because of
 * it; React only hears about it a few times a second, and only so the readout
 * and the scrubber thumb have something to show.
 *
 * It also plays. A day loops continuously — that is the piece's main event,
 * and a visitor who never touches anything should still watch the estate hand
 * over from the day shift to the night one. Scrubbing takes control; a few
 * seconds after the hand leaves, the day picks up again from wherever it was
 * left, so the piece is never stuck at 03:00 because someone walked away.
 */
export interface DayClock {
  /** 0..24, wrapping. Read this in a frame loop, not in render. */
  hour: number;
  /** True while a visitor is actively dragging, so scenes can hold their easing. */
  scrubbing: boolean;
}

/** A whole day in this many seconds. Slow enough to watch, fast enough to see. */
const DAY_SECONDS = 72;
/** Quiet after a scrub before the day resumes on its own. */
const RESUME_AFTER_MS = 4000;
/** No scrub call within this long and the hand has clearly left the control. */
const SCRUB_IDLE_MS = 260;
/** How often React is told, for the readout only. */
const LABEL_HZ = 8;

export function useDayClock(startHour: number) {
  const clock = useRef<DayClock>({ hour: startHour, scrubbing: false }).current;
  /** Mirrors `clock.hour` at a few hertz, purely so the DOM can draw it. */
  const [label, setLabel] = useState(startHour);
  const [playing, setPlaying] = useState(true);
  /**
   * When the visitor last moved the scrubber.
   *
   * Everything is derived from this one timestamp rather than from a pointerup
   * handler, because pointerup is not reliable here: a finger lifted outside
   * the track, a keyboard arrow, or a programmatic change all move the control
   * without ever ending a gesture, and the day would then stay parked forever.
   * A stamp cannot be missed.
   */
  const lastScrub = useRef(-Infinity);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let told = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;

      const since = now - lastScrub.current;
      clock.scrubbing = since < SCRUB_IDLE_MS;
      const running = since > RESUME_AFTER_MS;
      if (running) clock.hour = (clock.hour + (dt * 24) / DAY_SECONDS) % 24;

      if (now - told > 1000 / LABEL_HZ) {
        told = now;
        setLabel(clock.hour);
        setPlaying(running);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  /**
   * A visitor takes the wheel. Same time base as the frame loop — both read
   * `performance.now()`, which is what rAF passes.
   */
  const scrub = (hour: number) => {
    clock.hour = ((hour % 24) + 24) % 24;
    lastScrub.current = performance.now();
    setLabel(clock.hour);
  };

  return { clock, label, playing, scrub };
}
