import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, extractError } from '../api/client';
import { getMyProfile } from '../api/profile';
import { useAuth } from '../auth/AuthContext';

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ? p[0].toUpperCase() : '').join('') || '?';
}

function ProfileAvatar({ photoUrl, name }) {
  const src = photoUrl || null;
  return (
    <div className="profile-avatar dashboard-avatar" aria-hidden="true">
      {src
        ? <img src={src} alt={`${name || 'Student'} photo`} />
        : <span className="profile-avatar-initials">{initialsOf(name)}</span>}
    </div>
  );
}

function StudentDashboardHeader({ user }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  useEffect(() => {
    if (!user || user.role !== 'student') return undefined;
    let cancelled = false;
    getMyProfile()
      .then((profile) => {
        if (cancelled) return;
        setPhotoUrl(profile && profile.profilePhotoUrl ? profile.profilePhotoUrl : null);
      })
      .catch(() => { if (!cancelled) setPhotoUrl(null); });
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="dashboard-header">
      <ProfileAvatar photoUrl={photoUrl} name={user ? user.fullName : ''} />
      <div className="dashboard-header-text">
        <h1>Welcome back, {user ? user.fullName : 'there'}</h1>
        <p className="muted">
          Signed in as <strong>{user ? user.role : 'unknown'}</strong>
          {user && user.rollNumber ? <> &middot; Roll {user.rollNumber}</> : null}
          {user && user.department ? <> &middot; {user.department}</> : null}
        </p>
      </div>
    </div>
  );
}

function attendanceColorClass(pct) {
  if (pct == null || Number.isNaN(pct)) return 'att-neutral';
  if (pct >= 75) return 'att-good';
  if (pct >= 60) return 'att-warn';
  return 'att-bad';
}

function statusBadgeClass(status) {
  return `badge badge-${status || 'present'}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function StudentDashboard({ user }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [subjectBreakdown, setSubjectBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user || !user.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/attendance/student/${user.id}`)
      .then((r) => {
        if (cancelled) return;
        const data = r.data || {};
        setStats(data.stats || null);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setSubjectBreakdown(Array.isArray(data.subjectsBreakdown) ? data.subjectsBreakdown : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(extractError(e, 'Could not load attendance summary.'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  const percentage = stats
    ? Math.min(100, Math.max(0, Number(stats.attendancePercentage || 0)))
    : null;
  const colorClass = attendanceColorClass(percentage);
  const sessionsAttended = stats ? stats.sessionsAttended : 0;
  const totalPastSessions = stats ? stats.totalPastSessions : 0;

  const sortedSubjects = useMemo(
    () => subjectBreakdown.slice().sort((a, b) => a.percentage - b.percentage),
    [subjectBreakdown],
  );

  const recent = history.slice(0, 8);

  return (
    <>
      <section className="card attendance-summary-card">
        <h2>Your attendance</h2>
        {loading && <p>Loading your attendance...</p>}
        {error && <div className="alert error">{error}</div>}
        {!loading && !error && stats && (
          <>
            <div className={`attendance-percentage ${colorClass}`}>
              <div className="attendance-percentage-number">
                {percentage == null ? '—' : `${percentage}%`}
              </div>
              <div className="attendance-percentage-meta">
                <span><strong>{sessionsAttended}</strong> attended</span>
                <span className="muted"> of {totalPastSessions} past sessions</span>
              </div>
            </div>

            {percentage < 75 ? (
              <div className="alert warning">
                <strong>Low attendance warning.</strong> Your attendance is below the
                required 75%. Please attend more classes to avoid academic penalties.
              </div>
            ) : (
              <div className="alert success">
                <strong>Great!</strong> Your attendance meets the 75% requirement.
              </div>
            )}
          </>
        )}
        {!loading && !error && !stats && (
          <p className="muted">No attendance data yet. Mark attendance during an open session to see your stats here.</p>
        )}
      </section>

      <section className="card">
        <h2>By subject</h2>
        {loading && <p>Loading...</p>}
        {!loading && sortedSubjects.length === 0 && (
          <p className="muted">No subject-wise attendance yet.</p>
        )}
        {!loading && sortedSubjects.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th className="num">Attended</th>
                  <th className="num">Sessions</th>
                  <th className="num">Records</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {sortedSubjects.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="subject-cell">
                        <span className="badge badge-excused">{s.code}</span>
                        <span>{s.name}</span>
                      </div>
                    </td>
                    <td className="num">{s.attended}</td>
                    <td className="num muted">{s.total}</td>
                    <td className="num muted">{s.records}</td>
                    <td className={`num ${attendanceColorClass(s.percentage)}`}>
                      <strong>{s.percentage}%</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Sessions = total ended sessions for the subject (the denominator).
              Sessions with no record at all count as missed, same as an explicit
              absent.
            </p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent attendance</h2>
        {loading && <p>Loading...</p>}
        {!loading && recent.length === 0 && (
          <p className="muted">No attendance records yet.</p>
        )}
        {!loading && recent.length > 0 && (
          <ul className="record-list">
            {recent.map((r) => (
              <li key={r.id} className="record-list-item">
                <div className="record-list-main">
                  <div className="record-list-title">
                    {r.subject ? `${r.subject.code} · ${r.subject.name}` : r.sessionTitle || 'Session'}
                  </div>
                  <div className="muted small">{formatDate(r.markedAt)}</div>
                </div>
                <span className={statusBadgeClass(r.status)}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function formatShortDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function TeacherDashboard({ user }) {
  const [openSessions, setOpenSessions] = useState([]);
  const [openCounts, setOpenCounts] = useState({});
  const [openLoading, setOpenLoading] = useState(true);
  const [openError, setOpenError] = useState(null);

  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState(null);

  const [overview, setOverview] = useState({ subjects: 0, sessionsHeld: 0, attendancePct: null, marked: 0, denominator: 0 });
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    if (!user || !user.id) return undefined;
    let cancelled = false;

    const loadOpen = () => {
      api.get('/sessions', { params: { teacherId: user.id, openOnly: 'true' } })
        .then((r) => {
          if (cancelled) return;
          setOpenSessions(Array.isArray(r.data && r.data.sessions) ? r.data.sessions : []);
          setOpenError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setOpenError(extractError(e, 'Could not load active sessions.'));
        })
        .finally(() => { if (!cancelled) setOpenLoading(false); });
    };

    const loadRecent = () => {
      api.get('/sessions', { params: { teacherId: user.id } })
        .then((r) => {
          if (cancelled) return;
          const all = Array.isArray(r.data && r.data.sessions) ? r.data.sessions : [];
          const ended = all
            .filter((s) => !s.isOpen && s.endAt && new Date(s.endAt) < new Date())
            .slice(0, 5);
          setRecent(ended);
          setRecentError(null);

          const subjectIds = new Set();
          let held = 0;
          for (const s of all) {
            if (s.subjectId) subjectIds.add(s.subjectId);
            if (s.endAt && new Date(s.endAt) < new Date()) held += 1;
          }

          api.get('/subjects')
            .then((sr) => {
              if (cancelled) return;
              const subjects = Array.isArray(sr.data && sr.data.subjects) ? sr.data.subjects : [];
              const byId = new Map(subjects.map((sub) => [sub.id, sub]));
              const enriched = ended.map((s) => ({
                ...s,
                subject: byId.get(s.subjectId) || null,
              }));
              setRecent(enriched);

              const validSubjectIds = subjectIds;
              let attendedSum = 0;
              let denomSum = 0;
              let pending = 0;
              const subjectsToQuery = Array.from(validSubjectIds);
              if (subjectsToQuery.length === 0) {
                setOverview({ subjects: 0, sessionsHeld: held, attendancePct: null, marked: 0, denominator: 0 });
                setOverviewLoading(false);
                return;
              }
              pending = subjectsToQuery.length;
              for (const sid of subjectsToQuery) {
                api.get(`/analytics/subject/${sid}`)
                  .then((ar) => {
                    if (cancelled) return;
                    const d = ar.data || {};
                    const sum = d.summary || {};
                    const classAtt = Number(sum.classAttendancePercentage || 0);
                    const students = Array.isArray(d.students) ? d.students : [];
                    let subjAttended = 0;
                    let subjDenom = 0;
                    for (const st of students) {
                      subjAttended += Number(st.attended || 0);
                      subjDenom    += Number(st.attended || 0) + Number(st.absent || 0);
                    }
                    attendedSum += (classAtt / 100) * subjDenom;
                    denomSum    += subjDenom;
                    pending -= 1;
                    if (pending === 0) {
                      const pct = denomSum > 0 ? Math.round(((attendedSum / denomSum) * 100) * 100) / 100 : null;
                      setOverview({
                        subjects: validSubjectIds.size,
                        sessionsHeld: held,
                        attendancePct: pct,
                        marked: attendedSum,
                        denominator: denomSum,
                      });
                      setOverviewLoading(false);
                    }
                  })
                  .catch(() => {
                    if (cancelled) return;
                    pending -= 1;
                    if (pending === 0) {
                      const pct = denomSum > 0 ? Math.round(((attendedSum / denomSum) * 100) * 100) / 100 : null;
                      setOverview({
                        subjects: validSubjectIds.size,
                        sessionsHeld: held,
                        attendancePct: pct,
                        marked: attendedSum,
                        denominator: denomSum,
                      });
                      setOverviewLoading(false);
                    }
                  });
              }
            })
            .catch((se) => {
              if (cancelled) return;
              setRecentError(extractError(se, 'Could not load subjects.'));
              setOverview({ subjects: subjectIds.size, sessionsHeld: held, attendancePct: null, marked: 0, denominator: 0 });
              setOverviewLoading(false);
            });
        })
        .catch((e) => {
          if (cancelled) return;
          setRecentError(extractError(e, 'Could not load recent sessions.'));
          setRecentLoading(false);
        });
    };

    loadOpen();
    loadRecent();
    const interval = setInterval(loadOpen, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    if (openSessions.length === 0) {
      setOpenCounts({});
      return undefined;
    }
    Promise.all(openSessions.map((s) =>
      api.get(`/attendance/session/${s.id}`)
        .then((r) => ({ id: s.id, summary: (r.data && r.data.summary) || null }))
        .catch(() => ({ id: s.id, summary: null })),
    )).then((results) => {
      if (cancelled) return;
      const next = {};
      for (const r of results) next[r.id] = r.summary;
      setOpenCounts(next);
    });
    return () => { cancelled = true; };
  }, [openSessions]);

  const hasOpen = !openLoading && !openError && openSessions.length > 0;

  return (
    <>
      <section className="card">
        <h2>Active session</h2>
        {openLoading && <p>Checking for active sessions…</p>}
        {openError && <div className="alert error">{openError}</div>}
        {!openLoading && !openError && openSessions.length === 0 && (
          <div className="empty-state">
            <p>No active session right now.</p>
            <Link className="btn-primary" to="/sessions">Start a session</Link>
          </div>
        )}
        {hasOpen && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Title</th>
                  <th className="num">Marked</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openSessions.map((s) => {
                  const sum = openCounts[s.id];
                  const marked = sum ? (Number(sum.present || 0) + Number(sum.late || 0)) : null;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="subject-cell">
                          <span className="badge badge-open">Open</span>
                          <span>{s.subjectId ? s.subjectId.slice(0, 8) : '—'}</span>
                        </div>
                      </td>
                      <td>{s.title || <span className="muted">(untitled)</span>}</td>
                      <td className="num">
                        {marked == null ? <span className="muted">…</span> : <strong>{marked}</strong>}
                      </td>
                      <td className="table-actions">
                        <Link className="btn-primary" to={`/sessions/${s.id}/live`}>Open live</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">
              Live marked count refreshes automatically every 15 seconds.
            </p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Recent sessions</h2>
        {recentLoading && <p>Loading recent sessions…</p>}
        {recentError && <div className="alert error">{recentError}</div>}
        {!recentLoading && !recentError && recent.length === 0 && (
          <p className="muted">No completed sessions yet.</p>
        )}
        {!recentLoading && recent.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Title</th>
                  <th>Date</th>
                  <th className="num">Attendance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => {
                  const subj = s.subject;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className="subject-cell">
                          {subj
                            ? <span className="badge badge-excused">{subj.code}</span>
                            : <span className="badge badge-ended">—</span>}
                          <span>{subj ? subj.name : <span className="muted">Unknown subject</span>}</span>
                        </div>
                      </td>
                      <td>{s.title || <span className="muted">(untitled)</span>}</td>
                      <td className="muted">{formatShortDateTime(s.endAt)}</td>
                      <td className="num">
                        <RecentAttendanceCell sessionId={s.id} />
                      </td>
                      <td className="table-actions">
                        <Link className="btn-secondary" to={`/sessions/${s.id}/live`}>View</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Quick overview</h2>
        {overviewLoading && <p>Loading overview…</p>}
        {!overviewLoading && (
          <div className="analytics-summary">
            <div className="stat">
              <div className="num">{overview.subjects}</div>
              <div className="label">Subjects taught</div>
            </div>
            <div className="stat">
              <div className="num">{overview.sessionsHeld}</div>
              <div className="label">Sessions held</div>
            </div>
            <div className="stat">
              <div className={`num ${overview.attendancePct == null ? 'att-neutral' : attendanceColorClass(overview.attendancePct)}`}>
                {overview.attendancePct == null ? '—' : `${overview.attendancePct}%`}
              </div>
              <div className="label">Overall attendance</div>
            </div>
          </div>
        )}
        <div className="quick-links">
          <Link className="btn-secondary" to="/subjects">Subjects</Link>
          <Link className="btn-secondary" to="/sessions">Sessions</Link>
          <Link className="btn-secondary" to="/analytics">Analytics</Link>
        </div>
      </section>
    </>
  );
}

function RecentAttendanceCell({ sessionId }) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/attendance/session/${sessionId}`)
      .then((r) => {
        if (cancelled) return;
        setSummary((r.data && r.data.summary) || null);
      })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (!summary) return <span className="muted">…</span>;
  const attended = Number(summary.present || 0) + Number(summary.late || 0);
  const total = Number(summary.total || 0);
  return (
    <span>
      <strong>{attended}</strong>
      <span className="muted"> / {total}</span>
    </span>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const isStudent = user && user.role === 'student';
  const isTeacher = user && user.role === 'teacher';

  return (
    <section className="page">
      {isStudent && <StudentDashboardHeader user={user} />}
      {isTeacher && (
        <>
          <h1>Welcome back, {user ? user.fullName : 'there'}</h1>
          <p className="muted">
            Signed in as <strong>{user ? user.role : 'unknown'}</strong>
            {user && user.rollNumber ? <> &middot; Roll {user.rollNumber}</> : null}
            {user && user.department ? <> &middot; {user.department}</> : null}
          </p>
        </>
      )}

      {isStudent && <StudentDashboard user={user} />}
      {isTeacher && <TeacherDashboard user={user} />}
    </section>
  );
}
