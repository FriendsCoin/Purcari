/**
 * Twenty-four hour scrubber.
 *
 * The curve behind the track is the real per-hour detection density, both
 * networks summed. Dragging across it narrows the cloud to a slice of the day;
 * a click without a drag opens it back to the full 24 hours.
 */

import { useCallback, useMemo, useRef } from 'react';
import type { Archive } from '../data';

const DAY = 1440;

interface Props {
  archive: Archive;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}

export function Scrubber({ archive, value, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ active: boolean; origin: number; moved: boolean }>({
    active: false,
    origin: 0,
    moved: false,
  });

  const curve = useMemo(() => {
    const totals = archive.hourly.audio.map((v, i) => v + archive.hourly.camera[i]);
    const max = Math.max(...totals, 1);
    // Sampled at the hour, closed along the baseline so it reads as a mass.
    const pts = totals.map((v, i) => `${(i / 23) * 100},${(1 - v / max) * 100}`);
    return `M0,100 L${pts.join(' L')} L100,100 Z`;
  }, [archive]);

  const minuteAt = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(t * DAY);
  }, []);

  const handleDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { active: true, origin: minuteAt(e.clientX), moved: false };
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const m = minuteAt(e.clientX);
    if (Math.abs(m - drag.current.origin) > 12) drag.current.moved = true;
    if (drag.current.moved) {
      onChange([Math.min(drag.current.origin, m), Math.max(drag.current.origin, m)]);
    }
  };

  const handleUp = () => {
    if (drag.current.active && !drag.current.moved) onChange([0, DAY - 1]);
    drag.current.active = false;
  };

  const full = value[0] <= 0 && value[1] >= DAY - 1;
  const left = (value[0] / DAY) * 100;
  const width = ((value[1] - value[0]) / DAY) * 100;

  return (
    <div className="scrub">
      <div className="scrub__head">
        <span>Время суток</span>
        <span className="scrub__value">
          {full ? 'весь день' : `${fmt(value[0])} — ${fmt(value[1])}`}
        </span>
      </div>
      <div
        className="scrub__track"
        ref={trackRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        role="slider"
        tabIndex={0}
        aria-label="Окно времени суток"
        aria-valuemin={0}
        aria-valuemax={DAY}
        aria-valuenow={value[0]}
        aria-valuetext={full ? 'весь день' : `${fmt(value[0])} — ${fmt(value[1])}`}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 180 : 60;
          if (e.key === 'ArrowLeft') onChange([Math.max(0, value[0] - step), Math.max(step, value[1] - step)]);
          else if (e.key === 'ArrowRight')
            onChange([Math.min(DAY - step, value[0] + step), Math.min(DAY - 1, value[1] + step)]);
          else if (e.key === 'Escape') onChange([0, DAY - 1]);
          else return;
          e.preventDefault();
        }}
      >
        <svg className="scrub__density" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={curve} fill="rgba(240,180,41,0.10)" stroke="rgba(240,180,41,0.42)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="scrub__grid" aria-hidden="true">
          {Array.from({ length: 24 }, (_, i) => (
            <span className="scrub__tick" key={i} />
          ))}
        </div>
        {!full && <div className="scrub__window" style={{ left: `${left}%`, width: `${width}%` }} />}
      </div>
    </div>
  );
}

function fmt(minute: number): string {
  const m = Math.round(minute) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
