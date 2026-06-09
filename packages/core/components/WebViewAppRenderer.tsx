import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { CustomApp, UserProfile } from '../types';

// Compile through the gateway. The native install serves the bundle and the
// API from the same origin (EXPO_PUBLIC_GATEWAY_URL stays empty for
// relative URLs). EXPO_PUBLIC_COMPILE_URL stays an optional override for
// setups that front the gateway behind a different origin.
const COMPILE_SERVER_URL =
  process.env.EXPO_PUBLIC_GATEWAY_URL ??
  process.env.EXPO_PUBLIC_COMPILE_URL ??
  '';

interface WebViewAppRendererProps {
  customApp: CustomApp;
  instanceId: string;
  instanceState: any;
  updateState: (updates: any) => void;
  userProfile: UserProfile | null;
  // Per-user relay API base (derived from AgenticCoder's relayUrl). Empty
  // string means the user hasn't configured a relay yet — the renderer will
  // surface a helpful message instead of letting custom apps fail mysteriously.
  apiBase: string;
  // Event system integration
  emit?: (eventName: string, data: any) => void;
  subscribe?: (pattern: string, handler: (event: any) => void) => () => void;
}

interface BridgeMessage {
  type: 'UPDATE_STATE' | 'EMIT_EVENT' | 'FETCH_REQUEST' | 'MF_REQUEST' | 'CONSOLE_LOG' | 'ERROR' | 'READY';
  payload?: any;
}

/**
 * WebViewAppRenderer - Renders custom apps in a WebView on mobile
 *
 * This component:
 * 1. Compiles TypeScript code via the compilation server
 * 2. Generates an HTML document with React, shims, and the compiled code
 * 3. Provides a bridge for state sync and event system integration
 * 4. Handles bidirectional communication via postMessage
 */
export default function WebViewAppRenderer({
  customApp,
  instanceId,
  instanceState,
  updateState,
  userProfile,
  apiBase,
  emit,
  subscribe,
}: WebViewAppRendererProps) {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompiling, setIsCompiling] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);

  // Compile the custom app code
  useEffect(() => {
    async function compileApp() {
      setIsCompiling(true);
      setError(null);

      try {
        // Check if we have pre-compiled code
        let compiledCode = customApp.compiledCode;

        if (!compiledCode) {
          // Need to compile via server
          console.log('🔧 Compiling custom app for WebView:', customApp.name);

          const response = await fetch(`${COMPILE_SERVER_URL}/api/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: customApp.code,
              appName: customApp.name,
            }),
          });

          const result = await response.json();

          if (!result.success) {
            throw new Error(`Compilation failed: ${result.error}\n${result.details?.join('\n') || ''}`);
          }

          compiledCode = result.compiledCode;
        }

        if (!compiledCode) {
          throw new Error('No compiled code available');
        }

        // Generate HTML document
        const html = generateHTML(compiledCode, customApp.name, instanceState, userProfile, apiBase);
        setHtmlContent(html);
        setIsCompiling(false);

      } catch (err) {
        console.error('❌ WebView compilation error:', err);
        setError(err instanceof Error ? err.message : String(err));
        setIsCompiling(false);
      }
    }

    compileApp();
  }, [customApp.code, customApp.compiledCode, customApp.name, apiBase]);

  // Send state updates to WebView when instanceState changes
  useEffect(() => {
    if (webViewRef.current && !isLoading && htmlContent) {
      const message = JSON.stringify({
        type: 'STATE_UPDATE',
        state: instanceState,
      });
      webViewRef.current.postMessage(message);
    }
  }, [instanceState, isLoading, htmlContent]);

  // Subscribe to events and forward to WebView
  useEffect(() => {
    if (!subscribe || !webViewRef.current || isLoading) return;

    const unsubscribe = subscribe('*', (event: any) => {
      const message = JSON.stringify({
        type: 'EVENT',
        event,
      });
      webViewRef.current?.postMessage(message);
    });

    return unsubscribe;
  }, [subscribe, isLoading]);

  // Handle messages from WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data: BridgeMessage = JSON.parse(event.nativeEvent.data);

      switch (data.type) {
        case 'READY':
          console.log('✅ WebView custom app ready:', customApp.name);
          setIsLoading(false);
          // Send initial state
          const initMessage = JSON.stringify({
            type: 'STATE_UPDATE',
            state: instanceState,
          });
          webViewRef.current?.postMessage(initMessage);
          break;

        case 'UPDATE_STATE':
          if (data.payload) {
            updateState(data.payload);
          }
          break;

        case 'EMIT_EVENT':
          if (emit && data.payload) {
            emit(data.payload.eventName, data.payload.eventData);
          }
          break;

        case 'MF_REQUEST': {
          // The WebView can't carry the gateway session cookie, so the native
          // shell performs dashterm.* calls (secrets proxy + AI chat) and
          // ships the result back keyed by the request id.
          const { id, path, init } = data.payload || {};
          const gatewayBase = process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
          (async () => {
            let reply: any;
            try {
              const r = await fetch(`${gatewayBase}${path}`, { ...(init || {}), credentials: 'include' });
              const text = await r.text();
              let body: any;
              try { body = text ? JSON.parse(text) : null; } catch { body = text; }
              reply = {
                type: 'MF_RESPONSE',
                id,
                ok: r.ok,
                data: body,
                error: r.ok ? undefined : (body && body.error) || `HTTP ${r.status}`,
              };
            } catch (e) {
              reply = { type: 'MF_RESPONSE', id, ok: false, error: e instanceof Error ? e.message : String(e) };
            }
            webViewRef.current?.postMessage(JSON.stringify(reply));
          })();
          break;
        }

        case 'CONSOLE_LOG':
          console.log(`[${customApp.name}]`, ...(data.payload || []));
          break;

        case 'ERROR':
          console.error(`[${customApp.name} Error]`, data.payload);
          break;

        default:
          console.warn('Unknown message type from WebView:', data.type);
      }
    } catch (err) {
      console.error('Failed to parse WebView message:', err);
    }
  }, [customApp.name, instanceState, updateState, emit]);

  // Render loading state
  if (isCompiling) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingHeader}>
          <Text style={styles.loadingTitle}>COMPILING</Text>
          <Text style={styles.loadingAppName}>{customApp.name}</Text>
        </View>
        <View style={styles.loadingContent}>
          <ActivityIndicator size="large" color="#00ffff" />
          <Text style={styles.loadingText}>Transpiling TypeScript...</Text>
        </View>
      </View>
    );
  }

  // Render error state
  if (error) {
    return (
      <View style={styles.errorContainer}>
        <View style={styles.errorHeader}>
          <Text style={styles.errorTitle}>COMPILATION ERROR</Text>
          <Text style={styles.errorAppName}>{customApp.name}</Text>
        </View>
        <View style={styles.errorContent}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>
            Ask the AI to fix this error, or check the compilation server is running.
          </Text>
        </View>
      </View>
    );
  }

  // Render WebView
  if (!htmlContent) {
    return null;
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#00ffff" />
          <Text style={styles.loadingOverlayText}>Loading...</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        onMessage={handleMessage}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={false}
        scrollEnabled={true}
        bounces={false}
        // Security settings
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        // Debugging
        webviewDebuggingEnabled={__DEV__}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('WebView error:', nativeEvent);
          setError(`WebView error: ${nativeEvent.description}`);
        }}
      />
    </View>
  );
}

/**
 * Generate the HTML document that runs inside the WebView
 */
function generateHTML(
  compiledCode: string,
  appName: string,
  initialState: any,
  userProfile: UserProfile | null,
  apiBase: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${appName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root {
      width: 100%;
      height: 100%;
      background: #000;
      overflow: hidden;
      font-family: 'Courier New', monospace;
    }
    /* Spinner animation */
    @keyframes spin { to { transform: rotate(360deg); } }
    /* Scrollbar styling */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #111; }
    ::-webkit-scrollbar-thumb { background: #00ffff; border-radius: 4px; }
  </style>
  <!-- React from CDN -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script>
    // ============================================
    // DASHTERM BRIDGE API
    // ============================================
    window.__DASHTERM_STATE__ = ${JSON.stringify(initialState || {})};
    window.__USER_PROFILE__ = ${JSON.stringify(userProfile || { uid: '', email: '', displayName: 'Unknown' })};
    window.__EVENT_HANDLERS__ = {};
    window.DASHTERM_API_BASE = ${JSON.stringify(apiBase)};
    // Correlation map for dashterm.* requests proxied through the native shell.
    window.__MF_PENDING__ = {};
    window.__MF_SEQ__ = 0;

    window.DashTermBridge = {
      // Get current state
      getState: function() {
        return window.__DASHTERM_STATE__;
      },

      // Update state (sends to React Native)
      updateState: function(updates) {
        // Optimistically update local state
        window.__DASHTERM_STATE__ = { ...window.__DASHTERM_STATE__, ...updates };
        // Send to React Native
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'UPDATE_STATE',
          payload: updates
        }));
        // Trigger re-render
        if (window.__FORCE_UPDATE__) window.__FORCE_UPDATE__();
      },

      // Emit event (sends to React Native event system)
      emit: function(eventName, data) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'EMIT_EVENT',
          payload: { eventName: eventName, eventData: data }
        }));
      },

      // Subscribe to events
      subscribe: function(pattern, handler) {
        window.__EVENT_HANDLERS__[pattern] = handler;
        return function() {
          delete window.__EVENT_HANDLERS__[pattern];
        };
      },

      // Get user profile
      getUserProfile: function() {
        return window.__USER_PROFILE__;
      },

      // Console logging (forwards to React Native)
      log: function() {
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, args);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'CONSOLE_LOG',
          payload: args
        }));
      },

      // Authenticated gateway request, performed by the native shell (which
      // holds the session cookie) and returned by request id. Backs the
      // dashterm.* helpers (secrets proxy + AI chat) on mobile.
      request: function(path, init) {
        return new Promise(function(resolve, reject) {
          var id = 'mf_' + (++window.__MF_SEQ__);
          window.__MF_PENDING__[id] = { resolve: resolve, reject: reject };
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'MF_REQUEST',
            payload: { id: id, path: path, init: init || {} }
          }));
        });
      }
    };

    // Resolve a pending dashterm.* request when its response arrives.
    window.__mfHandleResponse = function(data) {
      var p = window.__MF_PENDING__[data.id];
      if (!p) return;
      delete window.__MF_PENDING__[data.id];
      if (data.ok) p.resolve(data.data);
      else p.reject(new Error(data.error || 'request failed'));
    };

    // Listen for messages from React Native
    document.addEventListener('message', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'MF_RESPONSE') {
          window.__mfHandleResponse(data);
        } else if (data.type === 'STATE_UPDATE') {
          window.__DASHTERM_STATE__ = data.state;
          if (window.__FORCE_UPDATE__) window.__FORCE_UPDATE__();
        } else if (data.type === 'EVENT') {
          // Route to subscribed handlers
          Object.keys(window.__EVENT_HANDLERS__).forEach(function(pattern) {
            var eventType = data.event && data.event.type;
            if (eventType && (pattern === '*' || pattern === eventType ||
                (pattern.endsWith('*') && eventType.startsWith(pattern.slice(0, -1))))) {
              window.__EVENT_HANDLERS__[pattern](data.event);
            }
          });
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    });

    // Also listen via window for iOS
    window.addEventListener('message', function(e) {
      try {
        var data = JSON.parse(e.data);
        if (data.type === 'MF_RESPONSE') {
          window.__mfHandleResponse(data);
        } else if (data.type === 'STATE_UPDATE') {
          window.__DASHTERM_STATE__ = data.state;
          if (window.__FORCE_UPDATE__) window.__FORCE_UPDATE__();
        } else if (data.type === 'EVENT') {
          Object.keys(window.__EVENT_HANDLERS__).forEach(function(pattern) {
            var eventType = data.event && data.event.type;
            if (eventType && (pattern === '*' || pattern === eventType ||
                (pattern.endsWith('*') && eventType.startsWith(pattern.slice(0, -1))))) {
              window.__EVENT_HANDLERS__[pattern](data.event);
            }
          });
        }
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    });

    // ============================================
    // ERROR HANDLING
    // ============================================
    window.onerror = function(message, source, lineno, colno, error) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ERROR',
        payload: { message: message, source: source, line: lineno, column: colno }
      }));
      return true;
    };

    // Catch unhandled promise rejections (the usual home of "Load failed"
    // from a failed fetch deep inside a vibe-coded app's render).
    window.addEventListener('unhandledrejection', function(e) {
      var r = e && e.reason;
      var detail = (r && (r.stack || r.message)) || String(r);
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ERROR',
        payload: { message: 'unhandledrejection: ' + detail }
      }));
    });

    // Wrap fetch so any network failure surfaces URL + method + cert/CORS/DNS
    // signal both in the host RN console AND in the error message the vibe-
    // coded app re-throws on screen. iOS WKWebView's bare "Load failed" is
    // useless without this.
    (function() {
      var origFetch = window.fetch;
      if (!origFetch) return;
      window.fetch = function(input, init) {
        var url = '';
        var method = (init && init.method) || 'GET';
        try {
          url = typeof input === 'string'
            ? input
            : (input && input.url) ? input.url : String(input);
          if (input && input.method) method = input.method;
        } catch (_) {}
        return origFetch.apply(this, arguments).then(function(res) {
          // Surface non-2xx as part of the error chain — many vibe apps treat
          // .ok=false as a thrown error; we leave that behaviour intact and
          // just attach extra context to the response object for inspection.
          res.__mfRequest = { url: url, method: method };
          return res;
        }, function(err) {
          var name = (err && err.name) || 'Error';
          var msg  = (err && err.message) || String(err);
          var detail = name + ': ' + msg + ' [' + method + ' ' + url + ']';
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CONSOLE_LOG',
              payload: ['[fetch failed]', detail, {
                url: url, method: method, name: name, message: msg,
                online: (typeof navigator !== 'undefined') ? navigator.onLine : null,
                origin: location && location.origin,
              }],
            }));
          } catch (_) {}
          var wrapped = new Error(detail);
          wrapped.cause = err;
          throw wrapped;
        });
      };
    })();

    // ============================================
    // COMPILED APP CODE
    // ============================================
    try {
      ${compiledCode}
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'ERROR',
        payload: { message: 'Failed to execute compiled code: ' + err.message }
      }));
    }

    // ============================================
    // MOUNT THE APP
    // ============================================
    (function() {
      try {
        var AppComponent = window.CustomAppComponent;
        if (!AppComponent) {
          throw new Error('CustomAppComponent not found in compiled code');
        }

        // Create a wrapper that handles state updates
        function AppWrapper() {
          var forceUpdate = React.useReducer(function(x) { return x + 1; }, 0)[1];

          React.useEffect(function() {
            window.__FORCE_UPDATE__ = forceUpdate;
            return function() { window.__FORCE_UPDATE__ = null; };
          }, [forceUpdate]);

          return React.createElement(AppComponent, {
            appState: window.__DASHTERM_STATE__,
            onUpdateState: function(updates) {
              DashTermBridge.updateState(updates);
            },
            userProfile: window.__USER_PROFILE__
          });
        }

        var root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(AppWrapper));

        // Signal that we're ready
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));

      } catch (err) {
        document.getElementById('root').innerHTML =
          '<div style="color: #ff0000; padding: 20px; font-family: monospace;">' +
          '<h3>MOUNT ERROR</h3>' +
          '<pre>' + err.message + '</pre>' +
          '</div>';
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'ERROR',
          payload: { message: 'Failed to mount app: ' + err.message }
        }));
      }
    })();
  </script>
</body>
</html>
`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingHeader: {
    borderBottomWidth: 2,
    borderBottomColor: '#00ffff',
    backgroundColor: 'rgba(0, 40, 40, 0.8)',
    padding: 20,
  },
  loadingTitle: {
    fontFamily: 'Courier New',
    fontSize: 14,
    letterSpacing: 2,
    color: '#00ffff',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  loadingAppName: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#00ffff',
  },
  loadingContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#ffffff',
    textAlign: 'center',
    marginTop: 15,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlayText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#00ffff',
    marginLeft: 10,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  errorHeader: {
    borderBottomWidth: 2,
    borderBottomColor: '#ff0000',
    backgroundColor: 'rgba(40, 0, 0, 0.8)',
    padding: 20,
  },
  errorTitle: {
    fontFamily: 'Courier New',
    fontSize: 14,
    letterSpacing: 2,
    color: '#ff0000',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  errorAppName: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffff00',
  },
  errorContent: {
    flex: 1,
    padding: 20,
  },
  errorText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ffffff',
    lineHeight: 16,
    marginBottom: 20,
  },
  errorHint: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
    lineHeight: 14,
  },
});
