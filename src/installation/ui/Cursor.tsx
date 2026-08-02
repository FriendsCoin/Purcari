/**
 * Custom cursor: a ring that trails the pointer and swells over anything
 * clickable. Hidden on touch, where the native pointer never appears anyway.
 */

import { useEffect, useRef } from 'react';

export function Cursor() {
  const root = useRef<HTMLDivElement>(null);
  const target = useRef({ x: -100, y: -100 });
  const current = useRef({ x: -100, y: -100 });

  useEffect(() => {
    let frame = 0;

    const move = (e: PointerEvent) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
      const interactive = (e.target as HTMLElement)?.closest?.('button, [role="slider"], a');
      root.current?.classList.toggle('cursor--active', Boolean(interactive));
    };

    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * 0.22;
      current.current.y += (target.current.y - current.current.y) * 0.22;
      if (root.current) {
        root.current.style.transform = `translate3d(${current.current.x}px, ${current.current.y}px, 0)`;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', move, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="cursor" ref={root} aria-hidden="true">
      <div className="cursor__ring" />
      <div className="cursor__dot" />
    </div>
  );
}
