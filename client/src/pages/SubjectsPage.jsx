import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { listSubjects, createSubject, updateSubject, deleteSubject } from '../api/subjects';

const EMPTY_FORM = { code: '', name: '', department: '', semester: '' };

export default function SubjectsPage() {
  const { user } = useAuth();
  const canCreate = user && (user.role === 'teacher' || user.role === 'admin');

  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listSubjects();
      setSubjects(data);
    } catch (err) {
      setLoadError((err && err.message) || 'Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    if (!form.code.trim() || !form.name.trim()) {
      setFormError('Code and name are required');
      return;
    }
    if (form.semester !== '' && form.semester !== null && form.semester !== undefined) {
      const n = Number(form.semester);
      if (!Number.isInteger(n) || n < 1 || n > 12) {
        setFormError('Semester must be between 1 and 12');
        return;
      }
    }

    setSubmitting(true);
    try {
      const created = await createSubject(form);
      setSubjects((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setForm(EMPTY_FORM);
      setSuccess(`Subject "${created.code}" created`);
    } catch (err) {
      setFormError(err.message || 'Failed to create subject');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({
      code: s.code || '',
      name: s.name || '',
      department: s.department || '',
      semester: s.semester != null ? String(s.semester) : '',
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
    if (!editForm.code.trim() || !editForm.name.trim()) {
      setEditError('Code and name are required');
      return;
    }
    setEditBusy(true);
    try {
      const updated = await updateSubject(id, editForm);
      setSubjects((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setEditingId(null);
    } catch (err) {
      setEditError(err.message || 'Failed to update subject');
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDelete(id, code) {
    if (!window.confirm(`Delete subject "${code}"? This cannot be undone.`)) return;
    try {
      await deleteSubject(id);
      setSubjects((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.message || 'Failed to delete subject');
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Subjects</h1>
          <p className="muted">Manage courses you teach or enroll in.</p>
        </div>
      </header>

      {canCreate && (
        <div className="card">
          <h2>Create subject</h2>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              <span>Code</span>
              <input
                type="text"
                value={form.code}
                onChange={(e) => update('code', e.target.value)}
                placeholder="e.g. CS101"
                required
              />
            </label>

            <label>
              <span>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Intro to Computer Science"
                required
              />
            </label>

            <label>
              <span>Department</span>
              <input
                type="text"
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                placeholder="e.g. CSE"
              />
            </label>

            <label>
              <span>Semester (1-12)</span>
              <input
                type="number"
                min="1"
                max="12"
                value={form.semester}
                onChange={(e) => update('semester', e.target.value)}
                placeholder="optional"
              />
            </label>

            {formError && <div className="alert error form-row-full">{formError}</div>}
            {success && <div className="alert success form-row-full">{success}</div>}

            <div className="form-row-full form-actions">
              <button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create subject'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>All subjects</h2>
          <button className="btn-secondary" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {loadError && <div className="alert error">{loadError}</div>}
        {editError && <div className="alert error">{editError}</div>}

        {loading && !subjects.length ? (
          <p className="muted">Loading subjects...</p>
        ) : !subjects.length ? (
          <p className="muted">No subjects yet. {canCreate ? 'Create one above.' : ''}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Semester</th>
                  {canCreate && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  editingId === s.id ? (
                    <tr key={s.id}>
                      <td><input type="text" value={editForm.code} onChange={(e) => setEditForm((p) => ({ ...p, code: e.target.value }))} style={{ width: '90px' }} /></td>
                      <td><input type="text" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} /></td>
                      <td><input type="text" value={editForm.department} onChange={(e) => setEditForm((p) => ({ ...p, department: e.target.value }))} style={{ width: '90px' }} /></td>
                      <td><input type="number" min="1" max="12" value={editForm.semester} onChange={(e) => setEditForm((p) => ({ ...p, semester: e.target.value }))} style={{ width: '60px' }} /></td>
                      <td className="table-actions">
                        <button type="button" onClick={() => saveEdit(s.id)} disabled={editBusy}>Save</button>
                        {' '}
                        <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={editBusy}>Cancel</button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id}>
                      <td><strong>{s.code}</strong></td>
                      <td>{s.name}</td>
                      <td>{s.department || <span className="muted">-</span>}</td>
                      <td>{s.semester ?? <span className="muted">-</span>}</td>
                      {canCreate && (
                        <td className="table-actions">
                          <button type="button" className="btn-secondary" onClick={() => startEdit(s)}>Edit</button>
                          {' '}
                          <button type="button" className="btn-secondary" onClick={() => handleDelete(s.id, s.code)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}