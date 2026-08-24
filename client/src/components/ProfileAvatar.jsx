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
//
// Implementation notes:
//   - We use the current `src` value as the `key` on the underlying <img>.
//     This forces React to unmount and remount the element whenever the
//     parent passes a new src, which guarantees a fresh load attempt with
//     no inherited onError / cached-failure state.
//   - `errored` is local state that tracks the load failure of the *current*
//     <img> only. When the parent re-renders with a new src, the new
//     <img> is a separate element (thanks to key=src) and gets its own
//     fresh errored=false. This is the most robust pattern for handling
//     a parent that reassigns src: the previous failure is discarded
//     along with the previous DOM node.
export default function ProfileAvatar({ src, name, alt, className }) {
  const [errored, setErrored] = useState(false);
  const showImg = !!src && !errored;

  return (
    <div className={className || 'profile-avatar'} aria-hidden="true">
      {showImg
        ? (
          <img
            key={src}
            src={src}
            alt={alt || `${name || 'User'} photo`}
            onError={() => setErrored(true)}
            onLoad={() => setErrored(false)}
          />
        )
        : <span className="profile-avatar-initials">{initialsOf(name)}</span>}
    </div>
  );
}
