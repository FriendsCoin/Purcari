import { useEffect, useState } from 'react';
import IndoorApp from '../indoor/IndoorApp';
import OutdoorApp from '../outdoor/OutdoorApp';
import { loadInstallationData } from '../core/data';
import type { InstallationData } from '../core/types';
import '../ui/installation.css';
import './pocket.css';

/**
 * The pocket edition — both installations in one page, for viewing on a phone.
 *
 * This is not a third artwork. It is the same two pieces, with a chooser in
 * front so a single link reaches both, and with the honest caveats a handset
 * needs: the indoor piece was composed for a touch panel two metres wide, and
 * the outdoor piece expects a dark field rather than a lit room. Both are
 * genuinely usable here — a phone has the camera and microphone the outdoor
 * piece actually wants.
 */

type Piece = 'menu' | 'indoor' | 'outdoor';

export default function PocketApp() {
  const [piece, setPiece] = useState<Piece>('menu');
  const [data, setData] = useState<InstallationData | null>(null);

  useEffect(() => {
    loadInstallationData().then(setData).catch(() => undefined);
  }, []);

  // Browser back should leave the piece rather than the page.
  useEffect(() => {
    if (piece === 'menu') return;
    window.history.pushState({ piece }, '');
    const onPop = () => setPiece('menu');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [piece]);

  if (piece === 'indoor') return <PieceFrame onBack={() => setPiece('menu')}><IndoorApp /></PieceFrame>;
  if (piece === 'outdoor') return <PieceFrame onBack={() => setPiece('menu')}><OutdoorApp /></PieceFrame>;

  const meta = data?.meta;

  return (
    <div className="pocket">
      <header className="pocket-head">
        <p className="inst-subtitle inst-rise">Château Purcari · Ștefan Vodă</p>
        <h1 className="inst-title inst-rise inst-delay-1">
          Terroir
          <br />
          vivant
        </h1>
        <p className="inst-lede inst-rise inst-delay-2">
          The estate reads its soil to find the wine. These two pieces read the
          same soil to find everything else living on it.
        </p>
      </header>

      {meta && (
        <dl className="pocket-facts inst-rise inst-delay-2">
          <div>
            <dt>Species</dt>
            <dd>{meta.totalSpecies}</dd>
          </div>
          <div>
            <dt>Detections</dt>
            <dd>{meta.totalDetections.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>Stations</dt>
            <dd>{meta.stations}</dd>
          </div>
          <div>
            <dt>Days</dt>
            <dd>{meta.surveyDays}</dd>
          </div>
        </dl>
      )}

      <nav className="pocket-choices">
        <button className="pocket-card inst-rise inst-delay-3" onClick={() => setPiece('indoor')}>
          <span className="pocket-card-eyebrow">Inside the château</span>
          <span className="pocket-card-title">Terroir vivant</span>
          <span className="pocket-card-body">
            Three chapters on a touchscreen. The estate seen by its mammals, then
            by its birds; a year wound into one disc; every species at once.
          </span>
          <span className="pocket-card-note">Built for a wall-sized panel — scaled down here.</span>
        </button>

        <button className="pocket-card inst-rise inst-delay-4" onClick={() => setPiece('outdoor')}>
          <span className="pocket-card-eyebrow">Outdoors, with sensors</span>
          <span className="pocket-card-title">Presence</span>
          <span className="pocket-card-body">
            Stand still and the wild comes back. Your camera and microphone sense
            movement and noise; the animals scatter, then return in the order the
            data says they should.
          </span>
          <span className="pocket-card-note">
            Works properly on a phone. Best in a quiet, dark place, with sound on.
          </span>
        </button>
      </nav>

      <footer className="pocket-foot">
        <p className="inst-mono">
          Survey: Every1Counts, {meta?.surveyStart} — {meta?.surveyEnd}. Birds
          identified by BirdNET.
        </p>
        <p className="inst-mono">
          No recordings were made. Every voice you hear is synthesised from that
          species&rsquo; own measurements.
        </p>
      </footer>
    </div>
  );
}

function PieceFrame({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <>
      {children}
      <button className="pocket-back" onClick={onBack} aria-label="Back to both pieces">
        ←
      </button>
    </>
  );
}
