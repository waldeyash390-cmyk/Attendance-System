import { api, extractError } from './client';

export async function markAttendance({ sessionId, descriptor, livenessPassed, lat, lng, accuracy }) {
  const { data } = await api.post('/attendance/mark', {
    sessionId,
    descriptor,
    livenessPassed: livenessPassed === true,
    ...(Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? { lat: Number(lat), lng: Number(lng), accuracy: Number(accuracy) }
      : {}),
  });
  return data;
}

export async function getSessionAttempts(sessionId) {
  const { data } = await api.get(`/attendance/session/${sessionId}/attempts`);
  return data;
}

export async function markManual({ sessionId, studentId, status = 'present', note }) {
  try {
    const { data } = await api.post('/attendance/mark-manual', {
      sessionId,
      studentId,
      status,
      note,
    });
    return data.attendance;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to mark attendance'));
  }
}

export async function updateAttendance({ sessionId, studentId, status, note, method }) {
  try {
    const { data } = await api.put(
      `/attendance/session/${sessionId}/student/${studentId}`,
      { status, note, method },
    );
    return data.attendance;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to update attendance'));
  }
}

export async function getSessionAttendance(sessionId) {
  const { data } = await api.get(`/attendance/session/${sessionId}`);
  return data;
}

export async function getStudentAttendance(studentId) {
  const { data } = await api.get(`/attendance/student/${studentId}`);
  return data;
}
