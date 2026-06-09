/**
 * AIAssistant settings — pick which AI provider answers the chat.
 *
 * Reads /api/ai/providers (list + bindings), shows the current resolved
 * provider for appId='ai', and lets an admin POST a new binding.
 * Non-admins see the current routing but can't change it (the bind /
 * unbind endpoints are admin-gated server-side anyway).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import type { AppSettingsContext } from '../../registry/types';

const APP_ID = 'ai';

interface ProviderSummary {
  id: string;
  name: string;
  kind: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  defaultModel: string;
  baseUrl: string | null;
  isDefault: boolean;
  hasApiKey: boolean;
}

interface Binding {
  appId: string;
  providerId: string;
}

function baseUrl(): string {
  return process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
}

export default function AIAssistantSettings({ onClose }: AppSettingsContext) {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [boundProviderId, setBoundProviderId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/ai/providers`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { providers: ProviderSummary[]; bindings: Binding[] };
      setProviders(data.providers);
      const myBinding = data.bindings.find((b) => b.appId === APP_ID);
      setBoundProviderId(myBinding?.providerId ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProviders([]);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const choose = async (providerId: string | null) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (providerId === null) {
        // Use default — drop the binding.
        const r = await fetch(`${baseUrl()}/api/ai/providers/unbind`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: APP_ID }),
        });
        if (!r.ok) throw new Error(`unbind failed: HTTP ${r.status}`);
      } else {
        const r = await fetch(`${baseUrl()}/api/ai/providers/${encodeURIComponent(providerId)}/bind`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: APP_ID }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`bind failed: HTTP ${r.status} ${text.slice(0, 120)}`);
        }
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const defaultProvider = providers?.find((p) => p.isDefault) ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
      <View style={styles.header}>
        <Text style={styles.headerText}>+-- AI PROVIDER --+</Text>
        <Pressable onPress={reload} style={styles.refresh}>
          <Text style={styles.refreshText}>[ ↻ REFRESH ]</Text>
        </Pressable>
      </View>

      <Text style={styles.help}>
        Pick the AI backend that answers chat in this app. Configure providers
        on the server with <Text style={styles.code}>$ dashterm provider add</Text>.
      </Text>

      {err && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>! {err}</Text>
        </View>
      )}

      {providers === null ? (
        <Text style={styles.muted}>LOADING…</Text>
      ) : providers.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No providers configured yet.</Text>
          <Text style={styles.muted}>
            Run on the host:
            {'\n'}<Text style={styles.code}>$ dashterm provider add my-claude --kind anthropic --model claude-haiku-4-5 --api-key sk-… --default</Text>
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.row}>
            <Pressable
              onPress={() => choose(null)}
              disabled={busy || boundProviderId === null}
              style={[
                styles.choice,
                boundProviderId === null && styles.choiceActive,
                busy && styles.choiceBusy,
              ]}
            >
              <Text style={[styles.choiceTitle, boundProviderId === null && styles.choiceTitleActive]}>
                USE DEFAULT
              </Text>
              <Text style={styles.choiceMeta}>
                {defaultProvider
                  ? `→ ${defaultProvider.name} (${defaultProvider.kind} / ${defaultProvider.defaultModel})`
                  : '(no default configured)'}
              </Text>
            </Pressable>
          </View>

          {providers.map((p) => {
            const isActive = boundProviderId === p.id;
            return (
              <View style={styles.row} key={p.id}>
                <Pressable
                  onPress={() => choose(p.id)}
                  disabled={busy || isActive}
                  style={[styles.choice, isActive && styles.choiceActive, busy && styles.choiceBusy]}
                >
                  <View style={styles.choiceHead}>
                    <Text style={[styles.choiceTitle, isActive && styles.choiceTitleActive]}>
                      {p.name}
                    </Text>
                    {p.isDefault && <Text style={styles.badge}>DEFAULT</Text>}
                    {!p.hasApiKey && p.kind !== 'ollama' && (
                      <Text style={styles.badgeWarn}>NO KEY</Text>
                    )}
                  </View>
                  <Text style={styles.choiceMeta}>{p.kind} · {p.defaultModel}</Text>
                </Pressable>
              </View>
            );
          })}
        </>
      )}

      <View style={styles.footer}>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>[ CLOSE ]</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1 },
  refresh: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#004444' },
  refreshText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },
  help: { fontFamily: 'Courier New', fontSize: 10, color: '#888888', marginBottom: 14, lineHeight: 16 },
  code: { color: '#00ff00' },
  errBox: { borderWidth: 1, borderColor: '#ff0000', padding: 10, marginBottom: 12, backgroundColor: 'rgba(255,0,0,0.08)' },
  errText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff0000' },
  muted: { fontFamily: 'Courier New', fontSize: 11, color: '#666666', marginTop: 4 },
  emptyBox: { padding: 10, borderWidth: 1, borderColor: '#333333' },
  emptyText: { fontFamily: 'Courier New', fontSize: 12, color: '#cccccc', marginBottom: 6 },
  row: { marginBottom: 8 },
  choice: { borderWidth: 1, borderColor: '#004444', padding: 10, backgroundColor: 'rgba(0,30,30,0.4)' },
  choiceActive: { borderColor: '#00ffff', backgroundColor: 'rgba(0,255,255,0.06)' },
  choiceBusy: { opacity: 0.5 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceTitle: { fontFamily: 'Courier New', fontSize: 12, color: '#cccccc', fontWeight: 'bold' },
  choiceTitleActive: { color: '#00ffff' },
  choiceMeta: { fontFamily: 'Courier New', fontSize: 10, color: '#666666', marginTop: 4 },
  badge: { fontFamily: 'Courier New', fontSize: 9, color: '#0a0a0a', backgroundColor: '#00ffff', paddingHorizontal: 6, paddingVertical: 1, letterSpacing: 1 },
  badgeWarn: { fontFamily: 'Courier New', fontSize: 9, color: '#ffff00', borderWidth: 1, borderColor: '#ffff00', paddingHorizontal: 6, paddingVertical: 1, letterSpacing: 1 },
  footer: { marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' },
  closeBtn: { borderWidth: 1, borderColor: '#666666', paddingHorizontal: 10, paddingVertical: 6 },
  closeText: { fontFamily: 'Courier New', fontSize: 11, color: '#cccccc' },
});
