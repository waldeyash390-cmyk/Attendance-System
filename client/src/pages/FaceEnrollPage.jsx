import { useEffect, useState, useCallback } from 'react';
import FaceCapture from '../components/FaceCapture';
import {
  enrollFace,
  faceStatus,
  submitFaceUpdateRequest,
  getMyFaceUpdateRequest,
} from '../api/face';
import { extractError } from '../api/client';

function statusLabel(s) {
  if (s === 'pending') return 'Pending review';
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  return s || '-';
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export default function FaceEnrollPage() {
  const [status, setStatus] = useState(null);
  const [latestRequest, setLatestRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('initial'); // initial | change | locked
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, mine] = await Promise.all([
        faceStatus(),
        getMyFaceUpdateRequest().catch(() => ({ request: null })),
      ]);
      setStatus(s);
      setLatestRequest(mine && mine.request ? mine.request : null);
    } catch (err) {
      setError(extractError(err, 'Failed to load enrollment status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleEnroll = useCallback(async ({ descriptor, photo }) => {
    setMessage('');
    setError('');
    try {
      await enrollFace({
        descriptor,
        source: 'enrollment',
        photo,
      });
      setMessage('Face enrolled successfully. This is locked — to change it, submit a face change request.');
      setMode('locked');
      await refresh();
    } catch (err) {
      setError(extractError(err, 'Enrollment failed'));
      throw err;
    }
  }, [refresh]);

  const handleSubmitChange = useCallback(async ({ descriptor, photo }) => {
    setMessage('');
    setError('');
    try {
      // The server only needs the photo for the pending request, but we
      // also recompute the descriptor so live attendance still works for
      // students whose face has actually changed.
      const result = await submitFaceUpdateRequest({ photo, reason: null });
      setMessage('Face change request submitted. A teacher will review and approve it.');
      setLatestRequest(result.request);
      setMode('locked');
    } catch (err) {
      setError(extractError(err, 'Failed to submit face change request'));
      throw err;
    }
  }, []);

  const face = status && status.face;
  const enrolled = Boolean(face && face.faceEnrolled);
  const pending = latestRequest && latestRequest.status === 'pending';
  const lastClosed = latestRequest && latestRequest.status !== 'pending'
    ? latestRequest : null;

  return (
    <section className="page">
      <div className="page-header">
        <h1>Face enrollment</h1>
        <p className="muted">
          Register your face so it can be matched during attendance.
          Once enrolled, your face is locked and any change requires teacher approval.
        </p>
      </div>

      {loading && <p>Loading status...</p>}

      {!loading && status && (
        <div className="card">
          <div className="card-header"><h2>Status</h2></div>
          {enrolled ? (
            <>
              <p>
                <strong>Enrolled</strong>
                {face.faceEnrolledAt && (
                  <> · since {formatDateTime(face.faceEnrolledAt)}</>
                )}
              </p>
              {face.faceImageUrl && (
                <p>
                  <img
                    src={face.faceImageUrl}
                    alt="Enrolled face"
                    style={{ maxWidth: 220, borderRadius: 8 }}
                  />
                </p>
              )}
            </>
          ) : (
            <p>You are not enrolled yet. Scan your face below to enroll.</p>
          )}
        </div>
      )}

      {!loading && pending && (
        <div className="alert info">
          You have a pending face change request submitted on{' '}
          <strong>{formatDateTime(latestRequest.requestedAt)}</strong>.
          A teacher will review it shortly. You cannot submit another request until this one is closed.
        </div>
      )}

      {!loading && !pending && lastClosed && (
        <div className={'alert ' + (lastClosed.status === 'approved' ? 'success' : 'error')}>
          Your most recent face change request was <strong>{statusLabel(lastClosed.status)}</strong>
          {lastClosed.reviewedAt && <> on <strong>{formatDateTime(lastClosed.reviewedAt)}</strong></>}
          {lastClosed.reviewNote && <> — <em>{lastClosed.reviewNote}</em></>}.
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {!loading && !enrolled && (
        <div className="card">
          <div className="card-header"><h2>Enroll now</h2></div>
          <FaceCapture
            onCapture={handleEnroll}
            buttonLabel="Enroll face"
            captureSnapshot
          />
        </div>
      )}

      {!loading && enrolled && mode === 'change' && !pending && (
        <div className="card">
          <div className="card-header">
            <h2>Request face change</h2>
            <button type="button" className="link-button" onClick={() => setMode('locked')}>
              Cancel
            </button>
          </div>
          <p className="muted">
            Take a fresh photo. It will be sent to your teacher for approval. Your
            current enrolled face will stay active until the teacher approves the change.
          </p>
          <FaceCapture
            onCapture={handleSubmitChange}
            buttonLabel="Submit change request"
            captureSnapshot
          />
        </div>
      )}

      {!loading && enrolled && mode === 'locked' && !pending && (
        <div className="card">
          <div className="card-header"><h2>Enrolled</h2></div>
          <p>Your face is locked. You can only change it by submitting a request for teacher approval.</p>
          <button
            type="button"
            onClick={() => setMode('change')}
            disabled={Boolean(pending)}
          >
            Request face change
          </button>
        </div>
      )}
    </section>
  );
}
