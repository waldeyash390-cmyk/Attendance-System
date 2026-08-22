import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { listSubjects } from '../api/subjects';
import {
  getSubjectAnalytics,
  downloadSubjectAnalyticsCsv,
} from '../api/analytics';

const DEFAULT_THRESHOLD = 75;

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function formatDateInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function percentClass(percentage, threshold) {
  if (percentage >= threshold) return 'pct-good';
  if (percentage >= threshold - 10) return 'pct-warn';
  return 'pct-bad';
}

export default function AnalyticsPage() {
  const { user } = useAuth();

  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState('');
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  // Load subjects on mount.
  useEffect(() => {
    let cancelled = false;
    listSubjects()
      .then((list) => {
        if (cancelled) return;
        setSubjects(list);
        if (list.length && !subjectId) setSubjectId(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load subjects');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAnalytics = useCallback(async () => {
    if (!subjectId) return;
    setLoading(true);
    setError('');
    try {
      const fromIso = from ? new Date(from + 'T00:00:00').toISOString() : undefined;
      const toIso = to ? new Date(to + 'T23:59:59').toISOString() : undefined;
      const result = await getSubjectAnalytics({
        subjectId,
        threshold,
        from: fromIso,
        to: toIso,
      });
      setData(result);
    } catch (err) {
      setData(null);
      setError(
        err && err.response && err.response.data && err.response.data.error
          ? err.response.data.error
          : err.message || 'Failed to load analytics',
      );
    } finally {
      setLoading(false);
    }
  }, [subjectId, threshold, from, to]);

  // Auto-refresh when subject/threshold/date change.
  useEffect(() => {
    if (!subjectId) return;
    fetchAnalytics();
  }, [subjectId, threshold, from, to, fetchAnalytics]);

  const handleExport = useCallback(async () => {
    if (!subjectId) return;
    setExporting(true);
    setError('');
    try {
      const fromIso = from ? new Date(from + 'T00:00:00').toISOString() : undefined;
      const toIso = to ? new Date(to + 'T23:59:59').toISOString() : undefined;
      const subj = subjects.find((s) => s.id === subjectId);
      const code = subj ? subj.code : subjectId;
      const filename = `attendance_${code.replace(/[^a-z0-9-_]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
      await downloadSubjectAnalyticsCsv({
        subjectId,
        threshold,
        from: fromIso,
        to: toIso,
        filename,
      });
    } catch (err) {
      setError(
        err && err.response && err.response.data && err.response.data.error
          ? err.response.data.error
          : err.message || 'Failed to export CSV',
      );
    } finally {
      setExporting(false);
    }
  }, [subjectId, threshold, from, to, subjects]);

  const defaulters = data ? data.summary.defaulters : [];
  const students = data ? data.students : [];

  const subject = useMemo(
    () => subjects.find((s) => s.id === subjectId) || (data && data.subject) || null,
    [subjects, subjectId, data],
  );

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="muted">
            Attendance percentage per subject and defaulter list (below the
            configured threshold).
          </p>
        </div>
      </header>

      <div className="card">
        <div className="card-header">
          <h2>Filters</h2>
          <div className="card-header-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleExport}
              disabled={!subjectId || exporting || loading}
            >
              {exporting ? 'Preparing CSV...' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>Subject</span>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={subjects.length === 0}
            >
              {subjects.length === 0 ? (
                <option value="">No subjects yet</option>
              ) : (
                <>
                  <option value="">Select a subject...</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>

          <label>
            <span>Defaulter threshold (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value === '' ? DEFAULT_THRESHOLD : Number(e.target.value))}
            />
          </label>

          <label>
            <span>From (optional)</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label>
            <span>To (optional)</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {loading && !data && (
        <div className="card"><p className="muted">Loading analytics...</p></div>
      )}

      {data && subject && (
        <>
          <div className="card">
            <div className="card-header">
              <h2>
                {subject.code} - {subject.name}
              </h2>
              <div className="muted small">
                {data.range.from ? `From ${formatDateTime(data.range.from)}` : 'All time'}
                {' · '}
                {data.range.to ? `To ${formatDateTime(data.range.to)}` : 'Now'}
              </div>
            </div>
            <div className="analytics-summary">
              <div className="stat">
                <div className="num">{data.sessionsHeld}</div>
                <div className="label">Sessions held</div>
              </div>
              <div className="stat">
                <div className="num">{data.summary.studentCount}</div>
                <div className="label">Students in roster</div>
              </div>
              <div className="stat">
                <div className={`num ${percentClass(data.summary.classAttendancePercentage, threshold)}`}>
                  {data.summary.classAttendancePercentage.toFixed(1)}%
                </div>
                <div className="label">Class attendance</div>
              </div>
              <div className="stat">
                <div className={`num ${data.summary.defaulterCount > 0 ? 'pct-bad' : 'pct-good'}`}>
                  {data.summary.defaulterCount}
                </div>
                <div className="label">Defaulters (&lt; {threshold}%)</div>
              </div>
            </div>
          </div>

          {defaulters.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2>Defaulter list ({defaulters.length})</h2>
                <div className="muted small">
                  Students below {threshold}% attendance (excused excluded)
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Roll number</th>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Attended</th>
                      <th>Absent</th>
                      <th>Excused</th>
                      <th>Missed</th>
                      <th>Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {defaulters.map((s) => (
                      <tr key={s.id} className="row-defaulter">
                        <td>{s.rollNumber || '-'}</td>
                        <td>
                          <strong>{s.fullName}</strong>
                          {s.department && <div className="muted small">{s.department}</div>}
                        </td>
                        <td>{s.email}</td>
                        <td>{s.attended}</td>
                        <td>{s.absent}</td>
                        <td>{s.excused}</td>
                        <td>{s.missed}</td>
                        <td>
                          <span className={percentClass(s.percentage, threshold)}>
                            {s.percentage.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h2>All students ({students.length})</h2>
              <div className="muted small">
                Sorted alphabetically. Excused absences are excluded from the
                percentage denominator.
              </div>
            </div>
            {students.length === 0 ? (
              <p className="muted">No students in this subject yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Roll number</th>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Present</th>
                      <th>Late</th>
                      <th>Excused</th>
                      <th>Absent</th>
                      <th>Missed</th>
                      <th>Attended</th>
                      <th>Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id} className={s.percentage < threshold && s.sessionsHeld > 0 ? 'row-defaulter' : ''}>
                        <td>{s.rollNumber || '-'}</td>
                        <td>
                          <strong>{s.fullName}</strong>
                          {s.department && <div className="muted small">{s.department}</div>}
                        </td>
                        <td>{s.email}</td>
                        <td>{s.present}</td>
                        <td>{s.late}</td>
                        <td>{s.excused}</td>
                        <td>{s.absent}</td>
                        <td>{s.missed}</td>
                        <td>{s.attended}</td>
                        <td>
                          {s.sessionsHeld === 0 ? (
                            <span className="muted">-</span>
                          ) : (
                            <span className={percentClass(s.percentage, threshold)}>
                              {s.percentage.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="muted small">
            Logged in as <strong>{user ? user.fullName : ''}</strong>
            {' · '}
            Sessions with <code>end_at &lt; NOW()</code> are counted as held.
            {' · '}
            Excused absences do not count toward the attendance percentage.
            {' · '}
            Sessions before the selected "From" date or after "To" are
            excluded.
            {' · '}
            <Link to="/sessions">Manage sessions</Link>
          </p>
        </>
      )}
    </section>
  );
}
