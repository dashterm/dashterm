/**
 * Secrets — a per-user vault of named credentials your custom apps can USE
 * without ever seeing the raw value.
 *
 * Values are write-only: GET /api/secrets returns names + timestamps only.
 * Apps consume a secret by sending requests through the gateway's secrets
 * proxy with `{{secret.NAME}}` placeholders (see the help block below); the
 * server substitutes the value and makes the call, so the value never
 * reaches the browser.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';

interface SecretSummary {
  name: string;
  createdAt: number;
  updatedAt: number;
}

function baseUrl(): string {
  return process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
}

const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export default function Secrets() {
  const [secrets, setSecrets] = useState<SecretSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/secrets`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { secrets: SecretSummary[] };
      setSecrets(data.secrets);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSecrets([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = async () => {
    if (busy) return;
    const n = name.trim();
    if (!NAME_RE.test(n)) {
      setErr('name must be letters, digits or underscore (1-64 chars)');
      return;
    }
    if (!value) {
      setErr('value is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/secrets/${encodeURIComponent(n)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!r.ok) {
        const t = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(t.error || `HTTP ${r.status}`);
      }
      setName('');
      setValue('');
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: string) => {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete secret "${n}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/secrets/${encodeURIComponent(n)}`, {
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

  const existing = secrets?.some((s) => s.name === name.trim());

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
      <View style={styles.header}>
        <Text style={styles.headerText}>+-- SECRETS --+</Text>
        <Pressable onPress={reload} style={styles.refresh}>
          <Text style={styles.refreshText}>[ ↻ ]</Text>
        </Pressable>
      </View>

      <Text style={styles.help}>
        Store API keys / tokens once; your apps use them by name and never see
        the value. In app code:
      </Text>
      <View style={styles.codeBox}>
        <Text style={styles.code}>
          {`await dashterm.secrets.fetch(url, {\n  headers: { Authorization: 'Bearer {{secret.NAME}}' }\n})`}
        </Text>
      </View>

      {err && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>! {err}</Text>
        </View>
      )}

      {secrets === null ? (
        <Text style={styles.muted}>LOADING…</Text>
      ) : secrets.length === 0 ? (
        <Text style={styles.muted}>No secrets yet.</Text>
      ) : (
        secrets.map((s) => (
          <View style={styles.row} key={s.name}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{s.name}</Text>
              <Text style={styles.meta}>•••• set · updated {new Date(s.updatedAt).toLocaleDateString()}</Text>
            </View>
            <Pressable onPress={() => remove(s.name)} disabled={busy} style={styles.delBtn}>
              <Text style={styles.delText}>delete</Text>
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.form}>
        <Text style={styles.formTitle}>{existing ? 'OVERWRITE SECRET' : 'ADD SECRET'}</Text>
        <Text style={styles.lbl}>name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="WEATHER_KEY"
          placeholderTextColor="#444"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Text style={styles.lbl}>value</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="paste secret value"
          placeholderTextColor="#444"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={save} disabled={busy} style={[styles.saveBtn, busy && styles.dim]}>
          <Text style={styles.saveText}>[ {existing ? 'OVERWRITE' : 'SAVE'} ]</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1 },
  refresh: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#004444' },
  refreshText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },
  help: { fontFamily: 'Courier New', fontSize: 10, color: '#888', marginBottom: 8, lineHeight: 15 },
  codeBox: { borderWidth: 1, borderColor: '#003300', backgroundColor: '#000', padding: 8, marginBottom: 12 },
  code: { fontFamily: 'Courier New', fontSize: 10, color: '#00ff00' },
  muted: { fontFamily: 'Courier New', fontSize: 10, color: '#666', marginTop: 4 },
  errBox: { borderWidth: 1, borderColor: '#ff0000', padding: 8, marginBottom: 10, backgroundColor: 'rgba(255,0,0,0.08)' },
  errText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff0000' },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#004444', padding: 10, marginBottom: 8, backgroundColor: 'rgba(0,30,30,0.4)' },
  name: { fontFamily: 'Courier New', fontSize: 12, color: '#00ffff', fontWeight: 'bold' },
  meta: { fontFamily: 'Courier New', fontSize: 9, color: '#777', marginTop: 3 },
  delBtn: { borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 3 },
  delText: { fontFamily: 'Courier New', fontSize: 10, color: '#ff5555' },
  form: { borderWidth: 1, borderColor: '#00ffff', padding: 12, marginTop: 8, backgroundColor: 'rgba(0,255,255,0.04)' },
  formTitle: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1, marginBottom: 6 },
  lbl: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc', marginBottom: 4, marginTop: 8 },
  input: { fontFamily: 'Courier New', fontSize: 12, color: '#00ff00', borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#000' },
  saveBtn: { borderWidth: 1, borderColor: '#00ff00', paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', marginTop: 14 },
  saveText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  dim: { opacity: 0.5 },
});
