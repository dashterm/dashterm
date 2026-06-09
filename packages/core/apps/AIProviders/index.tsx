/**
 * AI Providers — manage the AI backends the gateway can route to.
 *
 * Lives as a tile in the reserved Settings space. Reads /api/ai/providers
 * (shared with AIAssistant's settings) and, for admins, drives the provider
 * CRUD routes (POST/PATCH/DELETE/set-default). Non-admins get a read-only
 * view — the mutating endpoints are admin-gated server-side anyway.
 *
 * API keys are write-only: the list only ever reports hasApiKey, so the edit
 * form leaves the key field blank and a blank submit keeps the stored key.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';

type Kind = 'anthropic' | 'openai' | 'gemini' | 'ollama';
const KINDS: Kind[] = ['anthropic', 'openai', 'gemini', 'ollama'];
const MODEL_HINTS: Record<Kind, string> = {
  anthropic: 'e.g. claude-haiku-4-5',
  openai: 'e.g. gpt-4o-mini',
  gemini: 'e.g. gemini-3-flash-preview',
  ollama: 'e.g. llama3.1',
};

interface ProviderSummary {
  id: string;
  name: string;
  kind: Kind;
  defaultModel: string;
  baseUrl: string | null;
  isDefault: boolean;
  hasApiKey: boolean;
}

function baseUrl(): string {
  return process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
}

interface FormState {
  id: string | null; // null = creating
  name: string;
  kind: Kind;
  defaultModel: string;
  apiKey: string;
  baseUrl: string;
  asDefault: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  kind: 'anthropic',
  defaultModel: '',
  apiKey: '',
  baseUrl: '',
  asDefault: false,
};

export default function AIProviders() {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [meRes, provRes] = await Promise.all([
        fetch(`${baseUrl()}/api/auth/me`, { credentials: 'include' }),
        fetch(`${baseUrl()}/api/ai/providers`, { credentials: 'include' }),
      ]);
      const me = (await meRes.json()) as { user?: { isAdmin?: boolean } | null };
      setIsAdmin(!!me.user?.isAdmin);
      if (!provRes.ok) throw new Error(`HTTP ${provRes.status}`);
      const data = (await provRes.json()) as { providers: ProviderSummary[] };
      setProviders(data.providers);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const submit = async () => {
    if (!form || busy) return;
    const name = form.name.trim();
    const defaultModel = form.defaultModel.trim();
    if (!name || !defaultModel) {
      setErr('name and model are required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        name,
        kind: form.kind,
        defaultModel,
        baseUrl: form.baseUrl.trim() || null,
      };
      // Only send the key when the user typed one. On edit, a blank field
      // means "keep the existing key"; the server treats empty as no-op.
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();

      let r: Response;
      if (form.id === null) {
        payload.asDefault = form.asDefault;
        r = await fetch(`${baseUrl()}/api/ai/providers`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        r = await fetch(`${baseUrl()}/api/ai/providers/${encodeURIComponent(form.id)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!r.ok) {
        const t = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(t.error || `HTTP ${r.status}`);
      }
      // A brand-new provider marked default needs no extra call; an EDIT that
      // toggled default does (PATCH doesn't touch is_default).
      if (form.id !== null && form.asDefault) {
        await fetch(`${baseUrl()}/api/ai/providers/${encodeURIComponent(form.id)}/set-default`, {
          method: 'POST',
          credentials: 'include',
        });
      }
      setForm(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/ai/providers/${encodeURIComponent(id)}/set-default`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: ProviderSummary) => {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete provider "${p.name}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/ai/providers/${encodeURIComponent(p.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (p: ProviderSummary) =>
    setForm({
      id: p.id,
      name: p.name,
      kind: p.kind,
      defaultModel: p.defaultModel,
      apiKey: '',
      baseUrl: p.baseUrl ?? '',
      asDefault: p.isDefault,
    });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
      <View style={styles.header}>
        <Text style={styles.headerText}>+-- AI PROVIDERS --+</Text>
        <Pressable onPress={reload} style={styles.refresh}>
          <Text style={styles.refreshText}>[ ↻ ]</Text>
        </Pressable>
      </View>

      <Text style={styles.help}>
        Backends the dashboard and your apps route AI calls to. The provider
        marked DEFAULT answers anything not explicitly bound.
      </Text>

      {err && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>! {err}</Text>
        </View>
      )}

      {providers === null ? (
        <Text style={styles.muted}>LOADING…</Text>
      ) : (
        <>
          {providers.length === 0 && <Text style={styles.muted}>No providers yet.</Text>}
          {providers.map((p) => (
            <View style={styles.card} key={p.id}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{p.name}</Text>
                {p.isDefault && <Text style={styles.badge}>DEFAULT</Text>}
                {!p.hasApiKey && p.kind !== 'ollama' && <Text style={styles.badgeWarn}>NO KEY</Text>}
              </View>
              <Text style={styles.cardMeta}>
                {p.kind} · {p.defaultModel}
                {p.baseUrl ? ` · ${p.baseUrl}` : ''}
              </Text>
              {isAdmin && (
                <View style={styles.cardActions}>
                  {!p.isDefault && (
                    <Pressable onPress={() => setDefault(p.id)} disabled={busy} style={styles.actBtn}>
                      <Text style={styles.actText}>set default</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => startEdit(p)} disabled={busy} style={styles.actBtn}>
                    <Text style={styles.actText}>edit</Text>
                  </Pressable>
                  <Pressable onPress={() => remove(p)} disabled={busy} style={styles.actBtn}>
                    <Text style={[styles.actText, styles.danger]}>delete</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          {!isAdmin && (
            <Text style={styles.muted}>Read-only — only an admin can change providers.</Text>
          )}

          {isAdmin && form === null && (
            <Pressable onPress={() => setForm({ ...EMPTY_FORM })} style={styles.addBtn}>
              <Text style={styles.addText}>[ + ADD PROVIDER ]</Text>
            </Pressable>
          )}

          {isAdmin && form !== null && (
            <View style={styles.form}>
              <Text style={styles.formTitle}>{form.id === null ? 'NEW PROVIDER' : 'EDIT PROVIDER'}</Text>

              <Text style={styles.lbl}>name</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
                placeholder="my-claude"
                placeholderTextColor="#444"
                autoCapitalize="none"
              />

              <Text style={styles.lbl}>kind</Text>
              <View style={styles.kindRow}>
                {KINDS.map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setForm({ ...form, kind: k })}
                    style={[styles.kindBtn, form.kind === k && styles.kindBtnActive]}
                  >
                    <Text style={[styles.kindText, form.kind === k && styles.kindTextActive]}>{k}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.lbl}>default model</Text>
              <TextInput
                style={styles.input}
                value={form.defaultModel}
                onChangeText={(v) => setForm({ ...form, defaultModel: v })}
                placeholder={MODEL_HINTS[form.kind]}
                placeholderTextColor="#444"
                autoCapitalize="none"
              />

              <Text style={styles.lbl}>
                api key {form.id !== null && <Text style={styles.muted}>(blank = keep current)</Text>}
              </Text>
              <TextInput
                style={styles.input}
                value={form.apiKey}
                onChangeText={(v) => setForm({ ...form, apiKey: v })}
                placeholder={form.kind === 'ollama' ? '(not needed for ollama)' : 'sk-…'}
                placeholderTextColor="#444"
                secureTextEntry
                autoCapitalize="none"
              />

              <Text style={styles.lbl}>base url (optional)</Text>
              <TextInput
                style={styles.input}
                value={form.baseUrl}
                onChangeText={(v) => setForm({ ...form, baseUrl: v })}
                placeholder={form.kind === 'ollama' ? 'http://localhost:11434' : 'override endpoint'}
                placeholderTextColor="#444"
                autoCapitalize="none"
              />

              <Pressable
                onPress={() => setForm({ ...form, asDefault: !form.asDefault })}
                style={styles.checkRow}
              >
                <Text style={styles.checkBox}>{form.asDefault ? '[x]' : '[ ]'}</Text>
                <Text style={styles.checkLbl}>make this the default provider</Text>
              </Pressable>

              <View style={styles.formActions}>
                <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && styles.dim]}>
                  <Text style={styles.saveText}>[ {form.id === null ? 'CREATE' : 'SAVE'} ]</Text>
                </Pressable>
                <Pressable onPress={() => setForm(null)} disabled={busy} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>[ CANCEL ]</Text>
                </Pressable>
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1 },
  refresh: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#004444' },
  refreshText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },
  help: { fontFamily: 'Courier New', fontSize: 10, color: '#888', marginBottom: 12, lineHeight: 15 },
  muted: { fontFamily: 'Courier New', fontSize: 10, color: '#666', marginTop: 4 },
  errBox: { borderWidth: 1, borderColor: '#ff0000', padding: 8, marginBottom: 10, backgroundColor: 'rgba(255,0,0,0.08)' },
  errText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff0000' },
  card: { borderWidth: 1, borderColor: '#004444', padding: 10, marginBottom: 8, backgroundColor: 'rgba(0,30,30,0.4)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontFamily: 'Courier New', fontSize: 12, color: '#00ffff', fontWeight: 'bold' },
  cardMeta: { fontFamily: 'Courier New', fontSize: 10, color: '#888', marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  actBtn: { borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 3 },
  actText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },
  danger: { color: '#ff5555' },
  badge: { fontFamily: 'Courier New', fontSize: 9, color: '#0a0a0a', backgroundColor: '#00ffff', paddingHorizontal: 6, paddingVertical: 1, letterSpacing: 1 },
  badgeWarn: { fontFamily: 'Courier New', fontSize: 9, color: '#ffff00', borderWidth: 1, borderColor: '#ffff00', paddingHorizontal: 6, paddingVertical: 1, letterSpacing: 1 },
  addBtn: { borderWidth: 1, borderColor: '#00aa00', paddingVertical: 8, alignItems: 'center', marginTop: 6 },
  addText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  form: { borderWidth: 1, borderColor: '#00ffff', padding: 12, marginTop: 8, backgroundColor: 'rgba(0,255,255,0.04)' },
  formTitle: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1, marginBottom: 10 },
  lbl: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc', marginBottom: 4, marginTop: 8 },
  input: { fontFamily: 'Courier New', fontSize: 12, color: '#00ff00', borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#000' },
  kindRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  kindBtn: { borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 4 },
  kindBtnActive: { borderColor: '#00ffff', backgroundColor: 'rgba(0,255,255,0.1)' },
  kindText: { fontFamily: 'Courier New', fontSize: 10, color: '#888' },
  kindTextActive: { color: '#00ffff' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  checkBox: { fontFamily: 'Courier New', fontSize: 12, color: '#00ff00' },
  checkLbl: { fontFamily: 'Courier New', fontSize: 10, color: '#ccc' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  saveBtn: { borderWidth: 1, borderColor: '#00ff00', paddingHorizontal: 12, paddingVertical: 6 },
  saveText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  dim: { opacity: 0.5 },
  cancelBtn: { borderWidth: 1, borderColor: '#666', paddingHorizontal: 12, paddingVertical: 6 },
  cancelText: { fontFamily: 'Courier New', fontSize: 11, color: '#ccc' },
});
