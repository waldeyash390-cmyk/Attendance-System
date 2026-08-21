import axios from 'axios';

const TOKEN_KEY = 'attendance.token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      setToken(null);
    }
    return Promise.reject(err);
  },
);

export function extractError(err, fallback = 'Request failed') {
  if (err && err.response && err.response.data) {
    const d = err.response.data;
    if (typeof d === 'string') return d;
    if (d.error) return d.error;
  }
  if (err && err.message) return err.message;
  return fallback;
}
