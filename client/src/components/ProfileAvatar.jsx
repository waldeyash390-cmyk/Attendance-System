import { useState } from 'react';

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => (p[0] ? p[0].toUpperCase() : '')).join('') || '?';
}

// <ProfileAvatar> renders a user's profile photo when src is provided and
// the image loads successfully. If the photo is missing, fails to load
// (e.g. a 404 because the file was deleted from server/uploads/ but the
// user record still references it), or errors mid-stream, we silently fall
// back to an initials chip so the user never sees a broken-image icon.
export default function ProfileAvatar({ src, name, alt, className }) {
  const [errored, setErrored] = useState(false);
  const showImg = !!src && !errored;

  return (
    <div className={className || 'profile-avatar'} aria-hidden="true">
      {showImg
        ? (
          <img
            src={src}
            alt={alt || `${name || 'User'} photo`}
            onError={() => setErrored(true)}
          />
        )
        : <span className="profile-avatar-initials">{initialsOf(name)}</span>}
    </div>
  );
}
