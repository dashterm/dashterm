/**
 * AuthProvider + StorageProvider that talk to the native gateway
 * (packages/server) — the only backend for the OSS web build.
 *
 * Wire format: cookies for session, plain JSON over REST. The gateway
 * runs on EXPO_PUBLIC_GATEWAY_URL (default http://localhost:8765);
 * in production the gateway and the web bundle ship from the same
 * origin and the env var stays empty so requests stay relative.
 *
 * Realtime: subscribeUserData / subscribeApps open one shared WebSocket to
 * /api/ws. The gateway broadcasts `state:changed` / `apps:changed` after each
 * write (see packages/server/src/realtime.ts), so every tab/window of the same
 * account stays in sync. Drops reconnect with backoff and re-fetch to catch
 * anything missed during the gap.
 */

import type {
  AuthProvider,
  AuthUser,
  SignInResult,
  StorageProvider,
  UserData,
  UserSummary,
} from './types';
import type { CustomApp, UserProfile, AppState } from '../types';

const DEFAULT_BASE = 'http://localhost:8765';

function resolveBase(): string {
  // EXPO_PUBLIC_GATEWAY_URL is set at build time. If unset we assume the
  // dashboard was bundled to ship from the same origin as the gateway and
  // use relative URLs ('' + '/api/...').
  return process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
}

function resolveWsUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_GATEWAY_URL;
  if (explicit) {
    return explicit.replace(/^http(s?):/, 'ws$1:') + '/api/ws';
  }
  // Same-origin (the gateway serves the bundle in production). On web we
  // can derive ws:// from window.location; on a hypothetical RN target
  // without GATEWAY_URL set we fall back to DEFAULT_BASE — but the
  // production flow always has either the explicit env or window.
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/ws`;
  }
  return DEFAULT_BASE.replace(/^http:/, 'ws:') + '/api/ws';
}

interface ApiUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  isAdmin: boolean;
  mustResetPassword: boolean;
  metadata: Record<string, unknown>;
}

function toAuthUser(u: ApiUser): AuthUser {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
    metadata: { ...u.metadata, must_reset_password: u.mustResetPassword },
  };
}

async function http<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${resolveBase()}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j === 'object' && 'error' in j) detail = String((j as { error: unknown }).error);
    } catch {
      /* empty */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export class DashTermApiAuthProvider implements AuthProvider {
  private user: AuthUser | null = null;
  private listeners = new Set<(u: AuthUser | null) => void>();
  private bootstrapped = false;
  private bootstrapping: Promise<void> | null = null;

  constructor() {
    this.bootstrap();
  }

  // Ask the gateway who we are using the existing cookie. Runs once at
  // startup so refresh-on-existing-session works. Failures are silent —
  // the user is just treated as signed-out. /api/auth/me returns
  // { user: null } when not signed in (200, not 401) so this doesn't
  // generate console noise on first visit.
  private bootstrap(): Promise<void> {
    if (this.bootstrapped) return Promise.resolve();
    if (this.bootstrapping) return this.bootstrapping;
    this.bootstrapping = (async () => {
      try {
        const r = await http<{ user: ApiUser | null }>('GET', '/api/auth/me');
        this.setUser(r.user ? toAuthUser(r.user) : null);
      } catch {
        this.setUser(null);
      } finally {
        this.bootstrapped = true;
      }
    })();
    return this.bootstrapping;
  }

  private setUser(u: AuthUser | null) {
    this.user = u;
    for (const cb of this.listeners) {
      try {
        cb(u);
      } catch {
        /* swallow listener errors */
      }
    }
  }

  currentUser(): AuthUser | null {
    return this.user;
  }

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    this.listeners.add(cb);
    // Fire once with whatever we have so far. If bootstrap is still in
    // flight, fire again when it completes.
    cb(this.user);
    if (!this.bootstrapped) {
      void this.bootstrap().then(() => {
        if (this.listeners.has(cb)) cb(this.user);
      });
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  async signOut(): Promise<void> {
    await http<{ ok: boolean }>('POST', '/api/auth/signout');
    this.setUser(null);
  }

  async getIdToken(): Promise<string | null> {
    // Cookie-mode: no bearer token to hand back. Callers that need to
    // authenticate to a separate service should use the gateway as the
    // proxy rather than reaching in for a token.
    return null;
  }

  async signInWithGoogleCredential(): Promise<SignInResult> {
    throw new Error('Google sign-in is not supported on the native backend. Use email + password.');
  }

  async signInWithGooglePopup(): Promise<SignInResult> {
    throw new Error('Google sign-in is not supported on the native backend. Use email + password.');
  }

  async signInWithPassword(email: string, password: string): Promise<SignInResult> {
    const r = await http<{ user: ApiUser }>('POST', '/api/auth/signin', { email, password });
    const user = toAuthUser(r.user);
    this.setUser(user);
    return { user, oauthAccessToken: null };
  }

  async updatePassword(newPassword: string): Promise<void> {
    await http<{ ok: boolean }>('POST', '/api/auth/change-password', { newPassword });
  }

  async updateUserMetadata(patch: Record<string, unknown>): Promise<void> {
    await http<{ ok: boolean }>('POST', '/api/auth/update-metadata', { patch });
    // Refresh the local mirror so currentUser().metadata reflects the patch.
    try {
      const r = await http<{ user: ApiUser | null }>('GET', '/api/auth/me');
      this.setUser(r.user ? toAuthUser(r.user) : null);
    } catch {
      /* leave stale; next bootstrap will fix */
    }
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface StateResponse {
  profile: UserProfile;
  appState: AppState;
  lastUpdated: number;
}

export class DashTermApiStorageProvider implements StorageProvider {
  // Shared WS instance + per-event-type listener sets. The provider lazily
  // opens the connection when something subscribes and keeps it alive as
  // long as ANY consumer is subscribed. A drop triggers exponential
  // backoff reconnect; on reconnect, subscribeUserData consumers get a
  // fresh fetch since they may have missed pushes during the gap.
  private ws: WebSocket | null = null;
  private userListeners = new Map<string, Set<(data: UserData | null) => void>>();
  private appsListeners = new Set<(apps: CustomApp[]) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wantConnected = false;

  async getUserData(_uid: string): Promise<UserData | null> {
    try {
      const r = await http<StateResponse>('GET', '/api/state');
      return { profile: r.profile, appState: { ...r.appState, lastUpdated: r.lastUpdated } as AppState };
    } catch {
      return null;
    }
  }

  async setUserData(_uid: string, data: UserData): Promise<void> {
    await http<{ ok: boolean }>('PUT', '/api/state', {
      profile: data.profile,
      appState: data.appState,
    });
  }

  subscribeUserData(uid: string, cb: (data: UserData | null) => void): () => void {
    // Initial fetch — consumers expect the current row on mount. WS pushes
    // arrive only on subsequent changes.
    this.getUserData(uid).then(cb).catch(() => cb(null));

    let set = this.userListeners.get(uid);
    if (!set) {
      set = new Set();
      this.userListeners.set(uid, set);
    }
    set.add(cb);
    this.ensureWs();

    return () => {
      const s = this.userListeners.get(uid);
      if (s) {
        s.delete(cb);
        if (s.size === 0) this.userListeners.delete(uid);
      }
      this.maybeCloseWs();
    };
  }

  // ---- apps ----

  async getApp(shareCode: string): Promise<CustomApp | null> {
    try {
      const r = await http<{ app: CustomApp }>('GET', `/api/apps/${encodeURIComponent(shareCode)}`);
      return r.app;
    } catch {
      return null;
    }
  }

  async setApp(shareCode: string, app: CustomApp): Promise<void> {
    await http<{ ok: boolean }>('PUT', `/api/apps/${encodeURIComponent(shareCode)}`, app);
  }

  async deleteApp(shareCode: string): Promise<void> {
    await http<{ ok: boolean }>('DELETE', `/api/apps/${encodeURIComponent(shareCode)}`);
  }

  private async fetchAndDispatchApps(): Promise<void> {
    try {
      const r = await http<{ apps: CustomApp[] }>('GET', '/api/apps');
      for (const cb of this.appsListeners) cb(r.apps);
    } catch {
      for (const cb of this.appsListeners) cb([]);
    }
  }

  subscribeApps(cb: (apps: CustomApp[]) => void): () => void {
    this.appsListeners.add(cb);
    void http<{ apps: CustomApp[] }>('GET', '/api/apps')
      .then((r) => cb(r.apps))
      .catch(() => cb([]));
    this.ensureWs();
    return () => {
      this.appsListeners.delete(cb);
      this.maybeCloseWs();
    };
  }

  subscribeApp(shareCode: string, cb: (app: CustomApp | null) => void): () => void {
    void this.getApp(shareCode).then(cb);
    return () => {};
  }

  // ---- websocket plumbing ----

  private ensureWs(): void {
    this.wantConnected = true;
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this.openWs();
  }

  private openWs(): void {
    try {
      const sock = new WebSocket(resolveWsUrl());
      this.ws = sock;

      sock.onopen = () => {
        this.reconnectAttempts = 0;
        // Catch up on anything that changed while the socket was down (or
        // before it first connected): a missed `apps:changed` broadcast —
        // e.g. an agent push that landed during a reconnect — would otherwise
        // leave the custom-app list stale until the next broadcast or reload.
        if (this.appsListeners.size > 0) void this.fetchAndDispatchApps();
      };

      sock.onmessage = (ev: MessageEvent) => {
        let msg: { type?: string; appState?: AppState; lastUpdated?: number } | null = null;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;
        if (msg.type === 'state:changed') {
          // We have the new appState in the push, but the dashboard's
          // consumer expects a full UserData (profile + appState). Profiles
          // change rarely — re-fetch on each push to stay in sync without
          // tracking the profile separately in the message.
          for (const uid of this.userListeners.keys()) {
            void this.getUserData(uid).then((data) => {
              const set = this.userListeners.get(uid);
              if (!set) return;
              for (const cb of set) cb(data);
            });
          }
        } else if (msg.type === 'apps:changed') {
          void this.fetchAndDispatchApps();
        }
      };

      sock.onclose = () => {
        this.ws = null;
        if (this.wantConnected && this.hasListeners()) this.scheduleReconnect();
      };

      sock.onerror = () => {
        // The close handler will follow; leave reconnect to that path.
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * Math.pow(2, Math.min(this.reconnectAttempts, 6)));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected && this.hasListeners()) {
        this.openWs();
        // A drop may have hidden mutations from other tabs; re-fetch so
        // the dashboard catches up on what it missed.
        for (const uid of this.userListeners.keys()) {
          void this.getUserData(uid).then((data) => {
            const set = this.userListeners.get(uid);
            if (!set) return;
            for (const cb of set) cb(data);
          });
        }
        if (this.appsListeners.size > 0) void this.fetchAndDispatchApps();
      }
    }, delay);
  }

  private hasListeners(): boolean {
    return this.userListeners.size > 0 || this.appsListeners.size > 0;
  }

  private maybeCloseWs(): void {
    if (this.hasListeners()) return;
    this.wantConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closed */ }
      this.ws = null;
    }
  }

  // ---- user management ----

  async listUsers(): Promise<UserSummary[]> {
    const r = await http<{ users: UserSummary[] }>('GET', '/api/users');
    return r.users;
  }

  async deleteUser(uid: string): Promise<void> {
    await http<{ ok: boolean }>('DELETE', `/api/users/${encodeURIComponent(uid)}`);
  }
}

export function createDashTermApiProviders(): {
  authProvider: AuthProvider;
  storage: StorageProvider;
} {
  return {
    authProvider: new DashTermApiAuthProvider(),
    storage: new DashTermApiStorageProvider(),
  };
}
