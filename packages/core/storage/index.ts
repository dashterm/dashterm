/**
 * Provider singletons — single source of truth for backend access.
 *
 * Two backends ship in core/, picked at build time via EXPO_PUBLIC_BACKEND:
 *   - "dashterm-native" (default) — talks to the local gateway in
 *     packages/server. The OSS install path: one Node process,
 *     sqlite on disk, no Docker required.
 *   - "supabase" — talks to a Supabase instance (the homehub Docker bundle
 *     or any operator-supplied Supabase, including Supabase Cloud). Kept as
 *     an opt-in install path; family installs that want Realtime cross-tab
 *     sync or hosted scaling use this.
 *
 * Consumers only import { storage, authProvider } — they never see either
 * SDK directly.
 */

import { createDashTermApiProviders } from './dashtermApi';
import { createSupabaseProviders } from './supabase';
import type { AuthProvider, StorageProvider } from './types';

type Backend = 'dashterm-native' | 'supabase';

function resolveBackend(): Backend {
  const raw = (process.env.EXPO_PUBLIC_BACKEND ?? '').toLowerCase().trim();
  if (raw === 'supabase') return 'supabase';
  if (raw === 'dashterm-native' || raw === '') return 'dashterm-native';
  console.warn(`[storage] unknown EXPO_PUBLIC_BACKEND=${raw}; defaulting to dashterm-native`);
  return 'dashterm-native';
}

function buildProviders(): {
  authProvider: AuthProvider;
  storage: StorageProvider;
} {
  const backend = resolveBackend();
  if (backend === 'supabase') {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        '[storage] EXPO_PUBLIC_BACKEND=supabase but EXPO_PUBLIC_SUPABASE_URL and ' +
          'EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. Run `dashterm homehub init && ' +
          'dashterm homehub up` to bootstrap a local Supabase, or point at an existing one.',
      );
    }
    return createSupabaseProviders({ url, anonKey });
  }
  return createDashTermApiProviders();
}

const built = buildProviders();

export const authProvider: AuthProvider = built.authProvider;
export const storage: StorageProvider = built.storage;

export type {
  AuthProvider,
  AuthUser,
  SignInResult,
  StorageProvider,
  UserData,
  UserSummary,
} from './types';
