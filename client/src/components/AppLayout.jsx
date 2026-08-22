import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const TEACHER_NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/subjects', label: 'Subjects' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/analytics', label: 'Analytics' },
];

const STUDENT_NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/face-enroll', label: 'Face Enrollment' },
  { to: '/attendance', label: 'My Attendance' },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const nav = user && user.role === 'teacher' ? TEACHER_NAV
            : user && user.role === 'student' ? STUDENT_NAV
            : [];

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">Attendance</div>
        <nav className="primary-nav">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-box">
          <div className="user-info">
            <div className="user-name">{user ? user.fullName : ''}</div>
            <div className="user-role muted small">{user ? user.role : ''}</div>
          </div>
          <button className="btn-secondary" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
