import { useEffect, useState, useCallback } from 'react';
import FaceCapture from '../components/FaceCapture';
import { enrollFace, faceStatus } from '../api/face';
import { extractError } from '../api/client';

export default function FaceEnrollPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await faceStatus();
      setStatus(data);
    } catch (err) {
      setError(extractError(err, 'Failed to load enrollment status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleCapture = useCallback(async (descriptor) => {
    setMessage('');
    setError('');
    try {
      const result = await enrollFace({
        descriptor,
        source: status && status.enrolled ? 're_enrollment' : 'enrollment',
        replace: true,
      });
      setMessage('Face enrolled successfully.');
      await loadStatus();
      return result;
    } catch (err) {
      setError(extractError(err, 'Enrollment failed'));
    }
  }, [status, loadStatus]);

  return (
    <section className="page">
      <div className="page-header">
        <h1>Face enrollment</h1>
        <p className="muted">Register your face so it can be matched during attendance.</p>
      </div>

      {loading && <p>Loading status...</p>}

      {!loading && status && (
        <div className="card">
          <div className="card-header"><h2>Status</h2></div>
          <p>
            {status.enrolled
              ? 'You are enrolled. You can re-enroll to update your face.'
              : 'You are not enrolled yet.'}
          </p>
          {status.active && (
            <p className="muted">
              Last enrolled: {new Date(status.active.createdAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className="card">
        <div className="card-header"><h2>{status && status.enrolled ? 'Re-enroll' : 'Enroll now'}</h2></div>
        <FaceCapture onCapture={handleCapture} buttonLabel="Enroll face" />
      </div>
    </section>
  );
}