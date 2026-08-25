import { api } from './client';

export async function listTeacherFaceRequests(status = 'pending') {
  const { data } = await api.get('/teacher/face-requests', { params: { status } });
  return data;
}

export async function approveTeacherFaceRequest(id, reviewNote) {
  const { data } = await api.post(`/teacher/face-requests/${id}/approve`, { reviewNote });
  return data;
}

export async function rejectTeacherFaceRequest(id, reviewNote) {
  const { data } = await api.post(`/teacher/face-requests/${id}/reject`, { reviewNote });
  return data;
}
