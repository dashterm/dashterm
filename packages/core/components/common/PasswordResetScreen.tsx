import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Platform } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import TerminalButton from './TerminalButton';
import TerminalPanel from './TerminalPanel';

/**
 * Full-screen gate shown when the signed-in account has
 * `must_reset_password=true` in user_metadata. The seeded admin starts
 * out with this flag set; clearing it requires actually picking a new
 * password (a real one, not "changeme").
 */
export default function PasswordResetScreen() {
  const { user, updatePassword, updateUserMetadata, signOut } = useAuth();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    if (next.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    if (next === 'changeme') {
      setErr("Please choose a real password — that's the seed default.");
      return;
    }

    setBusy(true);
    const upd = await updatePassword(next);
    if (!upd.ok) {
      setErr(upd.error || 'Password update failed.');
      setBusy(false);
      return;
    }
    // Clear the flag so subsequent logins go straight to the dashboard.
    await updateUserMetadata({ must_reset_password: false });
    setBusy(false);
    // The useAuth hook re-reads metadata after updateUser — the App-level
    // check will see must_reset_password=false and switch to the dashboard
    // on next render.
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>PASSWORD RESET REQUIRED</Text>
        <Text style={styles.subtitle}>{user?.email || 'your account'}</Text>
      </View>

      <TerminalPanel header="Set a new password" style={styles.panel}>
        <Text style={styles.description}>
          Your account was seeded with a default password. Pick a real one
          before you can use the dashboard.
        </Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>NEW PASSWORD</Text>
          <TextInput
            value={next}
            onChangeText={setNext}
            placeholder="at least 8 characters"
            placeholderTextColor="#005555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            editable={!busy}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>CONFIRM</Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder="re-type new password"
            placeholderTextColor="#005555"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            editable={!busy}
            onSubmitEditing={submit}
          />
        </View>

        {err ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>{err.toUpperCase()}</Text>
          </View>
        ) : null}

        <View style={styles.buttonRow}>
          <TerminalButton
            onPress={submit}
            disabled={busy || !next || !confirm}
            variant="success"
            style={styles.primaryBtn}
          >
            {busy ? 'SAVING...' : 'SAVE NEW PASSWORD'}
          </TerminalButton>
          <TerminalButton
            onPress={signOut}
            disabled={busy}
            variant="secondary"
            style={styles.secondaryBtn}
          >
            CANCEL & SIGN OUT
          </TerminalButton>
        </View>
      </TerminalPanel>
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
    marginBottom: 30,
    borderWidth: 2,
    borderColor: '#ffff00',
    padding: 20,
    backgroundColor: 'rgba(40, 40, 0, 0.6)',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 0 20px rgba(255, 255, 0, 0.3)' }
      : {
          shadowColor: '#ffff00',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.3,
          shadowRadius: 10,
        }),
  },
  title: {
    fontFamily: 'Courier New',
    fontSize: 18,
    letterSpacing: 2,
    color: '#ffff00',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#cccc00',
  },
  panel: {
    maxWidth: 500,
    alignSelf: 'center',
    width: '100%',
  },
  description: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#00ffff',
    marginBottom: 14,
    lineHeight: 18,
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
    marginTop: 14,
  },
  errorText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ff0000',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    flex: 1,
    minWidth: 180,
  },
  secondaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
});
