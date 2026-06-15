import { useState, useEffect } from 'react';
import { authProvider } from '../storage';
import type { AuthUser } from '../storage';

// Test mode check - bypasses authentication for E2E testing
const IS_TEST_MODE = process.env.EXPO_PUBLIC_TEST_MODE === 'true';

// Mock user for test mode
const MOCK_TEST_USER: AuthUser = {
  uid: 'test-user-123',
  email: 'testuser@example.com',
  displayName: 'Test User',
  photoURL: null,
  metadata: {},
};

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export const useAuth = () => {
  // TEST MODE: Return mock authenticated state immediately
  if (IS_TEST_MODE) {
    console.log('🧪 TEST MODE: Using mock authentication');
    return {
      user: MOCK_TEST_USER,
      loading: false,
      error: null,
      signInWithPassword: async () => ({ ok: true as const }),
      updatePassword: async () => ({ ok: true as const }),
      updateUserMetadata: async () => ({ ok: true as const }),
      signOut: async () => { console.log('🧪 TEST MODE: signOut called'); },
      isAuthenticated: true,
      mustResetPassword: false,
    };
  }

  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = authProvider.onAuthChange((user) => {
      setAuthState(prev => ({
        ...prev,
        user,
        loading: false,
        error: null,
      }));
    });

    return unsubscribe;
  }, []);

  const signInWithPassword = async (email: string, password: string) => {
    setAuthState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const result = await authProvider.signInWithPassword(email, password);
      // onAuthChange fires and populates state; we just stop the spinner.
      setAuthState(prev => ({ ...prev, loading: false, user: result.user }));
      return { ok: true as const };
    } catch (e: any) {
      const msg = e?.message || 'Sign-in failed';
      setAuthState(prev => ({ ...prev, loading: false, error: msg }));
      return { ok: false as const, error: msg };
    }
  };

  const updatePassword = async (newPassword: string) => {
    setAuthState(prev => ({ ...prev, loading: true, error: null }));
    try {
      await authProvider.updatePassword(newPassword);
      setAuthState(prev => ({ ...prev, loading: false }));
      return { ok: true as const };
    } catch (e: any) {
      const msg = e?.message || 'Password update failed';
      setAuthState(prev => ({ ...prev, loading: false, error: msg }));
      return { ok: false as const, error: msg };
    }
  };

  const updateUserMetadata = async (patch: Record<string, unknown>) => {
    try {
      await authProvider.updateUserMetadata(patch);
      return { ok: true as const };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Metadata update failed' };
    }
  };

  const signOut = async () => {
    try {
      setAuthState(prev => ({ ...prev, loading: true, error: null }));
      await authProvider.signOut();
      // onAuthChange fires with null and clears the spinner.
      console.log('✅ Sign-out successful');
    } catch (error: any) {
      console.error('❌ Sign-out error:', error);
      setAuthState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to sign out',
      }));
    }
  };

  // True when the signed-in account has the `must_reset_password` flag in
  // user_metadata. The seeded admin account ships with it set; clearing it
  // happens at the end of the force-reset flow.
  const mustResetPassword =
    !!(authState.user?.metadata && (authState.user.metadata as any).must_reset_password === true);

  return {
    ...authState,
    signInWithPassword,
    updatePassword,
    updateUserMetadata,
    signOut,
    isAuthenticated: !!authState.user,
    mustResetPassword,
  };
};
