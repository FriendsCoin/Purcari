import { useEffect, useRef, useState } from 'react';

/**
 * Cross-fades one chapter into the next instead of cutting.
 *
 * The chapters were swapped by a conditional render, so a change was a hard cut
 * — the old scene vanished on one frame and the new one appeared on the next,
 * while the camera was still gliding to its new position. Holding both scenes
 * on stage for a moment and trading their `reveal` between them turns the same
 * camera move into a dissolve, which is what makes a sequence of chapters read
 * as one film rather than as four separate screens.
 *
 * Every scene already accepts `reveal`, so nothing else needs to change: the
 * outgoing chapter fades and settles, the incoming one rises.
 */

export interface ChapterTransition<T> {
  /** The chapter being entered. Always current. */
  current: T;
  /** The chapter being left, or null once the dissolve has finished. */
  previous: T | null;
  /** 0 at the start of the dissolve, 1 when it is complete. */
  t: number;
  /** Reveal for the incoming chapter. */
  reveal: number;
  /** Reveal for the outgoing chapter. */
  fade: number;
  /** True while both chapters are on stage. */
  crossing: boolean;
}

/**
 * @param value    the chapter identity — changing it starts a dissolve
 * @param duration seconds the two scenes overlap
 */
export function useChapterTransition<T>(value: T, duration = 1.5): ChapterTransition<T> {
  const [state, setState] = useState<{ current: T; previous: T | null; t: number }>({
    current: value,
    previous: null,
    t: 1,
  });
  const raf = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (value === state.current) return;

    // Starting a new dissolve mid-dissolve: the chapter we were already leaving
    // is dropped rather than queued, so rapid taps stay responsive instead of
    // stacking up a backlog of scenes to render.
    setState((prev) => ({ current: value, previous: prev.current, t: 0 }));
    startedAt.current = performance.now();

    const tick = () => {
      const elapsed = (performance.now() - startedAt.current) / 1000;
      const t = Math.min(1, elapsed / duration);
      setState((prev) => (prev.t === t ? prev : { ...prev, t }));
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        // Unmount the outgoing scene once it is invisible, so its geometry and
        // its frame loop stop costing anything.
        setState((prev) => ({ ...prev, previous: null }));
      }
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // `state.current` is read to detect a real change; including it would
    // restart the dissolve on its own update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Ease so the incoming chapter is already legible before the outgoing one has
  // fully gone — a linear pair crosses at half brightness and dips visibly.
  const eased = state.t * state.t * (3 - 2 * state.t);
  return {
    current: state.current,
    previous: state.previous,
    t: state.t,
    reveal: eased,
    fade: 1 - Math.min(1, eased * 1.35),
    crossing: state.previous !== null,
  };
}
