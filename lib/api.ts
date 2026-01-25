import { getBackendUrl } from './backend';
import { supabase } from './supabase';

const backendUrl = getBackendUrl();

if (!backendUrl) {
  throw new Error('Missing EXPO_PUBLIC_BACKEND_URL');
}

async function getAccessToken() {
  const session = await supabase.auth.getSession();
  return session.data.session?.access_token || '';
}

async function request(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const token = await getAccessToken();
  if (!token) {
    throw new Error('not_authenticated');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal
    });
  } catch (err: any) {
    clearTimeout(timeout);
    throw new Error(err?.name === 'AbortError' ? 'timeout' : 'network_error');
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const payload = await response.json().catch(async () => {
      const text = await response.text().catch(() => '');
      return { error: text };
    });
    const detail = payload.error || `request_failed (${response.status})`;
    if (detail === 'invalid_token' && retry) {
      await supabase.auth.refreshSession();
      return request(path, options, false);
    }
    throw new Error(detail);
  }

  return response.json();
}

export async function listGames() {
  return request('/games');
}

export async function createGame() {
  return request('/games', { method: 'POST' });
}

export async function fetchGame(gameId: string) {
  return request(`/games/${gameId}`);
}

export async function joinGame(gameId: string, seat: number) {
  return request(`/games/${gameId}/join`, {
    method: 'POST',
    body: JSON.stringify({ seat })
  });
}

export async function addRobot(gameId: string, seat: number) {
  return request(`/games/${gameId}/robot`, {
    method: 'POST',
    body: JSON.stringify({ seat })
  });
}

export async function leaveGame(gameId: string) {
  return request(`/games/${gameId}/leave`, { method: 'POST' });
}

export async function deleteGame(gameId: string) {
  return request(`/games/${gameId}`, { method: 'DELETE' });
}

export async function placeBid(gameId: string, payload: { contrat: string; atout?: string; coinche?: string }) {
  return request(`/games/${gameId}/bids`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function cancelBids(gameId: string) {
  return request(`/games/${gameId}/bids/cancel`, { method: 'POST' });
}

export async function playCard(gameId: string, card: string) {
  return request(`/games/${gameId}/play`, {
    method: 'POST',
    body: JSON.stringify({ card })
  });
}

export async function undoLast(gameId: string) {
  return request(`/games/${gameId}/undo-last`, { method: 'POST' });
}

export async function collectTrick(gameId: string) {
  return request(`/games/${gameId}/trick/collect`, { method: 'POST' });
}

export async function cancelTrick(gameId: string) {
  return request(`/games/${gameId}/trick/cancel`, { method: 'POST' });
}

export async function finishDebrief(gameId: string) {
  return request(`/games/${gameId}/debrief/finish`, { method: 'POST' });
}

export async function disableHints(gameId: string) {
  return request(`/games/${gameId}/hints/disable`, { method: 'POST' });
}

export async function enableHints(gameId: string) {
  return request(`/games/${gameId}/hints/enable`, { method: 'POST' });
}

export async function dealHand(gameId: string) {
  return request(`/games/${gameId}/deal`, { method: 'POST' });
}
