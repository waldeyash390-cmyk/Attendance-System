import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { listSubjects } from '../api/subjects';
import { listSessions, createSession, openSession, closeSession, updateSession, deleteSession } from '../api/sessions';

const EMPTY_FORM = {
  subjectId: '',
  title: '',
  startAt: '',
  endAt: '',
  location: '',
};

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export default function SessionsPage() {
  const { user } = useAuth();
  const canCreate = user && (user.role === 'teacher' || user.role === 'admin');

  const [subjects, setSubjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [filterSubject, setFilterSubject] = useState('');
  const [showOpenOnly, setShowOpenOnly] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [busyId, setBusyId] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

  const subjectMap = useMemo(() => {
    const m = new Map();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  async function refresh() {
    setLoading(true);
    setLoadError(null);
    try {
      const [subjList, sessList] = await Promise.all([
        listSubjects(),
        listSessions({
          subjectId: filterSubject || undefined,
          openOnly: showOpenOnly || undefined,
        }),
      ]);
      setSubjects(subjList);
      setSessions(sessList);
    } catch (err) {
      setLoadError((err && err.message) || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSubject, showOpenOnly]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!form.subjectId) return setFormError('Please select a subject');
    if (!form.startAt || !form.endAt) return setFormError('Start and end times are required');

    const start = new Date(form.startAt);
    const end = new Date(form.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return setFormError('Start and end times must be valid');
    }
    if (end <= start) return setFormError('End time must be after start time');

    const payload = {
      subjectId: form.subjectId,
      title: form.title.trim() || undefined,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      location: form.location.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const created = await createSession(payload);
      setSessions((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setForm(EMPTY_FORM);
      const subj = subjectMap.get(created.subjectId);
      setSuccess(`Session created for ${subj ? subj.code : 'subject'}`);
    } catch (err) {
      setFormError(err.message || 'Failed to create session');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(session) {
    setBusyId(session.id);
    try {
      const updated = session.isOpen
        ? await closeSession(session.id)
        : await openSession(session.id);
      setSessions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setLoadError((err && err.message) || 'Failed to update session');
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({
      subjectId: s.subjectId || '',
      title: s.title || '',
      startAt: toLocalInputValue(s.startAt),
      endAt: toLocalInputValue(s.endAt),
      location: s.location || '',
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setEditError(null);
  }

  async function saveEdit(id) {
    setEditError(null);
    if (!editForm.startAt || !editForm.endAt) {
      setEditError('Start and end times are required');
      return;
    }
    const start = new Date(editForm.startAt);
    const end = new Date(editForm.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setEditError('Start and end times must be valid');
      return;
    }
    if (end <= start) {
      setEditError('End time must be after start time');
      return;
    }
    setEditBusy(true);
    try {
      const updated = await updateSession(id, {
        title: editForm.title.trim() || undefined,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        location: editForm.location.trim() || undefined,
      });
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
    } catch (err) {
      setEditError(err.message || 'Failed to update session');
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDelete(id, label) {
    if (!window.confirm(`Delete session "${label}"? This cannot be undone.`)) return;
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.message || 'Failed to delete session');
    }
  }

  const nowIso = new Date().toISOString();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Sessions</h1>
          <p className="muted">Schedule class sessions and open them for attendance.</p>
        </div>
      </header>

      {canCreate && (
        <div className="card">
          <h2>Create session</h2>
          {subjects.length === 0 ? (
            <p className="muted">
              You need at least one subject before creating a session. Create one in <a href="/subjects">Subjects</a>.
            </p>
          ) : (
            <form className="form-grid" onSubmit={handleSubmit}>
              <label>
                <span>Subject</span>
                <select
                  value={form.subjectId}
                  onChange={(e) => update('subjectId', e.target.value)}
                  required
                >
                  <option value="">Select a subject...</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Title</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="e.g. Lecture 1 - Introduction"
                />
              </label>

              <label>
                <span>Start time</span>
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => update('startAt', e.target.value)}
                  required
                />
              </label>

              <label>
                <span>End time</span>
                <input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => update('endAt', e.target.value)}
                  required
                />
              </label>

              <label className="form-row-full">
                <span>Location</span>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => update('location', e.target.value)}
                  placeholder="e.g. Room 204"
                />
              </label>

              {formError && <div className="alert error form-row-full">{formError}</div>}
              {success && <div className="alert success form-row-full">{success}</div>}

              <div className="form-row-full form-actions">
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Creating...' : 'Create session'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>All sessions</h2>
          <div className="card-header-actions">
            <label className="inline-filter">
              <span>Subject</span>
              <select
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.target.value)}
              >
                <option value="">All subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-filter checkbox">
              <input
                type="checkbox"
                checked={showOpenOnly}
                onChange={(e) => setShowOpenOnly(e.target.checked)}
              />
              <span>Open only</span>
            </label>
            <button className="btn-secondary" onClick={refresh} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {loadError && <div className="alert error">{loadError}</div>}
        {editError && <div className="alert error">{editError}</div>}

        {loading && !sessions.length ? (
          <p className="muted">Loading sessions...</p>
        ) : !sessions.length ? (
          <p className="muted">
            No sessions {filterSubject || showOpenOnly ? 'match the current filters.' : 'yet.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Title</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const subj = subjectMap.get(s.subjectId);
                  const ended = s.endAt && new Date(s.endAt) < new Date(nowIso);

                  if (editingId === s.id) {
                    return (
                      <tr key={s.id}>
                        <td>{subj ? subj.code : '-'}</td>
                        <td><input type="text" value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} /></td>
                        <td><input type="datetime-local" value={editForm.startAt} onChange={(e) => setEditForm((p) => ({ ...p, startAt: e.target.value }))} /></td>
                        <td><input type="datetime-local" value={editForm.endAt} onChange={(e) => setEditForm((p) => ({ ...p, endAt: e.target.value }))} /></td>
                        <td><input type="text" value={editForm.location} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))} style={{ width: '90px' }} /></td>
                        <td>-</td>
                        <td className="table-actions">
                          <button type="button" onClick={() => saveEdit(s.id)} disabled={editBusy}>Save</button>
                          {' '}
                          <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={editBusy}>Cancel</button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={s.id}>
                      <td>
                        {subj ? (
                          <>
                            <strong>{subj.code}</strong>
                            <div className="muted small">{subj.name}</div>
                          </>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>{s.title || <span className="muted">-</span>}</td>
                      <td>{formatDateTime(s.startAt)}</td>
                      <td>{formatDateTime(s.endAt)}</td>
                      <td>{s.location || <span className="muted">-</span>}</td>
                      <td>
                        {s.isOpen ? (
                          <span className="badge badge-open">Open</span>
                        ) : ended ? (
                          <span className="badge badge-ended">Ended</span>
                        ) : (
                          <span className="badge badge-closed">Closed</span>
                        )}
                      </td>
                      <td className="table-actions">
                        <Link className="btn-primary" to={`/sessions/${s.id}/live`}>Live</Link>
                        {' '}
                        <button
                          className={s.isOpen ? 'btn-secondary' : 'btn-primary'}
                          onClick={() => handleToggle(s)}
                          disabled={busyId === s.id || ended}
                          title={ended ? 'Session has already ended' : ''}
                        >
                          {busyId === s.id ? '...' : s.isOpen ? 'Close' : 'Open'}
                        </button>
                        {' '}
                        <button type="button" className="btn-secondary" onClick={() => startEdit(s)}>Edit</button>
                        {' '}
                        <button type="button" className="btn-secondary" onClick={() => handleDelete(s.id, s.title || (subj ? subj.code : 'session'))}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
