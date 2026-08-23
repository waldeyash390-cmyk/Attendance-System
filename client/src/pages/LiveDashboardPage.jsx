import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../api/sessions';
import {
  getSessionAttendance,
  getSessionAttempts,
  markManual,
  updateAttendance,
} from '../api/attendance';
import { listUsers } from '../api/users';
import { api, extractError } from '../api/client';
import { formatCoords } from '../lib/geo';

const POLL_INTERVAL_MS = 4000;

// Threshold for flagging a student as "Suspicious" on the Location checks
// table based on the existing rejected_location attempts for this session.
// This is purely a presentation/visibility layer — it does not alter how
// attempts are logged or how analytics are computed server-side.
const SUSPICIOUS_REJECTED_THRESHOLD = 10;

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'excused', label: 'Excused' },
];

function StatusBadge({ status }) {
  const cls = `badge badge-${status || 'closed'}`;
  const label = (status ? status[0].toUpperCase() + status.slice(1) : 'Unknown');
  return <span className={cls}>{label}</span>;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export default function LiveDashboardPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();

  const [session, setSession] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [attempts, setAttempts] = useState(null);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [busyStudentId, setBusyStudentId] = useState(null);

  const pollRef = useRef(null);
  const tickRef = useRef(null);

  const loadSession = useCallback(async () => {
    try {
      const s = await getSession(sessionId);
      setSession(s);
    } catch (err) {
      setError(extractError(err, 'Failed to load session'));
    }
  }, [sessionId]);

  const loadStudents = useCallback(async () => {
    try {
      const list = await listUsers({ role: 'student', activeOnly: true });
      setStudents(list);
    } catch (err) {
      setError(extractError(err, 'Failed to load students'));
    }
  }, []);

  const loadAttendance = useCallback(async () => {
    try {
      const data = await getSessionAttendance(sessionId);
      setAttendance(data);
      setLastUpdate(new Date());
      setError('');
    } catch (err) {
      setError(extractError(err, 'Failed to load attendance'));
    }
  }, [sessionId]);

  const loadAttempts = useCallback(async () => {
    try {
      const data = await getSessionAttempts(sessionId);
      setAttempts(data);
    } catch (err) {
      // Non-fatal: the attempt log is a live extra, don't break the page.
      setAttempts(null);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSession(), loadStudents(), loadAttendance(), loadAttempts()]).finally(() =>
      setLoading(false),
    );
  }, [loadSession, loadStudents, loadAttendance, loadAttempts]);

  useEffect(() => {
    function startPolling() {
      stopPolling();
      pollRef.current = setInterval(() => {
        if (!paused) {
          loadAttendance();
          loadAttempts();
        }
      }, POLL_INTERVAL_MS);
      tickRef.current = setInterval(() => {
        setLastUpdate((prev) => prev ? new Date(prev) : prev);
      }, 1000);
    }
    function stopPolling() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    }
    startPolling();
    return stopPolling;
  }, [paused, loadAttendance, loadAttempts]);

  const summary = attendance ? attendance.summary : null;
  const recordsByStudent = useMemo(() => {
    const m = new Map();
    (attendance ? attendance.records : []).forEach((r) => m.set(r.studentId, r));
    return m;
  }, [attendance]);

  const markedStudents = useMemo(() => {
    if (!students.length) return [];
    return students
      .map((s) => ({ student: s, record: recordsByStudent.get(s.id) }))
      .filter((x) => x.record);
  }, [students, recordsByStudent]);

  const unmarkedStudents = useMemo(() => {
    if (!students.length) return [];
    return students
      .filter((s) => !recordsByStudent.has(s.id));
  }, [students, recordsByStudent]);

  const sinceSeconds = lastUpdate
    ? Math.max(0, Math.floor((Date.now() - lastUpdate.getTime()) / 1000))
    : null;

  // Derived from the existing attempts log: how many rejected_location
  // attempts each student has on this session. Threshold ≥
  // SUSPICIOUS_REJECTED_THRESHOLD marks them as suspicious for the UI.
  const rejectedCounts = useMemo(() => {
    const m = new Map();
    if (!attempts || !Array.isArray(attempts.attempts)) return m;
    for (const a of attempts.attempts) {
      if (a.status !== 'rejected_location') continue;
      const id = a.studentId;
      m.set(id, (m.get(id) || 0) + 1);
    }
    return m;
  }, [attempts]);

  const suspiciousStudents = useMemo(() => {
    if (!attempts || !Array.isArray(attempts.attempts)) return [];
    const byId = new Map();
    for (const a of attempts.attempts) {
      if (a.status !== 'rejected_location') continue;
      const count = rejectedCounts.get(a.studentId) || 0;
      if (count < SUSPICIOUS_REJECTED_THRESHOLD) continue;
      if (byId.has(a.studentId)) continue;
      byId.set(a.studentId, {
        studentId: a.studentId,
        studentName: a.studentName,
        rollNumber: a.rollNumber,
        count,
      });
    }
    return Array.from(byId.values()).sort((a, b) => b.count - a.count);
  }, [attempts, rejectedCounts]);

  async function handleSetStatus(studentId, status) {
    setBusyStudentId(studentId);
    setError('');
    setInfo('');
    try {
      await updateAttendance({ sessionId, studentId, status, method: 'manual' });
      setInfo(`Marked ${status}.`);
      await loadAttendance();
    } catch (err) {
      setError(extractError(err, 'Failed to update attendance'));
    } finally {
      setBusyStudentId(null);
    }
  }

  async function handleAddStudent(studentId) {
    setBusyStudentId(studentId);
    setError('');
    setInfo('');
    try {
      await markManual({ sessionId, studentId, status: 'present' });
      setInfo('Marked present.');
      await loadAttendance();
    } catch (err) {
      setError(extractError(err, 'Failed to mark attendance'));
    } finally {
      setBusyStudentId(null);
    }
  }

  if (loading && !session) {
    return (
      <section className="page">
        <div className="page-center">Loading live dashboard...</div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="page">
        <div className="card">
          <p className="muted">Session not found.</p>
          <Link to="/sessions" className="btn-secondary" style={{ display: 'inline-block', marginTop: 8 }}>Back to sessions</Link>
        </div>
      </section>
    );
  }

  const sessionEnded = session.endAt && new Date(session.endAt) < new Date();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Live dashboard</h1>
          <p className="muted">
            {session.subject ? `${session.subject.code} - ${session.subject.name}` : 'Session'}
            {' · '}
            {session.title || 'Untitled session'}
            {' · '}
            {formatDateTime(session.startAt)}
            {' · '}
            {session.location || 'No location'}
          </p>
          {session.campusLat != null && session.campusLng != null && (
            <p className="muted small">
              Session location: <strong>{formatCoords(session.campusLat, session.campusLng)}</strong>
              {' · '}Radius: <strong>{session.radiusMeters || 100} m</strong>
            </p>
          )}
        </div>
        <div className="live-controls">
          {paused ? (
            <span className="badge badge-closed">Polling paused</span>
          ) : (
            <span className="badge badge-open">
              <span className="live-pulse" />
              Live
            </span>
          )}
          <button type="button" className="btn-secondary" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume polling' : 'Pause polling'}
          </button>
          <button type="button" className="btn-secondary" onClick={loadAttendance} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh now'}
          </button>
          <Link to="/sessions" className="btn-secondary">All sessions</Link>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}

      <div className="card">
        <div className="card-header">
          <h2>Summary</h2>
          <div className="muted small">
            {sinceSeconds != null ? `Last refresh: ${sinceSeconds}s ago` : 'Loading...'}
            {' · '}
            {students.length} student{students.length === 1 ? '' : 's'} in roster
          </div>
        </div>
        <div className="live-summary">
          <div className="stat"><div className="num">{summary ? summary.present : 0}</div><div className="label">Present</div></div>
          <div className="stat"><div className="num">{summary ? summary.late : 0}</div><div className="label">Late</div></div>
          <div className="stat"><div className="num">{summary ? summary.absent : 0}</div><div className="label">Absent</div></div>
          <div className="stat"><div className="num">{summary ? summary.excused : 0}</div><div className="label">Excused</div></div>
          <div className="stat"><div className="num">{summary ? summary.total : 0}</div><div className="label">Marked</div></div>
          <div className="stat">
            <div className="num">
              {students.length ? Math.round(((summary ? summary.present : 0) + (summary ? summary.late : 0)) / students.length * 100) : 0}%
            </div>
            <div className="label">Attendance</div>
          </div>
        </div>
        {sessionEnded && (
          <p className="muted small">This session has ended; you can still update statuses below.</p>
        )}
        {!session.isOpen && !sessionEnded && (
          <p className="muted small">Session is closed. Marking is restricted to the assigned teacher/admin and status changes are still allowed.</p>
        )}
      </div>

      <div className="live-grid">
        <div className="card">
          <div className="card-header">
            <h2>Present ({markedStudents.length})</h2>
          </div>
          {markedStudents.length === 0 ? (
            <p className="muted">No one has been marked yet. As students scan their face, they will appear here.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Roll no</th>
                    <th>Status</th>
                    <th>Method</th>
                    <th>Marked at</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {markedStudents.map(({ student, record }) => (
                    <tr key={student.id}>
                      <td>
                        <strong>{student.fullName}</strong>
                        <div className="muted small">{student.email}</div>
                      </td>
                      <td>{student.rollNumber || '-'}</td>
                      <td><StatusBadge status={record.status} /></td>
                      <td>{record.method || '-'}</td>
                      <td>{formatDateTime(record.markedAt || record.createdAt)}</td>
                      <td>
                        <div className="status-actions">
                          {STATUS_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className={record.status === opt.value ? 'active' : ''}
                              disabled={busyStudentId === student.id}
                              onClick={() => handleSetStatus(student.id, opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Not yet marked ({unmarkedStudents.length})</h2>
          </div>
          {unmarkedStudents.length === 0 ? (
            <p className="muted">All enrolled students have a record for this session.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Roll no</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unmarkedStudents.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.fullName}</strong>
                        <div className="muted small">{s.email}</div>
                      </td>
                      <td>{s.rollNumber || '-'}</td>
                      <td>
                        <div className="status-actions">
                          {STATUS_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={busyStudentId === s.id}
                              onClick={() => handleSetStatus(s.id, opt.value)}
                              title={`Mark ${opt.label}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Location checks ({attempts ? attempts.summary.total : 0})</h2>
          <span className="muted small">
            {attempts ? `${attempts.summary.accepted} accepted · ${attempts.summary.rejected} rejected` : 'Loading...'}
          </span>
        </div>
        {suspiciousStudents.length > 0 && (
          <div className="geo-summary-line" role="alert">
            <span className="geo-summary-icon" aria-hidden="true">⚠</span>
            <span>
              {suspiciousStudents.length === 1
                ? '1 student has 10+ failed location attempts on this session:'
                : `${suspiciousStudents.length} students have 10+ failed location attempts on this session:`}
            </span>
            <ul>
              {suspiciousStudents.map((s) => (
                <li key={s.studentId}>
                  {s.studentName}{' '}
                  <span className="muted">
                    ({s.count} attempts{s.rollNumber ? ` · ${s.rollNumber}` : ''})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!attempts || attempts.attempts.length === 0 ? (
          <p className="muted">No location-checked marking attempts yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                  <th className="num">Distance</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {attempts.attempts.map((a) => {
                  const rejected = a.status === 'rejected_location';
                  const rejectedCount = rejected ? (rejectedCounts.get(a.studentId) || 0) : 0;
                  const suspicious = rejectedCount >= SUSPICIOUS_REJECTED_THRESHOLD;
                  const rowCls = suspicious
                    ? 'attempt-rejected attempt-suspicious'
                    : (rejected ? 'attempt-rejected' : '');
                  return (
                    <tr key={a.id} className={rowCls}>
                      <td>
                        <strong>{a.studentName}</strong>
                        {a.rollNumber && <div className="muted small">{a.rollNumber}</div>}
                      </td>
                      <td>
                        {suspicious ? (
                          <span
                            className="badge badge-suspicious"
                            title={`${rejectedCount} rejected attempts on this session`}
                          >
                            ⚠ Repeated attempts ({rejectedCount})
                          </span>
                        ) : (
                          <span className={`badge ${rejected ? 'badge-absent' : 'badge-present'}`}>
                            {rejected ? 'Rejected (outside area)' : 'Accepted'}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {a.distance == null ? '-' : `${Math.round(a.distance)} m`}
                        {a.accuracy != null && (
                          <div className="muted small">±{Math.round(a.accuracy)} m accuracy</div>
                        )}
                      </td>
                      <td>{formatDateTime(a.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="muted small">
        Logged in as <strong>{user ? user.fullName : ''}</strong> ({user ? user.role : ''}).
        {' '}The dashboard polls every {POLL_INTERVAL_MS / 1000}s; pause polling if you don't want updates.
      </p>
    </section>
  );
}
