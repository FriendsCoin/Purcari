interface SparklineProps {
  /** Values already normalised to 0..1. */
  values: number[];
  /** Index to highlight, if any. */
  active?: number;
  label?: string;
}

/**
 * The 24-hour (or 17-day) activity profile that sits under the readout. Drawn as
 * bars rather than a line: the data is counts per bucket, and at this size a line
 * would imply a continuity the recordings do not have.
 */
export function Sparkline({ values, active, label }: SparklineProps): JSX.Element | null {
  if (values.length === 0) return null;

  const width = 100;
  const height = 26;
  const gap = 0.22;
  const slot = width / values.length;
  const barWidth = Math.max(0.6, slot - gap);

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height + 2}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? 'Profil d’activité'}
    >
      <line className="spark__axis" x1={0} y1={height + 0.5} x2={width} y2={height + 0.5} />
      {values.map((value, index) => {
        // Floor at a hairline so empty buckets stay visible as part of the shape.
        const h = Math.max(0.5, value * height);
        return (
          <rect
            key={index}
            className={active === undefined || active === index ? 'spark__bar' : 'spark__bar spark__bar--muted'}
            x={index * slot}
            y={height - h}
            width={barWidth}
            height={h}
          />
        );
      })}
    </svg>
  );
}
