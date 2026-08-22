import { api } from './client';

export async function getSubjectAnalytics({ subjectId, threshold, from, to }) {
  const params = {};
  if (threshold !== undefined && threshold !== null && threshold !== '') params.threshold = threshold;
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await api.get(`/analytics/subject/${subjectId}`, { params });
  return data;
}

export function getSubjectAnalyticsCsvUrl({ subjectId, threshold, from, to }) {
  const params = new URLSearchParams();
  if (threshold !== undefined && threshold !== null && threshold !== '') params.set('threshold', threshold);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  // For browsers, fetching a file from the API requires the bearer token.
  // We expose this helper for the case where a teacher opens the URL in a new
  // tab (in which case they log in separately and cookie/session auth applies)
  // and we use downloadSubjectAnalyticsCsv for the in-app flow.
  return `/api/analytics/subject/${subjectId}/export.csv${qs ? `?${qs}` : ''}`;
}

export async function downloadSubjectAnalyticsCsv({ subjectId, threshold, from, to, filename }) {
  const params = {};
  if (threshold !== undefined && threshold !== null && threshold !== '') params.threshold = threshold;
  if (from) params.from = from;
  if (to) params.to = to;
  const res = await api.get(`/analytics/subject/${subjectId}/export.csv`, {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `attendance_${subjectId}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
