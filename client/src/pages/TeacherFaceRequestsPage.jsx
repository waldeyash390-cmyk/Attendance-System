import { useCallback, useEffect, useState } from 'react';
import {
  listTeacherFaceRequests,
  approveTeacherFaceRequest,
  rejectTeacherFaceRequest,
} from '../api/teacherFaceRequests';
import { extractError } from '../api/client';

const TABS = [
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function RequestCard({ req, busy, onApprove, onReject }) {
  const [reviewNote, setReviewNote] = useState('');
  const [localError, setLocalError] = useState('');
  const student = req.student || {};

  const isPending = req.status === 'pending';

  function handleApprove() {
    setLocalError('');
    onApprove(req.id, reviewNote).catch((err) => setLocalError(extractError(err, 'Approve failed')));
  }
  function handleReject() {
    setLocalError('');
    onReject(req.id, reviewNote).catch((err) => setLocalError(extractError(err, 'Reject failed')));
  }

  return (
    <div className="card face-request-card">
      <div className="card-header">
        <h3>{student.fullName || 'Student'}</h3>
        <span className={'badge badge-' + req.status}>{req.status}</span>
      </div>

      <div className="muted small">
        {student.rollNumber && <span>Roll: {student.rollNumber} · </span>}
        {student.email && <span>{student.email}</span>}
      </div>

      <div className="face-compare">
        <div className="face-compare-col">
          <div className="muted small">Current enrolled photo</div>
          {student.currentFaceImageUrl ? (
            <img src={student.currentFaceImageUrl} alt="Current" />
          ) : (
            <div className="muted">No photo on file</div>
          )}
          {student.faceEnrolledAt && (
            <div className="muted small">Enrolled {formatDateTime(student.faceEnrolledAt)}</div>
          )}
        </div>
        <div className="face-compare-col">
          <div className="muted small">Requested photo</div>
          <img src={req.pendingImageUrl} alt="Requested" />
          <div className="muted small">Submitted {formatDateTime(req.requestedAt)}</div>
        </div>
      </div>

      {req.reason && (
        <p><strong>Student note:</strong> {req.reason}</p>
      )}

      {isPending && (
        <>
          <label>
            Review note (optional)
            <input
              type="text"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="e.g. better lighting next time"
            />
          </label>
          {localError && <div className="alert error">{localError}</div>}
          <div className="row gap">
            <button type="button" onClick={handleApprove} disabled={busy}>
              Approve
            </button>
            <button type="button" className="danger" onClick={handleReject} disabled={busy}>
              Reject
            </button>
          </div>
        </>
      )}

      {!isPending && (
        <>
          <p className="muted small">Reviewed {formatDateTime(req.reviewedAt)}</p>
          {req.reviewNote && <p><strong>Review note:</strong> {req.reviewNote}</p>}
        </>
      )}
    </div>
  );
}

export default function TeacherFaceRequestsPage() {
  const [status, setStatus] = useState('pending');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listTeacherFaceRequests(status);
      setRequests(data.requests || []);
    } catch (err) {
      setError(extractError(err, 'Failed to load requests'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = useCallback(async (id, reviewNote) => {
    setBusyId(id);
    setMessage('');
    try {
      await approveTeacherFaceRequest(id, reviewNote);
      setMessage('Request approved.');
      await load();
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleReject = useCallback(async (id, reviewNote) => {
    setBusyId(id);
    setMessage('');
    try {
      await rejectTeacherFaceRequest(id, reviewNote);
      setMessage('Request rejected.');
      await load();
    } finally {
      setBusyId(null);
    }
  }, [load]);

  return (
    <section className="page">
      <div className="page-header">
        <h1>Face change requests</h1>
        <p className="muted">
          Review students who have requested a face change. Approving replaces the live
          photo; rejecting discards the pending photo.
        </p>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={'tab' + (status === t.key ? ' active' : '')}
            onClick={() => setStatus(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {loading && <p>Loading...</p>}

      {!loading && requests.length === 0 && (
        <div className="card"><p className="muted">No {status} requests.</p></div>
      )}

      <div className="stack">
        {requests.map((r) => (
          <RequestCard
            key={r.id}
            req={r}
            busy={busyId === r.id}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}
      </div>
    </section>
  );
}
