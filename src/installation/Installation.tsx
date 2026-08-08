import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine';
import type { ChapterId, Readout as ReadoutData } from './engine/Scene';
import { GUILD_COLORS, GUILD_ORDER, guildLabel } from './engine/palette';
import { ChorusScene } from './scenes/ChorusScene';
import { CircadianScene } from './scenes/CircadianScene';
import { FluxScene } from './scenes/FluxScene';
import { MethodsScene } from './scenes/MethodsScene';
import { OverlapScene } from './scenes/OverlapScene';
import { PassagesScene } from './scenes/PassagesScene';
import { SpeciesScene } from './scenes/SpeciesScene';
import { StatusScene } from './scenes/StatusScene';
import { TailScene } from './scenes/TailScene';
import { TerroirScene } from './scenes/TerroirScene';
import { atlas } from './data/atlas';
import { ChapterNav } from './ui/ChapterNav';
import { Diagnostics } from './ui/Diagnostics';
import { Readout } from './ui/Readout';

/** Taps in the top-left corner needed to open the commissioning panel. */
const SERVICE_TAPS = 4;
const SERVICE_WINDOW = 2500;

/**
 * Below this the piece is on a phone rather than on the panel.
 *
 * The wall has a left third for type and two thirds for the picture. A phone has
 * no left third, so the same layout puts eight lines of French across the middle
 * of the artwork. Under this width the type collapses to a title on a scrim and
 * opens on demand; the short-viewport clause catches a phone held sideways.
 */
const COMPACT_QUERY = '(max-width: 620px), (max-height: 480px)';

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
  const compact = useCompactLayout();
  const [sheetOpen, setSheetOpen] = useState(false);

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
        // Measured against the canvas rather than the window: on a phone the
        // two differ by the browser chrome, and an overlay anchored to the
        // window drifts off whatever it is pointing at.
        const frame = { width: canvas.clientWidth, height: canvas.clientHeight };
        positionMarker(markerRef.current, frame, next.marker);
        updateScalebar(scalebarRef.current, frame, next.scale);
        updateAxis(axisRef.current, frame, next.axis);
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
    instance.register(new StatusScene());
    instance.register(new MethodsScene());
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
    // Changing chapter closes the sheet: the first thing anyone wants from a new
    // chapter is to look at it.
    setSheetOpen(false);
  }, []);

  // A chapter the engine changed on its own — the idle return to the prologue —
  // has to close the sheet too, or the panel comes back to a wall of text.
  useEffect(() => {
    setSheetOpen(false);
  }, [chapter]);

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

  // Browsers only grant audio from a user gesture, so the soundscape arms on
  // touch. The listener stays: start() is idempotent and doubles as resume for
  // a context the browser suspended while the tab was hidden.
  useEffect(() => {
    const arm = (): void => engineRef.current?.ambience.start();
    window.addEventListener('pointerdown', arm);
    return () => window.removeEventListener('pointerdown', arm);
  }, []);

  const stageClass = [
    'stage',
    compact ? 'stage--compact' : '',
    compact && sheetOpen ? 'stage--sheet' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={stageClass}>
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
            <div className="masthead__coords">46.52° N · 29.87° E</div>
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
          <div className="sheet">
            <Readout data={readout} />
            {compact && (
              <button
                type="button"
                className="sheet__toggle"
                aria-expanded={sheetOpen}
                onPointerDown={() => setSheetOpen(open => !open)}
              >
                {sheetOpen ? 'Fermer' : 'En savoir plus'}
              </button>
            )}
          </div>
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

interface Frame {
  width: number;
  height: number;
}

function positionMarker(
  element: HTMLDivElement | null,
  frame: Frame,
  marker?: { x: number; y: number }
): void {
  if (!element) return;
  if (!marker) {
    element.classList.remove('marker--visible');
    return;
  }
  element.style.transform = `translate(${marker.x * frame.width}px, ${marker.y * frame.height}px)`;
  element.classList.add('marker--visible');
}

function updateAxis(
  element: HTMLDivElement | null,
  frame: Frame,
  axis?: { label: string; x: number }[]
): void {
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
  // The label box is a fixed width set in CSS, and reading it back is a forced
  // layout, so it is measured only when the frame changes rather than every
  // frame.
  const boxKey = `${frame.width}`;
  if (element.dataset.frame !== boxKey) {
    element.dataset.frame = boxKey;
    element.dataset.box = String((element.firstElementChild as HTMLElement).offsetWidth);
  }
  const half = Number(element.dataset.box ?? 0) / 2;

  axis.forEach((tick, i) => {
    const node = element.children[i] as HTMLElement;
    if (node.textContent !== tick.label) node.textContent = tick.label;

    // Midnight sits on the frame edge in the chapters that use this, and on a
    // phone the label would be cut in half by the screen. A tick that close to
    // an edge is pinned inside it and aligned outward — the reading is the same
    // and it is legible, which a half-drawn label is not.
    const x = tick.x * frame.width;
    if (x < half) {
      node.style.transform = 'translateX(0px)';
      node.style.textAlign = 'left';
    } else if (x > frame.width - half) {
      node.style.transform = `translateX(${frame.width - half * 2}px)`;
      node.style.textAlign = 'right';
    } else {
      node.style.transform = `translateX(${x - half}px)`;
      node.style.textAlign = 'center';
    }

    // A tick pushed off the panel by a zoom is hidden rather than clamped to the
    // edge, where it would sit under a label that means something else.
    node.style.opacity = tick.x < -0.02 || tick.x > 1.02 ? '0' : '1';
  });
  element.classList.add('axis--visible');
}

function updateScalebar(
  element: HTMLDivElement | null,
  frame: Frame,
  scale?: { metres: number; fraction: number }
): void {
  if (!element) return;
  if (!scale) {
    element.classList.remove('scalebar--visible');
    return;
  }
  const bar = element.firstElementChild as HTMLElement | null;
  const label = element.lastElementChild as HTMLElement | null;
  if (bar) bar.style.width = `${Math.round(scale.fraction * frame.width)}px`;
  const text = scale.metres >= 1000 ? `${scale.metres / 1000} km` : `${scale.metres} m`;
  if (label && label.textContent !== text) label.textContent = text;
  element.classList.add('scalebar--visible');
}

/**
 * True while the piece is on a phone-sized screen.
 *
 * A media query rather than a user-agent test: what the layout needs to know is
 * how much room it has, and a phone in a desktop-mode browser still has a phone's
 * width. It is watched rather than read once, so a rotation lands the right
 * layout without a reload.
 */
function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches
  );

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = (): void => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
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
