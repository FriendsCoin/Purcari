import { useEffect, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { atlas } from '../data/atlas';

interface DiagnosticsProps {
  engine: Engine | null;
  onClose: () => void;
}

/**
 * Commissioning panel, opened by four taps in the top-left corner of the screen.
 *
 * Whoever installs this will be standing in front of a wall panel with no
 * keyboard and no dev tools, needing to know whether the frame rate is holding
 * and what resolution the quality governor has settled on.
 */
export function Diagnostics({ engine, onClose }: DiagnosticsProps): JSX.Element {
  const [stats, setStats] = useState({ fps: 0, drawCalls: 0, programs: 0, textures: 0, size: '' });

  useEffect(() => {
    if (!engine) return undefined;

    let frames = 0;
    let last = performance.now();
    let raf = 0;

    const sample = (): void => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 500) {
        const info = engine.renderer.info;
        const canvas = engine.renderer.domElement;
        setStats({
          fps: Math.round((frames * 1000) / (now - last)),
          drawCalls: info.render.calls,
          programs: info.programs?.length ?? 0,
          textures: info.memory.textures,
          size: `${canvas.width} × ${canvas.height}`,
        });
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(sample);
    };

    raf = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div className="diagnostics" role="dialog" aria-label="Diagnostic">
      <dl>
        <dt>Images / s</dt>
        <dd>{stats.fps}</dd>
        <dt>Tampon</dt>
        <dd>{stats.size}</dd>
        <dt>Appels de rendu</dt>
        <dd>{stats.drawCalls}</dd>
        <dt>Programmes · textures</dt>
        <dd>
          {stats.programs} · {stats.textures}
        </dd>
        <dt>Jeu de données</dt>
        <dd>
          {atlas.meta.total} · {atlas.meta.speciesCount} esp. · {atlas.meta.stationCount} st.
        </dd>
      </dl>
      <p className="diagnostics__hint">Touchez pour fermer</p>
      <button
        type="button"
        onPointerDown={onClose}
        aria-label="Fermer le diagnostic"
        style={{ position: 'absolute', inset: 0, opacity: 0, background: 'none', border: 0 }}
      />
    </div>
  );
}
