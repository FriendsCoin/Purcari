import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine';
import type { ChapterId, Readout as ReadoutData } from './engine/Scene';
import { GUILD_COLORS, GUILD_ORDER, guildLabel } from './engine/palette';
import { ChorusScene } from './scenes/ChorusScene';
import { CircadianScene } from './scenes/CircadianScene';
import { FluxScene } from './scenes/FluxScene';
import { OverlapScene } from './scenes/OverlapScene';
import { PassagesScene } from './scenes/PassagesScene';
import { SpeciesScene } from './scenes/SpeciesScene';
import { TailScene } from './scenes/TailScene';
import { TerroirScene } from './scenes/TerroirScene';
import { atlas } from './data/atlas';
import { ChapterNav } from './ui/ChapterNav';
import { Diagnostics } from './ui/Diagnostics';
import { Readout } from './ui/Readout';

/** Taps in the top-left corner needed to open the commissioning panel. */
const SERVICE_TAPS = 4;
const SERVICE_WINDOW = 2500;

const EMPTY_READOUT: ReadoutData = { eyebrow: '', title: '' };

/**
 * The installation shell.
 *
 * React owns the typography and nothing else. The canvas, the frame loop and all
 * interaction live in the engine; this component subscribes to one readout
 * callback and re-renders only when the text actually changes, so the DOM is
 * never in the way of the 60 fps budget.
 */
export function Installation(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const scalebarRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const lastReadout = useRef<ReadoutData>(EMPTY_READOUT);

  const [readout, setReadout] = useState<ReadoutData>(EMPTY_READOUT);
  const [chapter, setChapter] = useState<ChapterId>('chorus');
  const [booted, setBooted] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);

  const serviceTaps = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const instance = new Engine({
      canvas,
      onReadout: next => {
        // Scenes hand back a stable object while their content is unchanged, so
        // reference equality is enough to keep React out of the frame loop.
        if (next !== lastReadout.current) {
          lastReadout.current = next;
          setReadout(next);
        }
        // The marker and the scale bar both track the camera every frame, so
        // they are written straight to the DOM rather than through state — the
        // reference gate above would otherwise freeze them at the value they
        // held when the chapter was entered.
        positionMarker(markerRef.current, next.marker);
        updateScalebar(scalebarRef.current, next.scale);
        updateAxis(axisRef.current, next.axis);
      },
      onChapterChange: setChapter,
    });

    instance.register(new ChorusScene());
    instance.register(new TerroirScene());
    instance.register(new CircadianScene());
    instance.register(new SpeciesScene());
    instance.register(new FluxScene());
    instance.register(new OverlapScene());
    instance.register(new PassagesScene());
    instance.register(new TailScene());
    instance.setHome('chorus');
    instance.goTo('chorus', true);
    instance.start();

    engineRef.current = instance;
    setEngine(instance);
    setBooted(true);

    // The idle hint is driven off the pointer's own idle clock rather than a
    // React timer, so it cannot drift out of sync with the attract behaviour.
    let raf = 0;
    const pollIdle = (): void => {
      const hint = hintRef.current;
      if (hint) {
        const idle = instance.pointer.idleTime > 8;
        hint.classList.toggle('hint--visible', idle);
      }
      raf = requestAnimationFrame(pollIdle);
    };
    raf = requestAnimationFrame(pollIdle);

    return () => {
      cancelAnimationFrame(raf);
      instance.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelect = useCallback((id: ChapterId) => {
    engineRef.current?.goTo(id);
  }, []);

  /** Four taps in the corner within a few seconds opens the service panel. */
  const handleServiceTap = useCallback(() => {
    const now = performance.now();
    serviceTaps.current = [...serviceTaps.current, now].filter(t => now - t < SERVICE_WINDOW);
    if (serviceTaps.current.length >= SERVICE_TAPS) {
      serviceTaps.current = [];
      setShowDiagnostics(true);
    }
  }, []);

  useFullscreenOnFirstTouch();

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="stage__canvas" />

      <div className={booted ? 'splash splash--done' : 'splash'} aria-hidden={booted}>
        <p className="splash__mark">Purcari</p>
      </div>

      <div className="overlay">
        <header className="masthead">
          <div>
            <p className="masthead__mark">Château Purcari</p>
            <p className="masthead__sub">Observatoire de la biodiversité</p>
          </div>
          <div className="masthead__meta">
            <div>{readout.period ?? '31 juillet — 16 août 2025'}</div>
            <div>46.52° N · 29.87° E</div>
            {/* Drawn at its true length: a scale bar whose rule does not match
                its label is decoration, not a scale bar. Filled in per frame. */}
            <div ref={scalebarRef} className="scalebar" aria-hidden="true">
              <span className="scalebar__bar" />
              <span className="scalebar__label" />
            </div>
          </div>
        </header>

        {/* Hour labels for chapters whose horizontal axis is a clock. Written
            straight to the DOM every frame, like the marker, because the ticks
            move with the camera. */}
        <div ref={axisRef} className="axis" aria-hidden="true" />

        <div className="stagebody">
          <Readout data={readout} />
          <ChapterNav active={chapter} onSelect={handleSelect} />
        </div>

        <footer className="footer">
          <div className="footer__legend">
            {(
              readout.legend ??
              GUILD_ORDER.filter(id => id !== 'unknown').map(id => ({
                label: guildLabel(id),
                color: GUILD_COLORS[id],
              }))
            ).map(entry => (
              <span className="legend__item" key={entry.label} style={{ color: entry.color }}>
                <span className="legend__swatch" aria-hidden="true" />
                <span>{entry.label}</span>
              </span>
            ))}
          </div>
          <div>
            {readout.source ??
              `${atlas.meta.total.toLocaleString('fr-FR')} détections · Every1Counts & BirdNET`}
          </div>
        </footer>
      </div>

      <p ref={hintRef} className="hint">
        Touchez pour explorer
      </p>

      <div ref={markerRef} className="marker" aria-hidden="true">
        <span className="marker__ring" />
        <span className="marker__dot" />
      </div>

      <div
        className="service-corner"
        onPointerDown={handleServiceTap}
        role="presentation"
        aria-hidden="true"
      />

      {showDiagnostics && <Diagnostics engine={engine} onClose={() => setShowDiagnostics(false)} />}
    </div>
  );
}

function positionMarker(element: HTMLDivElement | null, marker?: { x: number; y: number }): void {
  if (!element) return;
  if (!marker) {
    element.classList.remove('marker--visible');
    return;
  }
  element.style.transform = `translate(${marker.x * window.innerWidth}px, ${marker.y * window.innerHeight}px)`;
  element.classList.add('marker--visible');
}

function updateAxis(element: HTMLDivElement | null, axis?: { label: string; x: number }[]): void {
  if (!element) return;
  if (!axis || axis.length === 0) {
    element.classList.remove('axis--visible');
    return;
  }
  // Ticks are reused rather than rebuilt: this runs sixty times a second, and
  // replacing the children would thrash the DOM for text that rarely changes.
  while (element.childElementCount > axis.length) element.lastElementChild?.remove();
  while (element.childElementCount < axis.length) {
    const tick = document.createElement('span');
    tick.className = 'axis__tick';
    element.appendChild(tick);
  }
  axis.forEach((tick, i) => {
    const node = element.children[i] as HTMLElement;
    if (node.textContent !== tick.label) node.textContent = tick.label;
    node.style.transform = `translateX(${tick.x * window.innerWidth}px)`;
    // A tick pushed off the panel by a zoom is hidden rather than clamped to the
    // edge, where it would sit under a label that means something else.
    node.style.opacity = tick.x < -0.02 || tick.x > 1.02 ? '0' : '1';
  });
  element.classList.add('axis--visible');
}

function updateScalebar(element: HTMLDivElement | null, scale?: { metres: number; fraction: number }): void {
  if (!element) return;
  if (!scale) {
    element.classList.remove('scalebar--visible');
    return;
  }
  const bar = element.firstElementChild as HTMLElement | null;
  const label = element.lastElementChild as HTMLElement | null;
  if (bar) bar.style.width = `${Math.round(scale.fraction * window.innerWidth)}px`;
  const text = scale.metres >= 1000 ? `${scale.metres / 1000} km` : `${scale.metres} m`;
  if (label && label.textContent !== text) label.textContent = text;
  element.classList.add('scalebar--visible');
}

/**
 * Wall panels are usually launched in a kiosk shell already, but when this runs
 * in a plain browser the first touch should still fill the screen. Browsers only
 * grant fullscreen from a user gesture, so it is requested once and then the
 * listener retires either way.
 */
function useFullscreenOnFirstTouch(): void {
  useEffect(() => {
    const request = (): void => {
      window.removeEventListener('pointerdown', request);
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      void document.documentElement.requestFullscreen().catch(() => {
        // Denied by policy or already handled by the kiosk shell — either is fine.
      });
    };
    window.addEventListener('pointerdown', request, { once: true });
    return () => window.removeEventListener('pointerdown', request);
  }, []);
}
