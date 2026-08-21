import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../api/sessions';
import {
  getSessionAttendance,
  markManual,
  updateAttendance,
} from '../api/attendance';
import { listUsers } from '../api/users';
import { api, extractError } from '../api/client';

const POLL_INTERVAL_MS = 4000;

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

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSession(), loadStudents(), loadAttendance()]).finally(() =>
      setLoading(false),
    );
  }, [loadSession, loadStudents, loadAttendance]);

  useEffect(() => {
    function startPolling() {
      stopPolling();
      pollRef.current = setInterval(() => {
        if (!paused) {
          loadAttendance();
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
  }, [paused, loadAttendance]);

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

      <p className="muted small">
        Logged in as <strong>{user ? user.fullName : ''}</strong> ({user ? user.role : ''}).
        {' '}The dashboard polls every {POLL_INTERVAL_MS / 1000}s; pause polling if you don't want updates.
      </p>
    </section>
  );
}
