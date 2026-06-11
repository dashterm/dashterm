import React, { Component, ErrorInfo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { CustomApp, UserProfile } from '../types';

interface DynamicAppRendererProps {
  customApp: CustomApp;
  appState: any;
  onUpdateState: (updates: any) => void;
  userProfile: UserProfile | null;
  // Per-user gateway API base (derived from AgenticCoder's relayUrl). Empty
  // string means no relay configured yet — surfaced as a helpful message
  // rather than a "DASHTERM_API_BASE not set" failure inside each app.
  apiBase: string;
}

interface DynamicAppRendererState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isCompiling: boolean;
  compiledComponent: React.ComponentType<any> | null;
}

/**
 * Error Boundary + Dynamic Component Renderer
 * Safely executes and renders AI-generated custom app code
 */
export default class DynamicAppRenderer extends Component<
  DynamicAppRendererProps,
  DynamicAppRendererState
> {
  constructor(props: DynamicAppRendererProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isCompiling: false,
      compiledComponent: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<DynamicAppRendererState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Custom App Error]', this.props.customApp.name, error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidMount() {
    this.compileAndLoadComponent();
  }

  componentDidUpdate(prevProps: DynamicAppRendererProps) {
    // Reset error state and recompile if app code changes (edited)
    if (prevProps.customApp.code !== this.props.customApp.code) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        compiledComponent: null
      });
      this.compileAndLoadComponent();
    }
    // Mirror the latest relay URL onto the global so in-flight apps pick up
    // changes (e.g. the user edits the relay in AgenticCoder mid-session).
    if (prevProps.apiBase !== this.props.apiBase && typeof window !== 'undefined') {
      (window as any).DASHTERM_API_BASE = this.props.apiBase;
    }
  }

  renderError() {
    const { customApp } = this.props;
    const { error, errorInfo } = this.state;

    return (
      <View style={styles.errorContainer}>
        <View style={styles.errorHeader}>
          <Text style={styles.errorTitle}>⚠ ERROR IN CUSTOM APP</Text>
          <Text style={styles.errorAppName}>{customApp.name}</Text>
        </View>

        <ScrollView style={styles.errorContent}>
          <Text style={styles.errorLabel}>ERROR:</Text>
          <Text style={styles.errorText}>{error?.toString()}</Text>

          {errorInfo && (
            <>
              <Text style={[styles.errorLabel, { marginTop: 20 }]}>STACK TRACE:</Text>
              <Text style={styles.errorStack}>{errorInfo.componentStack}</Text>
            </>
          )}

          <Text style={[styles.errorLabel, { marginTop: 20 }]}>SOLUTION:</Text>
          <Text style={styles.errorText}>
            Ask the AI to fix this error by describing the issue.
            {'\n\n'}
            Example: "Fix the error in {customApp.name}"
          </Text>
        </ScrollView>
      </View>
    );
  }

  async compileAndLoadComponent() {
    const { customApp } = this.props;

    this.setState({ isCompiling: true });

    try {
      console.log('🔧 Compiling custom app:', customApp.name);

      // Compile through the gateway: the native install serves the bundle
      // and the API from the same origin, so '' + '/api/compile' resolves
      // correctly. EXPO_PUBLIC_COMPILE_URL stays an optional override for
      // setups that front the gateway behind a different origin.
      const base =
        process.env.EXPO_PUBLIC_GATEWAY_URL ??
        process.env.EXPO_PUBLIC_COMPILE_URL ??
        '';
      const response = await fetch(`${base}/api/compile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: customApp.code,
          appName: customApp.name,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(`Compilation failed: ${result.error}\n${result.details?.join('\n') || ''}`);
      }

      // Execute the compiled code
      const component = this.executeCompiledCode(result.compiledCode);

      this.setState({
        compiledComponent: component,
        isCompiling: false,
      });

    } catch (error) {
      console.error('❌ Compilation error:', error);
      this.setState({
        hasError: true,
        error: error as Error,
        isCompiling: false,
      });
    }
  }

  executeCompiledCode(compiledCode: string): React.ComponentType<any> {
    try {
      // Ensure React is available on window for compiled code
      if (typeof window !== 'undefined') {
        (window as any).React = React;
        // Per-user relay URL — set fresh on every render so a user changing
        // their relay in AgenticCoder takes effect on next compile without a
        // page reload.
        (window as any).DASHTERM_API_BASE = this.props.apiBase;
        // Gateway base for the dashterm.* helpers (secrets proxy + AI chat).
        // Same origin the dashboard's own /api calls use.
        (window as any).DASHTERM_GATEWAY_BASE = process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
      }

      // Execute the compiled code in a controlled environment
      const executeCode = new Function('React', 'useState', 'useEffect', 'useRef', `
        ${compiledCode}
        return window.CustomAppComponent;
      `);

      const { useState, useEffect, useRef } = React;
      const component = executeCode(React, useState, useEffect, useRef);

      if (!component) {
        throw new Error('Component not found in compiled code');
      }

      return component;
    } catch (error) {
      console.error('❌ Code execution error:', error);
      throw new Error(`Failed to execute compiled code: ${(error as Error).message}`);
    }
  }

  render() {
    const { appState, onUpdateState, userProfile } = this.props;
    const { hasError, isCompiling, compiledComponent } = this.state;

    if (hasError) {
      return this.renderError();
    }

    if (isCompiling) {
      return this.renderLoading();
    }

    if (!compiledComponent) {
      return this.renderLoading();
    }

    try {
      const CustomComponent = compiledComponent;
      const { customApp, apiBase } = this.props;

      // Bound helper so an app can call ITS OWN agent-authored backend without
      // knowing its share code: backend('/uptime') → GET /api/x/<id>/uptime.
      // Resolves the parsed JSON body; throws on a non-2xx with the error text.
      const backendBase = `${apiBase || ''}/x/${customApp.id}`;
      const backend = async (p: string, init?: RequestInit) => {
        const rel = p && p[0] === '/' ? p : `/${p || ''}`;
        const res = await fetch(backendBase + rel, { credentials: 'include', ...(init || {}) });
        const ct = res.headers.get('content-type') || '';
        const payload = ct.includes('application/json') ? await res.json() : await res.text();
        if (!res.ok) {
          const msg = payload && (payload as any).error ? (payload as any).error : `HTTP ${res.status}`;
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        return payload;
      };

      return (
        <CustomComponent
          appState={appState}
          onUpdateState={onUpdateState}
          appId={customApp.id}
          backend={backend}
          userProfile={userProfile || {
            uid: '',
            email: '',
            displayName: 'Unknown User',
          }}
        />
      );
    } catch (error) {
      console.error('[Custom App Render Error]', this.props.customApp.name, error);
      return (
        <View style={styles.errorContainer}>
          <View style={styles.errorHeader}>
            <Text style={styles.errorTitle}>⚠ RUNTIME ERROR</Text>
            <Text style={styles.errorAppName}>{this.props.customApp.name}</Text>
          </View>
          <View style={styles.errorContent}>
            <Text style={styles.errorText}>
              {error instanceof Error ? error.message : String(error)}
            </Text>
          </View>
        </View>
      );
    }
  }

  renderLoading() {
    const { customApp } = this.props;

    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingHeader}>
          <Text style={styles.loadingTitle}>⚡ COMPILING</Text>
          <Text style={styles.loadingAppName}>{customApp.name}</Text>
        </View>
        <View style={styles.loadingContent}>
          <Text style={styles.loadingText}>Transpiling TypeScript...</Text>
          <Text style={styles.loadingSubText}>Please wait...</Text>
        </View>
      </View>
    );
  }

}

const styles = StyleSheet.create({
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
  errorLabel: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ff0000',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  errorText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ffffff',
    lineHeight: 16,
  },
  errorStack: {
    fontFamily: 'Courier New',
    fontSize: 9,
    color: '#666666',
    lineHeight: 14,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingHeader: {
    borderBottomWidth: 2,
    borderBottomColor: '#ffff00',
    backgroundColor: 'rgba(40, 40, 0, 0.8)',
    padding: 20,
  },
  loadingTitle: {
    fontFamily: 'Courier New',
    fontSize: 14,
    letterSpacing: 2,
    color: '#ffff00',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  loadingAppName: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffff00',
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
    marginBottom: 10,
  },
  loadingSubText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
    textAlign: 'center',
  },
});
