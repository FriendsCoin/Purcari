import type { Readout as ReadoutData } from '../engine/Scene';
import { Sparkline } from './Sparkline';

interface ReadoutProps {
  data: ReadoutData;
}

/**
 * The text half of the piece: what the visitor is looking at, in the same order
 * every time — label, name, sentence, numbers, rhythm. Keeping the slots fixed
 * means a visitor who reads one chapter can read the rest without relearning it.
 */
export function Readout({ data }: ReadoutProps): JSX.Element {
  return (
    <div className="readout" style={data.accent ? ({ '--accent': data.accent } as React.CSSProperties) : undefined}>
      {data.eyebrow && <p className="readout__eyebrow">{data.eyebrow}</p>}
      {data.title && <h1 className="readout__title">{data.title}</h1>}
      {data.body && <p className="readout__body">{data.body}</p>}

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
