import type { PosStateSnapshot, UserPublic } from '../shared/types';

export interface QueuedMutation {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  label: string;
  queuedAt: string;
}

const TOKEN_KEY = 'brewdesk_jwt_token';
const USER_KEY = 'brewdesk_user';
const CACHE_KEY = 'brewdesk_cached_state';
const QUEUE_KEY = 'brewdesk_offline_queue';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): UserPublic | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserPublic) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: UserPublic): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function loadCachedState(): PosStateSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PosStateSnapshot) : null;
  } catch {
    return null;
  }
}

export function saveCachedState(state: PosStateSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadOfflineQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: QueuedMutation[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage quota errors
  }
}

const API_BASE = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

const WS_BASE = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_WS_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${cleanPath}` : cleanPath;
}

export function getWsUrl(token: string): string {
  const encoded = encodeURIComponent(token);
  if (WS_BASE) {
    return `${WS_BASE}/ws?token=${encoded}`;
  }
  if (API_BASE && /^https?:\/\//i.test(API_BASE)) {
    const wsOrigin = API_BASE.replace(/^http/i, 'ws');
    return `${wsOrigin}/ws?token=${encoded}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws?token=${encoded}`;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return true;
  }
  return false;
}
