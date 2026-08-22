import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const ROLES = [
  { value: 'student', label: 'Student' },
  { value: 'teacher', label: 'Teacher' },
];

export default function RegisterPage() {
  const { register, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'student',
    rollNumber: '',
    department: '',
    inviteCode: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (loading) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (form.role === 'student' && !form.rollNumber.trim()) {
      setError('Roll number is required for students');
      return;
    }
    if (form.role === 'teacher' && !form.inviteCode.trim()) {
      setError('Teacher invite code is required');
      return;
    }

    const payload = {
      email: form.email.trim(),
      password: form.password,
      fullName: form.fullName.trim(),
      role: form.role,
    };
    if (form.role === 'student') payload.rollNumber = form.rollNumber.trim();
    if (form.role === 'teacher') payload.inviteCode = form.inviteCode.trim();
    if (form.department.trim()) payload.department = form.department.trim();

    setSubmitting(true);
    try {
      await register(payload);
      navigate('/', { replace: true });
    } catch (err) {
      const msg = (err && err.response && err.response.data && err.response.data.error) || 'Registration failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Create account</h1>
        <p className="muted">Register as a student or teacher</p>

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
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>

        <label>
          <span>Role</span>
          <select value={form.role} onChange={(e) => update('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>

        {form.role === 'student' && (
          <label>
            <span>Roll number</span>
            <input
              type="text"
              value={form.rollNumber}
              onChange={(e) => update('rollNumber', e.target.value)}
              required={form.role === 'student'}
            />
          </label>
        )}

        {form.role === 'teacher' && (
          <label>
            <span>Teacher invite code</span>
            <input
              type="text"
              value={form.inviteCode}
              onChange={(e) => update('inviteCode', e.target.value)}
              required
            />
          </label>
        )}

        <label>
          <span>Department (optional)</span>
          <input
            type="text"
            value={form.department}
            onChange={(e) => update('department', e.target.value)}
          />
        </label>

        {error && <div className="alert error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="muted small">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}