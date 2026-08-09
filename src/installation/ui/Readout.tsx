import type { Readout as ReadoutData } from '../engine/Scene';
import { Sparkline } from './Sparkline';

interface ReadoutProps {
  data: ReadoutData;
  /** Called when a visitor picks one of the chapter's configurations. */
  onMode?: (id: string) => void;
}

/**
 * The text half of the piece: what the visitor is looking at, in the same order
 * every time — label, name, sentence, numbers, rhythm. Keeping the slots fixed
 * means a visitor who reads one chapter can read the rest without relearning it.
 */
export function Readout({ data, onMode }: ReadoutProps): JSX.Element {
  return (
    <div className="readout" style={data.accent ? ({ '--accent': data.accent } as React.CSSProperties) : undefined}>
      {data.eyebrow && <p className="readout__eyebrow">{data.eyebrow}</p>}
      {data.title && <h1 className="readout__title">{data.title}</h1>}
      {data.body && <p className="readout__body">{data.body}</p>}

      {/* The chapter's other configurations. Kept above the numbers, and
          visible on a phone even with the sheet closed: it is an instrument,
          not a footnote. */}
      {data.modes && data.modes.length > 0 && (
        <div className="readout__modes">
          {data.modes.map(mode => (
            <button
              key={mode.id}
              type="button"
              className={mode.active ? 'readout__mode readout__mode--active' : 'readout__mode'}
              aria-pressed={mode.active}
              onPointerDown={() => onMode?.(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}

      {data.stats && data.stats.length > 0 && (
        <dl className="readout__stats">
          {data.stats.map(stat => (
            <div className="readout__stat" key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {data.spark && <Sparkline values={data.spark} />}
    </div>
  );
}
