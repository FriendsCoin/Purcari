import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InstallationData, Species } from '../core/types';
import { loadInstallationData } from '../core/data';
import { GUILD_COLORS, PALETTE } from '../core/palette';
import { soundField } from '../core/audio';
import { useSensorBus } from '../sensors/useSensorBus';
import { Stage, CameraRig } from '../gl/Stage';
import { PresenceField } from '../gl/PresenceField';
import '../ui/installation.css';

/**
 * PRESENCE — the outdoor installation.
 *
 * A projection or weatherised LED wall with a camera and a microphone watching
 * the space in front of it. The whole piece is one sentence: *stand still, and
 * the wild comes back*.
 *
 * Nothing here is a metaphor. The animals on screen are the animals the survey
 * actually recorded at this hour of this day; the order in which they return is
 * ordered by how rare and how nocturnal they really are; and the number that
 * counts up in the corner is a real species count out of a real total.
 */

/** The five states the piece moves through, and the text each one shows. */
const STAGES = [
  {
    at: 0,
    title: 'Something is moving here.',
    body: 'Wild animals leave before you ever see them. Right now, almost everything that lives on this estate is somewhere else.',
    color: PALETTE.garnet,
  },
  {
    at: 6,
    title: 'Be still.',
    body: 'The boldest animals are the first to test a quiet place. The pheasant, the hare — they have learned to live beside us.',
    color: PALETTE.wine,
  },
  {
    at: 18,
    title: 'They are coming back.',
    body: 'Each light is one animal that Château Purcari recorded at this hour of the day, across a year of listening.',
    color: PALETTE.brandBronze,
  },
  {
    at: 36,
    title: 'The wary ones now.',
    body: 'The badger. The wildcat. The golden jackal. These return only where they are not followed.',
    color: PALETTE.gold,
  },
  {
    at: 55,
    title: 'This is the whole chorus.',
    body: 'You are seeing what this land holds when nothing disturbs it. It took you one minute of stillness. It takes the estate all year.',
    color: PALETTE.candle,
  },
];

function stageFor(stillnessSeconds: number) {
  let current = STAGES[0];
  for (const stage of STAGES) if (stillnessSeconds >= stage.at) current = stage;
  return current;
}

function formatClock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function OutdoorApp() {
  const [data, setData] = useState<InstallationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);

  // `simulate` lets the piece run convincingly on a bench with no sensors, and
  // is what the gallery sees if a camera is unplugged mid-exhibition.
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const forceSimulate = params.get('simulate') === '1';

  const bus = useSensorBus({ simulate: forceSimulate || !started });

  const [present, setPresent] = useState(0);
  const [total, setTotal] = useState(0);
  const [recent, setRecent] = useState<Species[]>([]);
  const recentRef = useRef<Species[]>([]);

  useEffect(() => {
    loadInstallationData().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  // Diagnostics panel for the installer: hold D, or append ?diag=1.
  useEffect(() => {
    if (params.get('diag') === '1') setDiagnostics(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'd' || e.key === 'D') setDiagnostics((v) => !v);
      if (e.key === 'f' || e.key === 'F') void document.documentElement.requestFullscreen?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [params]);

  const handlePresence = useCallback(
    (count: number, totalSpecies: number, newest: Species | null) => {
      setPresent(count);
      setTotal(totalSpecies);
      if (newest) {
        // Keep a short ticker of who just arrived — it is the piece's caption.
        const next = [newest, ...recentRef.current.filter((s) => s.sci !== newest.sci)].slice(0, 5);
        recentRef.current = next;
        setRecent(next);
      }
    },
    [],
  );

  const begin = useCallback(async () => {
    setStarted(true);
    try {
      await soundField.start();
      if (data) soundField.startDrone(data.meta.shannon);
    } catch {
      // Audio is an enhancement here, never a requirement.
    }
    void bus.enableCamera();
    void bus.enableMicrophone();
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, [bus, data]);

  const stillness = bus.readout.stillnessSeconds;
  const stage = stageFor(stillness);
  const fraction = total > 0 ? present / total : 0;

  if (error) {
    return (
      <div className="inst-root" style={{ display: 'grid', placeItems: 'center' }}>
        <p className="inst-body">Could not load the survey data: {error}</p>
      </div>
    );
  }

  return (
    <div className="inst-root inst-outdoor inst-cursor-visible">
      {data && (
        <Stage
          className="inst-canvas"
          cameraPosition={[0, 4.2, 13]}
          cameraFov={52}
          bloomStrength={1.15}
          bloomRadius={0.85}
          bloomThreshold={0.1}
          grain={0.035}
          vignette={1.25}
        >
          {/*
            Low subject aspect on purpose: the field surrounds the viewer, so on
            a narrow screen it should stay close and dense and let the sides
            crop, rather than retreating until it reads as a distant band.
          */}
          <CameraRig
            position={[0, 4.2, 13]}
            lookAt={[0, 1.6, 0]}
            subjectAspect={0.55}
            speed={0.4}
          />
          <PresenceField data={data} sensors={bus.state} onPresenceChange={handlePresence} />
        </Stage>
      )}

      {/* -------------------------------------------------- the running count */}
      <div className="inst-layer inst-pass">
        <div className="inst-corner inst-corner--tl inst-fade">
          <p className="inst-label">Species present · awake now</p>
          <p className="inst-figure" style={{ color: stage.color }}>
            {present}
            <span style={{ fontSize: '0.32em', color: PALETTE.ash, marginLeft: '0.4em' }}>
              / {total}
            </span>
          </p>
          <div className="inst-meter" style={{ width: 'clamp(160px, 18vw, 300px)' }}>
            <span style={{ transform: `scaleX(${fraction})` }} />
          </div>
        </div>

        <div className="inst-corner inst-corner--tr inst-fade">
          <p className="inst-label">Estate time</p>
          <p
            className="inst-mono"
            style={{ fontSize: '1.5rem', color: PALETTE.candle, margin: 0 }}
          >
            {formatClock(bus.readout.clockHour)}
          </p>
          <p className="inst-mono" style={{ margin: '0.35rem 0 0' }}>
            {bus.simulated ? 'demonstration cycle' : 'live'}
          </p>
        </div>

        {/* ---------------------------------------------------- the invitation */}
        <div className="inst-hint">
          <h1 className="inst-hint-title" style={{ color: stage.color }}>
            {stage.title}
          </h1>
          <p className="inst-body" style={{ margin: '0 auto' }}>
            {stage.body}
          </p>

          {/* Stillness meter — the visitor's own held breath, made visible. */}
          <div
            style={{
              margin: '1.8rem auto 0',
              width: 'clamp(220px, 30vw, 520px)',
            }}
          >
            <div className="inst-meter" style={{ height: 3 }}>
              <span style={{ transform: `scaleX(${Math.min(1, stillness / 60)})` }} />
            </div>
            <p className="inst-mono" style={{ marginTop: '0.7rem', letterSpacing: '0.24em' }}>
              {stillness < 1
                ? 'DISTURBED'
                : `STILL FOR ${stillness.toFixed(0)}S`}
            </p>
          </div>
        </div>

        {/* ------------------------------------------------------- who arrived */}
        <div className="inst-corner inst-corner--bl">
          <p className="inst-label" style={{ marginBottom: '0.7rem' }}>
            Returning
          </p>
          {recent.map((species, i) => (
            <div
              key={species.sci}
              className="inst-species-line"
              style={{ opacity: 1 - i * 0.17 }}
            >
              <i
                className="inst-swatch"
                style={{ color: GUILD_COLORS[species.guild] ?? PALETTE.foil }}
              />
              <span style={{ fontSize: '0.95rem' }}>{species.name}</span>
              {species.status && (
                <span className="inst-status" data-level={species.status}>
                  {species.status}
                </span>
              )}
            </div>
          ))}
          {recent.length === 0 && (
            <p className="inst-mono">waiting for quiet…</p>
          )}
        </div>

        <div className="inst-corner inst-corner--br">
          <p className="inst-mono">
            CHÂTEAU PURCARI · ȘTEFAN VODĂ
            <br />
            {data?.meta.surveyDays ?? 365} DAYS · {data?.meta.stations ?? 12} STATIONS
            <br />
            {data?.meta.totalSpecies ?? 213} SPECIES RECORDED
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------- gate */}
      {!started && (
        <div className="inst-gate">
          <div>
            <p className="inst-subtitle inst-rise">Château Purcari</p>
            <h1 className="inst-title inst-rise inst-delay-1" style={{ margin: '1.2rem 0 1.6rem' }}>
              Presence
            </h1>
            <p
              className="inst-lede inst-rise inst-delay-2"
              style={{ margin: '0 auto 2.6rem' }}
            >
              A year of wildlife, listening back.
            </p>
            <button className="inst-rise inst-delay-3" onClick={() => void begin()}>
              Begin
            </button>
            <p className="inst-mono inst-fade inst-delay-4" style={{ marginTop: '1.8rem' }}>
              uses the camera and microphone to sense movement and sound.
              <br />
              nothing is recorded, stored or transmitted.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ diagnostics */}
      {diagnostics && (
        <div className="inst-diag">
          {`PURCARI · PRESENCE · installer view
camera      ${bus.sources.camera ? 'LIVE' : bus.errors.camera ?? 'off'}
microphone  ${bus.sources.microphone ? 'LIVE' : bus.errors.microphone ?? 'off'}
serial      ${bus.serialSupported ? (bus.sources.serial ? 'LIVE' : bus.errors.serial ?? 'off') : 'unsupported'}
mode        ${bus.simulated ? 'SIMULATED' : 'sensor-driven'}

presence    ${bus.readout.presence.toFixed(3)}
disturbance ${bus.readout.disturbance.toFixed(3)}
stillness   ${bus.readout.stillnessSeconds.toFixed(1)}s
loudness    ${bus.readout.loudness.toFixed(3)}
clock       ${formatClock(bus.readout.clockHour)}
temp/wind   ${bus.readout.temperature?.toFixed(1) ?? '--'}C / ${bus.readout.wind?.toFixed(1) ?? '--'}m/s
species     ${present}/${total}`}
          <div>
            <button onClick={() => void bus.enableCamera()}>camera</button>
            <button onClick={() => void bus.enableMicrophone()}>mic</button>
            {bus.serialSupported && (
              <button onClick={() => void bus.enableSerial()}>serial</button>
            )}
            <button onClick={() => setDiagnostics(false)}>close</button>
          </div>
        </div>
      )}
    </div>
  );
}
