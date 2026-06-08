/**
 * SupabaseProvider — Supabase Auth + Postgres + Realtime behind the
 * AuthProvider / StorageProvider interfaces.
 *
 * Schema lives at services/homehub/migrations/001_init.sql:
 *   profiles  — UserProfile, one row per auth.users
 *   app_state — { user_id, state jsonb }, one row per user
 *   apps      — vibe-coded apps (matches the apps/$code share-code shape)
 *
 * Realtime is wired on app_state and apps via the supabase_realtime
 * publication; subscribeUserData / subscribeApps use Realtime channels.
 *
 * This file is the only place in core/ that imports from @supabase/*.
 * Consumers reach the singleton via packages/core/storage/index.ts.
 */

import {
  createClient,
  type SupabaseClient,
  type Session,
  type User as SupabaseUser,
  type RealtimeChannel,
} from '@supabase/supabase-js';
import type {
  AuthProvider,
  AuthUser,
  SignInResult,
  StorageProvider,
  UserData,
  UserSummary,
} from './types';
import type { CustomApp, UserProfile, AppState } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAuthUser(u: SupabaseUser | null | undefined): AuthUser | null {
  if (!u) return null;
  const meta = (u.user_metadata || {}) as Record<string, unknown>;
  return {
    uid: u.id,
    email: u.email ?? null,
    displayName:
      (meta.full_name as string | undefined) ??
      (meta.name as string | undefined) ??
      (meta.user_name as string | undefined) ??
      u.email ??
      null,
    photoURL:
      (meta.avatar_url as string | undefined) ??
      (meta.picture as string | undefined) ??
      null,
    metadata: meta,
  };
}

// Profiles table row <-> UserProfile shape
type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  photo_url: string | null;
  created_at: string;
  last_active: string;
};

function profileFromRow(r: ProfileRow): UserProfile {
  return {
    uid: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? 'Unknown User',
    photoURL: r.photo_url ?? undefined,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    lastActive: r.last_active ? Date.parse(r.last_active) : Date.now(),
  };
}

function profileToRow(p: UserProfile): Omit<ProfileRow, 'created_at' | 'last_active'> & {
  last_active: string;
} {
  return {
    id: p.uid,
    email: p.email ?? null,
    display_name: p.displayName ?? null,
    photo_url: p.photoURL ?? null,
    last_active: new Date(p.lastActive ?? Date.now()).toISOString(),
  };
}

// Apps table row <-> CustomApp shape. snake_case ↔ camelCase + JSONB.
type AppRow = {
  id: string;
  name: string;
  description: string | null;
  code: string;
  compiled_code: string | null;
  functions: unknown;
  queryable_data: unknown;
  owner_id: string | null;
  owner_name: string | null;
  visibility: 'private' | 'unlisted' | 'public';
  category: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

function appFromRow(r: AppRow): CustomApp {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    code: r.code,
    compiledCode: r.compiled_code ?? undefined,
    functions: (r.functions as CustomApp['functions']) ?? undefined,
    queryableData: (r.queryable_data as CustomApp['queryableData']) ?? undefined,
    ownerId: r.owner_id ?? '',
    ownerName: r.owner_name ?? '',
    visibility: r.visibility,
    category: r.category ?? undefined,
    version: r.version,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now(),
  };
}

function appToRow(a: CustomApp): Omit<AppRow, 'created_at' | 'updated_at'> {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    code: a.code,
    compiled_code: a.compiledCode ?? null,
    functions: a.functions ?? null,
    queryable_data: a.queryableData ?? null,
    owner_id: a.ownerId ?? null,
    owner_name: a.ownerName ?? null,
    visibility: a.visibility,
    category: a.category ?? null,
    version: a.version,
  };
}

// ---------------------------------------------------------------------------
// Auth provider
// ---------------------------------------------------------------------------

export class SupabaseAuthProvider implements AuthProvider {
  private cachedUser: AuthUser | null = null;
  private cachedSession: Session | null = null;

  constructor(private client: SupabaseClient) {
    // Prime the cache from the persisted session so currentUser() is
    // synchronously available after a refresh.
    client.auth.getSession().then(({ data }) => {
      this.cachedSession = data.session;
      this.cachedUser = toAuthUser(data.session?.user);
    });
    client.auth.onAuthStateChange((_event, session) => {
      this.cachedSession = session;
      this.cachedUser = toAuthUser(session?.user);
    });
  }

  currentUser(): AuthUser | null {
    return this.cachedUser;
  }

  onAuthChange(cb: (user: AuthUser | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      cb(toAuthUser(session?.user));
    });
    // Fire once immediately with the cached user so consumers don't wait
    // for a state-change event after mount.
    cb(this.cachedUser);
    return () => data.subscription.unsubscribe();
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async getIdToken(_forceRefresh = false): Promise<string | null> {
    // Supabase issues short-lived JWTs (access_token); the client auto-refreshes
    // them, so we just read the current session's access_token.
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async signInWithGoogleCredential(
    idToken: string,
    accessToken: string | null,
  ): Promise<SignInResult> {
    const { data, error } = await this.client.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      // Supabase v2 accepts access_token when verifying the id_token claim,
      // letting downstream APIs reuse the OAuth access token.
      access_token: accessToken ?? undefined,
    });
    if (error) throw error;
    const user = toAuthUser(data.user);
    if (!user) throw new Error('Supabase signInWithIdToken returned no user');
    return { user, oauthAccessToken: accessToken };
  }

  async signInWithGooglePopup(scopes: string[]): Promise<SignInResult> {
    const redirectTo =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : undefined;
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: scopes.join(' '),
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    if (error) throw error;
    // signInWithOAuth navigates the browser away; the actual session lands
    // on return via onAuthStateChange. The caller's UI flow is the
    // "signing in..." state until that fires.
    return {
      user: this.cachedUser ?? {
        uid: '',
        email: null,
        displayName: null,
        photoURL: null,
        metadata: {},
      },
      oauthAccessToken: null,
    };
  }

  async signInWithPassword(email: string, password: string): Promise<SignInResult> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    const user = toAuthUser(data.user);
    if (!user) throw new Error('Supabase signInWithPassword returned no user');
    return { user, oauthAccessToken: null };
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async updateUserMetadata(patch: Record<string, unknown>): Promise<void> {
    // supabase-js's updateUser merges keys at the top level of `data` —
    // i.e., a deep-merge isn't applied, so callers should send full key
    // values for anything they want to overwrite.
    const { error } = await this.client.auth.updateUser({ data: patch });
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Storage provider
// ---------------------------------------------------------------------------

export class SupabaseStorageProvider implements StorageProvider {
  constructor(private client: SupabaseClient) {}

  // ---- user data ----

  async getUserData(uid: string): Promise<UserData | null> {
    const [profileRes, stateRes] = await Promise.all([
      this.client.from('profiles').select('*').eq('id', uid).maybeSingle(),
      this.client.from('app_state').select('state').eq('user_id', uid).maybeSingle(),
    ]);

    if (profileRes.error) throw profileRes.error;
    if (stateRes.error) throw stateRes.error;
    if (!profileRes.data && !stateRes.data) return null;

    return {
      profile: profileRes.data
        ? profileFromRow(profileRes.data as ProfileRow)
        : ({ uid, email: '', displayName: 'Unknown User', createdAt: Date.now(), lastActive: Date.now() } as UserProfile),
      appState: ((stateRes.data?.state as AppState) ?? {}) as AppState,
    };
  }

  async setUserData(uid: string, data: UserData): Promise<void> {
    const profileRow = profileToRow(data.profile);
    const stateRow = {
      user_id: uid,
      state: data.appState as unknown as Record<string, unknown>,
    };

    // Two upserts. We don't wrap them in a transaction because supabase-js
    // doesn't expose one; the app_state row is the load-bearing one (it's
    // what restores on refresh), so we write it last. A failed profile
    // upsert won't lose state.
    const profileRes = await this.client.from('profiles').upsert(profileRow);
    if (profileRes.error) throw profileRes.error;
    const stateRes = await this.client.from('app_state').upsert(stateRow);
    if (stateRes.error) throw stateRes.error;
  }

  subscribeUserData(
    uid: string,
    cb: (data: UserData | null) => void,
  ): () => void {
    // Initial fetch so the consumer gets the current row immediately.
    this.getUserData(uid).then(cb).catch((err) => {
      console.error('[SupabaseStorageProvider] subscribeUserData initial fetch:', err);
      cb(null);
    });

    // Realtime is opt-in. supabase/realtime self-host requires a tenant row
    // in `_realtime.tenants` whose `jwt_secret` is AES-256-GCM-encrypted
    // with the service's DB_ENC_KEY — not something we can seed via a
    // plain SQL migration. Until we wire that bootstrap properly, default
    // off: the dashboard falls back to fetch-on-mount + write-through, which
    // is fine for a single-tab home install but skips cross-tab live sync.
    // Set EXPO_PUBLIC_REALTIME_ENABLED=true at build time once realtime is
    // properly tenanted to opt back in.
    if (process.env.EXPO_PUBLIC_REALTIME_ENABLED !== 'true') {
      return () => {};
    }

    const channel = this.client
      .channel(`user-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_state', filter: `user_id=eq.${uid}` },
        () => {
          this.getUserData(uid).then(cb).catch((err) => {
            console.error('[SupabaseStorageProvider] app_state change refetch:', err);
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        () => {
          this.getUserData(uid).then(cb).catch((err) => {
            console.error('[SupabaseStorageProvider] profile change refetch:', err);
          });
        },
      )
      .subscribe();

    return () => {
      this.client.removeChannel(channel);
    };
  }

  // ---- apps ----

  async getApp(shareCode: string): Promise<CustomApp | null> {
    const { data, error } = await this.client
      .from('apps')
      .select('*')
      .eq('id', shareCode)
      .maybeSingle();
    if (error) throw error;
    return data ? appFromRow(data as AppRow) : null;
  }

  async setApp(shareCode: string, app: CustomApp): Promise<void> {
    const { error } = await this.client.from('apps').upsert(appToRow(app));
    if (error) throw error;
  }

  async deleteApp(shareCode: string): Promise<void> {
    const { error } = await this.client.from('apps').delete().eq('id', shareCode);
    if (error) throw error;
  }

  subscribeApps(cb: (apps: CustomApp[]) => void): () => void {
    let channel: RealtimeChannel | null = null;

    const refetch = () => {
      this.client
        .from('apps')
        .select('*')
        .then(({ data, error }) => {
          if (error) {
            console.error('[SupabaseStorageProvider] subscribeApps fetch:', error);
            return;
          }
          cb((data ?? []).map((r) => appFromRow(r as AppRow)));
        });
    };

    refetch();

    channel = this.client
      .channel('apps-all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'apps' },
        refetch,
      )
      .subscribe();

    return () => {
      if (channel) this.client.removeChannel(channel);
    };
  }

  subscribeApp(
    shareCode: string,
    cb: (app: CustomApp | null) => void,
  ): () => void {
    this.getApp(shareCode).then(cb).catch(() => cb(null));

    const channel = this.client
      .channel(`app-${shareCode}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'apps', filter: `id=eq.${shareCode}` },
        () => {
          this.getApp(shareCode).then(cb).catch(() => cb(null));
        },
      )
      .subscribe();

    return () => {
      this.client.removeChannel(channel);
    };
  }

  // ---- user management ----

  async listUsers(): Promise<UserSummary[]> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, email, display_name, is_admin, created_at, last_active')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      email: r.email ?? '',
      displayName: r.display_name ?? '',
      isAdmin: !!r.is_admin,
      createdAt: r.created_at ? Date.parse(r.created_at) : 0,
      lastActive: r.last_active ? Date.parse(r.last_active) : 0,
    }));
  }

  async deleteUser(uid: string): Promise<void> {
    // admin_delete_user is a SECURITY DEFINER RPC; it gates on
    // current_user_is_admin() and refuses self-delete. Cascade FKs handle
    // the profile + app_state cleanup.
    const { error } = await this.client.rpc('admin_delete_user', { target_id: uid });
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SupabaseProviderConfig {
  url: string;
  anonKey: string;
}

export function createSupabaseProviders(config: SupabaseProviderConfig): {
  authProvider: AuthProvider;
  storage: StorageProvider;
} {
  const client = createClient(config.url, config.anonKey, {
    auth: {
      // Persist on web (localStorage) and native (AsyncStorage if available
      // via the consumer's setup). Default storage works for both since
      // supabase-js feature-detects.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return {
    authProvider: new SupabaseAuthProvider(client),
    storage: new SupabaseStorageProvider(client),
  };
}
