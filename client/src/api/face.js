import { api } from './client';

export async function enrollFace({ descriptor, source, quality, photo }) {
  const { data } = await api.post('/face/enroll', { descriptor, source, quality, photo });
  return data;
}

export async function faceStatus(userId) {
  const params = userId ? { userId } : undefined;
  const { data } = await api.get('/face/status', { params });
  return data;
}

export async function submitFaceUpdateRequest({ photo, reason }) {
  const { data } = await api.post('/face/update-request', { photo, reason });
  return data;
}

export async function getMyFaceUpdateRequest() {
  const { data } = await api.get('/face/update-request/me');
  return data;
}
