import { useEffect, useRef } from 'react';

/**
 * Sign-out confirmation dialog.
 *
 * Renders nothing when `open` is false. While open it locks the page
 * behind a fixed backdrop and intercepts Escape / outside-clicks to
 * trigger the cancel handler — both of which behave identically to
 * pressing the "Cancel" button.
 *
 * Used from the shared AppLayout so both Teacher and Student dashboards
 * share the exact same modal markup, copy and styling.
 */
export default function SignOutConfirmModal({ open, onConfirm, onCancel }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    // Move focus to the confirm button so keyboard users can press
    // Enter to immediately sign out — and so screen readers announce
    // the modal as soon as it opens.
    if (confirmRef.current) confirmRef.current.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  function onBackdropClick(e) {
    // Only close when the click is on the backdrop itself, not on the
    // modal panel. This is the same UX rule used by the existing
    // profile-modal in the app.
    if (e.target === e.currentTarget) onCancel();
  }

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signout-confirm-title"
        aria-describedby="signout-confirm-body"
      >
        <h3 id="signout-confirm-title">Sign out</h3>
        <p id="signout-confirm-body">
          Are you sure you want to sign out?
        </p>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-btn-primary"
            ref={confirmRef}
            onClick={onConfirm}
          >
            Yes, Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
