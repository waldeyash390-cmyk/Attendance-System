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

const REASON_PRESETS = [
  'face changed',
  'photo unclear',
  'enrollment error',
];

export default function FaceEnrollPage() {
  const [status, setStatus] = useState(null);
  const [latestRequest, setLatestRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('locked'); // change | locked
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');

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
      const trimmedReason = reason.trim();
      const result = await submitFaceUpdateRequest({
        photo,
        reason: trimmedReason || null,
      });
      setMessage('Face re-enrollment request submitted. A teacher will review and approve it.');
      setLatestRequest(result.request);
      setMode('locked');
      setReason('');
    } catch (err) {
      setError(extractError(err, 'Failed to submit face re-enrollment request'));
      throw err;
    }
  }, [reason]);

  const openRequestForm = useCallback(() => {
    setReason('');
    setError('');
    setMessage('');
    setMode('change');
  }, []);

  const cancelRequestForm = useCallback(() => {
    setReason('');
    setError('');
    setMode('locked');
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
          You have a pending face re-enrollment request submitted on{' '}
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
            <h2>Request face re-enrollment</h2>
            <button type="button" className="btn-link" onClick={cancelRequestForm}>
              Cancel
            </button>
          </div>
          <p className="muted">
            Tell us why you need a re-enrollment, then take a fresh photo. Your current
            enrolled face will stay active until a teacher approves the change.
          </p>

          <div className="form-row">
            <label>
              <span>Reason (optional)</span>
              <select
                value={REASON_PRESETS.includes(reason) ? reason : (reason ? '__custom__' : '')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__custom__') setReason('');
                  else setReason(v);
                }}
              >
                <option value="">Select a reason…</option>
                {REASON_PRESETS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
                <option value="__custom__">Other (type below)</option>
              </select>
            </label>
          </div>

          {!REASON_PRESETS.includes(reason) && (
            <div className="form-row">
              <label>
                <span>Custom reason</span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. glasses, beard, recent haircut"
                  maxLength={200}
                />
              </label>
            </div>
          )}

          <FaceCapture
            onCapture={handleSubmitChange}
            buttonLabel="Submit re-enrollment request"
            captureSnapshot
          />
        </div>
      )}

      {!loading && enrolled && mode === 'locked' && (
        <div className="card">
          <div className="card-header"><h2>Enrolled</h2></div>

          {pending ? (
            <>
              <p>Your face is locked while a re-enrollment request is pending teacher approval.</p>
              <div className="status-pill" role="status" aria-live="polite">
                <span className="status-pill-dot" />
                Request Pending Teacher Approval
              </div>
            </>
          ) : (
            <>
              <p>Your face is locked. You can only change it by submitting a request for teacher approval.</p>
              <button
                type="button"
                onClick={openRequestForm}
              >
                Request face re-enrollment
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
