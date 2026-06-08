/**
 * Provider interfaces — the seam between core code and the backend.
 *
 * The OSS build ships only a SupabaseProvider (./supabase.ts) backed by the
 * homehub bundle in services/homehub. Nothing in core/ outside ./supabase.ts
 * should import from `@supabase/*` directly.
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

  // Bearer token for calling our own backend (homehub, /api/cli/*, etc).
  getIdToken(forceRefresh?: boolean): Promise<string | null>;

  // Sign in with a credential already obtained from the OAuth flow.
  // Used by the mobile path (expo-auth-session returns id_token + access_token).
  signInWithGoogleCredential(idToken: string, accessToken: string | null): Promise<SignInResult>;

  // Sign in via the provider's own OAuth flow (web popup / redirect).
  // Returns the user once the flow completes.
  signInWithGooglePopup(scopes: string[]): Promise<SignInResult>;

  // Email + password — the default first-login path. Signup is operator-
  // mediated (`dashterm homehub add-user`), so there's no signUp method here.
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

export interface StorageProvider {
  // Per-user blob (profile + appState). Phase 3 Supabase impl will split
  // these into two tables internally but keep this API.
  getUserData(uid: string): Promise<UserData | null>;
  setUserData(uid: string, data: UserData): Promise<void>;
  subscribeUserData(uid: string, cb: (data: UserData | null) => void): () => void;

  // Shared apps collection.
  getApp(shareCode: string): Promise<CustomApp | null>;
  setApp(shareCode: string, app: CustomApp): Promise<void>;
  deleteApp(shareCode: string): Promise<void>;
  subscribeApps(cb: (apps: CustomApp[]) => void): () => void;
  subscribeApp(shareCode: string, cb: (app: CustomApp | null) => void): () => void;

  // User management — admin-only. RLS lets admins see all profiles; non-
  // admins get only their own row. deleteUser calls a SECURITY DEFINER
  // RPC that cascades to auth.users + the user's app_state.
  listUsers(): Promise<UserSummary[]>;
  deleteUser(uid: string): Promise<void>;
}
