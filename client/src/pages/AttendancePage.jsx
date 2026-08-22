import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import FaceCapture from '../components/FaceCapture';
import { markAttendance, getSessionAttendance, getStudentAttendance } from '../api/attendance';
import { lookupStudent } from '../api/auth';
import { api, extractError } from '../api/client';

function StudentView({ user }) {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions', { params: { openOnly: true } });
      setSessions(data.sessions || []);
    } catch (err) {
      setError(extractError(err, 'Failed to load sessions'));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await getStudentAttendance(user.id);
      setHistory(data);
    } catch (err) {
      setError(extractError(err, 'Failed to load attendance history'));
    }
  }, [user.id]);

  useEffect(() => {
    loadSessions();
    loadHistory();
  }, [loadSessions, loadHistory]);

  const handleCapture = useCallback(async (payload) => {
    setMessage('');
    setError('');
    if (!selectedSession) {
      setError('Select a session first.');
      return;
    }

    let descriptor;
    let livenessPassed = false;
    if (payload && typeof payload === 'object' && Array.isArray(payload.descriptor)) {
      descriptor = payload.descriptor;
      livenessPassed = payload.livenessPassed === true;
    } else if (Array.isArray(payload)) {
      descriptor = payload;
    } else {
      setError('Invalid face capture payload.');
      return;
    }

    try {
      const result = await markAttendance({
        sessionId: selectedSession,
        descriptor,
        livenessPassed,
      });
      const confPct = (result.match && result.match.confidence != null)
        ? Math.round(result.match.confidence * 100) + '%'
        : 'n/a';
      setMessage('Attendance marked. Match confidence: ' + confPct);
      await loadHistory();
    } catch (err) {
      setError(extractError(err, 'Failed to mark attendance'));
    }
  }, [selectedSession, loadHistory]);

  return (
    <>
      <div className="card">
        <div className="card-header"><h2>Mark attendance</h2></div>
        <label>
          <span>Open session</span>
          <select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}>
            <option value="">Select a session...</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.subjectId} - {new Date(s.startAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        <FaceCapture
          onCapture={handleCapture}
          buttonLabel="Scan and mark attendance"
          busyLabel="Verifying liveness..."
          requireLiveness
        />
      </div>

      <div className="card">
        <div className="card-header"><h2>Your attendance history</h2></div>
        {history && history.stats && (
          <p>
            Attendance: <strong>{history.stats.attendancePercentage}%</strong>
            {' '}({history.stats.sessionsAttended}/{history.stats.totalPastSessions} sessions)
          </p>
        )}
        {history && history.history && history.history.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Subject</th><th>Session</th><th>Date</th><th>Confidence</th></tr>
              </thead>
              <tbody>
                {history.history.map((r) => (
                  <tr key={r.id}>
                    <td>{r.subject ? r.subject.code : '-'}</td>
                    <td>{r.sessionTitle || '-'}</td>
                    <td>{new Date(r.markedAt).toLocaleString()}</td>
                    <td>{r.confidence != null ? Math.round(r.confidence * 100) + '%' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No attendance records yet.</p>
        )}
      </div>
    </>
  );
}

function ManualMark({ selectedSession, onMarked }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLookup = useCallback(async () => {
    setError('');
    setMessage('');
    setFound(null);
    if (!query.trim()) {
      setError('Enter a student email or roll number.');
      return;
    }
    setBusy(true);
    try {
      const isEmail = query.includes('@');
      const data = await lookupStudent(isEmail ? { email: query.trim() } : { rollNumber: query.trim() });
      setFound(data.user);
    } catch (err) {
      setError(extractError(err, 'Student not found'));
    } finally {
      setBusy(false);
    }
  }, [query]);

  const handleMark = useCallback(async () => {
    if (!selectedSession) {
      setError('Select a session above first.');
      return;
    }
    if (!found) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/attendance/mark-manual', {
        sessionId: selectedSession,
        studentId: found.id,
        status: 'present',
      });
      setMessage(`Marked ${found.fullName} present.`);
      setFound(null);
      setQuery('');
      if (onMarked) onMarked();
    } catch (err) {
      setError(extractError(err, 'Failed to mark attendance'));
    } finally {
      setBusy(false);
    }
  }, [selectedSession, found, onMarked]);

  return (
    <div className="card">
      <div className="card-header"><h2>Manual override</h2></div>
      <p className="muted">If face scan fails, look up a student by email or roll number and mark them present directly.</p>

      <div className="inline-filter">
        <input
          type="text"
          placeholder="Student email or roll number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={handleLookup} disabled={busy}>
          Look up
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {found && (
        <div className="alert success" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>{found.fullName} ({found.rollNumber || found.email})</span>
          <button type="button" onClick={handleMark} disabled={busy}>Mark present</button>
        </div>
      )}
    </div>
  );
}

function TeacherView() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [attendance, setAttendance] = useState(null);
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.get('/sessions');
      setSessions(data.sessions || []);
    } catch (err) {
      setError(extractError(err, 'Failed to load sessions'));
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadAttendance = useCallback(async () => {
    if (!selectedSession) return;
    try {
      const data = await getSessionAttendance(selectedSession);
      setAttendance(data);
    } catch (err) {
      setError(extractError(err, 'Failed to load attendance'));
    }
  }, [selectedSession]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  return (
    <>
      <div className="card">
        <div className="card-header"><h2>Session attendance</h2></div>
        <div className="inline-filter">
          <label>
            <span>Session</span>
            <select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}>
              <option value="">Select a session...</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.subjectId} - {new Date(s.startAt).toLocaleString()} ({s.isOpen ? 'OPEN' : 'CLOSED'})
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-secondary" onClick={loadAttendance}>Refresh</button>
        </div>

        {error && <div className="alert error">{error}</div>}

        {attendance && (
          <>
            <p className="muted">
              {attendance.records ? attendance.records.length : 0} student(s) marked present.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Student</th><th>Roll no</th><th>Marked at</th><th>Method</th></tr>
                </thead>
                <tbody>
                  {(attendance.records || []).map((r) => (
                    <tr key={r.id || r.studentId}>
                      <td>{r.student ? r.student.fullName : r.studentId}</td>
                      <td>{r.student ? r.student.rollNumber : '-'}</td>
                      <td>{new Date(r.markedAt || r.createdAt).toLocaleString()}</td>
                      <td>{r.method || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {selectedSession && <ManualMark selectedSession={selectedSession} onMarked={loadAttendance} />}
    </>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();

  return (
    <section className="page">
      <div className="page-header"><h1>Attendance</h1></div>
      {user && user.role === 'teacher' ? <TeacherView /> : <StudentView user={user} />}
    </section>
  );
}