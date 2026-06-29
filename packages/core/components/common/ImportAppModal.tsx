/**
 * ImportAppModal — bring in a `.dashapp.json` bundle exported from another
 * DashTerm install (or, eventually, a marketplace).
 *
 * Importing runs real code: the app's frontend executes in the user's browser
 * session, and any backend module runs in the gateway process with the server's
 * network / secret / shell access. So the flow is deliberately gated behind an
 * explicit "Trust this app" acknowledgement with loud messaging — the user has
 * to opt in before the Import button enables. The gateway also requires the
 * trust flag, so this isn't the only line of defence, but it's where the human
 * makes the call.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, Platform } from 'react-native';
import { storage } from '../../storage';
import type { AppExport, ImportAppResult } from '../../storage/types';

interface ImportAppModalProps {
  visible: boolean;
  onClose: () => void;
  onImported?: (result: ImportAppResult) => void;
}

type Phase = 'pick' | 'review' | 'importing' | 'done';

const EXPECTED_FORMAT = 'dashterm-app/1';

// Open the OS file picker and return the chosen file's text, or null if the
// user cancelled. Web-only (the dashboard's import lives on web); guarded so a
// non-web bundle just no-ops instead of crashing.
function pickBundleFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.dashapp.json,application/json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve({ name: file.name, text });
      } catch {
        resolve({ name: file.name, text: '' });
      }
    };
    input.click();
  });
}

function validateManifest(raw: unknown): { manifest: AppExport } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'File is not a valid app bundle.' };
  const m = raw as Partial<AppExport>;
  if (m.format !== EXPECTED_FORMAT) {
    return { error: `Unsupported bundle format (expected "${EXPECTED_FORMAT}").` };
  }
  if (typeof m.code !== 'string' || !m.code.trim()) {
    return { error: 'Bundle has no app code.' };
  }
  return { manifest: m as AppExport };
}

export default function ImportAppModal({ visible, onClose, onImported }: ImportAppModalProps) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [manifest, setManifest] = useState<AppExport | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAppResult | null>(null);

  const reset = () => {
    setPhase('pick');
    setFileName(null);
    setManifest(null);
    setTrusted(false);
    setError(null);
    setResult(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handlePick = async () => {
    setError(null);
    const picked = await pickBundleFile();
    if (!picked) return; // cancelled
    setFileName(picked.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(picked.text);
    } catch {
      setError('That file is not valid JSON.');
      return;
    }
    const v = validateManifest(parsed);
    if ('error' in v) {
      setError(v.error);
      return;
    }
    setManifest(v.manifest);
    setTrusted(false);
    setPhase('review');
  };

  const handleImport = async () => {
    if (!manifest || !trusted) return;
    setPhase('importing');
    setError(null);
    try {
      const res = await storage.importApp(manifest, true);
      setResult(res);
      setPhase('done');
      onImported?.(res);
    } catch (e) {
      setError((e as Error).message || 'Import failed.');
      setPhase('review');
    }
  };

  if (!visible) return null;

  const hasBackend = !!manifest?.hasBackend;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <Pressable style={styles.modal} onPress={(e) => e.stopPropagation()}>
          <View style={styles.container}>
            <View style={styles.header}>
              <Text style={styles.title}>IMPORT APP</Text>
              <Text style={styles.hint}>Load a .dashapp.json bundle into your library</Text>
            </View>

            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
              {/* ---- PICK ---- */}
              {phase === 'pick' && (
                <>
                  <Text style={styles.paragraph}>
                    Select an app bundle exported from DashTerm. It will be recompiled and added
                    to your library as a new, private app.
                  </Text>
                  <Pressable style={styles.fileButton} onPress={handlePick}>
                    <Text style={styles.fileButtonText}>+ SELECT .dashapp.json FILE</Text>
                  </Pressable>
                  {error && <Text style={styles.error}>{error}</Text>}
                </>
              )}

              {/* ---- REVIEW ---- */}
              {phase === 'review' && manifest && (
                <>
                  <View style={styles.metaBox}>
                    <Text style={styles.metaName}>{manifest.name}</Text>
                    {!!manifest.description && (
                      <Text style={styles.metaDesc}>{manifest.description}</Text>
                    )}
                    <Text style={styles.metaLine}>app id: {manifest.sourceId || '(will be assigned)'}</Text>
                    <Text style={styles.metaLine}>file: {fileName}</Text>
                    <Text style={styles.metaLine}>
                      backend module: {hasBackend ? 'YES — runs on your server' : 'none'}
                    </Text>
                  </View>

                  {/* Loud, unmissable warning. The frontend alone is dangerous —
                      don't let a "no backend" bundle read as safe. */}
                  <View style={styles.warnBox}>
                    <Text style={styles.warnTitle}>⚠  SECURITY WARNING — ONLY IMPORT CODE YOU TRUST</Text>
                    <Text style={styles.warnText}>
                      Importing runs this app's code with your access. Even with no backend, the
                      frontend runs inside your logged-in session and can:
                    </Text>
                    <Text style={styles.warnBullet}>
                      • call fetch() to ANY server — it can send your data anywhere it likes
                    </Text>
                    <Text style={styles.warnBullet}>
                      • read the page and your other apps' on-screen data, and act as you
                    </Text>
                    <Text style={styles.warnBullet}>
                      • use your session to make authenticated requests to your gateway
                    </Text>
                    {hasBackend && (
                      <Text style={styles.warnBackend}>
                        ⚠  PLUS A BACKEND MODULE that runs on your gateway server with its
                        network, secret, and shell access — like running a stranger's program
                        on your machine.
                      </Text>
                    )}
                    <Text style={styles.warnText}>
                      Nothing here sandboxes an untrusted app into safety. Only import from a
                      source you trust, and review the source below first.
                    </Text>
                  </View>

                  {/* Source preview (truncated). */}
                  <Text style={styles.previewLabel}>FRONTEND SOURCE</Text>
                  <ScrollView style={styles.preview} horizontal={false} nestedScrollEnabled>
                    <Text style={styles.previewText}>
                      {manifest.code.slice(0, 6000)}
                      {manifest.code.length > 6000 ? '\n\n… (truncated — review the full file)' : ''}
                    </Text>
                  </ScrollView>

                  {hasBackend && !!manifest.backendCode && (
                    <>
                      <Text style={[styles.previewLabel, { color: '#ff5555' }]}>BACKEND SOURCE</Text>
                      <ScrollView style={styles.preview} nestedScrollEnabled>
                        <Text style={styles.previewText}>
                          {manifest.backendCode.slice(0, 6000)}
                          {manifest.backendCode.length > 6000
                            ? '\n\n… (truncated — review the full file)'
                            : ''}
                        </Text>
                      </ScrollView>
                    </>
                  )}

                  {/* Trust gate. */}
                  <Pressable style={styles.trustRow} onPress={() => setTrusted((t) => !t)}>
                    <Text style={[styles.checkbox, trusted && styles.checkboxOn]}>
                      {trusted ? '[x]' : '[ ]'}
                    </Text>
                    <Text style={styles.trustText}>
                      I trust this app and understand its code will run with my access.
                    </Text>
                  </Pressable>

                  {error && <Text style={styles.error}>{error}</Text>}
                </>
              )}

              {/* ---- IMPORTING ---- */}
              {phase === 'importing' && (
                <Text style={styles.paragraph}>Compiling and importing…</Text>
              )}

              {/* ---- DONE ---- */}
              {phase === 'done' && result && (
                <View style={styles.doneBox}>
                  <Text style={styles.doneTitle}>✓ {result.updated ? 'UPDATED' : 'IMPORTED'}</Text>
                  <Text style={styles.paragraph}>
                    "{result.name}" {result.updated
                      ? 'was updated from the bundle'
                      : 'was added to your library'}.
                  </Text>
                  <Text style={styles.doneCode}>app id: {result.shareCode}</Text>
                  <Text style={styles.metaLine}>
                    Add it to a space from the command palette (⌘K / Ctrl+K).
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Footer actions */}
            <View style={styles.footer}>
              {phase === 'review' && (
                <Pressable style={styles.footerBtn} onPress={() => { reset(); }}>
                  <Text style={styles.footerBtnText}>‹ BACK</Text>
                </Pressable>
              )}
              <View style={{ flex: 1 }} />
              {phase === 'done' ? (
                <Pressable style={[styles.footerBtn, styles.primaryBtn]} onPress={close}>
                  <Text style={[styles.footerBtnText, styles.primaryBtnText]}>DONE</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable style={styles.footerBtn} onPress={close}>
                    <Text style={styles.footerBtnText}>CANCEL</Text>
                  </Pressable>
                  {phase === 'review' && (
                    <Pressable
                      style={[
                        styles.footerBtn,
                        styles.primaryBtn,
                        !trusted && styles.disabledBtn,
                      ]}
                      onPress={handleImport}
                      disabled={!trusted}
                    >
                      <Text
                        style={[
                          styles.footerBtnText,
                          styles.primaryBtnText,
                          !trusted && styles.disabledBtnText,
                        ]}
                      >
                        IMPORT
                      </Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: { width: '100%', maxWidth: 640, maxHeight: '88%' },
  container: {
    backgroundColor: '#001111',
    borderWidth: 2,
    borderColor: '#00ffff',
    borderRadius: 8,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 0 30px rgba(0, 255, 255, 0.5)' }
      : {
          shadowColor: '#00ffff',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 15,
        }),
  },
  header: {
    padding: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#004444',
  },
  title: { fontFamily: 'Courier New', fontSize: 16, color: '#00ffff', fontWeight: 'bold', marginBottom: 5 },
  hint: { fontFamily: 'Courier New', fontSize: 10, color: '#888' },
  body: { maxHeight: 520 },
  bodyContent: { padding: 20 },
  paragraph: { fontFamily: 'Courier New', fontSize: 12, color: '#ccc', lineHeight: 18, marginBottom: 12 },
  fileButton: {
    borderWidth: 1,
    borderColor: '#00ffff',
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#002222',
  },
  fileButtonText: { fontFamily: 'Courier New', fontSize: 13, color: '#00ffff', fontWeight: 'bold', letterSpacing: 1 },
  metaBox: {
    borderWidth: 1,
    borderColor: '#ff00ff',
    borderRadius: 4,
    padding: 12,
    marginBottom: 14,
    backgroundColor: 'rgba(255,0,255,0.06)',
  },
  metaName: { fontFamily: 'Courier New', fontSize: 14, color: '#ff66ff', fontWeight: 'bold', marginBottom: 4 },
  metaDesc: { fontFamily: 'Courier New', fontSize: 11, color: '#ccc', marginBottom: 6 },
  metaLine: { fontFamily: 'Courier New', fontSize: 10, color: '#999', marginTop: 2 },
  warnBox: {
    borderWidth: 1,
    borderColor: '#ffaa00',
    borderRadius: 4,
    padding: 12,
    marginBottom: 14,
    backgroundColor: 'rgba(255, 170, 0, 0.08)',
  },
  warnTitle: { fontFamily: 'Courier New', fontSize: 13, color: '#ffaa00', fontWeight: 'bold', marginBottom: 8, letterSpacing: 1 },
  warnText: { fontFamily: 'Courier New', fontSize: 11, color: '#ffdd99', lineHeight: 17, marginBottom: 8 },
  warnBullet: { fontFamily: 'Courier New', fontSize: 11, color: '#ffcc77', lineHeight: 16, marginBottom: 4, paddingLeft: 4 },
  warnBackend: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ff7777',
    fontWeight: 'bold',
    lineHeight: 17,
    marginTop: 2,
  },
  previewLabel: { fontFamily: 'Courier New', fontSize: 10, color: '#00ffff', marginBottom: 4, letterSpacing: 1 },
  preview: {
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#004444',
    borderRadius: 4,
    padding: 8,
    marginBottom: 14,
    backgroundColor: '#0a0a0a',
  },
  previewText: { fontFamily: 'Courier New', fontSize: 10, color: '#7fd7c4', lineHeight: 15 },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#00ff00',
    borderRadius: 4,
    padding: 12,
    backgroundColor: 'rgba(0,255,0,0.05)',
  },
  checkbox: { fontFamily: 'Courier New', fontSize: 14, color: '#888', marginRight: 10 },
  checkboxOn: { color: '#00ff00', fontWeight: 'bold' },
  trustText: { flex: 1, fontFamily: 'Courier New', fontSize: 12, color: '#cfc', lineHeight: 18 },
  error: { fontFamily: 'Courier New', fontSize: 11, color: '#ff5555', marginTop: 12 },
  doneBox: { alignItems: 'flex-start' },
  doneTitle: { fontFamily: 'Courier New', fontSize: 15, color: '#00ff00', fontWeight: 'bold', marginBottom: 10 },
  doneCode: {
    fontFamily: 'Courier New',
    fontSize: 13,
    color: '#ff66ff',
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#004444',
    gap: 8,
  },
  footerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#004444',
    borderRadius: 4,
  },
  footerBtnText: { fontFamily: 'Courier New', fontSize: 12, color: '#aaa', letterSpacing: 1 },
  primaryBtn: { borderColor: '#00ff00', backgroundColor: 'rgba(0,255,0,0.1)' },
  primaryBtnText: { color: '#00ff00', fontWeight: 'bold' },
  disabledBtn: { borderColor: '#333', backgroundColor: 'transparent' },
  disabledBtnText: { color: '#555' },
});
