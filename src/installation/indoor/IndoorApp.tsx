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
import { soundField } from '../core/audio';
import { Stage, CameraRig } from '../gl/Stage';
import { Constellation, type Lens } from '../gl/Constellation';
import { Chronogram } from '../gl/Chronogram';
import { Choir } from '../gl/Choir';
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

type ChapterId = 'estate' | 'year' | 'choir';

interface Chapter {
  id: ChapterId;
  label: string;
  title: string;
  lede: string;
  /** Seconds the attract loop dwells here. */
  dwell: number;
  camera: [number, number, number];
  lookAt: [number, number, number];
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
  },
  {
    id: 'year',
    label: 'The Year',
    title: 'A year,\nhour by hour',
    lede: 'Every detection the estate recorded, wound into a single disc: twelve months around, twenty-four hours outward. The bright band hugging the sunrise line is the dawn chorus.',
    dwell: 34,
    camera: [0, 11.5, 9],
    lookAt: [0, 0, 0],
  },
  {
    id: 'choir',
    label: 'The Choir',
    title: 'Two hundred\nand thirteen',
    lede: 'Every species recorded in a year. The common at the centre, the rare at the edges, the nocturnal sinking below. Touch any one of them.',
    dwell: 40,
    camera: [0, 2.5, 17],
    lookAt: [0, 0, 0],
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

  const idleTimer = useRef<number | null>(null);
  const chapter = CHAPTERS[chapterIndex];

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

  if (error) {
    return (
      <div className="inst-root" style={{ display: 'grid', placeItems: 'center' }}>
        <p className="inst-body">Could not load the survey data: {error}</p>
      </div>
    );
  }

  const lensMeta = LENSES.find((l) => l.id === lens) ?? LENSES[0];

  return (
    <div className="inst-root inst-cursor-visible" onPointerDown={touch}>
      {data && (
        <Stage
          className="inst-canvas"
          cameraPosition={chapter.camera}
          bloomStrength={0.95}
          bloomRadius={0.75}
          bloomThreshold={0.12}
        >
          <CameraRig position={chapter.camera} lookAt={chapter.lookAt} speed={0.5} />

          {chapter.id === 'estate' && (
            <Constellation
              data={data}
              reveal={1}
              lens={lens}
              selectedSite={selectedSite}
              onSelectSite={handleSelectSite}
            />
          )}

          {chapter.id === 'year' && (
            <Chronogram
              data={data}
              reveal={1}
              modality="both"
              focusMonth={focusMonth}
              onSelectMonth={(month) => {
                touch();
                setFocusMonth((current) => (current === month ? null : month));
              }}
            />
          )}

          {chapter.id === 'choir' && (
            <Choir
              data={data}
              reveal={1}
              cluster={clusterGuilds ? 1 : 0}
              hour={12}
              selected={selectedSpecies}
              onSelect={handleSelectSpecies}
            />
          )}
        </Stage>
      )}

      {/* ------------------------------------------------------------ text */}
      <div className="inst-layer">
        <div className="inst-corner inst-corner--tl inst-pass" key={chapter.id}>
          <p className="inst-subtitle inst-rise">{chapter.label}</p>
          <h1
            className="inst-title inst-rise inst-delay-1"
            style={{ margin: '1rem 0 1.4rem', whiteSpace: 'pre-line' }}
          >
            {chapter.title}
          </h1>
          <p className="inst-lede inst-rise inst-delay-2">{chapter.lede}</p>
        </div>

        {/* ------------------------------------------------ chapter controls */}
        {chapter.id === 'estate' && (
          <div
            className="inst-corner inst-corner--bl"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
          >
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
          </div>
        )}

        {chapter.id === 'choir' && data && (
          <div className="inst-corner inst-corner--bl">
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
          </div>
        )}

        {chapter.id === 'year' && data && (
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
          </aside>
        )}

        {/* ------------------------------------------------------ site totals */}
        {data && !site && !selectedSpecies && (
          <div className="inst-corner inst-corner--tr inst-pass inst-fade">
            <p className="inst-label">Recorded in one year</p>
            <p className="inst-figure">{data.meta.totalSpecies}</p>
            <p className="inst-mono">SPECIES</p>
            <div className="inst-rule" />
            <p className="inst-mono" style={{ lineHeight: 2 }}>
              {formatNumber(data.meta.totalDetections)} DETECTIONS
              <br />
              {data.meta.stations} STATIONS · {data.meta.surveyDays} DAYS
              <br />
              SHANNON H′ {data.meta.shannon.toFixed(2)}
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
          </div>
        </div>
      )}
    </div>
  );
}
