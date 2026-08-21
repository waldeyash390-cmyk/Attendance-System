import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/health')
      .then((r) => setHealth(r.data))
      .catch((e) => setError((e && e.message) || 'Health check failed'));
  }, []);

  return (
    <section className="page">
      <h1>Welcome, {user ? user.fullName : 'there'}</h1>
      <p className="muted">
        Signed in as <strong>{user ? user.role : 'unknown'}</strong>
        {user && user.rollNumber ? <> &middot; Roll {user.rollNumber}</> : null}
        {user && user.department ? <> &middot; {user.department}</> : null}
      </p>

      <div className="card">
        <h2>Backend status</h2>
        {error && <div className="alert error">{error}</div>}
        {health ? (
          <ul className="kv">
            <li><span>Service</span><strong>{health.service}</strong></li>
            <li><span>Status</span><strong>{health.status}</strong></li>
            <li><span>DB</span><strong>{health.db && health.db.ok ? 'ok' : 'unreachable'}</strong></li>
            <li><span>Time</span><strong>{new Date((health.time || '').replace('Z', '')).toLocaleString()}</strong></li>
          </ul>
        ) : !error ? <p>Loading…</p> : null}
      </div>

      <div className="card">
        <h2>Next steps</h2>
        <ul>
          <li>Teachers: create subjects and sessions, then take attendance.</li>
          <li>Students: enroll your face, then mark attendance during an open session.</li>
        </ul>
        <p className="muted small">
          These screens will be added in upcoming steps. The shell, login and role-based navigation are working.
        </p>
      </div>
    </section>
  );
}
