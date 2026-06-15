/**
 * Secrets & Variables — a per-user store your custom apps read by name.
 *
 * Two sibling stores with opposite disclosure rules:
 *   • VARIABLES are non-secret config (a base URL, hostname, username). They
 *     ARE readable: GET /api/vars returns values, so you can see and edit them
 *     here, and apps read them on the frontend via dashterm.vars.
 *   • SECRETS are write-only credentials. GET /api/secrets returns names only;
 *     the value never reaches the browser. Apps consume one by sending a
 *     request through the gateway's proxy with a `{{secret.NAME}}` placeholder.
 *
 * Both are substituted into a proxied request — {{var.NAME}} / {{secret.NAME}}.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';

interface SecretSummary {
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface VarRow {
  name: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

function baseUrl(): string {
  return process.env.EXPO_PUBLIC_GATEWAY_URL ?? '';
}

const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export default function Secrets() {
  const [secrets, setSecrets] = useState<SecretSummary[] | null>(null);
  const [vars, setVars] = useState<VarRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // add-secret form
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  // add-variable form
  const [varName, setVarName] = useState('');
  const [varValue, setVarValue] = useState('');

  // inline edits for existing variables: name -> draft value
  const [varEdits, setVarEdits] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const [rs, rv] = await Promise.all([
        fetch(`${baseUrl()}/api/secrets`, { credentials: 'include' }),
        fetch(`${baseUrl()}/api/vars`, { credentials: 'include' }),
      ]);
      if (!rs.ok) throw new Error(`secrets: HTTP ${rs.status}`);
      if (!rv.ok) throw new Error(`vars: HTTP ${rv.status}`);
      const sdata = (await rs.json()) as { secrets: SecretSummary[] };
      const vdata = (await rv.json()) as { vars: VarRow[] };
      setSecrets(sdata.secrets);
      setVars(vdata.vars);
      setVarEdits({});
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSecrets((s) => s ?? []);
      setVars((v) => v ?? []);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // ----- secrets -----
  const saveSecret = async () => {
    if (busy) return;
    const n = name.trim();
    if (!NAME_RE.test(n)) {
      setErr('secret name must be letters, digits or underscore (1-64 chars)');
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

  const removeSecret = async (n: string) => {
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

  // ----- variables -----
  const putVar = async (n: string, v: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/vars/${encodeURIComponent(n)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: v }),
      });
      if (!r.ok) {
        const t = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(t.error || `HTTP ${r.status}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addVar = async () => {
    if (busy) return;
    const n = varName.trim();
    if (!NAME_RE.test(n)) {
      setErr('variable name must be letters, digits or underscore (1-64 chars)');
      return;
    }
    if (!varValue) {
      setErr('value is required');
      return;
    }
    await putVar(n, varValue);
    setVarName('');
    setVarValue('');
  };

  const removeVar = async (n: string) => {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete variable "${n}"?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`${baseUrl()}/api/vars/${encodeURIComponent(n)}`, {
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

  const secretExists = secrets?.some((s) => s.name === name.trim());
  const varExists = vars?.some((v) => v.name === varName.trim());

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
      <View style={styles.header}>
        <Text style={styles.headerText}>+-- SECRETS & VARS --+</Text>
        <Pressable onPress={reload} style={styles.refresh}>
          <Text style={styles.refreshText}>[ ↻ ]</Text>
        </Pressable>
      </View>

      <Text style={styles.help}>
        Two stores your apps read by name. VARIABLES are readable config (URLs,
        hostnames) you can see and edit. SECRETS are write-only — apps use them
        but never see the value. Reference either in a proxied request:
      </Text>
      <View style={styles.codeBox}>
        <Text style={styles.code}>
          {`await dashterm.secrets.fetch(\n  'https://{{var.SONARR_URL}}/api/v3/series',\n  { headers: { 'X-Api-Key': '{{secret.SONARR_API_KEY}}' } }\n)`}
        </Text>
      </View>

      {err && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>! {err}</Text>
        </View>
      )}

      {/* ============ VARIABLES ============ */}
      <Text style={styles.sectionTitle}>// VARIABLES — readable config</Text>
      {vars === null ? (
        <Text style={styles.muted}>LOADING…</Text>
      ) : vars.length === 0 ? (
        <Text style={styles.muted}>No variables yet.</Text>
      ) : (
        vars.map((v) => {
          const draft = varEdits[v.name] ?? v.value;
          const dirty = varEdits[v.name] !== undefined && varEdits[v.name] !== v.value;
          return (
            <View style={styles.row} key={v.name}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{v.name}</Text>
                <TextInput
                  style={styles.varValueInput}
                  value={draft}
                  onChangeText={(t) => setVarEdits((m) => ({ ...m, [v.name]: t }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {dirty && (
                <Pressable
                  onPress={() => putVar(v.name, draft)}
                  disabled={busy}
                  style={styles.editBtn}
                >
                  <Text style={styles.editText}>save</Text>
                </Pressable>
              )}
              <Pressable onPress={() => removeVar(v.name)} disabled={busy} style={styles.delBtn}>
                <Text style={styles.delText}>delete</Text>
              </Pressable>
            </View>
          );
        })
      )}

      <View style={styles.form}>
        <Text style={styles.formTitle}>{varExists ? 'OVERWRITE VARIABLE' : 'ADD VARIABLE'}</Text>
        <Text style={styles.lbl}>name</Text>
        <TextInput
          style={styles.input}
          value={varName}
          onChangeText={setVarName}
          placeholder="SONARR_URL"
          placeholderTextColor="#444"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Text style={styles.lbl}>value</Text>
        <TextInput
          style={styles.input}
          value={varValue}
          onChangeText={setVarValue}
          placeholder="https://sonarr.example.com"
          placeholderTextColor="#444"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={addVar} disabled={busy} style={[styles.saveBtn, busy && styles.dim]}>
          <Text style={styles.saveText}>[ {varExists ? 'OVERWRITE' : 'SAVE'} ]</Text>
        </Pressable>
      </View>

      {/* ============ SECRETS ============ */}
      <Text style={[styles.sectionTitle, { marginTop: 22 }]}>// SECRETS — write-only credentials</Text>
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
            <Pressable onPress={() => removeSecret(s.name)} disabled={busy} style={styles.delBtn}>
              <Text style={styles.delText}>delete</Text>
            </Pressable>
          </View>
        ))
      )}

      <View style={[styles.form, styles.secretForm]}>
        <Text style={styles.formTitle}>{secretExists ? 'OVERWRITE SECRET' : 'ADD SECRET'}</Text>
        <Text style={styles.lbl}>name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="SONARR_API_KEY"
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
        <Pressable onPress={saveSecret} disabled={busy} style={[styles.saveBtn, busy && styles.dim]}>
          <Text style={styles.saveText}>[ {secretExists ? 'OVERWRITE' : 'SAVE'} ]</Text>
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
  sectionTitle: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#004444', padding: 10, marginBottom: 8, backgroundColor: 'rgba(0,30,30,0.4)' },
  name: { fontFamily: 'Courier New', fontSize: 12, color: '#00ffff', fontWeight: 'bold' },
  meta: { fontFamily: 'Courier New', fontSize: 9, color: '#777', marginTop: 3 },
  varValueInput: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00', borderWidth: 1, borderColor: '#003333', paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#000', marginTop: 4 },
  editBtn: { borderWidth: 1, borderColor: '#006600', paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 },
  editText: { fontFamily: 'Courier New', fontSize: 10, color: '#00ff00' },
  delBtn: { borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 3 },
  delText: { fontFamily: 'Courier New', fontSize: 10, color: '#ff5555' },
  form: { borderWidth: 1, borderColor: '#00ffff', padding: 12, marginTop: 8, backgroundColor: 'rgba(0,255,255,0.04)' },
  secretForm: { borderColor: '#aa8800', backgroundColor: 'rgba(255,200,0,0.04)' },
  formTitle: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff', letterSpacing: 1, marginBottom: 6 },
  lbl: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc', marginBottom: 4, marginTop: 8 },
  input: { fontFamily: 'Courier New', fontSize: 12, color: '#00ff00', borderWidth: 1, borderColor: '#004444', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#000' },
  saveBtn: { borderWidth: 1, borderColor: '#00ff00', paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', marginTop: 14 },
  saveText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  dim: { opacity: 0.5 },
});
