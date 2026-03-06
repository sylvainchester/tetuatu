import { getPushApiBase } from '@/lib/pushApi';
import { supabase } from '@/lib/supabase';

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return { Authorization: `Bearer ${token}` };
}

async function request(path: string, init: RequestInit = {}) {
  const base = getPushApiBase();
  if (!base) throw new Error('missing_push_api_base');
  const headers = new Headers(init.headers || {});
  const authHeaders = await getAuthHeader();
  headers.set('Authorization', authHeaders.Authorization);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${base}${path}`, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('api_not_reached_non_json_response');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `request_failed_${response.status}`);
  }
  return payload;
}

export async function submitExerciseAttempt(params: {
  testId: string;
  title: string;
  summary: string;
  score?: number | null;
  payload?: Record<string, any>;
}) {
  return request('/exercises/submit', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

export async function listProfAttempts() {
  return request('/prof/attempts');
}

export async function fetchProfAttempt(id: string) {
  const safe = encodeURIComponent(id);
  return request(`/prof/attempt?id=${safe}`);
}

export async function markProfAttemptRead(id: string) {
  return request('/prof/mark-read', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
}

export async function submitProfReview(params: { id: string; decision: 'correct' | 'a_corriger'; comment: string }) {
  return request('/prof/review', {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

export async function listStudentCorrections() {
  return request('/student/corrections');
}

export async function listStudentAttempts(testId: string) {
  const safe = encodeURIComponent(testId);
  return request(`/student/attempts?test_id=${safe}`);
}
