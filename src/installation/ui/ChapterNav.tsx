import type { ChapterId } from '../engine/Scene';
import { CHAPTERS } from './chapters';

interface ChapterNavProps {
  active: ChapterId;
  onSelect: (id: ChapterId) => void;
}

export function ChapterNav({ active, onSelect }: ChapterNavProps): JSX.Element {
  return (
    <nav className="chapters" aria-label="Chapitres">
      {CHAPTERS.map(chapter => {
        const isActive = chapter.id === active;
        return (
          <button
            key={chapter.id}
            type="button"
            className={isActive ? 'chapter chapter--active' : 'chapter'}
            aria-current={isActive ? 'true' : undefined}
            // Fires on press rather than click: on a panel with any input lag,
            // waiting for the full tap makes the interface feel unresponsive.
            onPointerDown={() => onSelect(chapter.id)}
          >
            <span className="chapter__numeral">{chapter.numeral}</span>
            <span className="chapter__name">{chapter.name}</span>
            <span className="chapter__rule" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
