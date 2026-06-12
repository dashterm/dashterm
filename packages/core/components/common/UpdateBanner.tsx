/**
 * Dashboard "update available" banner. Renders nothing unless the gateway
 * reports a newer release tag (see useUpdateStatus). Admins on a daemon
 * install get an "UPDATE NOW" button that triggers the in-place self-update
 * (git checkout tag → rebuild → restart); everyone else sees the manual
 * `dashterm update` command instead.
 *
 * Terminal aesthetic: amber on near-black, Courier New, cyan action button.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';

export default function UpdateBanner() {
  const { status, visible, running, error, runUpdate, dismiss } = useUpdateStatus();
  if (!visible || !status) return null;

  const current = status.currentVersion ?? '?';
  const latest = status.latestVersion ?? '?';

  return (
    <View style={styles.banner}>
      <Text style={styles.text} numberOfLines={1}>
        <Text style={styles.glyph}>▲ </Text>
        <Text style={styles.strong}>UPDATE AVAILABLE</Text>
        {`  v${latest}  `}
        <Text style={styles.dim}>{`(running v${current})`}</Text>
        {error ? <Text style={styles.error}>{`   ✗ ${error}`}</Text> : null}
      </Text>

      <View style={styles.actions}>
        {running ? (
          <Text style={styles.updating}>UPDATING… (gateway will restart)</Text>
        ) : status.canApply ? (
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={() => void runUpdate()}
          >
            <Text style={styles.btnText}>[ UPDATE NOW ]</Text>
          </Pressable>
        ) : (
          <Text style={styles.hint}>
            run <Text style={styles.cmd}>dashterm update</Text>
          </Text>
        )}

        {!running && (
          <Pressable
            style={({ pressed }) => [styles.close, pressed && styles.btnPressed]}
            onPress={dismiss}
            accessibilityLabel="Dismiss update banner"
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 0, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: '#ffff00',
    zIndex: 101,
    elevation: 101,
  },
  text: {
    flex: 1,
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ffff00',
    letterSpacing: 1,
  },
  glyph: { color: '#ffff00' },
  strong: { fontWeight: 'bold', color: '#ffff00' },
  dim: { color: '#999900' },
  error: { color: '#ff5555' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  updating: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ffff',
    letterSpacing: 1,
  },
  btn: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(0, 255, 255, 0.08)',
  },
  btnPressed: { opacity: 0.6 },
  btnText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    fontWeight: 'bold',
    color: '#00ffff',
    letterSpacing: 1,
  },
  hint: { fontFamily: 'Courier New', fontSize: 11, color: '#999900' },
  cmd: { color: '#00ffff' },
  close: { paddingHorizontal: 6, paddingVertical: 1 },
  closeText: { fontFamily: 'Courier New', fontSize: 16, color: '#ffff00', lineHeight: 16 },
});
