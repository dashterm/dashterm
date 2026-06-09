/**
 * User Management — admin-only app for listing and deleting user accounts.
 *
 * The gateway gates the data: GET /api/users returns everyone for an admin
 * and just the caller otherwise; DELETE /api/users/:id re-checks the caller
 * is admin and refuses self-delete.
 *
 * To add users, run `dashterm add-user <email> [password]` on the server.
 * (No invite-link UI in v0.)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { storage } from '../../storage';
import type { UserSummary } from '../../storage';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  appState: any;
  onUpdate: (updates: any) => void;
  userProfile: any;
}

function timeAgo(epochMs: number): string {
  if (!epochMs) return '—';
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function UserManagement(_props: Props) {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const list = await storage.listUsers();
      setUsers(list);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load users');
      setUsers([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onDelete = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setErr(null);
    try {
      await storage.deleteUser(id);
      await refresh();
      setPendingDeleteId(null);
    } catch (e: any) {
      setErr(e?.message || 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 14 }}>
      <View style={styles.header}>
        <Text style={styles.headerText}>+-- USERS --+</Text>
        <Pressable onPress={refresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>[ ↻ REFRESH ]</Text>
        </Pressable>
      </View>

      <Text style={styles.help}>
        To add a user, run on the server:{'\n'}
        <Text style={styles.code}>$ dashterm add-user alice@family.lan</Text>
      </Text>

      {err && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>! {err}</Text>
        </View>
      )}

      {users === null ? (
        <Text style={styles.muted}>LOADING…</Text>
      ) : users.length === 0 ? (
        <Text style={styles.muted}>(no users — only admins can see this list)</Text>
      ) : (
        users.map((u) => {
          const isSelf = user?.uid === u.id;
          const confirming = pendingDeleteId === u.id;
          const busy = busyId === u.id;
          return (
            <View key={u.id} style={[styles.row, u.isAdmin && styles.rowAdmin]}>
              <View style={styles.rowMain}>
                <View style={styles.rowHead}>
                  <Text style={styles.email}>{u.email}</Text>
                  {u.isAdmin && <Text style={styles.badgeAdmin}>ADMIN</Text>}
                  {isSelf && <Text style={styles.badgeSelf}>YOU</Text>}
                </View>
                <Text style={styles.displayName}>{u.displayName}</Text>
                <Text style={styles.meta}>
                  added {timeAgo(u.createdAt)} · last active {timeAgo(u.lastActive)}
                </Text>
              </View>
              <View style={styles.rowActions}>
                {!confirming ? (
                  <Pressable
                    onPress={() => setPendingDeleteId(u.id)}
                    disabled={isSelf}
                    style={[styles.dangerBtn, isSelf && styles.dangerBtnDisabled]}
                  >
                    <Text style={[styles.dangerText, isSelf && styles.dangerTextDisabled]}>
                      {isSelf ? '— SELF —' : '[ DELETE ]'}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.confirmRow}>
                    <Pressable
                      onPress={() => onDelete(u.id)}
                      disabled={busy}
                      style={styles.dangerConfirmBtn}
                    >
                      <Text style={styles.dangerConfirmText}>
                        {busy ? 'DELETING…' : '[ CONFIRM ]'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setPendingDeleteId(null)}
                      style={styles.cancelBtn}
                    >
                      <Text style={styles.cancelText}>[ CANCEL ]</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ffff',
    letterSpacing: 1,
  },
  refreshBtn: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#004444' },
  refreshText: { fontFamily: 'Courier New', fontSize: 10, color: '#00cccc' },
  help: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
    marginBottom: 14,
    lineHeight: 16,
  },
  code: { color: '#00ff00' },
  errorBox: {
    borderWidth: 1,
    borderColor: '#ff0000',
    backgroundColor: 'rgba(255, 0, 0, 0.08)',
    padding: 10,
    marginBottom: 12,
  },
  errorText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff0000' },
  muted: { fontFamily: 'Courier New', fontSize: 11, color: '#666666', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#004444',
    backgroundColor: 'rgba(0, 30, 30, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 6px rgba(0,255,255,0.05)' } : {}),
  },
  rowAdmin: { borderColor: '#00ffff' },
  rowMain: { flex: 1, marginRight: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  email: { fontFamily: 'Courier New', fontSize: 13, color: '#00ffff', fontWeight: 'bold' },
  badgeAdmin: {
    fontFamily: 'Courier New',
    fontSize: 9,
    color: '#0a0a0a',
    backgroundColor: '#00ffff',
    paddingHorizontal: 6,
    paddingVertical: 1,
    letterSpacing: 1,
  },
  badgeSelf: {
    fontFamily: 'Courier New',
    fontSize: 9,
    color: '#00ff00',
    borderWidth: 1,
    borderColor: '#00ff00',
    paddingHorizontal: 6,
    paddingVertical: 1,
    letterSpacing: 1,
  },
  displayName: { fontFamily: 'Courier New', fontSize: 11, color: '#cccccc', marginTop: 2 },
  meta: { fontFamily: 'Courier New', fontSize: 10, color: '#666666', marginTop: 2 },
  rowActions: { alignItems: 'flex-end' },
  dangerBtn: {
    borderWidth: 1,
    borderColor: '#ff6666',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dangerBtnDisabled: { borderColor: '#444444' },
  dangerText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff6666' },
  dangerTextDisabled: { color: '#444444' },
  confirmRow: { flexDirection: 'row', gap: 6 },
  dangerConfirmBtn: {
    borderWidth: 1,
    borderColor: '#ff0000',
    backgroundColor: 'rgba(255,0,0,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dangerConfirmText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff0000' },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#666666',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cancelText: { fontFamily: 'Courier New', fontSize: 11, color: '#cccccc' },
});
