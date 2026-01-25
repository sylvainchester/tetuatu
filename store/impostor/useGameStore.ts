import { getImpostorApiBase, getImpostorAuthHeaders } from '@/lib/impostor/api';
import { storage } from '@/lib/impostor/storage';
import axios from 'axios';
import { create } from 'zustand';

interface User {
  id: string;
  username: string;
}

interface Game {
  id: number;
  status: 'waiting' | 'playing' | 'voting' | 'finished';
  created_at: string;
  player_count: number;
  current_turn_user_id: string | null;
  winner: 'impostor' | 'cabronazos' | 'none' | null;
  result_details: string | null;
  word?: string;
  clue?: string;
}

interface ScoreboardEntry {
  username: string;
  score: number;
}

interface GameStore {
  user: User | null;
  pushToken: string | null;
  games: Game[];
  setUser: (user: User | null) => void;
  setPushToken: (token: string | null) => void;
  isLoading: boolean;
  error: string | null;
  ensureUser: (username: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchGames: () => Promise<void>;
  createGame: () => Promise<number | null>;
  joinGame: (gameId: number) => Promise<boolean>;
  cancelGame: (gameId: number) => Promise<void>;
  scoreboard: ScoreboardEntry[];
  fetchScoreboard: () => Promise<void>;
}

const USER_STORAGE_KEY = 'impostor_user';

async function getApiUrl() {
  const apiUrl = getImpostorApiBase();
  if (!apiUrl) {
    throw new Error('Missing EXPO_PUBLIC_IMPOSTOR_API_URL');
  }
  return apiUrl;
}

async function getAuthHeaders() {
  const headers = await getImpostorAuthHeaders();
  if (!headers) {
    throw new Error('not_authenticated');
  }
  return headers;
}

export const useGameStore = create<GameStore>((set, get) => ({
  user: null,
  pushToken: null,
  games: [],
  scoreboard: [],
  isLoading: false,
  error: null,
  setUser: (user) => set({ user }),
  setPushToken: (token) => set({ pushToken: token }),
  ensureUser: async (username: string) => {
    if (!username.trim()) {
      set({ error: 'Username manquant', isLoading: false });
      return false;
    }

    const current = get().user;
    if (current && current.username === username) {
      return true;
    }

    set({ isLoading: true, error: null });
    try {
      const apiUrl = await getApiUrl();
      const headers = await getAuthHeaders();
      const meRes = await axios.get(`${apiUrl}/me`, { headers });
      set({ user: meRes.data, isLoading: false });
      await storage.setItem(USER_STORAGE_KEY, JSON.stringify(meRes.data));
      return true;
    } catch (error: any) {
      set({ error: error.message || 'Failed to init user', isLoading: false });
      return false;
    }
  },
  logout: async () => {
    await storage.deleteItem(USER_STORAGE_KEY);
    set({ user: null });
  },
  fetchGames: async () => {
    try {
      const apiUrl = await getApiUrl();
      const headers = await getAuthHeaders();
      const res = await axios.get(`${apiUrl}/games`, { headers });
      set({ games: res.data });
    } catch (error) {
      set({ error: (error as Error).message || 'Failed to load games' });
    }
  },
  createGame: async () => {
    set({ isLoading: true, error: null });
    try {
      const apiUrl = await getApiUrl();
      const headers = await getAuthHeaders();
      const res = await axios.post(`${apiUrl}/games`, {}, { headers });
      set({ isLoading: false });
      return res.data.id;
    } catch (error) {
      set({ isLoading: false, error: 'Failed to create game' });
      return null;
    }
  },
  joinGame: async (gameId: number) => {
    const { user } = get();
    if (!user) return false;
    try {
      const apiUrl = await getApiUrl();
      const headers = await getAuthHeaders();
      await axios.post(`${apiUrl}/games/${gameId}/join`, {}, { headers });
      return true;
    } catch (error) {
      set({ error: (error as Error).message || 'Failed to join game' });
      return false;
    }
  },
  cancelGame: async (gameId: number) => {
    try {
      const apiUrl = await getApiUrl();
      const headers = await getAuthHeaders();
      await axios.post(`${apiUrl}/games/${gameId}/cancel`, {}, { headers });
      get().fetchGames();
    } catch (error) {
      set({ error: (error as Error).message || 'Failed to cancel game' });
    }
  },
  fetchScoreboard: async () => {
    try {
      const apiUrl = await getApiUrl();
      const headers = await getAuthHeaders();
      const res = await axios.get(`${apiUrl}/scoreboard`, { headers });
      set({ scoreboard: res.data });
    } catch (error) {
      set({ error: (error as Error).message || 'Failed to load scoreboard' });
    }
  }
}));
