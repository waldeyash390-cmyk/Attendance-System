import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="page">
      <h1>Page not found</h1>
      <p className="muted">The page you were looking for doesn't exist.</p>
      <p><Link to="/">Back to dashboard</Link></p>
    </section>
  );
}
