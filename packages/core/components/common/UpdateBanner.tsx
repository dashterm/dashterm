/**
 * Dashboard "update available" banner. Renders nothing unless the gateway
 * reports a newer release tag (see useUpdateStatus). Admins on a daemon
 * install get an "UPDATE NOW" button that triggers the in-place self-update
 * (git checkout tag → rebuild → restart); everyone else sees the manual
 * `dashterm update` command instead.
 *
 * Terminal aesthetic: amber on near-black, Courier New, cyan action button.
 */

import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useUpdateStatus } from '../../hooks/useUpdateStatus';

export default function UpdateBanner() {
  const { status, visible, running, error, runUpdate, dismiss } = useUpdateStatus();
  const [showNotes, setShowNotes] = useState(false);
  if (!visible || !status) return null;

  const current = status.currentVersion ?? '?';
  const latest = status.latestVersion ?? '?';
  const hasNotes = !!status.releaseNotes && status.releaseNotes.trim().length > 0;
  const hasLink = !!status.releaseUrl;

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.text} numberOfLines={1}>
          <Text style={styles.glyph}>▲ </Text>
          <Text style={styles.strong}>UPDATE AVAILABLE</Text>
          {`  v${latest}  `}
          <Text style={styles.dim}>{`(running v${current})`}</Text>
          {error ? <Text style={styles.error}>{`   ✗ ${error}`}</Text> : null}
        </Text>

        <View style={styles.actions}>
          {(hasNotes || hasLink) && !running ? (
            <Pressable
              style={({ pressed }) => [styles.linkBtn, pressed && styles.btnPressed]}
              onPress={() => setShowNotes((s) => !s)}
            >
              <Text style={styles.linkText}>{showNotes ? "What's new ▴" : "What's new ▾"}</Text>
            </Pressable>
          ) : null}

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

      {showNotes && !running ? (
        <View style={styles.notesPanel}>
          <Text style={styles.notesTitle}>
            {status.releaseName ? status.releaseName : `v${latest}`}
          </Text>
          {hasNotes ? (
            <ScrollView style={styles.notesScroll}>
              <Text style={styles.notesText}>{status.releaseNotes}</Text>
            </ScrollView>
          ) : (
            <Text style={styles.notesDim}>No release notes provided.</Text>
          )}
          {hasLink ? (
            <Pressable
              onPress={() => {
                if (status.releaseUrl) void Linking.openURL(status.releaseUrl);
              }}
            >
              <Text style={styles.releaseLink}>View release on GitHub ↗</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 101,
    elevation: 101,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 0, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: '#ffff00',
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
  linkBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  linkText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ffff',
    letterSpacing: 1,
    textDecorationLine: 'underline',
  },
  notesPanel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#665500',
  },
  notesTitle: {
    fontFamily: 'Courier New',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffff00',
    marginBottom: 6,
    letterSpacing: 1,
  },
  notesScroll: { maxHeight: 220 },
  notesText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#c8d0e0',
    lineHeight: 17,
  },
  notesDim: { fontFamily: 'Courier New', fontSize: 11, color: '#8892b0' },
  releaseLink: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ffff',
    marginTop: 10,
    textDecorationLine: 'underline',
  },
});
