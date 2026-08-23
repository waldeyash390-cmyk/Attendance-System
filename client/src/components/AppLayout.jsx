import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();

  const nav = user && user.role === 'teacher' ? TEACHER_NAV
            : user && user.role === 'student' ? STUDENT_NAV
            : [];

  const [navOpen, setNavOpen] = useState(false);
  const headerRef = useRef(null);

  function handleLogout() {
    setNavOpen(false);
    logout();
    navigate('/login', { replace: true });
  }

  // Close the mobile menu whenever the route changes — the nav links
  // themselves navigate, but we also want it to close after logout/refresh
  // navigation triggered from elsewhere.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Close on Escape and on outside click while open. Outside-click is only
  // wired on small screens where the menu is rendered as an overlay;
  // on desktop the menu is the inline horizontal nav so there's nothing
  // to dismiss.
  useEffect(() => {
    if (!navOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    function onClick(e) {
      if (headerRef.current && !headerRef.current.contains(e.target)) {
        setNavOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [navOpen]);

  const headerCls = 'app-header' + (navOpen ? ' nav-open' : '');

  return (
    <div className="app-shell">
      <header className={headerCls} ref={headerRef}>
        <div className="brand-row">
          <div className="brand">Attendance</div>
          <button
            type="button"
            className="nav-toggle"
            aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={navOpen}
            aria-controls="primary-nav"
            onClick={() => setNavOpen((v) => !v)}
          >
            <span className="nav-toggle-bars" aria-hidden="true">
              <span /><span /><span />
            </span>
            <span className="nav-toggle-label">{navOpen ? 'Close' : 'Menu'}</span>
          </button>
        </div>

        <nav
          id="primary-nav"
          className="primary-nav"
          aria-label="Primary"
        >
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
