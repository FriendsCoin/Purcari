/**
 * PURCARI — LIVING ARCHIVE
 *
 * A media-art installation that is also a dashboard: 3015 real detections from
 * the estate's 2025 biodiversity monitoring, rendered as a single cloud of light
 * that reorganises itself into six readings of the same season.
 *
 * Interaction is deliberately shallow — arrows, scroll, one scrubber — because
 * the piece has to survive on a wall with nobody driving it. Left alone it plays
 * itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping, Vector3 } from 'three';
import { ACTS } from './acts';
import { KIND_LABEL, describeDetection, useArchive, type Archive, type DetectionDetail } from './data';
import { makeContext, type Layout, type LayoutContext } from './layouts';
import { labelsForAct } from './labels';
import { ParticleField, type FieldControls } from './gl/ParticleField';
import { Labels, type LabelRegistry } from './gl/Labels';
import { Landscape } from './gl/Landscape';
import { Scenery } from './gl/Scenery';
import { PostFX } from './gl/PostFX';
import { Rig, type TransitionState } from './gl/Rig';
import { Panel } from './ui/Panels';
import { Scrubber } from './ui/Scrubber';
import { Cursor } from './ui/Cursor';
import { Inspector } from './ui/Inspector';
import { Picker } from './gl/Picker';
import './ui/installation.css';

const AUTOPLAY_SECONDS = 16;
const IDLE_SECONDS = 45;
const SEASON_SECONDS = 26;
const SWEEP_SECONDS = 19;

export function Installation({ onExit }: { onExit?: () => void }) {
  const { archive, error } = useArchive();

  if (error) {
    return (
      <div className="inst">
        <div className="inst__status">
          Не удалось загрузить архив: {error}
          <br />
          Проверьте, что public/installation.json собран: npm run data
        </div>
      </div>
    );
  }

  if (!archive) {
    return (
      <div className="inst">
        <div className="inst__status">Загрузка архива…</div>
      </div>
    );
  }

  return <Piece archive={archive} onExit={onExit} />;
}

function Piece({ archive, onExit }: { archive: Archive; onExit?: () => void }) {
  const [entered, setEntered] = useState(false);
  const [act, setAct] = useState(0);
  const [window_, setWindow] = useState<[number, number]>([0, 1439]);
  const [autoplay, setAutoplay] = useState(true);
  const [season, setSeason] = useState(false);
  const [detail, setDetail] = useState<DetectionDetail | null>(null);
  const [isolated, setIsolated] = useState<number>(-1);
  const [kind, setKind] = useState<number>(-1);
  const [help, setHelp] = useState(false);

  const context = useMemo<LayoutContext>(() => makeContext(archive), [archive]);
  const cache = useRef(new Map<number, Layout>());
  const layout = useMemo(() => {
    const hit = cache.current.get(act);
    if (hit) return hit;
    const built = ACTS[act].build(context);
    cache.current.set(act, built);
    return built;
  }, [act, context]);

  const definition = ACTS[act];

  // Everything the render loop reads lives in refs so panning the camera or
  // scrubbing time never re-renders the overlay.
  const controls = useRef<FieldControls>({
    pointer: new Vector3(0, -999, 0),
    pointerStrength: 0,
    window: [0, 1439],
    dayCursor: -1,
    focusSpecies: -1,
    focusStation: -1,
    sweep: -1,
    focusKind: -1,
    picked: -1,
    drift: ACTS[0].drift,
    opacity: 1,
  });
  const pointer = useRef({ x: 0, y: 0 });
  const pointerWorld = useMemo(() => new Vector3(0, -999, 0), []);
  const labelRegistry = useRef<LabelRegistry>(new Map());
  const transition = useRef<TransitionState>({ progress: 1, bell: 0, travelling: false });
  const labelOpacity = useRef(1);
  const settled = useRef(true);
  const actsRef = useRef<HTMLDivElement>(null);
  const seasonRef = useRef<HTMLSpanElement>(null);
  const lastInteraction = useRef(performance.now());

  controls.current.window = window_;
  controls.current.drift = definition.drift;
  controls.current.pointer = pointerWorld;
  controls.current.focusKind = kind;
  controls.current.picked = detail ? detail.index : -1;
  // An isolated species overrides the transient hover focus.
  if (isolated >= 0) controls.current.focusSpecies = isolated;

  const anchors = useMemo(() => labelsForAct(archive, definition.key), [archive, definition.key]);

  const touch = useCallback(() => {
    lastInteraction.current = performance.now();
  }, []);

  const go = useCallback(
    (next: number, manual = true) => {
      if (manual) touch();
      setAct(((next % ACTS.length) + ACTS.length) % ACTS.length);
    },
    [touch]
  );

  // ------------------------------------------------------------- input
  useEffect(() => {
    if (!entered) return undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') go(act + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') go(act - 1);
      else if (e.key === ' ') {
        setAutoplay((a) => !a);
        touch();
      } else if (e.key.toLowerCase() === 'p') {
        setSeason((s) => !s);
        touch();
      } else if (e.key === 'Escape') {
        // Peel back one layer at a time rather than resetting everything.
        if (help) setHelp(false);
        else if (detail) setDetail(null);
        else if (isolated >= 0) {
          setIsolated(-1);
          controls.current.focusSpecies = -1;
        } else if (kind >= 0) setKind(-1);
        else setWindow([0, 1439]);
        touch();
      } else if (e.key === '?' || e.key === '/') {
        setHelp((h) => !h);
        touch();
      } else if (/^[0-7]$/.test(e.key)) go(Number(e.key));
      else return;
      e.preventDefault();
    };

    let wheelAccum = 0;
    let wheelLock = 0;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.closest?.('.panel')) return;
      touch();
      const now = performance.now();
      if (now < wheelLock) return;
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) > 120) {
        go(act + Math.sign(wheelAccum));
        wheelAccum = 0;
        wheelLock = now + 700;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / globalThis.innerWidth) * 2 - 1;
      pointer.current.y = -((e.clientY / globalThis.innerHeight) * 2 - 1);
      controls.current.pointerStrength = 2.6;
      touch();
    };
    const onPointerLeave = () => {
      controls.current.pointerStrength = 0;
    };

    let swipeStart: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      swipeStart = e.touches[0]?.clientX ?? null;
      touch();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (swipeStart === null) return;
      const dx = (e.changedTouches[0]?.clientX ?? swipeStart) - swipeStart;
      if (Math.abs(dx) > 60) go(act - Math.sign(dx));
      swipeStart = null;
    };

    globalThis.addEventListener('keydown', onKey);
    globalThis.addEventListener('wheel', onWheel, { passive: true });
    globalThis.addEventListener('pointermove', onPointerMove, { passive: true });
    globalThis.addEventListener('pointerleave', onPointerLeave);
    globalThis.addEventListener('touchstart', onTouchStart, { passive: true });
    globalThis.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      globalThis.removeEventListener('keydown', onKey);
      globalThis.removeEventListener('wheel', onWheel);
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerleave', onPointerLeave);
      globalThis.removeEventListener('touchstart', onTouchStart);
      globalThis.removeEventListener('touchend', onTouchEnd);
    };
  }, [act, entered, go, touch, help, detail, isolated, kind]);

  // ------------------------------------------- autoplay, idle, season clock
  useEffect(() => {
    if (!entered) return undefined;
    let frame = 0;
    let elapsed = 0;
    let seasonT = 0;
    let sweepT = 0;
    let last = performance.now();

    const firstDay = new Date(`${archive.meta.window.firstDay}T00:00:00Z`);
    const maxDay = archive.meta.window.days;

    const tick = () => {
      const now = performance.now();
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;

      const idle = (now - lastInteraction.current) / 1000 > IDLE_SECONDS;
      const running = autoplay || idle;

      if (running) {
        elapsed += delta;
        if (elapsed >= AUTOPLAY_SECONDS) {
          elapsed = 0;
          setAct((a) => (a + 1) % ACTS.length);
        }
      } else {
        elapsed = 0;
      }
      actsRef.current?.style.setProperty('--progress', running ? String(elapsed / AUTOPLAY_SECONDS) : '0');

      // Act II runs a hand around the dial; the shader lights each hour as it
      // passes, so the day plays rather than just sitting there.
      if (ACTS[act].key === 'chronos') {
        sweepT = (sweepT + delta / SWEEP_SECONDS) % 1;
        controls.current.sweep = sweepT * 1440;
      } else {
        controls.current.sweep = -1;
        sweepT = 0;
      }

      if (season) {
        seasonT = (seasonT + delta / SEASON_SECONDS) % 1.12;
        const cursor = seasonT * maxDay;
        controls.current.dayCursor = cursor;
        if (seasonRef.current) {
          const d = new Date(firstDay.getTime() + Math.min(cursor, maxDay) * 86400000);
          seasonRef.current.textContent = d.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: 'short',
            timeZone: 'UTC',
          });
        }
      } else {
        controls.current.dayCursor = -1;
        seasonT = 0;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [entered, autoplay, season, archive, act]);

  const onMorphProgress = useCallback((t: number) => {
    const e = Math.max(0, Math.min(1, (t - 0.55) / 0.45));
    labelOpacity.current = e * e * (3 - 2 * e);
  }, []);

  const focusSpecies = useCallback((id: number) => {
    controls.current.focusSpecies = id;
  }, []);
  const focusStation = useCallback((id: number) => {
    controls.current.focusStation = id;
  }, []);

  return (
    <div className="inst">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: ACTS[0].camera.fov, position: ACTS[0].camera.position, near: 0.1, far: 600 }}
        onCreated={({ gl }) => {
          gl.setClearColor('#04060a', 1);
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <ParticleField
          archive={archive}
          layout={layout}
          controls={controls}
          onMorphProgress={onMorphProgress}
          settled={settled}
        />
        <Picker
          layout={layout}
          count={archive.count}
          settled={settled}
          onPick={(index) => {
            touch();
            setDetail(index === null ? null : describeDetection(archive, index));
          }}
          onHover={(index) => {
            document.body.classList.toggle('is-grabbable', index !== null);
          }}
        />
        <Landscape archive={archive} active={definition.key === 'land' || definition.key === 'stations' ? 1 : 0} />
        <Scenery archive={archive} act={definition.key} controls={controls} />
        <Labels anchors={anchors} registry={labelRegistry} opacity={labelOpacity} />
        <Rig
          act={definition}
          pointer={pointer}
          pointerWorld={pointerWorld}
          transition={transition}
          enabled={entered}
        />
        <PostFX transition={transition} />
      </Canvas>

      <div className="inst__veil" />

      <div className="labels" aria-hidden="true">
        {anchors.map((a) => (
          <div
            key={a.id}
            className={`label${a.tone && a.tone !== 'default' ? ` label--${a.tone}` : ''}`}
            ref={(el) => {
              if (el) labelRegistry.current.set(a.id, el);
              else labelRegistry.current.delete(a.id);
            }}
          >
            <span className="label__title">{a.title}</span>
            {a.meta && <span className="label__meta">{a.meta}</span>}
          </div>
        ))}
      </div>

      <div className="inst__ui">
        <header className="masthead">
          <div className="masthead__mark">
            <div className="wordmark">
              Purcari <span>/</span> Живой архив
            </div>
            <div className="masthead__sub">
              {archive.meta.window.firstDay} — {archive.meta.window.lastDay} · Молдова
            </div>
          </div>

          <div className="tally">
            <Tally value={new Intl.NumberFormat('ru-RU').format(archive.meta.counts.detections)} label="регистраций" />
            <Tally value={String(archive.meta.counts.species)} label="видов" />
            <Tally value={`${archive.meta.counts.stationsActive}/${archive.meta.counts.stations}`} label="станций" />
            <Tally value={archive.meta.shannonOverall.toFixed(2)} label="H′ Шеннона" />
          </div>
        </header>

        <div className="stage">
          <div className="act-title fade-swap" key={act}>
            <span className="act-title__numeral">
              {definition.numeral === '00' ? 'Пролог' : `Акт ${definition.numeral}`}
            </span>
            <h1 className="act-title__h1">{definition.title}</h1>
            <p className="act-title__sub">{definition.subtitle}</p>
            <p className="act-title__caption">{definition.caption(archive)}</p>
          </div>

          <Panel
            archive={archive}
            act={definition}
            onFocusSpecies={focusSpecies}
            onFocusStation={focusStation}
            window={window_}
          />
        </div>

        <div className="transport">
          <nav className="acts" ref={actsRef} aria-label="Акты">
            {ACTS.map((a) => (
              <button
                key={a.key}
                type="button"
                className="acts__item"
                aria-current={a.id === act}
                onClick={() => go(a.id)}
              >
                <span className="acts__numeral">{a.numeral}</span>
                <span className="acts__name">{a.title}</span>
              </button>
            ))}
          </nav>

          <Scrubber
            archive={archive}
            value={window_}
            onChange={(next) => {
              touch();
              setWindow(next);
            }}
          />

          <div className="controls">
            <button
              type="button"
              className="pill"
              aria-pressed={season}
              onClick={() => {
                touch();
                setSeason((s) => !s);
              }}
              title="Проиграть сезон по дням (P)"
            >
              <span className="pill__dot" />
              Сезон <span ref={seasonRef} />
            </button>
            <div className="kinds" role="group" aria-label="Группы животных">
              {[0, 1, 2].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="kinds__item"
                  aria-pressed={kind === k}
                  onClick={() => {
                    touch();
                    setKind((current) => (current === k ? -1 : k));
                  }}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <button type="button" className="pill" onClick={() => setHelp(true)} title="Справка (?)">
              ?
            </button>
            <button
              type="button"
              className="pill"
              aria-pressed={autoplay}
              onClick={() => {
                touch();
                setAutoplay((a) => !a);
              }}
            >
              Авто
            </button>
            {onExit && (
              <button type="button" className="pill" onClick={onExit}>
                Дэшборд
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={`intro${entered ? ' intro--out' : ''}`}>
        <div className="intro__inner">
          <span className="intro__kicker">Purcari · Молдова · 2025</span>
          <h1 className="intro__title">Живой архив</h1>
          <div className="intro__line" />
          <p className="intro__meta">
            {new Intl.NumberFormat('ru-RU').format(archive.meta.counts.detections)} регистраций
            дикой природы: {new Intl.NumberFormat('ru-RU').format(archive.meta.counts.acoustic)} голосов
            и {archive.meta.counts.camera} снимков фотоловушек, {archive.meta.counts.species} вида,{' '}
            {archive.meta.counts.stations} станций, {archive.meta.window.days} дней.
            <br />
            Каждая частица — одно настоящее наблюдение.
          </p>
          <button
            type="button"
            className="intro__enter"
            onClick={() => {
              setEntered(true);
              touch();
            }}
          >
            Войти
          </button>
          <span className="intro__hint">стрелки · колесо · пробел — автопрокрутка</span>
        </div>
      </div>

      <Inspector
        archive={archive}
        detail={detail}
        isolated={isolated >= 0}
        onClose={() => setDetail(null)}
        onIsolate={(speciesId) => {
          touch();
          if (isolated === speciesId) {
            setIsolated(-1);
            controls.current.focusSpecies = -1;
          } else {
            setIsolated(speciesId);
          }
        }}
      />

      {help && (
        <div className="help" role="dialog" aria-label="Справка" onClick={() => setHelp(false)}>
          <div className="help__card" onClick={(e) => e.stopPropagation()}>
            <div className="help__head">
              <span className="panel__title">Управление</span>
              <button type="button" className="inspector__close" onClick={() => setHelp(false)}>
                ✕
              </button>
            </div>
            <dl className="help__list">
              <div><dt>← →, колесо, свайп</dt><dd>соседний акт</dd></div>
              <div><dt>0 – 7</dt><dd>перейти к акту</dd></div>
              <div><dt>клик по частице</dt><dd>что это было за наблюдение</dd></div>
              <div><dt>пробел</dt><dd>автопрокрутка</dd></div>
              <div><dt>P</dt><dd>проиграть сезон по дням</dd></div>
              <div><dt>перетащить шкалу</dt><dd>срез времени суток</dd></div>
              <div><dt>Esc</dt><dd>снять выделение, затем фильтр, затем срез</dd></div>
              <div><dt>?</dt><dd>эта справка</dd></div>
            </dl>
            <p className="help__note">
              Каждая частица — одно настоящее наблюдение из архива 2025 года. Без действий
              инсталляция через 45 секунд начинает играть себя сама.
            </p>
          </div>
        </div>
      )}

      <Cursor />
    </div>
  );
}

function Tally({ value, label }: { value: string; label: string }) {
  return (
    <div className="tally__item">
      <span className="tally__value">{value}</span>
      <span className="tally__label">{label}</span>
    </div>
  );
}
