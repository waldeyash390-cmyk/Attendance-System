import { api } from './client';

export async function enrollFace({ descriptor, source, quality, replace }) {
  const { data } = await api.post('/face/enroll', { descriptor, source, quality, replace });
  return data;
}

export async function faceStatus(userId) {
  const params = userId ? { userId } : undefined;
  const { data } = await api.get('/face/status', { params });
  return data;
}