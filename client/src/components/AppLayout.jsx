import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

import IconDashboard from './icons/IconDashboard';
import IconBook from './icons/IconBook';
import IconCalendar from './icons/IconCalendar';
import IconClipboard from './icons/IconClipboard';
import IconChart from './icons/IconChart';
import IconCamera from './icons/IconCamera';
import IconUser from './icons/IconUser';
import IconLogout from './icons/IconLogout';
import IconChevron from './icons/IconChevron';

const TEACHER_NAV = [
  { to: '/', label: 'Dashboard', end: true, Icon: IconDashboard },
  { to: '/subjects', label: 'Subjects', Icon: IconBook },
  { to: '/sessions', label: 'Lectures', Icon: IconCalendar },
  { to: '/attendance', label: 'Attendance', Icon: IconClipboard },
  { to: '/analytics', label: 'Analytics', Icon: IconChart },
];

const STUDENT_NAV = [
  { to: '/', label: 'Dashboard', end: true, Icon: IconDashboard },
  { to: '/face-enroll', label: 'Face Enrollment', Icon: IconCamera },
  { to: '/attendance', label: 'My Attendance', Icon: IconClipboard },
  { to: '/profile', label: 'My Profile', Icon: IconUser },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const nav = user && user.role === 'teacher' ? TEACHER_NAV
            : user && user.role === 'student' ? STUDENT_NAV
            : [];

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  function handleLogout() {
    setUserMenuOpen(false);
    logout();
    navigate('/login', { replace: true });
  }

  // Close the user dropdown on Escape and outside click.
  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setUserMenuOpen(false);
    }
    function onClick(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [userMenuOpen]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">Attendance</div>

        <div className="user-box" ref={userMenuRef}>
          <button
            type="button"
            className="user-trigger"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
          >
            <span className="user-info">
              <span className="user-name">{user ? user.fullName : ''}</span>
              <span className="user-role muted small">{user ? user.role : ''}</span>
            </span>
            <IconChevron className="user-trigger-chevron" />
          </button>
          {userMenuOpen && (
            <div className="user-menu" role="menu">
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={handleLogout}
              >
                <IconLogout className="user-menu-icon" />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      {nav.length > 0 && (
        <nav className="bottom-nav" aria-label="Primary">
          <ul className="bottom-nav-pill">
            {nav.map(({ to, label, end, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    'bottom-nav-link' + (isActive ? ' active' : '')
                  }
                  aria-label={label}
                >
                  <span className="bottom-nav-icon"><Icon /></span>
                  <span className="bottom-nav-label">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
