import { api } from './client';

// ---- Student self-service ----

export async function getMyProfile() {
  const { data } = await api.get('/profile/me');
  return data.profile;
}

export async function updateMyProfile(payload) {
  const { data } = await api.put('/profile/me', payload);
  return data.profile;
}

// ---- Teacher editing a student ----

export async function getStudentProfile(userId) {
  const { data } = await api.get(`/profile/${userId}`);
  return data.profile;
}

export async function updateStudentProfile(userId, payload) {
  const { data } = await api.put(`/profile/${userId}`, payload);
  return data.profile;
}

export async function unlockStudentProfile(userId) {
  const { data } = await api.post(`/profile/${userId}/unlock`);
  return data.profile;
}

// ---- Validation helpers shared by the Profile page and the inline panel ----

export const PHOTO_MIN_BYTES = 2 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

export function isValidPhone(raw) {
  const s = String(raw || '').trim().replace(/[\s\-()]/g, '');
  if (!s) return false;
  return /^\+?[0-9]{10,15}$/.test(s);
}

export function isValidEmail(raw) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(raw || '').trim());
}

// Read a File/Blob and return { dataUrl, mime, bytes }. Used by the profile
// photo input — the SPA converts the selected file to a base64 data URL and
// ships it in the JSON body so we don't need multipart on the server.
export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected'));
      return;
    }
    if (!PHOTO_MIME_TYPES.includes(file.type)) {
      reject(new Error('Photo must be an image (jpg, png, webp, or gif)'));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      reject(new Error(`Photo must be at most ${PHOTO_MAX_BYTES / (1024 * 1024)}MB`));
      return;
    }
    if (file.size < PHOTO_MIN_BYTES) {
      reject(new Error(`Photo must be at least ${PHOTO_MIN_BYTES / (1024 * 1024)}MB`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({ dataUrl: result, mime: file.type, bytes: file.size });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
