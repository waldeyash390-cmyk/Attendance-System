const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const PHOTO_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
};

function persistFacePhoto({ data, prefix }) {
  if (typeof data !== 'string' || !data) {
    return { error: 'photo data is required' };
  }

  let mime = null;
  let b64 = null;
  const m = data.match(/^data:([^;]+);base64,(.+)$/);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  } else {
    mime = 'image/jpeg';
    b64 = data;
  }

  if (!PHOTO_MIME_TO_EXT[mime]) {
    return { error: 'photo must be an image (jpg, png, webp, or gif)' };
  }

  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch (err) {
    return { error: 'photo is not valid base64' };
  }
  if (!buf || buf.length === 0) {
    return { error: 'photo is empty' };
  }
  if (buf.length > MAX_PHOTO_BYTES) {
    return { error: `photo must be at most ${MAX_PHOTO_BYTES / (1024 * 1024)}MB` };
  }

  const ext = PHOTO_MIME_TO_EXT[mime];
  const filename = `${prefix}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(fullPath, buf);
  return { url: `/api/uploads/${filename}`, filename, bytes: buf.length };
}

function tryDeletePhotoFile(publicUrl) {
  if (!publicUrl) return;
  const m = String(publicUrl).match(/^\/api\/uploads\/([^/?#]+)$/);
  if (!m) return;
  const filename = m[1];
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return;
  }
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.unlink(fullPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[face] failed to delete photo', fullPath, err.message);
    }
  });
}

module.exports = { persistFacePhoto, tryDeletePhotoFile, UPLOAD_DIR };
