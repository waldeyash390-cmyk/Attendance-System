import { api, extractError } from '../api/client';
export async function listSubjects(params = {}) {
  const cleaned = {};
  if (params.department) cleaned.department = params.department;
  if (params.semester) cleaned.semester = params.semester;
  if (params.q) cleaned.q = params.q;
  const { data } = await api.get('/subjects', { params: cleaned });
  return data.subjects || [];
}
export async function getSubject(id) {
  const { data } = await api.get(`/subjects/${id}`);
  return data.subject;
}
export async function createSubject({ code, name, department, semester }) {
  const payload = { code: code.trim(), name: name.trim() };
  if (department && department.trim()) payload.department = department.trim();
  if (semester !== '' && semester !== null && semester !== undefined) payload.semester = semester;
  try {
    const { data } = await api.post('/subjects', payload);
    return data.subject;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to create subject'));
  }
}
export async function updateSubject(id, { code, name, department, semester }) {
  const payload = { code: code.trim(), name: name.trim() };
  if (department && department.trim()) payload.department = department.trim();
  if (semester !== '' && semester !== null && semester !== undefined) payload.semester = semester;
  try {
    const { data } = await api.put(`/subjects/${id}`, payload);
    return data.subject;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to update subject'));
  }
}
export async function deleteSubject(id) {
  try {
    const { data } = await api.delete(`/subjects/${id}`);
    return data;
  } catch (err) {
    throw new Error(extractError(err, 'Failed to delete subject'));
  }
}