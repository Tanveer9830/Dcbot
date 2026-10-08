'use client';

export default function ErrorBoundary({ error }: { error: Error }): JSX.Element {
  return (
    <div className="container" style={{ paddingTop: 64 }}>
      <div className="card">
        <h1>Something went wrong</h1>
        <p className="muted">
          The dashboard hit an unexpected error. No sensitive details are rendered here; check the server logs.
        </p>
        <div className="alert alert-error">{error.name}</div>
        <a className="btn" href="/dashboard">
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
