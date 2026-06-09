import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { authProvider } from '../storage';
import type { AuthUser } from '../storage';

// Required for proper redirect handling on native
WebBrowser.maybeCompleteAuthSession();

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

// OAuth scopes for Gmail and Calendar access
// gmail.readonly is a RESTRICTED scope requiring an annual CASA security
// assessment to verify for public release — dropped for now. Calendar scopes
// are "sensitive" (lighter brand verification, no CASA). Re-add gmail.readonly
// only if/when the CASA assessment is done.
const GOOGLE_SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  accessToken: string | null; // For Google API calls
}

// Storage keys for token persistence
const ACCESS_TOKEN_KEY = 'dashterm_google_access_token';
const REFRESH_TOKEN_KEY = 'dashterm_google_refresh_token';
const TOKEN_EXPIRY_KEY = 'dashterm_google_token_expiry';

interface TokenData {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null; // Unix timestamp
}

// Helper to get stored tokens (web only)
const getStoredTokens = (): TokenData => {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return {
      accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
      refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
      expiresAt: localStorage.getItem(TOKEN_EXPIRY_KEY)
        ? parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY)!, 10)
        : null,
    };
  }
  return { accessToken: null, refreshToken: null, expiresAt: null };
};

// Helper to store tokens (web only)
const storeTokens = (data: Partial<TokenData>) => {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    if (data.accessToken !== undefined) {
      if (data.accessToken) {
        localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
      } else {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
      }
    }
    if (data.refreshToken !== undefined) {
      if (data.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      } else {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      }
    }
    if (data.expiresAt !== undefined) {
      if (data.expiresAt) {
        localStorage.setItem(TOKEN_EXPIRY_KEY, data.expiresAt.toString());
      } else {
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
      }
    }
  }
};

// Clear all stored tokens
const clearStoredTokens = () => {
  storeTokens({ accessToken: null, refreshToken: null, expiresAt: null });
};

// Check if token is expired or about to expire (within 5 minutes)
const isTokenExpired = (expiresAt: number | null): boolean => {
  if (!expiresAt) return true;
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer
  return Date.now() >= expiresAt - bufferMs;
};

export const useAuth = () => {
  // TEST MODE: Return mock authenticated state immediately
  if (IS_TEST_MODE) {
    console.log('🧪 TEST MODE: Using mock authentication');
    return {
      user: MOCK_TEST_USER,
      loading: false,
      error: null,
      accessToken: 'mock-access-token',
      signInWithGoogle: async () => { console.log('🧪 TEST MODE: signInWithGoogle called'); },
      signInWithPassword: async () => ({ ok: true as const }),
      updatePassword: async () => ({ ok: true as const }),
      updateUserMetadata: async () => ({ ok: true as const }),
      signOut: async () => { console.log('🧪 TEST MODE: signOut called'); },
      refreshAccessToken: async () => 'mock-access-token',
      getValidAccessToken: async () => 'mock-access-token',
      isAuthenticated: true,
      hasGoogleAccess: true,
      tokenNeedsRefresh: false,
      mustResetPassword: false,
    };
  }

  const storedTokens = getStoredTokens();
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    accessToken: storedTokens.accessToken // Initialize from storage
  });
  const [refreshToken, setRefreshToken] = useState<string | null>(storedTokens.refreshToken);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(storedTokens.expiresAt);

  // OAuth Client IDs from environment variables. The dev variant
  // (app.berengamble.dashterm.dev) needs its own iOS OAuth client because
  // Google validates the redirect against the bundle id. When
  // EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DEV is present (set in local .env for
  // Metro dev), prefer it. Production builds never see that var, so they keep
  // using the standard client.
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID_DEV ||
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  // Log configuration on mount (for debugging)
  useEffect(() => {
    if (Platform.OS !== 'web') {
      console.log('🔐 Google OAuth Configuration:');
      console.log('   Platform:', Platform.OS);
      console.log('   Web Client ID:', webClientId ? '✓ configured' : '✗ missing');
      console.log('   iOS Client ID:', iosClientId ? '✓ configured' : '✗ missing (required for iOS)');
      console.log('   Android Client ID:', androidClientId ? '✓ configured' : '✗ missing (required for Android)');
      console.log('   Scopes:', GOOGLE_SCOPES.length, 'scopes (Calendar)');

      if (Platform.OS === 'ios' && !iosClientId) {
        console.warn('⚠️ iOS Client ID is missing. Create an iOS OAuth client in Google Cloud Console with bundle ID: app.berengamble.dashterm');
      }
    }
  }, []);

  // Configure Google Auth Request with Gmail and Calendar scopes.
  // On web the auth provider runs its own Google popup flow, so this hook's
  // output is unused — but Google.useAuthRequest still throws invariantClientId if
  // no clientId is provided. Pass a harmless placeholder so the page renders
  // even when EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID isn't baked into the build
  // (e.g. the /cli pairing page).
  const PLACEHOLDER_CLIENT_ID = 'unset.apps.googleusercontent.com';
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: webClientId || PLACEHOLDER_CLIENT_ID,
    iosClientId: iosClientId || webClientId || PLACEHOLDER_CLIENT_ID,
    androidClientId: androidClientId || webClientId || PLACEHOLDER_CLIENT_ID,
    scopes: GOOGLE_SCOPES,
  });


  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = authProvider.onAuthChange((user) => {
      setAuthState(prev => ({
        ...prev,
        user,
        loading: false,
        error: null
      }));
    });

    return unsubscribe;
  }, []);

  // Handle Google OAuth response for mobile
  useEffect(() => {
    if (response && Platform.OS !== 'web') {
      console.log('🔍 OAuth Response:', {
        type: response.type,
        params: response.type === 'success' ? Object.keys(response.params) : undefined,
        error: response.type === 'error' ? response.error : undefined
      });
    }

    if (response?.type === 'success' && Platform.OS !== 'web') {
      const { id_token, access_token } = response.params;

      if (id_token) {
        console.log('✅ ID token received, signing in...');
        console.log('✅ Access token received for API calls:', access_token ? 'yes' : 'no');

        authProvider
          .signInWithGoogleCredential(id_token, access_token || null)
          .then((result) => {
            console.log('✅ Sign-in successful:', result.user.displayName);

            // Persist the token (55 min expiry estimate for mobile)
            const expiresAt = Date.now() + 55 * 60 * 1000;
            storeTokens({
              accessToken: access_token || null,
              expiresAt,
            });
            setTokenExpiresAt(expiresAt);

            setAuthState(prev => ({
              ...prev,
              loading: false,
              accessToken: access_token || null
            }));
          })
          .catch((error: any) => {
            console.error('❌ Credential sign-in error:', error);
            setAuthState(prev => ({
              ...prev,
              loading: false,
              error: error.message || 'Failed to sign in with Google'
            }));
          });
      } else {
        console.error('❌ No id_token in response');
        setAuthState(prev => ({
          ...prev,
          loading: false,
          error: 'Authentication failed: No ID token received'
        }));
      }
    } else if (response?.type === 'error' && Platform.OS !== 'web') {
      console.error('❌ OAuth error:', response.error);
      setAuthState(prev => ({
        ...prev,
        loading: false,
        error: response.error?.message || 'Authentication failed'
      }));
    } else if (response?.type === 'dismiss' && Platform.OS !== 'web') {
      console.log('ℹ️ OAuth flow dismissed');
      setAuthState(prev => ({
        ...prev,
        loading: false,
        error: null
      }));
    }
  }, [response]);

  const signInWithGoogle = async () => {
    try {
      setAuthState(prev => ({ ...prev, loading: true, error: null }));

      if (Platform.OS === 'web') {
        // Web: provider handles the popup OAuth dance.
        // (gmail.readonly dropped — restricted scope, see GOOGLE_SCOPES note)
        const result = await authProvider.signInWithGooglePopup([
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/calendar.events',
        ]);
        console.log('✅ Web sign-in successful:', result.user.displayName);

        const accessToken = result.oauthAccessToken;
        console.log('✅ Access token for API calls:', accessToken ? 'received' : 'not available');

        // Note: web popup flow doesn't provide refresh tokens directly.
        // The token expires in ~1 hour. We'll handle 401s by prompting re-auth.
        // Set expiry to 55 minutes from now (conservative estimate)
        const expiresAt = Date.now() + 55 * 60 * 1000;

        storeTokens({
          accessToken,
          expiresAt,
        });
        setTokenExpiresAt(expiresAt);

        setAuthState(prev => ({
          ...prev,
          accessToken
        }));
      } else {
        // Mobile: Use expo-auth-session
        if (!request) {
          const missingIds = [];
          if (Platform.OS === 'ios' && !iosClientId) missingIds.push('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
          if (Platform.OS === 'android' && !androidClientId) missingIds.push('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID');
          if (!webClientId) missingIds.push('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');

          throw new Error(
            `OAuth not configured. Missing: ${missingIds.join(', ')}\n\n` +
            'Setup instructions:\n' +
            '1. Go to Google Cloud Console > APIs & Services > Credentials\n' +
            '2. Create OAuth 2.0 Client IDs:\n' +
            '   - iOS: Application type "iOS", Bundle ID: app.berengamble.dashterm\n' +
            '   - Web: Application type "Web application"\n' +
            '3. Add the client IDs to your .env file'
          );
        }

        console.log('🚀 Starting OAuth flow with scopes:', GOOGLE_SCOPES);
        await promptAsync();
        // Response is handled by the useEffect above
      }
    } catch (error: any) {
      console.error('❌ Sign-in error:', error);
      setAuthState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to sign in with Google'
      }));
    }
  };

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

      // Clear all persisted tokens
      clearStoredTokens();
      setRefreshToken(null);
      setTokenExpiresAt(null);

      setAuthState(prev => ({
        ...prev,
        accessToken: null
      }));
      console.log('✅ Sign-out successful');
    } catch (error: any) {
      console.error('❌ Sign-out error:', error);
      setAuthState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to sign out'
      }));
    }
  };

  // Refresh access token using refresh token
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const webClientSecret = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET;

    // Check if we have a refresh token
    if (!refreshToken) {
      console.log('ℹ️ No refresh token available, re-authentication required');
      return null;
    }

    // Check if current token is still valid
    if (!isTokenExpired(tokenExpiresAt) && authState.accessToken) {
      console.log('✅ Token still valid, no refresh needed');
      return authState.accessToken;
    }

    console.log('🔄 Refreshing access token...');

    try {
      // Use Google's token endpoint to refresh
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: webClientId || '',
          client_secret: webClientSecret || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Token refresh failed:', errorText);
        // Clear invalid refresh token
        clearStoredTokens();
        setRefreshToken(null);
        setTokenExpiresAt(null);
        setAuthState(prev => ({ ...prev, accessToken: null }));
        return null;
      }

      const data = await response.json();
      const newAccessToken = data.access_token;
      const expiresIn = data.expires_in || 3600; // Default 1 hour
      const newExpiresAt = Date.now() + expiresIn * 1000;

      console.log('✅ Token refreshed successfully, expires in', expiresIn, 'seconds');

      // Store the new tokens
      storeTokens({
        accessToken: newAccessToken,
        expiresAt: newExpiresAt,
        // Keep existing refresh token (Google doesn't always return a new one)
        refreshToken: data.refresh_token || refreshToken,
      });

      setTokenExpiresAt(newExpiresAt);
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token);
      }
      setAuthState(prev => ({ ...prev, accessToken: newAccessToken }));

      return newAccessToken;
    } catch (error) {
      console.error('❌ Token refresh error:', error);
      return null;
    }
  }, [refreshToken, tokenExpiresAt, authState.accessToken]);

  // Get a valid access token, refreshing if necessary
  const getValidAccessToken = useCallback(async (): Promise<string | null> => {
    // If token is still valid, return it
    if (!isTokenExpired(tokenExpiresAt) && authState.accessToken) {
      return authState.accessToken;
    }
    // Otherwise try to refresh
    return refreshAccessToken();
  }, [tokenExpiresAt, authState.accessToken, refreshAccessToken]);

  // Check if token needs refresh (for proactive refresh)
  const tokenNeedsRefresh = isTokenExpired(tokenExpiresAt);

  // True when the signed-in account has the `must_reset_password` flag in
  // user_metadata. The seeded admin account ships with it set; clearing it
  // happens at the end of the force-reset flow.
  const mustResetPassword =
    !!(authState.user?.metadata && (authState.user.metadata as any).must_reset_password === true);

  return {
    ...authState,
    signInWithGoogle,
    signInWithPassword,
    updatePassword,
    updateUserMetadata,
    signOut,
    refreshAccessToken,
    getValidAccessToken,
    isAuthenticated: !!authState.user,
    hasGoogleAccess: !!authState.accessToken,
    tokenNeedsRefresh,
    mustResetPassword,
  };
};
