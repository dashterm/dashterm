/**
 * Full-screen blocking overlay shown while a self-update is applying. The
 * gateway is down for the rebuild, so this deliberately hides ALL app UI (and
 * pre-empts the login screen the failed auth checks would otherwise show) until
 * the gateway restarts on the new version and the page reloads.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { UpdatePhase } from '../../hooks/useUpdateProgress';

interface Props {
  phase: UpdatePhase;
  target: string | null;
  onDismiss: () => void;
}

export default function UpdatingModal({ phase, target, onDismiss }: Props) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (phase === 'complete' || phase === 'failed') return;
    const id = setInterval(() => setTick((t) => (t + 1) % 4), 400);
    return () => clearInterval(id);
  }, [phase]);

  const dots = '.'.repeat(tick) + ' '.repeat(3 - tick);
  const ver = target ? `v${target}` : 'the latest version';

  const headline =
    phase === 'complete'
      ? `✓ UPDATED TO ${ver}`
      : phase === 'failed'
        ? '✗ UPDATE DID NOT COMPLETE'
        : `UPDATING TO ${ver}`;

  const body =
    phase === 'restarting'
      ? 'Gateway restarting — the dashboard is offline and will reconnect automatically.'
      : phase === 'rebuilding'
        ? 'Rebuilding the gateway and dashboard. This takes a couple of minutes.'
        : phase === 'complete'
          ? 'Reloading the dashboard…'
          : 'The gateway should have rolled back to the previous version. Check ~/.dashterm/update.log for details.';

  const accent =
    phase === 'complete' ? '#00ff00' : phase === 'failed' ? '#ff5555' : '#00ffff';

  return (
    <View style={styles.overlay}>
      <View style={[styles.panel, { borderColor: accent }]}>
        <Text style={[styles.headline, { color: accent }]}>
          {headline}
          {phase === 'rebuilding' || phase === 'restarting' ? (
            <Text style={styles.dots}>{dots}</Text>
          ) : null}
        </Text>
        <Text style={styles.body}>{body}</Text>

        {phase === 'rebuilding' || phase === 'restarting' ? (
          <Text style={styles.warn}>Keep this window open — do not close it.</Text>
        ) : null}

        {phase === 'failed' ? (
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={() => {
                if (typeof window !== 'undefined' && window.location) window.location.reload();
              }}
            >
              <Text style={styles.btnText}>[ RELOAD ]</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={onDismiss}
            >
              <Text style={styles.btnText}>[ DISMISS ]</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  panel: {
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 24,
    maxWidth: 460,
    backgroundColor: 'rgba(0,255,255,0.03)',
  },
  headline: {
    fontFamily: 'Courier New',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
    textAlign: 'center',
  },
  dots: { fontFamily: 'Courier New', fontSize: 16, fontWeight: 'bold' },
  body: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#8892b0',
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
  },
  warn: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ffff00',
    textAlign: 'center',
    marginTop: 14,
    letterSpacing: 1,
  },
  actions: { flexDirection: 'row', gap: 14, marginTop: 20, justifyContent: 'center' },
  btn: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,255,255,0.08)',
  },
  btnPressed: { opacity: 0.6 },
  btnText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#00ffff',
    letterSpacing: 1,
  },
});
