import { useEffect, useRef, useState } from 'react';
import {
  getMyProfile,
  updateMyProfile,
  isValidPhone,
  isValidEmail,
  readImageFile,
  PHOTO_MAX_BYTES,
} from '../api/profile';
import { extractError } from '../api/client';

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] ? p[0].toUpperCase() : '').join('') || '?';
}

export default function StudentProfilePage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    rollNumber: '',
    email: '',
    phoneNumber: '',
  });
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getMyProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setForm({
          fullName: p.fullName || '',
          rollNumber: p.rollNumber || '',
          email: p.email || '',
          phoneNumber: p.phoneNumber || '',
        });
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err, 'Failed to load profile'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

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
      };
      if (photoDataUrl) payload.profilePhoto = photoDataUrl;
      const updated = await updateMyProfile(payload);
      setProfile(updated);
      setInfo('Profile saved. You can no longer edit it.');
      setPhotoDataUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(extractError(err, 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !profile) {
    return (
      <section className="page">
        <div className="page-center">Loading profile...</div>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="page">
        <div className="card">
          {error ? <div className="alert error">{error}</div> : <p className="muted">Profile not available.</p>}
        </div>
      </section>
    );
  }

  const photoSrc = photoDataUrl
    ? photoDataUrl
    : profile.profilePhotoUrl
      ? (profile.profilePhotoUrl.startsWith('http')
          ? profile.profilePhotoUrl
          : profile.profilePhotoUrl)
      : null;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>My profile</h1>
          <p className="muted">
            {isLocked
              ? 'Profile is locked. Contact your teacher if you need to make a correction.'
              : 'Set your profile details. You can only save once.'}
          </p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert success">{info}</div>}

      <div className="card profile-card">
        <div className="profile-photo-block">
          <div className="profile-avatar" aria-hidden="true">
            {photoSrc
              ? <img src={photoSrc} alt="Profile photo" />
              : <span className="profile-avatar-initials">{initialsOf(profile.fullName)}</span>}
          </div>
          {!isLocked && (
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

        {!isLocked && (
          <div className="alert warning">
            <strong>Heads up:</strong> You can only edit your profile once.
            Please double check all details before saving.
          </div>
        )}

        {isLocked && (
          <div className="alert">
            Your profile has been set and can no longer be edited. Contact your teacher if you need to make a correction.
          </div>
        )}

        <div className="form-grid">
          <label>
            <span>Full name</span>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              disabled={isLocked}
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
              disabled={isLocked}
              required
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              disabled={isLocked}
              required
              autoComplete="email"
            />
          </label>

          <label>
            <span>Phone number</span>
            <input
              type="tel"
              value={form.phoneNumber}
              onChange={(e) => update('phoneNumber', e.target.value)}
              disabled={isLocked}
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="10-15 digits"
            />
          </label>
        </div>

        {!isLocked && (
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Account</h2>
        <ul className="kv">
          <li><span>Role</span><strong>{profile.role}</strong></li>
          <li><span>Department</span><strong>{profile.department || '-'}</strong></li>
          <li><span>Profile created</span><strong>{formatDateTime(profile.createdAt)}</strong></li>
          <li><span>Last profile update</span><strong>{formatDateTime(profile.profileUpdatedAt)}</strong></li>
        </ul>
      </div>
    </section>
  );
}
