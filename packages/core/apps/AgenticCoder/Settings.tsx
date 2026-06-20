import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import type { AppSettingsContext } from '../../registry/types';

export default function AgenticCoderSettings({ state, updateState, onClose }: AppSettingsContext) {
  const [relayUrl, setRelayUrl] = useState<string>(state?.relayUrl || '');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const save = () => {
    updateState({ relayUrl: relayUrl.trim() });
    onClose();
  };

  const probe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const httpUrl = relayUrl.trim()
        .replace(/^wss:/i, 'https:')
        .replace(/^ws:/i, 'http:')
        .replace(/\/ws\/?$/i, '')
        .replace(/\/+$/, '');
      const resp = await fetch(`${httpUrl}/health`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json().catch(() => ({}));
      setProbeResult(`✓ ${data.service || 'relay'} responded`);
    } catch (err: any) {
      setProbeResult(`✗ ${err?.message || 'unreachable'}`);
    } finally {
      setProbing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>+-- AGENTIC CODER SETTINGS --+</Text>

      <Text style={styles.label}>DASHTERM URL</Text>
      <Text style={styles.help}>
        WebSocket endpoint of your dashterm container. Examples:{'\n'}
        {'  '}wss://your-host.example.com/dashterm{'\n'}
        {'  '}ws://192.168.1.10:18790{'\n'}
        Leave blank to use the EXPO_PUBLIC_DASHTERM_URL build default.
      </Text>
      <TextInput
        value={relayUrl}
        onChangeText={setRelayUrl}
        placeholder="wss://your-host/dashterm"
        placeholderTextColor="#005555"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />

      <View style={styles.row}>
        <Pressable onPress={probe} style={styles.secondaryButton} disabled={probing || !relayUrl.trim()}>
          <Text style={styles.secondaryText}>{probing ? '[ probing... ]' : '[ test /health ]'}</Text>
        </Pressable>
        {probeResult && (
          <Text style={[styles.probeResult, probeResult.startsWith('✓') ? styles.ok : styles.err]}>
            {probeResult}
          </Text>
        )}
      </View>

      <Text style={[styles.label, { marginTop: 24 }]}>HOSTING OPTIONS</Text>
      <Text style={styles.help}>
        • <Text style={styles.bold}>Use the operator's dashterm</Text> (preconfigured coding
        agent — owner pays the bill). Paste the URL they shared.{'\n\n'}
        • <Text style={styles.bold}>Host your own</Text>: build the relay server image,
        run `docker compose up -d dashterm`, expose port 18790 via Tailscale Serve
        for HTTPS, then paste the URL here.{'\n\n'}
        • <Text style={styles.bold}>Prefer the CLI</Text>: run `dashterm dev` locally and
        edit files with your own agent (Claude Code, Codex) — no relay needed.
      </Text>

      <View style={[styles.row, { marginTop: 16 }]}>
        <Pressable onPress={save} style={styles.primaryButton}>
          <Text style={styles.primaryText}>[ SAVE ]</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>[ CANCEL ]</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16 },
  title: { fontFamily: 'Courier New', fontSize: 14, color: '#00ffff', marginBottom: 16 },
  label: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00', marginBottom: 4 },
  help: { fontFamily: 'Courier New', fontSize: 11, color: '#888888', marginBottom: 8, lineHeight: 16 },
  bold: { color: '#cccccc' },
  input: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffff00',
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#000000',
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  primaryButton: {
    borderWidth: 1, borderColor: '#00ffff',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  primaryText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff' },
  secondaryButton: {
    borderWidth: 1, borderColor: '#003333',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  secondaryText: { fontFamily: 'Courier New', fontSize: 11, color: '#888888' },
  probeResult: { fontFamily: 'Courier New', fontSize: 11, marginLeft: 8 },
  ok: { color: '#00ff00' },
  err: { color: '#ff0000' },
});
