import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import TerminalButton from './TerminalButton';
import TerminalPanel from './TerminalPanel';

export default function LoginPage() {
  const { signInWithPassword, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!email || !password || submitting) return;
    setSubmitting(true);
    await signInWithPassword(email.trim(), password);
    setSubmitting(false);
  };

  const busy = loading || submitting;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>DASHTERM AUTHENTICATION</Text>
        <Text style={styles.subtitle}>SECURE ACCESS REQUIRED</Text>
      </View>

      <TerminalPanel header="Login Protocol" style={styles.loginPanel}>
        <Text style={styles.description}>
          Initialize secure connection to DASHTERM ecosystem.
        </Text>
        <Text style={styles.description}>
          Sign in with the account your operator created for you.
        </Text>

        <View style={styles.statusPanel}>
          <Text style={styles.statusLabel}>CONNECTION_STATUS:</Text>
          <Text style={[styles.statusValue, { color: '#ff0000' }]}>UNAUTHORIZED</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>EMAIL</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="admin@localhost"
            placeholderTextColor="#005555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
            editable={!busy}
            onSubmitEditing={() => { /* tab to password */ }}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>PASSWORD</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#005555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            editable={!busy}
            onSubmitEditing={onSubmit}
          />
        </View>

        {error ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>ERROR: {error.toUpperCase()}</Text>
          </View>
        ) : null}

        <View style={styles.buttonContainer}>
          <TerminalButton
            onPress={onSubmit}
            disabled={busy || !email || !password}
            variant="success"
            style={styles.loginButton}
          >
            {busy ? 'AUTHENTICATING...' : 'SIGN IN'}
          </TerminalButton>
        </View>

        <Text style={styles.helpText}>
          // FIRST LOGIN: admin@localhost / changeme
        </Text>
        <Text style={styles.helpText}>
          // YOU'LL BE PROMPTED TO ROTATE THE PASSWORD
        </Text>
        <Text style={[styles.helpText, { marginTop: 8 }]}>
          // NO ACCOUNT? ASK YOUR OPERATOR TO RUN `dashterm add-user`
        </Text>
      </TerminalPanel>

      <View style={styles.footer}>
        <Text style={styles.footerText}>DASHTERM v1.0 | AI-ENHANCED PRODUCTIVITY PLATFORM</Text>
        <Text style={styles.footerText}>SECURE • SYNCHRONIZED • INTELLIGENT</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    borderWidth: 2,
    borderColor: '#00ffff',
    padding: 20,
    backgroundColor: 'rgba(0, 26, 26, 0.8)',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 20px rgba(0, 255, 255, 0.3)',
    } : {
      shadowColor: '#00ffff',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
    }),
  },
  title: {
    fontFamily: 'Courier New',
    fontSize: 20,
    letterSpacing: 3,
    color: '#00ffff',
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Courier New',
    fontSize: 12,
    letterSpacing: 2,
    color: '#00cccc',
  },
  loginPanel: {
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  description: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#00ffff',
    marginBottom: 10,
    lineHeight: 18,
  },
  statusPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(0, 30, 30, 0.5)',
    borderWidth: 1,
    borderColor: '#004444',
    paddingVertical: 8,
  },
  statusLabel: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00cccc',
  },
  statusValue: {
    fontFamily: 'Courier New',
    fontSize: 11,
    fontWeight: 'bold',
  },
  field: {
    marginTop: 14,
  },
  fieldLabel: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#00ff00',
    marginBottom: 4,
    letterSpacing: 1,
  },
  input: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#00ffff',
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#000000',
  },
  errorPanel: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    borderWidth: 1,
    borderColor: '#ff0000',
    padding: 10,
    marginVertical: 10,
  },
  errorText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ff0000',
    textAlign: 'center',
  },
  buttonContainer: {
    marginTop: 18,
    marginBottom: 12,
  },
  loginButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  helpText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#006666',
    textAlign: 'center',
    marginBottom: 2,
  },
  footer: {
    alignItems: 'center',
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#00ffff',
    paddingTop: 20,
  },
  footerText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#004444',
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: 2,
  },
});
