interface SparklineProps {
  points: Array<{ day: string; count: number }>;
  label?: string;
}

/**
 * Dependency-free SVG bar chart.
 *
 * Renders only real data points. An empty series renders the "no data" text
 * instead of a fabricated line.
 */
export function Sparkline({ points, label }: SparklineProps): JSX.Element {
  if (points.length === 0) {
    return <div className="empty">No recorded events in this period.</div>;
  }
  const max = Math.max(1, ...points.map((point) => point.count));
  const width = 100 / points.length;
  return (
    <div>
      {label ? <div className="stat-label">{label}</div> : null}
      <svg
        className="sparkline"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        role="img"
        aria-label={label ?? 'chart'}
      >
        {points.map((point, index) => {
          const height = (point.count / max) * 34;
          return (
            <rect
              key={point.day}
              x={index * width + width * 0.15}
              y={38 - height}
              width={width * 0.7}
              height={Math.max(1, height)}
              fill="var(--brand)"
              rx="1"
            >
              <title>{`${point.day}: ${point.count}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
