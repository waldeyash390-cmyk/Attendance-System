import { api, extractError } from '../api/client';
export async function listSessions(params = {}) {
  const cleaned = {};
  if (params.subjectId) cleaned.subjectId = params.subjectId;
  if (params.teacherId) cleaned.teacherId = params.teacherId;
  if (params.openOnly === true) cleaned.openOnly = 'true';
  if (params.upcoming === true) cleaned.upcoming = 'true';
  const { data } = await api.get('/sessions', { params: cleaned });
  return data.sessions || [];
}
export async function getSession(id) {
  const { data } = await api.get(`/sessions/${id}`);
  return data.session;
}
export async function createSession(payload) {
  try {
    const { data } = await api.post('/sessions', payload);
    return data.session;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to create session'));
  }
}
export async function updateSession(id, payload) {
  try {
    const { data } = await api.put(`/sessions/${id}`, payload);
    return data.session;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to update session'));
  }
}
export async function deleteSession(id) {
  try {
    const { data } = await api.delete(`/sessions/${id}`);
    return data;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to delete session'));
  }
}
export async function openSession(id) {
  const { data } = await api.post(`/sessions/${id}/open`);
  return data.session;
}
export async function closeSession(id) {
  const { data } = await api.post(`/sessions/${id}/close`);
  return data.session;
}