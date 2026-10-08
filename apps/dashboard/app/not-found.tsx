import Link from 'next/link';

export default function NotFound(): JSX.Element {
  return (
    <div className="container" style={{ paddingTop: 64, textAlign: 'center' }}>
      <h1>404</h1>
      <p className="muted">That page does not exist.</p>
      <Link className="btn" href="/">
        Back home
      </Link>
    </div>
  );
}
