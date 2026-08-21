import { api } from './client';

export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function register(payload) {
  const { data } = await api.post('/auth/register', payload);
  return data;
}

export async function me() {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function lookupStudent({ email, rollNumber }) {
  const params = {};
  if (email) params.email = email;
  if (rollNumber) params.rollNumber = rollNumber;
  const { data } = await api.get('/auth/lookup', { params });
  return data;
}