import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The detail a chapter owes but should not be shouting.
 *
 * Every chapter had accumulated a paragraph in its corner — hectares, ranges,
 * method notes, the caveats this piece refuses to leave out. All of it is true
 * and some of it matters a great deal, but a wall reads a headline and a shape,
 * not four lines of 0.86rem prose, and the prose was crowding the thing the
 * visitor actually came to look at.
 *
 * So it moves in here, one keystroke away. The chapter keeps its figure and one
 * line of caption; anyone who wants the working opens it. Nothing is deleted —
 * that would be the wrong fix for a piece whose whole argument is that the
 * numbers are honest.
 *
 * Deliberately a panel and not a tooltip: this is reading matter, it needs
 * width, scrolling and a close button a thumb can hit.
 */

export interface DossierProps {
  title: string;
  /** A short line under the title — what this drawer is about. */
  standfirst?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Dossier({ title, standfirst, open, onClose, children }: DossierProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Escape closes, and focus lands on the close button — a kiosk still has a
    // keyboard behind the panel, and a drawer that traps a visitor is worse
    // than one that never opened.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="inst-dossier-scrim"
      onPointerDown={(event) => {
        // Only a press on the scrim itself closes; a press that began inside
        // the panel and drifted out while scrolling must not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="inst-dossier"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="inst-dossier-head">
          <div>
            <p className="inst-label">In detail</p>
            <h2 className="inst-display inst-dossier-title">{title}</h2>
            {standfirst && <p className="inst-mono">{standfirst.toUpperCase()}</p>}
          </div>
          <button ref={closeRef} className="inst-dossier-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="inst-dossier-body">{children}</div>
      </aside>
    </div>
  );
}
