/**
 * Provider interfaces — the seam between core code and the backend.
 *
 * The OSS build ships one implementation: DashTermApiProvider
 * (./dashtermApi.ts), which talks to the native gateway in packages/server
 * over REST + a session cookie.
 *
 * Design notes:
 *
 * - UID is always a parameter, never read off provider state. The provider
 *   is auth-stateless; consumers (hooks) drive the auth->data join.
 * - subscribeUserData / subscribeApps return an unsubscribe function.
 * - Apps are stored at apps/{shareCode}. subscribeApps yields the full
 *   collection; callers filter by ownerId. RLS denies non-owners.
 */

import type { AppState, CustomApp, UserProfile } from '../types';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  // Arbitrary per-user metadata the operator/admin sets on the auth account.
  // We use this for `must_reset_password` (admin-seeded accounts), but it's
  // open-ended — anything the dashboard wants to track per-account that
  // doesn't belong in app_state can live here.
  metadata: Record<string, unknown>;
}

export interface SignInResult {
  user: AuthUser;
  // Provider-specific OAuth access token (Google Gmail/Calendar scopes etc).
  // Callers that need it know which provider they're on.
  oauthAccessToken: string | null;
}

export interface AuthProvider {
  currentUser(): AuthUser | null;
  onAuthChange(cb: (user: AuthUser | null) => void): () => void;
  signOut(): Promise<void>;

  // Bearer token for calling our own backend (/api/cli/*, etc).
  getIdToken(forceRefresh?: boolean): Promise<string | null>;

  // Sign in with a credential already obtained from the OAuth flow.
  // Used by the mobile path (expo-auth-session returns id_token + access_token).
  signInWithGoogleCredential(idToken: string, accessToken: string | null): Promise<SignInResult>;

  // Sign in via the provider's own OAuth flow (web popup / redirect).
  // Returns the user once the flow completes.
  signInWithGooglePopup(scopes: string[]): Promise<SignInResult>;

  // Email + password — the default first-login path. Signup is operator-
  // mediated (`dashterm add-user`), so there's no signUp method here.
  signInWithPassword(email: string, password: string): Promise<SignInResult>;

  // Change the signed-in user's password. Used by the force-reset screen
  // when a user with `must_reset_password=true` lands on the dashboard.
  updatePassword(newPassword: string): Promise<void>;

  // Merge keys into the signed-in user's metadata. Used to clear the
  // `must_reset_password` flag after a successful reset.
  updateUserMetadata(patch: Record<string, unknown>): Promise<void>;
}

export interface UserData {
  profile: UserProfile;
  appState: AppState;
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: number;
  lastActive: number;
}

// Self-update status from the gateway (/api/update/status). `supported` is
// false in dev / non-git installs (the banner stays hidden); `canApply` is
// true only for admins on a daemon install (otherwise the banner shows the
// manual command instead of an enabled button).
export interface UpdateStatus {
  supported: boolean;
  reason: string | null;
  available: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  canRestart: boolean;
  canApply: boolean;
  running: boolean;
  checkedAt: number | null;
  error: string | null;
  // GitHub release notes (markdown), page URL, and title for latestVersion.
  releaseNotes: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
}

export interface StorageProvider {
  // Per-user blob (profile + appState). The gateway stores this as a single
  // JSON document per user; this API stays stable regardless.
  getUserData(uid: string): Promise<UserData | null>;
  setUserData(uid: string, data: UserData): Promise<void>;
  subscribeUserData(uid: string, cb: (data: UserData | null) => void): () => void;

  // Shared apps collection.
  getApp(shareCode: string): Promise<CustomApp | null>;
  setApp(shareCode: string, app: CustomApp): Promise<void>;
  deleteApp(shareCode: string): Promise<void>;
  subscribeApps(cb: (apps: CustomApp[]) => void): () => void;
  subscribeApp(shareCode: string, cb: (app: CustomApp | null) => void): () => void;
  // Force an immediate re-fetch of the shared apps list and dispatch it to all
  // subscribers. Used right after an agent push so the dashboard reflects the
  // new app without waiting on the realtime broadcast.
  refreshApps(): Promise<void>;

  // User management — admin-only. RLS lets admins see all profiles; non-
  // admins get only their own row. deleteUser calls a SECURITY DEFINER
  // RPC that cascades to auth.users + the user's app_state.
  listUsers(): Promise<UserSummary[]>;
  deleteUser(uid: string): Promise<void>;

  // Self-update. getUpdateStatus reads /api/update/status; runUpdate POSTs
  // /api/update/run (admin-only on the gateway); subscribeUpdate yields the
  // status on mount and again on each `update:available` WS broadcast.
  getUpdateStatus(): Promise<UpdateStatus>;
  runUpdate(): Promise<void>;
  subscribeUpdate(cb: (status: UpdateStatus) => void): () => void;
}
