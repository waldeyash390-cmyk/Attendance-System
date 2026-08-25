import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import FaceEnrollPage from './pages/FaceEnrollPage';
import AttendancePage from './pages/AttendancePage';
import SubjectsPage from './pages/SubjectsPage';
import SessionsPage from './pages/SessionsPage';
import LiveDashboardPage from './pages/LiveDashboardPage';
import AnalyticsPage from './pages/AnalyticsPage';
import StudentProfilePage from './pages/StudentProfilePage';
import TeacherFaceRequestsPage from './pages/TeacherFaceRequestsPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="face-enroll" element={<FaceEnrollPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route
              path="profile"
              element={
                <ProtectedRoute roles={['student']}>
                  <StudentProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="subjects"
              element={
                <ProtectedRoute roles={['teacher', 'admin']}>
                  <SubjectsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sessions"
              element={
                <ProtectedRoute roles={['teacher', 'admin']}>
                  <SessionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sessions/:sessionId/live"
              element={
                <ProtectedRoute roles={['teacher', 'admin']}>
                  <LiveDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="analytics"
              element={
                <ProtectedRoute roles={['teacher', 'admin']}>
                  <AnalyticsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="face-requests"
              element={
                <ProtectedRoute roles={['teacher', 'admin']}>
                  <TeacherFaceRequestsPage />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
