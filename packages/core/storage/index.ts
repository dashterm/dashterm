/**
 * Provider singletons — single source of truth for backend access.
 *
 * There is one backend: the native gateway in packages/server (one Node
 * process, sqlite on disk, no Docker). Consumers only import
 * { storage, authProvider } — they never see the transport directly.
 */

import { createDashTermApiProviders } from './dashtermApi';
import type { AuthProvider, StorageProvider } from './types';

const built = createDashTermApiProviders();

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
