import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InstallationData, Species } from '../core/types';
import { loadInstallationData, speciesAtSite, MONTHS } from '../core/data';
import {
  GUILD_COLORS,
  GUILD_LABELS,
  HABITAT_LABELS,
  TYPOLOGY_LABELS,
  PALETTE,
} from '../core/palette';
import { soundField, Chorus } from '../core/audio';
import { Spectrogram, SPECTROGRAM_AXES } from '../ui/Spectrogram';
import { Vignette } from '../ui/Vignette';
import { Dossier } from '../ui/Dossier';
import { VIGNETTE_SOURCE, type VignetteKind } from '../ui/vignetteData';
import { useChapterTransition } from '../core/useChapterTransition';
import { useDayClock } from '../core/dayClock';
import { Stage, CameraRig, ChapterFrame } from '../gl/Stage';
import { Constellation, type Lens, type MapAnchor } from '../gl/Constellation';
import { Chronogram } from '../gl/Chronogram';
import { Choir } from '../gl/Choir';
import { Refuge, type RefugeMode } from '../gl/Refuge';
import { Unseen } from '../gl/Unseen';
import { buildRings } from '../gl/unseenRings';
import { GLYPH_CREDIT } from '../gl/silhouettes';
import '../ui/installation.css';

/**
 * TERROIR VIVANT — the indoor touchscreen installation for Château Purcari.
 *
 * Built for a single large portrait or landscape touch panel running unattended
 * for a full visitor day. It runs an attract loop of its own accord; a touch
 * hands control to the visitor; two minutes of no touches hands it back.
 *
 * The estate's own terroir survey reads the land downward, into geology, and
 * calls the result the wine. This piece reads the same land upward, into the
 * animals living on top of it, and calls the result the estate's other harvest.
 */

type ChapterId = 'estate' | 'year' | 'choir' | 'unseen' | 'refuge';

/** Where one Refuge column's foot sits on screen, reported by the scene itself. */
interface RefugeMark {
  landUse: string;
  x: number;
  y: number;
  self: boolean;
  value: number;
  form: number;
}

/**
 * The four questions the Refuge row can answer. All four are about this estate
 * and nothing outside it: what it does, what its own ground carries as the
 * cameras see it and as the recorders hear it, and what its published ecosystem
 * score stands on.
 */
/**
 * One scene, four ways of lighting it. The buttons stopped swapping data when
 * the readings merged; now the whole argument stands on stage at once —
 * practices on the terrace, grounds in the colonnade, the score's pillars
 * behind — and a button only moves the light to one tier of it.
 */
const REFUGE_READINGS: { label: string; mode: RefugeMode }[] = [
  { label: 'Everything', mode: 'all' },
  { label: 'Practices', mode: 'practices' },
  { label: 'The ground', mode: 'habitat' },
  { label: 'Ecosystem', mode: 'ecosystem' },
];

/**
 * Approximate advance of one character of the caption face — 0.6rem monospace
 * with 0.14em tracking. Measuring for real would mean a layout read per frame
 * for a decision that only has to be roughly right.
 */
const CAPTION_CHAR_PX = 7.1;

interface Chapter {
  id: ChapterId;
  label: string;
  title: string;
  lede: string;
  /** Seconds the attract loop dwells here. */
  dwell: number;
  camera: [number, number, number];
  lookAt: [number, number, number];
  /** Width ÷ height of the subject, so narrow viewports pull back only when needed. */
  subjectAspect: number;
  /** Optional override of how far the camera may pull back to fit it. */
  maxPull?: number;
}

const CHAPTERS: Chapter[] = [
  {
    id: 'estate',
    label: 'The Estate',
    title: 'One land,\nthree readings',
    lede: 'Twelve listening posts across the vineyard. Ask the mammals which ground is rich and they answer one way; ask the birds and they answer another.',
    dwell: 34,
    // High and back: the estate runs 13 units along its long axis, so this
    // frames it nearly plan-view with north kept up.
    camera: [0, 15, 13],
    lookAt: [0, 0.4, 0],
    subjectAspect: 0.5,
  },
  {
    id: 'year',
    label: 'The Year',
    title: 'A year,\nhour by hour',
    lede: 'Every detection the estate recorded, wound into a single disc: twelve months around, twenty-four hours outward. The bright band hugging the sunrise line is the dawn chorus.',
    dwell: 34,
    camera: [0, 11.5, 9],
    lookAt: [0, 0, 0],
    subjectAspect: 1.0,
  },
  {
    id: 'choir',
    label: 'The Choir',
    title: 'Two hundred\nand thirteen',
    lede: 'Every species recorded in a year. The common at the centre, the rare at the edges, the nocturnal sinking below. Touch any one of them.',
    dwell: 40,
    camera: [0, 2.5, 17],
    lookAt: [0, 0, 0],
    subjectAspect: 1.7,
  },
  {
    id: 'unseen',
    label: 'The Unseen',
    title: 'What a year\nstill missed',
    lede: 'Chao1 estimates a place’s true richness from how many species were caught only once or twice. One ring per station, filled as far as the count got and then broken. The estate closes furthest — because what one station missed, another caught.',
    dwell: 36,
    // Standing off far enough that the outermost ring has air around it: the
    // spiral of open ends is the figure, and it needs somewhere to be seen.
    camera: [0, 0, 16.8],
    lookAt: [0, 0, 0],
    subjectAspect: 1.0,
  },
  {
    id: 'refuge',
    label: 'Refuge',
    title: 'What the estate\ndoes to it',
    lede: 'One column per stage of the estate\u2019s own programme, standing at how far it has been rolled out, with the same living community rising inside all of them.',
    dwell: 38,
    // The widest row in the piece — ten habitat columns — so the camera stands
    // off far enough that every capital is in frame at once.
    // Raised: the chapter is a three-tier diorama now, and depth only reads
    // from above — a frontal camera flattened the terrace into the colonnade.
    camera: [0, 5.4, 15.6],
    lookAt: [0, 1.4, 0],
    subjectAspect: 2.3,
    // A ten-column colonnade is genuinely three times wider than it is tall, and
    // on a phone in portrait the default limit left it running off both edges.
    maxPull: 3.1,
  },
];

const LENSES: { id: Lens; label: string; caption: string }[] = [
  { id: 'both', label: 'Both', caption: 'Cameras and microphones together' },
  { id: 'camera', label: 'Mammals', caption: 'As the camera traps see it' },
  { id: 'sound', label: 'Birds', caption: 'As the recorders hear it' },
];

/** Idle time before the piece resumes its own attract loop. */
const IDLE_RESUME_MS = 120_000;

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatHour(value: number): string {
  const h = Math.floor(value) % 24;
  const m = Math.round((value - Math.floor(value)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function IndoorApp() {
  const [data, setData] = useState<InstallationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [chapterIndex, setChapterIndex] = useState(0);
  const [attract, setAttract] = useState(true);
  const [progress, setProgress] = useState(0);

  const [lens, setLens] = useState<Lens>('both');
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [selectedSpecies, setSelectedSpecies] = useState<Species | null>(null);
  const [focusMonth, setFocusMonth] = useState<number | null>(null);
  const [clusterGuilds, setClusterGuilds] = useState(false);
  const [flagshipOnly, setFlagshipOnly] = useState(false);
  /**
   * Which question the Refuge row answers: what the estate does, what its own
   * ground carries under each survey method, or what its published ecosystem
   * score stands on.
   */
  const [refugeMode, setRefugeMode] = useState<RefugeMode>('all');
  const [refugeSelected, setRefugeSelected] = useState<string | null>(null);
  const [refugeMarks, setRefugeMarks] = useState<RefugeMark[]>([]);
  /** Named anchors on the estate map — the château, the villages, the scale. */
  const [mapAnchors, setMapAnchors] = useState<MapAnchor[]>([]);
  /** Which chapter's detail drawer is open, if any. */
  const [dossier, setDossier] = useState<ChapterId | null>(null);
  /** Where the chosen station stands, for the fly-to. Null at the overview. */
  const [estateFocus, setEstateFocus] = useState<[number, number, number] | null>(null);
  /** Which ring of The Unseen is chosen — a station id, 'ESTATE', or null. */
  const [unseenSelected, setUnseenSelected] = useState<string | null>(null);
  /**
   * The hour the estate is shown at. Starts at the château's real local time,
   * so a visitor first meets the estate as it is right now, and can then scrub
   * a whole day and watch the community hand over from the day shift to the
   * night one. Every response to it comes from measured hourly profiles.
   */
  /**
   * The estate's day, running on its own and looping. Lives outside React —
   * see `core/dayClock.ts`: writing the hour to state on every pointer move was
   * re-rendering the whole chapter tree, scene elements included, which is
   * exactly the judder the scrubber used to have.
   */
  const {
    clock: dayClock,
    label: hour,
    playing: dayPlaying,
    scrub: scrubHour,
  } = useDayClock(new Date().getHours() + new Date().getMinutes() / 60);
  const [clockTouched, setClockTouched] = useState(false);

  /**
   * The Refuge captions, with collisions removed.
   *
   * Ten habitat names is well over 300 px of type; on a phone in portrait the
   * row is only 430 px wide and they overlap into an unreadable smear. Shrinking
   * the face further would make it unreadable on the kiosk too, so instead the
   * ones that collide are dropped — in priority order, so the label that
   * survives is always the one that matters: ground the estate keeps first, then
   * whatever the visitor has selected, then left to right.
   */
  const refugeLabels = useMemo(() => {
    // Worked and built ground outranks kept ground here, and deliberately: only
    // two of the ten columns are in production, and dropping *those* two labels
    // to fit the rest leaves a row that looks entirely like habitat. The rare
    // case is the informative one.
    // The focused tier's captions survive collisions first: with eighteen
    // columns on one stage, whatever the light is on is what the visitor is
    // reading, and losing *its* names to a background tier's is backwards.
    const focusForm =
      refugeMode === 'practices' ? 0 : refugeMode === 'habitat' ? 1 : refugeMode === 'ecosystem' ? 2 : -1;
    const rank = (mark: RefugeMark) =>
      refugeSelected === mark.landUse
        ? 0
        : mark.form === focusForm
          ? 1
          : mark.self
            ? 3
            : 2;
    const ordered = [...refugeMarks].sort((a, b) => rank(a) - rank(b) || a.x - b.x);
    const taken: { left: number; right: number }[] = [];
    const kept: RefugeMark[] = [];
    for (const mark of ordered) {
      // A column that has faded out of the current survey carries no label.
      if (mark.value <= 0.02) continue;
      const half = (mark.landUse.length * CAPTION_CHAR_PX) / 2 + 6;
      const left = mark.x - half;
      const right = mark.x + half;
      if (taken.some((box) => left < box.right && right > box.left)) continue;
      taken.push({ left, right });
      kept.push(mark);
    }
    return kept;
  }, [refugeMarks, refugeSelected, refugeMode]);

  /**
   * Which practice stage has a diagram behind it.
   *
   * Only the two that are a physical thing happening to a plant. "Land kept"
   * and "treatments cut" are shares of an estate, and a moving picture of a
   * percentage is decoration — the column already is that picture.
   */
  const practiceVignette = useMemo((): { kind: VignetteKind; caption: string } | null => {
    // Any focus: the stage is one now, and a visitor who taps the drip column
    // from the overview asked the same question.
    if (!refugeSelected) return null;
    if (refugeSelected === 'Drip irrigation')
      return { kind: 'drip', caption: 'WATER GOES TO THE ROOT, NOT OVER THE LEAF — DIAGRAM' };
    if (refugeSelected === 'Water saved')
      return { kind: 'drip', caption: 'THE SAME VINE, ON LESS WATER — DIAGRAM' };
    return null;
  }, [refugeSelected]);

  /** The Unseen's rings, in the same order the scene draws them. */
  const rings = useMemo(() => (data ? buildRings(data) : []), [data]);

  const idleTimer = useRef<number | null>(null);
  const chapter = CHAPTERS[chapterIndex];
  const transition = useChapterTransition<ChapterId>(chapter.id);

  useEffect(() => {
    loadInstallationData().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  /* ------------------------------------------------------- attract loop */
  useEffect(() => {
    if (!attract || !started) return;
    const dwellMs = chapter.dwell * 1000;
    const startedAt = performance.now();
    let raf = 0;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      setProgress(Math.min(1, elapsed / dwellMs));
      if (elapsed >= dwellMs) {
        setChapterIndex((i) => (i + 1) % CHAPTERS.length);
        // Rotate the lens with each pass so the attract loop shows the estate's
        // three readings without anyone touching the screen.
        setLens((current) => {
          const at = LENSES.findIndex((l) => l.id === current);
          return LENSES[(at + 1) % LENSES.length].id;
        });
        setSelectedSite(null);
        setSelectedSpecies(null);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [attract, started, chapter.dwell, chapterIndex]);

  /** Any touch takes control; silence hands it back. */
  const touch = useCallback(() => {
    setAttract(false);
    setProgress(0);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      setAttract(true);
      setSelectedSite(null);
      setSelectedSpecies(null);
      setFocusMonth(null);
    }, IDLE_RESUME_MS);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') void document.documentElement.requestFullscreen?.();
      if (e.key === 'ArrowRight') { touch(); setChapterIndex((i) => (i + 1) % CHAPTERS.length); }
      if (e.key === 'ArrowLeft') {
        touch();
        setChapterIndex((i) => (i - 1 + CHAPTERS.length) % CHAPTERS.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [touch]);

  const begin = useCallback(async () => {
    setStarted(true);
    try {
      await soundField.start();
      soundField.setVolume(0.45);
      if (data) soundField.startDrone(data.meta.shannon);
    } catch {
      // Silent installation is still a complete installation.
    }
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, [data]);

  /**
   * A sparse ambient chorus of whichever species are genuinely active at the
   * château's real local hour — so the room sounds like dawn at dawn and like
   * an owl-only night after closing. Deliberately thin: this plays in a tasting
   * room, not a cinema.
   */
  const chorus = useRef(new Chorus(soundField));
  useEffect(() => {
    if (!started || !data) return;
    const tick = window.setInterval(() => {
      if (!soundField.ready) return;
      // Follows the scrubber once the visitor has taken hold of it, so the
      // room's voices match the hour on screen; otherwise it tracks real time.
      const now = new Date();
      const sounding = clockTouched ? hour : now.getHours() + now.getMinutes() / 60;
      // The Choir chapter earns a fuller soundscape; the others stay in the background.
      const density = CHAPTERS[chapterIndex].id === 'choir' ? 0.45 : 0.22;
      chorus.current.update(data.species, sounding, density);
    }, 400);
    return () => window.clearInterval(tick);
  }, [started, data, chapterIndex, clockTouched, hour]);

  const site = useMemo(
    () => (data && selectedSite ? data.sites.find((s) => s.id === selectedSite) ?? null : null),
    [data, selectedSite],
  );

  const siteSpecies = useMemo(
    () => (data && site ? speciesAtSite(data, site.id).slice(0, 7) : []),
    [data, site],
  );

  const handleSelectSite = useCallback(
    (id: string | null) => {
      touch();
      setSelectedSite(id);
      if (id && data) {
        // Sound the station's most characteristic voice.
        const top = speciesAtSite(data, id)[0];
        if (top && soundField.ready) soundField.play(top, 0.6);
      }
    },
    [touch, data],
  );

  const handleSelectSpecies = useCallback(
    (species: Species | null) => {
      touch();
      setSelectedSpecies(species);
      if (species && soundField.ready) soundField.play(species, 0.75);
    },
    [touch],
  );


  /** One chapter's 3D content at a given reveal. */
  const renderScene = (id: ChapterId, reveal: number, interactive: boolean) => {
    if (!data) return null;
    switch (id) {
      case 'estate':
        return (
          <Constellation
            key="estate"
            data={data}
            reveal={reveal}
            lens={lens}
            hour={hour}
            clock={dayClock}
            selectedSite={selectedSite}
            onSelectSite={interactive ? handleSelectSite : undefined}
            onMapAnchors={interactive ? setMapAnchors : undefined}
            onFocus={interactive ? setEstateFocus : undefined}
          />
        );
      case 'year':
        return (
          <Chronogram
            key="year"
            data={data}
            reveal={reveal}
            modality="both"
            focusMonth={focusMonth}
            onSelectMonth={
              interactive
                ? (month) => {
                    touch();
                    setFocusMonth((current) => (current === month ? null : month));
                  }
                : undefined
            }
          />
        );
      case 'refuge':
        return (
          <Refuge
            key="refuge"
            data={data}
            reveal={reveal}
            mode={refugeMode}
            selected={refugeSelected}
            onSelect={
              interactive
                ? (landUse) => {
                    touch();
                    setRefugeSelected(landUse);
                  }
                : undefined
            }
            onLayout={interactive ? setRefugeMarks : undefined}
          />
        );
      case 'unseen':
        return (
          <Unseen
            key="unseen"
            data={data}
            reveal={reveal}
            selected={unseenSelected}
            onSelect={
              interactive
                ? (id) => {
                    touch();
                    setUnseenSelected((current) => (current === id ? null : id));
                  }
                : undefined
            }
          />
        );
      case 'choir':
        return (
          <Choir
            key="choir"
            data={data}
            reveal={reveal}
            cluster={clusterGuilds ? 1 : 0}
            hour={hour}
            clock={dayClock}
            flagshipOnly={flagshipOnly}
            selected={selectedSpecies}
            onSelect={interactive ? handleSelectSpecies : undefined}
          />
        );
      default:
        return null;
    }
  };

  /**
   * One chapter's overlay: its title band and its own controls.
   *
   * Rendered twice through a dissolve, exactly as the 3D scenes are. Before
   * this, the canvas cross-faded while the type hard-cut — the largest thing on
   * the screen changing on a single frame, which is precisely the seam the
   * dissolve exists to remove. The outgoing copy takes no touches, so a fading
   * control cannot steal a tap meant for the arriving one.
   */
  const chapterOverlay = (id: ChapterId, opacity: number, interactive: boolean) => {
    const chapter = CHAPTERS.find((entry) => entry.id === id) ?? CHAPTERS[0];
    return (
      <div
        className="inst-chapter-layer"
        key={id}
        style={{ opacity, pointerEvents: interactive ? undefined : 'none' }}
      >
        <div className="inst-corner inst-corner--tl inst-pass" >
          <p className="inst-subtitle inst-rise">{chapter.label}</p>
          <h1
            className="inst-title inst-rise inst-delay-1"
            style={{ margin: '1rem 0 1.4rem', whiteSpace: 'pre-line' }}
          >
            {chapter.title}
          </h1>
          <p className="inst-lede inst-rise inst-delay-2">{chapter.lede}</p>
        </div>

        {/* --------------------------------------------------- map captions */}
        {/*
          The names that make the sheet recognisably Purcari: the château, the
          villages the roads leave toward, the scale bar's own figure. Anchored
          to screen positions the scene reports each frame, so they ride the
          map's slow sway; rendered only for the live overlay, since a dissolve
          would otherwise draw two sets of the same names.
        */}
        {id === 'estate' && interactive && (
          <div className="inst-map-labels inst-pass" aria-hidden="true">
            {mapAnchors.map((anchor) => (
              <span
                key={`${anchor.kind}:${anchor.name}`}
                className={`inst-map-label inst-map-label--${anchor.kind}${
                  anchor.edge ? ' inst-map-label--edge' : ''
                }`}
                style={{ left: anchor.x, top: anchor.y }}
              >
                {anchor.kind === 'winery' ? 'Château Purcari · 1827' : anchor.name}
              </span>
            ))}
          </div>
        )}

        {/* ------------------------------------------------ chapter controls */}
        {id === 'estate' && (
          <div
            className="inst-corner inst-corner--bl"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
          >
            {/*
              The clock. Native range input on purpose: it is the one control a
              visitor can already drive without instruction, and it carries
              keyboard focus and arrow-key stepping for free.
            */}
            <div className="inst-clock" style={{ marginBottom: '1rem' }}>
              <div className="inst-clock-head">
                {/*
                  The day runs on its own and loops. Saying which state it is in
                  matters: without it a visitor cannot tell whether the estate is
                  changing because of them or because time is passing, and the
                  scrubber looks broken for the four seconds after they let go.
                */}
                <span className="inst-label">
                  Hour of day {dayPlaying ? '· running' : '· yours'}
                </span>
                <span className="inst-clock-time">{formatHour(hour)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={23.75}
                step={0.25}
                value={hour}
                aria-label="Hour of day"
                onChange={(event) => {
                  touch();
                  setClockTouched(true);
                  scrubHour(Number(event.target.value));
                }}
              />
              <div className="inst-clock-scale">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>
            </div>
            <p className="inst-label" style={{ marginBottom: '0.5rem' }}>
              Read the land as
            </p>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {LENSES.map((entry) => (
                <button
                  key={entry.id}
                  className="inst-nav-item"
                  data-active={entry.id === lens}
                  onClick={() => {
                    touch();
                    setLens(entry.id);
                  }}
                  style={{ minHeight: 56, padding: '0.9rem 1.1rem' }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="inst-mono" style={{ marginTop: '0.3rem' }}>
              {lensMeta.caption.toUpperCase()}
            </p>

            {/*
              What the lens the visitor just chose actually is. The chapter
              rests on "cameras for the mammals, microphones for the birds" and
              has never shown either instrument; a small moving diagram answers
              it where the question is asked. On BOTH there is nothing to
              explain, so nothing plays.
            */}
            {lens !== 'both' && (
              <div className="inst-vignette">
                <Vignette
                  kind={lens === 'camera' ? 'camera' : 'sound'}
                  active={chapter.id === 'estate'}
                  height={150}
                />
                <p className="inst-mono" style={{ opacity: 0.5 }}>
                  {lens === 'camera'
                    ? 'A CAMERA TRAP FIRES ON MOVEMENT — DIAGRAM'
                    : 'A RECORDER LISTENS ALL NIGHT — DIAGRAM'}
                </p>
              </div>
            )}
            {/*
              The sources move into the drawer with everything else that is
              reading rather than looking. ODbL requires the OSM line wherever
              the map data is shown — the drawer is where it is now shown.
            */}
            <button className="inst-more" onClick={() => { touch(); setDossier('estate'); }}>
              Sources &amp; method
            </button>
          </div>
        )}

        {id === 'choir' && data && (
          <div className="inst-corner inst-corner--bl">
            {/*
              The clock. Native range input on purpose: it is the one control a
              visitor can already drive without instruction, and it carries
              keyboard focus and arrow-key stepping for free.
            */}
            <div className="inst-clock" style={{ marginBottom: '1rem' }}>
              <div className="inst-clock-head">
                {/*
                  The day runs on its own and loops. Saying which state it is in
                  matters: without it a visitor cannot tell whether the estate is
                  changing because of them or because time is passing, and the
                  scrubber looks broken for the four seconds after they let go.
                */}
                <span className="inst-label">
                  Hour of day {dayPlaying ? '· running' : '· yours'}
                </span>
                <span className="inst-clock-time">{formatHour(hour)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={23.75}
                step={0.25}
                value={hour}
                aria-label="Hour of day"
                onChange={(event) => {
                  touch();
                  setClockTouched(true);
                  scrubHour(Number(event.target.value));
                }}
              />
              <div className="inst-clock-scale">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>
            </div>
            {/* The rosette is unreadable without naming the clusters. */}
            {clusterGuilds && (
              <div
                className="inst-rise"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '0.1rem 1.4rem',
                  marginBottom: '1rem',
                  maxWidth: 380,
                }}
              >
                {Object.entries(data.guilds)
                  .sort((a, b) => b[1].species - a[1].species)
                  .map(([guild, totals]) => (
                    <div className="inst-species-line" key={guild}>
                      <i
                        className="inst-swatch"
                        style={{ color: GUILD_COLORS[guild] ?? PALETTE.foil }}
                      />
                      <span style={{ fontSize: '0.78rem' }}>
                        {GUILD_LABELS[guild] ?? guild}
                      </span>
                      <span className="inst-mono" style={{ marginLeft: 'auto' }}>
                        {totals.species}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              <button
                className="inst-nav-item"
                data-active={clusterGuilds}
                onClick={() => {
                  touch();
                  setClusterGuilds((v) => !v);
                }}
                style={{ minHeight: 56, paddingLeft: 0 }}
              >
                {clusterGuilds ? 'Merge the swarm' : 'Sort by guild'}
              </button>
              <button
                className="inst-nav-item"
                data-active={flagshipOnly}
                onClick={() => {
                  touch();
                  setFlagshipOnly((v) => !v);
                }}
                style={{ minHeight: 56 }}
              >
                {flagshipOnly ? 'Show all 213' : 'The ones that matter'}
              </button>
            </div>
            {flagshipOnly && (
              <p className="inst-mono" style={{ marginTop: '0.6rem', maxWidth: '34ch', lineHeight: 1.7 }}>
                {data.flagships.length} SPECIES THE SURVEY SINGLES OUT — BY
                CONSERVATION STATUS OR BY WHAT THEIR PRESENCE PROVES.
              </p>
            )}
          </div>
        )}

        {id === 'refuge' &&
          refugeLabels.map((mark) => (
            <span
              key={mark.landUse}
              className="inst-column-label inst-pass"
              data-self={mark.self}
              data-active={refugeSelected === mark.landUse}
              style={{
                left: mark.x,
                top: mark.y + 14,
                opacity: Math.min(1, Math.max(0, mark.value * 1.6)),
              }}
            >
              {mark.landUse}
            </span>
          ))}

        {id === 'refuge' && data && (
          <div className="inst-corner inst-corner--bl">
            <p className="inst-label" style={{ marginBottom: '0.5rem' }}>
              Light on
            </p>
            {/* Four buttons overflow a phone in a single row; the wrap costs
                nothing on the kiosk, where they still fit on one line. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {REFUGE_READINGS.map((entry) => (
                <button
                  key={entry.label}
                  className="inst-nav-item"
                  data-active={refugeMode === entry.mode}
                  onClick={() => {
                    touch();
                    setRefugeMode(entry.mode);
                    setRefugeSelected(null);
                  }}
                  style={{ minHeight: 56, padding: '0.9rem 1.1rem' }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="inst-mono" style={{ marginTop: '0.3rem' }}>
              {(refugeMode === 'practices'
                ? 'WHAT IT DOES · SHARES LEFT, HECTARES RIGHT — TWO SCALES'
                : refugeMode === 'ecosystem'
                  ? 'WHAT IT ADDS UP TO · THE PUBLISHED SCORE ON ITS PILLARS'
                  : refugeMode === 'habitat'
                    ? 'THE GROUND · SHAFT ONE SURVEY, COLLAR THE OTHER'
                    : 'TOUCH ANYTHING — ITS THREADS LIGHT WHAT IT TOUCHES'
              ).toUpperCase()}
            </p>

            <div className="inst-rule" style={{ maxWidth: 380 }} />

            {refugeMode === 'practices' ? (
              /*
                The stages, in their own units, and the reason the row carries
                two scales at once. Saying so is the point: the estate's total
                area is not published anywhere in the survey, so there is no
                honest conversion between a hectare figure and a share.
              */
              <>
                <p className="inst-figure" style={{ fontSize: '2.4rem' }}>
                  {notInProduction.toFixed(1)}%
                </p>
                <p className="inst-mono">OF THE ESTATE IS NOT IN PRODUCTION</p>
                <p className="inst-mono" style={{ marginTop: '0.5rem' }}>
                  SAME COMMUNITY IN EVERY STAGE · ONE YEAR, NO BEFORE-AND-AFTER
                </p>
                {/*
                  The hectares, the ranges and the reason for two scales used to
                  sit here as a paragraph. All of it is true and some of it
                  matters a great deal — but a wall reads a figure and a shape,
                  not four lines of prose, and the prose was crowding the row it
                  was describing. It moves one keystroke away; nothing is cut.
                */}
                <button className="inst-more" onClick={() => { touch(); setDossier('refuge'); }}>
                  The working
                </button>
              </>
            ) : refugeMode === 'ecosystem' ? (
              /*
                What the pillars hold up. The overall score is not an average of
                the three — it is published as its own figure — so it is given as
                the datum the row is read against, exactly as the scene draws it.
              */
              <>
                <p className="inst-figure" style={{ fontSize: '2.4rem' }}>
                  {data.narrative.ecosystemScore.overall.toFixed(1)}
                  <span style={{ fontSize: '1rem', opacity: 0.6 }}> / 100</span>
                </p>
                <p className="inst-mono">
                  ECOSYSTEM SCORE · {data.narrative.protection.protConn.toFixed(1)}% PROTECTED
                </p>
                <p
                  className="inst-body"
                  style={{ maxWidth: '38ch', fontSize: '0.86rem', marginTop: '0.6rem' }}
                >
                  A strong ecosystem, and strong because it is joined up:
                  connectivity {data.narrative.ecosystemScore.connectivity.toFixed(1)} against
                  intrinsic quality {data.narrative.ecosystemScore.intrinsic.toFixed(1)}.
                </p>
              </>
            ) : (
              /*
                The default and the ground focus share one short block: the
                diorama is the statement now, and the corner only names its
                three tiers and offers the working. Prose lives in the drawer.
              */
              <>
                <p className="inst-figure" style={{ fontSize: '2.4rem' }}>
                  {notInProduction.toFixed(1)}%
                </p>
                <p className="inst-mono">OF THE ESTATE IS NOT IN PRODUCTION</p>
                <p className="inst-mono" style={{ marginTop: '0.5rem' }}>
                  ONE ESTATE · WHAT IT DOES, WHAT LIVES THERE, WHAT IT ADDS UP TO
                </p>
                <button className="inst-more" onClick={() => { touch(); setDossier('refuge'); }}>
                  The working
                </button>
              </>
            )}
            {/*
              What the chosen stage does, when it is a thing that can be drawn —
              water arriving at the root rather than over the leaf. Follows the
              selection in any focus: the stage is one scene now.
            */}
            {practiceVignette && (
              <div className="inst-vignette inst-rise">
                <Vignette
                  kind={practiceVignette.kind}
                  active={chapter.id === 'refuge'}
                  height={112}
                />
                <p className="inst-mono" style={{ opacity: 0.5 }}>
                  {practiceVignette.caption}
                </p>
              </div>
            )}
          </div>
        )}

        {id === 'unseen' && data && (
          <div className="inst-corner inst-corner--bl">
            <p className="inst-label" style={{ marginBottom: '0.5rem' }}>
              {chosenRing ? 'Selected' : 'Least counted first'}
            </p>
            <p className="inst-figure" style={{ fontSize: '2.4rem' }}>
              {chosenRing
                ? `${Math.round(chosenRing.completeness * 100)}%`
                : `${Math.round(
                    (data.meta.totalSpecies / data.meta.chao1) * 100
                  )}%`}
            </p>
            <p className="inst-mono">
              {chosenRing
                ? `${chosenRing.observed} SEEN · ${Math.round(
                    chosenRing.estimated
                  )} ESTIMATED · ${Math.round(
                    chosenRing.estimated - chosenRing.observed
                  )} MISSED`
                : `${data.meta.totalSpecies} SEEN · ${Math.round(
                    data.meta.chao1
                  )} ESTIMATED ACROSS THE ESTATE`}
            </p>
            <p className="inst-body" style={{ maxWidth: '34ch', fontSize: '0.86rem', marginTop: '0.7rem' }}>
              {chosenRing
                ? chosenRing.estate
                  ? 'Every station pooled. The estate closes furthest of all — what one station missed, another caught.'
                  : `${chosenRing.label}. The open arc is a count, not a list: Chao1 says how many are still out there, never which.`
                : 'Touch any ring.'}
            </p>
          </div>
        )}

        {/*
          The ring list. Every row is the same reading as the ring it names, and
          touching either selects both — the figure is legible on a wall from
          across the room, and the list is what makes it legible from arm's
          length, where the inner rings are only a couple of centimetres apart.
        */}
        {id === 'unseen' && data && (
          <aside className="inst-panel inst-panel--right inst-rise inst-ringlist">
            <p className="inst-label" style={{ marginBottom: '0.7rem' }}>
              Counted
            </p>
            {rings.map((ring) => (
              <button
                key={ring.id}
                className="inst-ring-row"
                data-active={unseenSelected === ring.id}
                data-estate={ring.estate}
                onClick={() => {
                  touch();
                  setUnseenSelected((current) => (current === ring.id ? null : ring.id));
                }}
              >
                <span className="inst-ring-name">{ring.label}</span>
                <span className="inst-ring-bar">
                  <span style={{ transform: `scaleX(${ring.completeness})` }} />
                </span>
                <span className="inst-ring-value">{Math.round(ring.completeness * 100)}%</span>
              </button>
            ))}
          </aside>
        )}

        {id === 'year' && data && (
          <div className="inst-corner inst-corner--bl">
            <p className="inst-label" style={{ marginBottom: '0.6rem' }}>
              Dawn chorus
            </p>
            <p className="inst-figure">{data.narrative.dawnChorus.meanSpecies.toFixed(1)}</p>
            <p className="inst-mono">
              SPECIES PER MORNING · {data.narrative.dawnChorus.mornings} MORNINGS
            </p>
            <p className="inst-body" style={{ marginTop: '1rem', maxWidth: '32ch' }}>
              {data.narrative.dawnChorus.verdict}
            </p>
            {focusMonth !== null && (
              <p className="inst-mono" style={{ marginTop: '0.8rem', color: PALETTE.foil }}>
                {MONTHS[focusMonth].toUpperCase()} SELECTED
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  if (error) {
    return (
      <div className="inst-root" style={{ display: 'grid', placeItems: 'center' }}>
        <p className="inst-body">Could not load the survey data: {error}</p>
      </div>
    );
  }

  const lensMeta = LENSES.find((l) => l.id === lens) ?? LENSES[0];
  const chosenRing = rings.find((ring) => ring.id === unseenSelected) ?? null;

  /**
   * The share of the estate that is not farmed and not built, straight from the
   * published land-cover split rather than from one minus the agricultural
   * share — the four classes are measured separately and need not sum to 1.
   */
  const notInProduction = data
    ? data.narrative.landCover
        .filter((entry) => entry.label !== 'Agricultural' && entry.label !== 'Built')
        .reduce((sum, entry) => sum + entry.share, 0) * 100
    : 0;

  return (
    <div className="inst-root inst-cursor-visible" onPointerDown={touch}>
      {data && (
        <Stage
          className="inst-canvas"
          cameraPosition={chapter.camera}
          bloomStrength={0.95}
          bloomRadius={0.75}
          bloomThreshold={0.12}
          swell={transition.crossing ? Math.sin(transition.t * Math.PI) : 0}
        >
          {/*
            Choosing a station swoops the camera from the plan view down to an
            oblique over that station — the "come and look at this ground"
            gesture. The look-at sits a little east of the mark so the station
            lands left of centre, clear of the detail panel on the right; the
            CameraRig's own easing makes both the descent and the return one
            continuous move.
          */}
          <CameraRig
            position={
              chapter.id === 'estate' && estateFocus
                ? [estateFocus[0] + 1.3, estateFocus[1] + 5.2, estateFocus[2] + 5.6]
                : chapter.camera
            }
            lookAt={
              chapter.id === 'estate' && estateFocus
                ? [estateFocus[0] + 1.3, estateFocus[1], estateFocus[2]]
                : chapter.lookAt
            }
            subjectAspect={chapter.subjectAspect}
            maxPull={chapter.maxPull}
            /*
              Fast enough that the camera lands with the dissolve rather than
              still gliding a second after the new chapter is fully lit — which
              was what made the old transition read as a cut followed by a drift.
            */
            speed={1.15}
            dissolve={transition.crossing ? Math.sin(transition.t * Math.PI) : 0}
          />

          {/*
            Both chapters are on stage during a dissolve. The outgoing one keeps
            rendering at a falling `reveal` but stops accepting touches, so a
            fading scene cannot steal a tap meant for the arriving one.
          */}
          <ChapterFrame reveal={transition.reveal}>
            {renderScene(transition.current, transition.reveal, true)}
          </ChapterFrame>
          {transition.previous !== null && (
            <ChapterFrame reveal={transition.fade} leaving>
              {renderScene(transition.previous, transition.fade, false)}
            </ChapterFrame>
          )}
        </Stage>
      )}

      {/* ------------------------------------------------------------ text */}
      <div className="inst-layer">
        {transition.previous !== null &&
          chapterOverlay(transition.previous, transition.fade, false)}
        {chapterOverlay(transition.current, transition.reveal, true)}

        {/* ----------------------------------------------------- detail panel */}
        {site && (
          <aside className="inst-panel inst-panel--right inst-rise" key={site.id}>
            <p className="inst-subtitle">{site.id}</p>
            <h2 className="inst-display" style={{ fontSize: '2rem', margin: '0.5rem 0 0.2rem' }}>
              {site.label}
            </h2>
            <p className="inst-mono">
              {(HABITAT_LABELS[site.habitat] ?? site.habitat).toUpperCase()} ·{' '}
              {TYPOLOGY_LABELS[site.typology]?.toUpperCase()}
            </p>
            <div className="inst-rule" />
            <p className="inst-body" style={{ fontSize: '0.86rem' }}>{site.note}</p>
            <div className="inst-rule" />
            <dl style={{ margin: 0 }}>
              <div className="inst-stat-row">
                <dt>Species</dt>
                <dd>{site.richness}</dd>
              </div>
              <div className="inst-stat-row">
                <dt>Detections</dt>
                <dd>{formatNumber(site.detections)}</dd>
              </div>
              <div className="inst-stat-row">
                <dt>Shannon H′</dt>
                <dd>{site.shannon.toFixed(2)}</dd>
              </div>
              <div className="inst-stat-row">
                <dt>After dark</dt>
                <dd>{(site.nightRatio * 100).toFixed(0)}%</dd>
              </div>
              <div className="inst-stat-row">
                <dt>Still undiscovered</dt>
                <dd>≈{Math.max(0, Math.round(site.chao1 - site.richness))}</dd>
              </div>
            </dl>
            <div className="inst-rule" />
            <p className="inst-label" style={{ marginBottom: '0.5rem' }}>
              Most recorded here
            </p>
            {siteSpecies.map((species) => (
              <div className="inst-species-line" key={species.sci}>
                <i
                  className="inst-swatch"
                  style={{ color: GUILD_COLORS[species.guild] ?? PALETTE.foil }}
                />
                <span style={{ fontSize: '0.86rem' }}>{species.name}</span>
                <span className="inst-mono" style={{ marginLeft: 'auto' }}>
                  {formatNumber(species.sites[site.id] ?? 0)}
                </span>
              </div>
            ))}
          </aside>
        )}

        {selectedSpecies && (
          <aside className="inst-panel inst-panel--right inst-rise" key={selectedSpecies.sci}>
            <p className="inst-subtitle" style={{ color: GUILD_COLORS[selectedSpecies.guild] }}>
              {GUILD_LABELS[selectedSpecies.guild] ?? selectedSpecies.guild}
            </p>
            <h2 className="inst-display" style={{ fontSize: '2.1rem', margin: '0.5rem 0 0.1rem' }}>
              {selectedSpecies.name}
            </h2>
            <p className="inst-sci" style={{ fontSize: '1.05rem' }}>{selectedSpecies.sci}</p>
            {selectedSpecies.alt && <p className="inst-mono">{selectedSpecies.alt.toUpperCase()}</p>}

            {selectedSpecies.status && (
              <p style={{ marginTop: '0.9rem' }}>
                <span className="inst-status" data-level={selectedSpecies.status}>
                  IUCN {selectedSpecies.status}
                </span>
              </p>
            )}
            {selectedSpecies.note && (
              <>
                <div className="inst-rule" />
                <p className="inst-body" style={{ fontSize: '0.86rem' }}>{selectedSpecies.note}</p>
              </>
            )}

            {/*
              The voice, seen. This is the master bus after the limiter, so it is
              exactly the sound in the room — and it is a synthesis, not a
              recording, which the caption under it says every time.
            */}
            <div className="inst-rule" />
            <p className="inst-label" style={{ marginBottom: '0.5rem' }}>
              Its voice
            </p>
            <Spectrogram active={chapter.id === 'choir'} height={78} />
            {/*
              The axes, stated. Without them the strip is a texture — nobody can
              tell whether the bright band low down is a drone or a whistle. The
              provenance line stays whole above it: it is the more important of
              the two sentences and must not be shortened to make room.
            */}
            <p className="inst-mono" style={{ marginTop: '0.4rem' }}>
              SYNTHESISED FROM THIS SPECIES&rsquo; OWN MEASURES — NOT A RECORDING
            </p>
            <p className="inst-mono" style={{ marginTop: '0.2rem', opacity: 0.5 }}>
              {SPECTROGRAM_AXES.toUpperCase()}
            </p>

            <div className="inst-rule" />
            <dl style={{ margin: 0 }}>
              <div className="inst-stat-row">
                <dt>Detections</dt>
                <dd>{formatNumber(selectedSpecies.total)}</dd>
              </div>
              <div className="inst-stat-row">
                <dt>Stations</dt>
                <dd>{selectedSpecies.siteCount} of {data?.meta.stations ?? 12}</dd>
              </div>
              <div className="inst-stat-row">
                <dt>Busiest hour</dt>
                <dd>{String(selectedSpecies.peakHour).padStart(2, '0')}:00</dd>
              </div>
              <div className="inst-stat-row">
                <dt>Peak month</dt>
                <dd>{MONTHS[selectedSpecies.peakMonth - 1]}</dd>
              </div>
              <div className="inst-stat-row">
                <dt>After dark</dt>
                <dd>{(selectedSpecies.nightRatio * 100).toFixed(0)}%</dd>
              </div>
            </dl>

            {/* The animal's own 24-hour rhythm, drawn from its detections. */}
            <div className="inst-rule" />
            <p className="inst-label" style={{ marginBottom: '0.6rem' }}>
              Its day
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 46 }}>
              {selectedSpecies.hourly.map((value, hour) => {
                const peak = Math.max(...selectedSpecies.hourly, 1);
                return (
                  <div
                    key={hour}
                    title={`${hour}:00 — ${value}`}
                    style={{
                      flex: 1,
                      height: `${Math.max(3, (value / peak) * 100)}%`,
                      background:
                        hour === selectedSpecies.peakHour
                          ? PALETTE.candle
                          : GUILD_COLORS[selectedSpecies.guild] ?? PALETTE.foil,
                      opacity: hour === selectedSpecies.peakHour ? 1 : 0.45,
                    }}
                  />
                );
              })}
            </div>
            <p className="inst-mono" style={{ marginTop: '0.5rem' }}>
              00:00 — 23:00
            </p>

            {/*
              And its year. Together with the daily rhythm above this is the
              whole portrait: a nightjar peaks at dusk in June and is simply
              absent in January, and both facts are visible at a glance.
            */}
            <p className="inst-label" style={{ margin: '1.1rem 0 0.6rem' }}>
              Its year
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 42 }}>
              {selectedSpecies.monthly.map((value, month) => {
                const peak = Math.max(...selectedSpecies.monthly, 1);
                const isPeak = month === selectedSpecies.peakMonth - 1;
                return (
                  <div
                    key={month}
                    title={`${MONTHS[month]} — ${value}`}
                    style={{
                      flex: 1,
                      height: `${Math.max(3, (value / peak) * 100)}%`,
                      background: isPeak
                        ? PALETTE.candle
                        : GUILD_COLORS[selectedSpecies.guild] ?? PALETTE.foil,
                      opacity: isPeak ? 1 : 0.42,
                    }}
                  />
                );
              })}
            </div>
            {/*
              JAN and DEC anchor the axis; the peak month is named over its own
              bar, not spaced evenly between them. Laid out with space-between it
              read as a three-point scale, so a species peaking in February was
              labelled FEB at the middle of the year — the axis contradicting the
              bar directly above it.
            */}
            <div
              className="inst-mono"
              style={{ position: 'relative', marginTop: '0.4rem', height: '1.1em' }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  color: selectedSpecies.peakMonth === 1 ? PALETTE.candle : undefined,
                }}
              >
                JAN
              </span>
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  color: selectedSpecies.peakMonth === 12 ? PALETTE.candle : undefined,
                }}
              >
                DEC
              </span>
              {/*
                A January or December peak is already named by its anchor — drawn
                again it would land on top of it. Lighting the anchor instead
                keeps one label per month at either end of the axis.
              */}
              {selectedSpecies.peakMonth > 1 && selectedSpecies.peakMonth < 12 && (
                <span
                  style={{
                    position: 'absolute',
                    // Centre of the peak bar: twelve equal columns, so the n-th
                    // sits at (n - 0.5)/12 of the width.
                    left: `${((selectedSpecies.peakMonth - 0.5) / 12) * 100}%`,
                    transform: 'translateX(-50%)',
                    color: PALETTE.candle,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {MONTHS[selectedSpecies.peakMonth - 1].toUpperCase()}
                </span>
              )}
            </div>

            {/* Where it was actually recorded. */}
            <div className="inst-rule" />
            <p className="inst-label" style={{ marginBottom: '0.5rem' }}>
              Where
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {Object.entries(selectedSpecies.sites)
                .sort((a, b) => b[1] - a[1])
                .map(([siteId, count]) => (
                  <span
                    key={siteId}
                    className="inst-mono"
                    style={{
                      padding: '0.2rem 0.45rem',
                      border: `1px solid ${GUILD_COLORS[selectedSpecies.guild] ?? PALETTE.foil}44`,
                      color: PALETTE.parchment,
                    }}
                  >
                    {siteId} · {formatNumber(count)}
                  </span>
                ))}
            </div>
          </aside>
        )}

        {/* ------------------------------------------------------ site totals */}
        {data && !site && !selectedSpecies && (
          <div className="inst-corner inst-corner--tr inst-pass inst-fade">
            <p className="inst-label">Recorded in one year</p>
            <p className="inst-figure">{data.meta.totalSpecies}</p>
            <p className="inst-mono">SPECIES</p>
            <div className="inst-rule" />
            {/*
              One item per line on the kiosk, one wrapping row on a phone —
              driven by flex direction rather than <br>, so collapsing the block
              never runs the values together.
            */}
            <p className="inst-mono inst-statline">
              <span>{formatNumber(data.meta.totalDetections)} DETECTIONS</span>
              <span>
                {data.meta.stations} STATIONS · {data.meta.surveyDays} DAYS
              </span>
              <span>SHANNON H′ {data.meta.shannon.toFixed(2)}</span>
            </p>
          </div>
        )}

        {/* ------------------------------------------------------ navigation */}
        <nav className="inst-nav">
          {CHAPTERS.map((entry, i) => (
            <button
              key={entry.id}
              className="inst-nav-item"
              data-active={i === chapterIndex}
              onClick={() => {
                touch();
                setChapterIndex(i);
                setSelectedSite(null);
                setSelectedSpecies(null);
              }}
            >
              {entry.label}
              {i === chapterIndex && attract && (
                <span className="inst-nav-progress">
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
              )}
            </button>
          ))}
        </nav>

        {attract && started && (
          <div className="inst-prompt inst-pass inst-breathe">
            <div className="inst-prompt-ring" />
            Touch to explore
          </div>
        )}

        {/* Hidden while a detail panel is open — they share the right edge. */}
        {!site && !selectedSpecies && (
          <div className="inst-corner inst-corner--br inst-pass">
            <p className="inst-mono" style={{ lineHeight: 1.9 }}>
              {data?.narrative.credits.survey.toUpperCase() ?? 'EVERY1COUNTS'} ·{' '}
              {data?.meta.surveyStart} — {data?.meta.surveyEnd}
            </p>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- dossier */}
      {data && (
        <Dossier
          open={dossier === 'refuge'}
          onClose={() => setDossier(null)}
          title="What the estate does"
          standfirst="the programme, in its own units"
        >
          <p>
            {formatNumber(data.narrative.estate.dripIrrigationHectares)} ha are drip-irrigated,
            at {Math.round(data.narrative.estate.waterSavingLow * 100)}–
            {Math.round(data.narrative.estate.waterSavingHigh * 100)}% less water than the
            method it replaced. {formatNumber(data.narrative.estate.organicConversionHectares)} ha
            are converting to organic. Phytosanitary treatments are down{' '}
            {Math.round(data.narrative.estate.phytosanitaryReduction * 100)}%, and{' '}
            {notInProduction.toFixed(1)}% of the estate is not in production at all.
          </p>
          <p>
            The row carries two scales, and the break in the skyline is where one ends and the
            other begins. Three stages are shares of the estate and can stand against a common
            axis. Two are hectare figures, and the estate&rsquo;s total area is not published
            anywhere in this survey — so there is no honest conversion between them. Those two
            stand open-topped: a capital asserts a position on an axis, and they have none.
          </p>
          <p>
            The living community inside every column is the same community. This is one year of
            recording with no before-and-after, so nothing here says a practice caused what is
            living in it — only that both are true of the same estate at the same time. The
            mote density is deliberately uniform across the stages for that reason.
          </p>
          <p>
            In the colonnade, each column carries both surveys at once: the shaft stands at
            whichever instrument found more effective species, and the cool collar cut into it
            marks where the other put the same ground. Cameras and recorders disagree because
            they are answering different questions, and the gap between the two marks is that
            disagreement.
          </p>
          <p>
            The threads between the tiers are relations the data actually states, and all of
            them are composition or address, never cause. &ldquo;Land kept&rdquo; is tied to the
            kept grounds because they are the same hectares named twice; the four worked stages
            are tied to the vineyard because that is where drip lines, treatments and conversion
            physically happen; and every ground is tied to the three pillars because it is part
            of the estate they assess. A thread says &ldquo;these touch&rdquo; — with one year
            of recording and no before-and-after, it cannot and does not say &ldquo;this caused
            that&rdquo;.
          </p>
        </Dossier>
      )}

      {data && (
        <Dossier
          open={dossier === 'estate'}
          onClose={() => setDossier(null)}
          title="The ground under the marks"
          standfirst="sources, and what is measured versus drawn"
        >
          <p>
            The relief is a 72×72 grid of SRTM 30 m elevation over the estate&rsquo;s bounding
            box — real altitude, from about −4 m on the Dniester floodplain to 164 m on the
            southern ridge. Height is exaggerated threefold, which is ordinary practice for a
            relief model and is what makes the ravine and the river terrace read at all under a
            near-plan camera. Shape is honest; gradients are not, and no slope is quoted in
            degrees anywhere in this piece.
          </p>
          <p>
            The parcels, the woods, the tracks, the streams, the ponds and the château are
            OpenStreetMap geometry, projected to metres about the estate origin. Of 539 mapped
            buildings only the château complex is drawn: every shed in the village at the same
            emphasis was noise pretending to be information. The ring around the house encloses
            whichever substantial buildings sit within 250 m of OSM&rsquo;s own winery node, so
            nothing is placed by hand.
          </p>
          <p>
            The twelve stations stand at their true relative positions. Their brightness and size
            follow measured hourly detection profiles, each read against its own daily peak — so
            a quiet station still shows its own rhythm rather than staying dark all day. The sun
            moves on a real arc through the looping day; the colour of the hours is a rendering
            choice, the activity underneath it is not.
          </p>
          <p>
            Elevation: SRTM 30 m via opentopodata.org. Map data © OpenStreetMap contributors,
            ODbL. Survey: {data.narrative.credits.survey}, {data.meta.surveyStart} —{' '}
            {data.meta.surveyEnd}.
          </p>
        </Dossier>
      )}

      {/* ------------------------------------------------------------- gate */}
      {!started && (
        <div className="inst-gate">
          <div>
            <p className="inst-subtitle inst-rise">Château Purcari · 1827</p>
            <h1
              className="inst-title inst-rise inst-delay-1"
              style={{ margin: '1.4rem 0 1.8rem' }}
            >
              Terroir vivant
            </h1>
            <p className="inst-lede inst-rise inst-delay-2" style={{ margin: '0 auto 2.8rem' }}>
              The estate reads its soil to find the wine.
              <br />
              This reads the same soil to find everything else living on it.
            </p>
            <button className="inst-rise inst-delay-3" onClick={() => void begin()}>
              Enter
            </button>
            {/*
              The colophon. A piece that spends five chapters insisting on the
              difference between what was counted and what was estimated cannot
              then put two generated animals on screen without saying so, and the
              place to say it is before the visitor starts rather than in a
              footnote they will never reach.
            */}
            <p
              className="inst-mono inst-rise inst-delay-4"
              style={{ margin: '2.6rem auto 0', maxWidth: '38rem', opacity: 0.45 }}
            >
              {GLYPH_CREDIT} {VIGNETTE_SOURCE}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
