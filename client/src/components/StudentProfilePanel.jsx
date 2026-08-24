import { useEffect, useRef, useState } from 'react';
import {
  getStudentProfile,
  updateStudentProfile,
  unlockStudentProfile,
  isValidPhone,
  isValidEmail,
  readImageFile,
  PHOTO_MAX_BYTES,
} from '../api/profile';
import { extractError } from '../api/client';
import ProfileAvatar from './ProfileAvatar';

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ? p[0].toUpperCase() : '').join('') || '?';
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

// Build an absolute URL for a stored profile photo path. The API returns a
// path like "/api/uploads/profile_xyz.jpg" which the browser resolves
// against the current origin. We expose this through a helper so callers
// don't have to think about it.
function photoSrcOf(profilePhotoUrl) {
  if (!profilePhotoUrl) return null;
  return profilePhotoUrl;
}

// Reusable inline "view/edit student profile" component.
//
// Two usage modes:
//   - <StudentProfilePanel student={...} />  — a teacher/admin clicks a name
//     in a table; this panel renders below that row in an expandable
//     section. It loads the full profile (with phone, photo, edit_count,
//     etc.) lazily via /api/profile/:userId.
//   - The same component is also used inside a modal/drawer overlay (see
//     <StudentProfileModal /> below) when the page layout can't easily
//     accommodate an inline expanded row.
//
// The teacher can always edit and save, regardless of edit_count/profile_locked
// status. They can also call "Unlock for student" to reset the lock and let
// the student edit again.
export function StudentProfilePanel({ student, onProfileUpdated }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    rollNumber: '',
    email: '',
    phoneNumber: '',
    department: '',
  });
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef(null);

  // Fetch the full student profile the first time the panel is opened, then
  // re-fetch whenever the parent passes us a different student id (e.g.
  // clicking a different row in the same table).
  useEffect(() => {
    if (!student || !student.id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setInfo('');
    setEditing(false);
    setPhotoDataUrl(null);
    setPhotoError('');
    getStudentProfile(student.id)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setForm({
          fullName: p.fullName || '',
          rollNumber: p.rollNumber || '',
          email: p.email || '',
          phoneNumber: p.phoneNumber || '',
          department: p.department || '',
        });
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err, 'Failed to load profile'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [student && student.id]);

  const isLocked = !!(profile && (profile.profileLocked || (profile.editCount || 0) >= 1));

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handlePhotoChange(e) {
    setPhotoError('');
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const result = await readImageFile(file);
      setPhotoDataUrl(result.dataUrl);
    } catch (err) {
      setPhotoError(err.message || 'Invalid photo');
      setPhotoDataUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function clearPhoto() {
    setPhotoDataUrl(null);
    setPhotoError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSave() {
    setError('');
    setInfo('');

    if (!form.fullName.trim() || form.fullName.trim().length < 2) {
      setError('Full name is required');
      return;
    }
    if (!form.rollNumber.trim()) {
      setError('Roll number is required');
      return;
    }
    if (!isValidEmail(form.email)) {
      setError('Email is not valid');
      return;
    }
    if (!isValidPhone(form.phoneNumber)) {
      setError('Phone number is not valid (10-15 digits, optional leading +)');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        rollNumber: form.rollNumber.trim(),
        email: form.email.trim().toLowerCase(),
        phoneNumber: form.phoneNumber.trim().replace(/[\s\-()]/g, ''),
        department: form.department.trim(),
      };
      if (photoDataUrl) payload.profilePhoto = photoDataUrl;
      const updated = await updateStudentProfile(student.id, payload);
      setProfile(updated);
      setEditing(false);
      setPhotoDataUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setInfo('Profile updated.');
      if (onProfileUpdated) onProfileUpdated(updated);
    } catch (err) {
      setError(extractError(err, 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlock() {
    if (!student || !student.id) return;
    setError('');
    setInfo('');
    setUnlocking(true);
    try {
      const updated = await unlockStudentProfile(student.id);
      setProfile(updated);
      setInfo('Unlocked. The student can edit their profile again.');
      if (onProfileUpdated) onProfileUpdated(updated);
    } catch (err) {
      setError(extractError(err, 'Failed to unlock profile'));
    } finally {
      setUnlocking(false);
    }
  }

  function cancelEdit() {
    if (!profile) return;
    setForm({
      fullName: profile.fullName || '',
      rollNumber: profile.rollNumber || '',
      email: profile.email || '',
      phoneNumber: profile.phoneNumber || '',
      department: profile.department || '',
    });
    setPhotoDataUrl(null);
    setPhotoError('');
    setEditing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (loading && !profile) {
    return (
      <div className="profile-panel">
        <div className="muted small">Loading profile...</div>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="profile-panel">
        <div className="alert error">{error}</div>
      </div>
    );
  }

  if (!profile) return null;

  const photoSrc = photoDataUrl ? photoDataUrl : photoSrcOf(profile.profilePhotoUrl);

  return (
    <div className="profile-panel">
      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}

      <div className="profile-panel-layout">
        <div className="profile-photo-block">
          <ProfileAvatar
            src={photoSrc}
            name={profile.fullName}
            alt={`${profile.fullName || 'Student'} photo`}
          />
          {editing && (
            <div className="profile-photo-controls">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handlePhotoChange}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
              >
                {profile.profilePhotoUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {photoDataUrl && (
                <button type="button" className="btn-secondary" onClick={clearPhoto}>
                  Discard
                </button>
              )}
              <p className="muted small">
                JPEG/PNG/WebP/GIF, {PHOTO_MAX_BYTES / (1024 * 1024)}MB max.
              </p>
              {photoError && <div className="alert error small">{photoError}</div>}
            </div>
          )}
        </div>

        <div className="profile-panel-fields">
          {!editing ? (
            <ul className="kv">
              <li><span>Full name</span><strong>{profile.fullName || '-'}</strong></li>
              <li><span>Roll number</span><strong>{profile.rollNumber || '-'}</strong></li>
              <li><span>Email</span><strong>{profile.email || '-'}</strong></li>
              <li>
                <span>Phone number</span>
                <strong className="kv-with-action">
                  <span>{profile.phoneNumber || '-'}</span>
                  {profile.phoneNumber ? (
                    <a
                      className="btn-secondary btn-call"
                      href={`tel:${profile.phoneNumber.replace(/\s/g, '')}`}
                      aria-label={`Call ${profile.fullName || 'student'} at ${profile.phoneNumber}`}
                    >
                      Call
                    </a>
                  ) : null}
                </strong>
              </li>
              <li><span>Department</span><strong>{profile.department || '-'}</strong></li>
              <li>
                <span>Profile lock</span>
                <strong>
                  {isLocked ? 'Locked' : 'Open'}
                  <span className="muted small"> (edits: {profile.editCount || 0})</span>
                </strong>
              </li>
              <li><span>Last updated</span><strong>{formatDateTime(profile.profileUpdatedAt)}</strong></li>
            </ul>
          ) : (
            <div className="form-grid">
              <label>
                <span>Full name</span>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => update('fullName', e.target.value)}
                  required
                  minLength={2}
                />
              </label>
              <label>
                <span>Roll number</span>
                <input
                  type="text"
                  value={form.rollNumber}
                  onChange={(e) => update('rollNumber', e.target.value)}
                  required
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  required
                />
              </label>
              <label>
                <span>Phone number</span>
                <div className="field-with-action">
                  <input
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(e) => update('phoneNumber', e.target.value)}
                    required
                    inputMode="tel"
                    placeholder="10-15 digits"
                  />
                  {form.phoneNumber.trim() ? (
                    <a
                      className="btn-secondary btn-call"
                      href={`tel:${form.phoneNumber.trim().replace(/\s/g, '')}`}
                      aria-label={`Call ${form.fullName || 'student'} at ${form.phoneNumber}`}
                    >
                      Call
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary btn-call"
                      disabled
                      title="No phone number on file"
                    >
                      Call
                    </button>
                  )}
                </div>
              </label>
              <label className="form-row-full">
                <span>Department</span>
                <input
                  type="text"
                  value={form.department}
                  onChange={(e) => update('department', e.target.value)}
                />
              </label>
            </div>
          )}

          <div className="profile-panel-actions">
            {!editing ? (
              <>
                <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
                  Edit profile
                </button>
                {isLocked && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleUnlock}
                    disabled={unlocking}
                  >
                    {unlocking ? 'Unlocking...' : 'Unlock for student'}
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
                <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Drawer/modal overlay used when the page wants a focused profile view
// rather than an inline expanded row. Renders <StudentProfilePanel /> inside
// a portal-ish fixed-position overlay. Escape and backdrop click close it.
export function StudentProfileModal({ student, open, onClose, onProfileUpdated }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose && onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !student) return null;

  return (
    <div className="profile-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Profile for ${student.fullName || 'student'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-modal-header">
          <h2>Student profile</h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            aria-label="Close profile"
          >
            Close
          </button>
        </div>
        <StudentProfilePanel student={student} onProfileUpdated={onProfileUpdated} />
      </div>
    </div>
  );
}
