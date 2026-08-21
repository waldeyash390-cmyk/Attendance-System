import { api } from './client';

export async function markAttendance({ sessionId, descriptor }) {
  const { data } = await api.post('/attendance/mark', { sessionId, descriptor });
  return data;
}

export async function getSessionAttendance(sessionId) {
  const { data } = await api.get(`/attendance/session/${sessionId}`);
  return data;
}

export async function getStudentAttendance(studentId) {
  const { data } = await api.get(`/attendance/student/${studentId}`);
  return data;
}