interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string | null;
}

export function StatCard({ label, value, detail }: StatCardProps): JSX.Element {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail ? <div className="stat-detail">{detail}</div> : null}
    </div>
  );
}
