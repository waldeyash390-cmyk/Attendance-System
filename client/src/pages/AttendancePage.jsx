import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import FaceCapture from '../components/FaceCapture';
import { markAttendance, getSessionAttendance, getStudentAttendance } from '../api/attendance';
import { lookupStudent } from '../api/auth';
import { listSubjects } from '../api/subjects';
import { getCurrentPosition, haversineDistanceMeters } from '../lib/geo';
import { api, extractError } from '../api/client';

function formatShortDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function sessionLabel(subject, session) {
  const subjectPart = subject ? `[${subject.code}] ` : '';
  const titlePart = session.title || (subject ? subject.name : 'Session');
  return `${subjectPart}${titlePart} - ${formatShortDateTime(session.startAt)}`;
}

// Prominent in/out-of-campus status banner shown to students right after a
// location check (and before/during marking attendance). Visibility is the
// whole point — this is intentionally large and unmistakable, distinct
// from the small inline `.alert` used for follow-up messages.
function GeoStatusBanner({ status }) {
  if (!status) return null;
  const inside = status.kind === 'in';
  const distance = status.distanceMeters;
  const cls = inside ? 'geo-banner geo-banner-in' : 'geo-banner geo-banner-out';
  return (
    <div className={cls} role={inside ? 'status' : 'alert'} aria-live="polite">
      <div className="geo-banner-icon" aria-hidden="true">
        {inside ? '✓' : '✕'}
      </div>
      <div className="geo-banner-body">
        <div className="geo-banner-title">
          {inside ? 'You are IN CAMPUS' : 'You are OUT OF CAMPUS'}
        </div>
        <div className="geo-banner-sub">
          {inside ? (
            <>
              You are inside the session radius
              {distance != null ? ` (${Math.round(distance)} m from the session location)` : ''}.
              You can proceed to mark attendance.
            </>
          ) : (
            <>
              {distance != null && `${Math.round(distance)} m away from the session location. `}
              Attendance was <strong>NOT</strong> counted. Move closer to the session location and try again.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StudentView({ user }) {
  const [sessions, setSessions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);
  // Last computed in/out-of-campus check for the selected session.
  // Shape: { kind: 'in' | 'out', distanceMeters, radiusMeters, checkedAt }
  // `kind: 'out'` is also used when the server-side geofence rejects the
  // marking attempt (distance comes from the server response in that case).
  const [geoCheck, setGeoCheck] = useState(null);
  const [geoChecking, setGeoChecking] = useState(false);

  const subjectMap = useMemo(() => {
    const m = new Map();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const selectedSessionObj = useMemo(
    () => sessions.find((s) => s.id === selectedSession) || null,
    [sessions, selectedSession],
  );
  const sessionNeedsGeo = Boolean(
    selectedSessionObj
      && selectedSessionObj.campusLat != null
      && selectedSessionObj.campusLng != null,
  );

  const loadSessions = useCallback(async () => {
    try {
      const [{ data }, subjectList] = await Promise.all([
        api.get('/sessions', { params: { openOnly: true } }),
        listSubjects(),
      ]);
      setSessions(data.sessions || []);
      setSubjects(subjectList);
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

  // Run a client-side geofence check for the currently selected session
  // so the student sees a prominent in/out-of-campus banner before they
  // even attempt to mark attendance. The server still re-verifies on
  // /attendance/mark — this is purely a visibility layer.
  const runGeoCheck = useCallback(async () => {
    if (!selectedSessionObj || !sessionNeedsGeo) {
      setGeoCheck(null);
      return;
    }
    setGeoChecking(true);
    setError('');
    try {
      const pos = await getCurrentPosition();
      const distance = haversineDistanceMeters(
        pos.lat, pos.lng,
        selectedSessionObj.campusLat, selectedSessionObj.campusLng,
      );
      const radius = selectedSessionObj.radiusMeters || 100;
      const inside = distance != null && distance <= radius;
      setGeoCheck({
        kind: inside ? 'in' : 'out',
        distanceMeters: distance,
        radiusMeters: radius,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err.message || 'Could not read your location.');
    } finally {
      setGeoChecking(false);
    }
  }, [selectedSessionObj, sessionNeedsGeo]);

  // When the student picks a new session that requires geo, immediately
  // run a check so they know where they stand before scanning.
  useEffect(() => {
    if (sessionNeedsGeo) {
      runGeoCheck();
    } else {
      setGeoCheck(null);
    }
  }, [selectedSession, sessionNeedsGeo, runGeoCheck]);

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

    // Capture the student's location at the moment of marking. Sessions
    // started with a campus location enforce the radius server-side; the
    // coords are sent along so every attempt can be verified and logged.
    let position = null;
    if (sessionNeedsGeo) {
      try {
        position = await getCurrentPosition();
      } catch (err) {
        setError(err.message || 'Location is required to mark attendance for this session.');
        return;
      }
    }

    try {
      const result = await markAttendance({
        sessionId: selectedSession,
        descriptor,
        livenessPassed,
        lat: position ? position.lat : undefined,
        lng: position ? position.lng : undefined,
        accuracy: position ? position.accuracy : undefined,
      });
      const confPct = (result.match && result.match.confidence != null)
        ? Math.round(result.match.confidence * 100) + '%'
        : 'n/a';
      setMessage('Attendance marked. Match confidence: ' + confPct);

      // Reflect the server's authoritative location verdict on the
      // banner — the server returns distanceMeters for geo-gated
      // sessions. Treat inside-radius as "IN CAMPUS".
      if (sessionNeedsGeo && result.location && result.location.distanceMeters != null) {
        const inside = result.location.distanceMeters <= (result.location.radiusMeters || (selectedSessionObj && selectedSessionObj.radiusMeters) || 100);
        setGeoCheck({
          kind: inside ? 'in' : 'out',
          distanceMeters: result.location.distanceMeters,
          radiusMeters: result.location.radiusMeters || (selectedSessionObj && selectedSessionObj.radiusMeters) || null,
          checkedAt: new Date().toISOString(),
        });
      } else if (sessionNeedsGeo && position) {
        // Fallback: compute client-side if the server didn't echo a distance.
        const distance = haversineDistanceMeters(
          position.lat, position.lng,
          selectedSessionObj.campusLat, selectedSessionObj.campusLng,
        );
        const radius = selectedSessionObj.radiusMeters || 100;
        setGeoCheck({
          kind: distance != null && distance <= radius ? 'in' : 'out',
          distanceMeters: distance,
          radiusMeters: radius,
          checkedAt: new Date().toISOString(),
        });
      }
      await loadHistory();
    } catch (err) {
      // Server-side geofence rejection: promote the plain error into a
      // prominent OUT OF CAMPUS banner with the server's distance so the
      // student cannot miss it.
      const resp = err && err.response && err.response.data;
      if (resp && resp.code === 'OUTSIDE_GEOFENCE') {
        setGeoCheck({
          kind: 'out',
          distanceMeters: resp.distanceMeters,
          radiusMeters: resp.radiusMeters,
          checkedAt: new Date().toISOString(),
        });
      }
      setError(extractError(err, 'Failed to mark attendance'));
    }
  }, [selectedSession, sessionNeedsGeo, selectedSessionObj, loadHistory]);

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
                {sessionLabel(subjectMap.get(s.subjectId), s)}
              </option>
            ))}
          </select>
        </label>

        {sessionNeedsGeo && (
          <p className="muted small">
            This session verifies your location — you must be within{' '}
            {selectedSessionObj.radiusMeters || 100} m of the set location for attendance to count.
          </p>
        )}

        {sessionNeedsGeo && (
          <div className="geo-check-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={runGeoCheck}
              disabled={geoChecking}
            >
              {geoChecking ? 'Checking location...' : 'Re-check my location'}
            </button>
            {geoCheck && (
              <span className="muted small">
                Last check: {new Date(geoCheck.checkedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {sessionNeedsGeo && <GeoStatusBanner status={geoCheck} />}

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
        <div className="alert success found-result">
          <span className="found-result-label">{found.fullName} ({found.rollNumber || found.email})</span>
          <button type="button" onClick={handleMark} disabled={busy}>Mark present</button>
        </div>
      )}
    </div>
  );
}

function TeacherView() {
  const [sessions, setSessions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [attendance, setAttendance] = useState(null);
  const [error, setError] = useState('');

  const subjectMap = useMemo(() => {
    const m = new Map();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const loadSessions = useCallback(async () => {
    try {
      const [{ data }, subjectList] = await Promise.all([
        api.get('/sessions'),
        listSubjects(),
      ]);
      setSessions(data.sessions || []);
      setSubjects(subjectList);
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
        <div className="filter-row">
          <label className="filter-row-field">
            <span>Session</span>
            <select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}>
              <option value="">Select a session...</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionLabel(subjectMap.get(s.subjectId), s)} ({s.isOpen ? 'OPEN' : 'CLOSED'})
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-secondary filter-row-action" onClick={loadAttendance}>Refresh</button>
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