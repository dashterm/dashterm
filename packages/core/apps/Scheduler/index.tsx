import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { authProvider } from '../../storage';

interface SchedulerState {
  relayUrl?: string;
  workspace?: string;
}

interface Props {
  appState: SchedulerState;
  onUpdate: (updates: Partial<SchedulerState>) => void;
  // Optional: workspace names that are "related" to the currently-active
  // Space (computed by the parent from each app's originWorkspace). When
  // provided and non-empty, the workspace dropdown defaults to showing only
  // these. A 'Show all' tickbox overrides.
  relatedWorkspaceNames?: string[];
}

interface Schedule {
  id: string;
  cron: string;
  prompt: string;
  tz: string | null;
  shareCode: string | null;
  enabled: boolean;
  active: boolean;
  nextRun: number | null;
}

interface QueueStats {
  totalPending: number;
  workspaces: Array<{ workspace: string; pending: number; oldestQueuedAt: number | null }>;
}

const DEFAULT_RELAY_URL = (process.env.EXPO_PUBLIC_DASHTERM_URL as string) || '';
const DEFAULT_WORKSPACE = 'default';
const REFRESH_INTERVAL_MS = 5000;

type ConnState = 'idle' | 'connecting' | 'authing' | 'ready' | 'closed' | 'error';

export default function Scheduler({ appState, onUpdate, relatedWorkspaceNames }: Props) {
  const state: SchedulerState = { workspace: DEFAULT_WORKSPACE, ...(appState || {}) };
  const relayUrl = (state.relayUrl || DEFAULT_RELAY_URL || '').trim();
  const workspace = (state.workspace || DEFAULT_WORKSPACE).trim();
  // Filter applies only when the parent supplied a non-empty related set.
  const filterAvailable = !!(relatedWorkspaceNames && relatedWorkspaceNames.length > 0);
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);

  const [conn, setConn] = useState<ConnState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [stats, setStats] = useState<QueueStats>({ totalPending: 0, workspaces: [] });
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [lastResponse, setLastResponse] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const refreshTimerRef = useRef<any>(null);

  const send = useCallback((payload: any) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const requestRefresh = useCallback(() => {
    send({ type: 'list_schedules' });
    send({ type: 'queue_stats' });
  }, [send]);

  const closeConnection = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(1000, 'client'); } catch {}
      wsRef.current = null;
    }
    setWaitingForReply(false);
  }, []);

  useEffect(() => () => closeConnection(), [closeConnection]);

  const connect = useCallback(async () => {
    if (!relayUrl) {
      setError('Set EXPO_PUBLIC_DASHTERM_URL or override in app settings.');
      setConn('error');
      return;
    }
    if (wsRef.current) closeConnection();

    setError(null);
    setConn('connecting');

    const url = normalizeWsUrl(relayUrl);
    let idToken: string;
    try {
      const t = await authProvider.getIdToken();
      if (!t) throw new Error('not signed in');
      idToken = t;
    } catch (err: any) {
      setError(err?.message || 'failed to get id token');
      setConn('error');
      return;
    }

    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch (err: any) {
      setError(err?.message || 'failed to open websocket');
      setConn('error');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConn('authing');
      ws.send(JSON.stringify({ type: 'auth', idToken, workspace, resume: true }));
    };
    ws.onerror = (e: any) => {
      setError(e?.message || 'websocket error');
      setConn('error');
    };
    ws.onclose = (e) => {
      setConn(e.wasClean ? 'closed' : 'error');
      setWaitingForReply(false);
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
    ws.onmessage = (e) => {
      let msg: any;
      try { msg = JSON.parse(e.data); }
      catch { return; }

      switch (msg.type) {
        case 'ready':
          setConn('ready');
          requestRefresh();
          if (!refreshTimerRef.current) {
            refreshTimerRef.current = setInterval(requestRefresh, REFRESH_INTERVAL_MS);
          }
          break;
        case 'schedules':
          setSchedules(msg.items || []);
          break;
        case 'queue_stats':
          setStats({
            totalPending: msg.totalPending || 0,
            workspaces: msg.workspaces || [],
          });
          break;
        case 'claude_event':
          renderAgentEvent(msg.event, setLastResponse);
          break;
        case 'session_end':
          setWaitingForReply(false);
          requestRefresh();
          break;
        case 'schedule_ran':
          requestRefresh();
          break;
        case 'error':
          setError(msg.error || 'unknown error');
          break;
      }
    };
  }, [closeConnection, relayUrl, requestRefresh, workspace]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || conn !== 'ready' || waitingForReply) return;
    send({ type: 'user', text });
    setLastResponse('');
    setInput('');
    setWaitingForReply(true);
  }, [conn, input, send, waitingForReply]);

  const runScheduleNow = useCallback((id: string) => {
    send({ type: 'run_schedule_now', id });
  }, [send]);

  const handleInputKeyPress = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    const native = e?.nativeEvent;
    if (!native || native.key !== 'Enter') return;
    if (native.shiftKey || native.metaKey || native.ctrlKey || native.altKey) return;
    e.preventDefault?.();
    native.preventDefault?.();
    sendMessage();
  }, [sendMessage]);

  const statusColor = useMemo(() => {
    if (conn === 'ready') return '#00ff00';
    if (conn === 'authing' || conn === 'connecting') return '#ffff00';
    if (conn === 'error') return '#ff0000';
    return '#666666';
  }, [conn]);

  return (
    <View style={styles.container}>
      <View style={styles.statusBar}>
        <Text style={[styles.statusDot, { color: statusColor }]}>● </Text>
        <Text style={styles.statusText} numberOfLines={1} ellipsizeMode="tail">
          {conn.toUpperCase()}  ws:{workspace}
        </Text>
        {conn === 'idle' || conn === 'closed' || conn === 'error' ? (
          <Pressable onPress={connect} style={styles.statusButton}>
            <Text style={styles.statusButtonText}>[CONNECT]</Text>
          </Pressable>
        ) : (
          <Pressable onPress={closeConnection} style={styles.statusButton}>
            <Text style={styles.statusButtonText}>[DISCONNECT]</Text>
          </Pressable>
        )}
      </View>

      {error ? <Text style={styles.errorText}>! {error}</Text> : null}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {(() => {
          // Workspace switcher. Lists "related" workspaces (apps in the
          // current Space) plus any workspaces the homehub has reported via
          // queue stats. 'Show all' lifts the filter to include every
          // workspace we've heard about. Switching reconnects automatically.
          const known = Array.from(new Set([
            workspace,
            ...(filterAvailable ? relatedWorkspaceNames! : []),
            ...stats.workspaces.map((w) => w.workspace),
          ].filter(Boolean)));
          const visible = filterAvailable && !showAllWorkspaces
            ? known.filter((w) => relatedWorkspaceNames!.includes(w) || w === workspace)
            : known;
          const switchTo = (name: string) => {
            if (name === workspace) return;
            closeConnection();
            setConn('idle');
            onUpdate({ workspace: name });
            setError(null);
          };
          return (
            <>
              <Text style={styles.sectionLabel}>+-- WORKSPACE --+</Text>
              {filterAvailable && (
                <Pressable onPress={() => setShowAllWorkspaces((v) => !v)} style={styles.filterToggle}>
                  <Text style={styles.filterToggleText}>
                    {`[${showAllWorkspaces ? 'x' : ' '}] show all workspaces`}
                  </Text>
                  <Text style={styles.filterToggleHint}>
                    {showAllWorkspaces
                      ? 'showing every known workspace'
                      : `scoped to this space (${relatedWorkspaceNames!.length})`}
                  </Text>
                </Pressable>
              )}
              <View style={styles.workspaceRow}>
                {visible.map((name) => (
                  <Pressable key={name} onPress={() => switchTo(name)} style={[
                    styles.workspaceChip,
                    name === workspace && styles.workspaceChipActive,
                  ]}>
                    <Text style={[
                      styles.workspaceChipText,
                      name === workspace && styles.workspaceChipTextActive,
                    ]}>
                      {name === workspace ? `> ${name}` : name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          );
        })()}

        <Text style={styles.sectionLabel}>+-- SCHEDULES --+</Text>
        {schedules.length === 0 ? (
          <Text style={styles.hint}>
            {conn === 'ready'
              ? 'No schedules yet. Try: "add a schedule called morning-news that runs at 7am daily to summarise tech news"'
              : 'Connect to load schedules.'}
          </Text>
        ) : (
          schedules.map((s) => (
            <View key={s.id} style={styles.scheduleRow}>
              <View style={styles.scheduleHeader}>
                <Text style={[styles.scheduleId, !s.enabled && styles.disabledText]}>{s.id}</Text>
                <Text style={styles.scheduleCron}>{s.cron}</Text>
                {conn === 'ready' && (
                  <Pressable onPress={() => runScheduleNow(s.id)} style={styles.runButton}>
                    <Text style={styles.runButtonText}>[ run ]</Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.schedulePrompt} numberOfLines={2}>
                {s.prompt}
              </Text>
              <Text style={styles.scheduleMeta}>
                {`next: ${formatNextRun(s.nextRun)}${s.tz ? '  tz: ' + s.tz : ''}${s.enabled ? '' : '  DISABLED'}`}
              </Text>
            </View>
          ))
        )}

        {lastResponse ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>+-- LATEST AGENT REPLY --+</Text>
            <Text style={styles.responseText}>{lastResponse.trim()}</Text>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {`queue: ${stats.totalPending} pending`}
          {stats.totalPending > 0 && stats.workspaces[0]?.oldestQueuedAt
            ? `  · oldest ${formatRelative(stats.workspaces[0].oldestQueuedAt)}`
            : ''}
        </Text>
      </View>

      <View style={styles.composer}>
        <View style={styles.inputRow}>
          <Text style={styles.prompt}>{'>'}</Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={conn === 'ready' ? 'tell the agent what to schedule…' : 'connect first'}
            placeholderTextColor="#005555"
            style={styles.input}
            editable={conn === 'ready' && !waitingForReply}
            onKeyPress={handleInputKeyPress}
            multiline
          />
          <Pressable
            onPress={sendMessage}
            style={[styles.sendButton, (conn !== 'ready' || waitingForReply || !input.trim()) && styles.disabled]}
            disabled={conn !== 'ready' || waitingForReply || !input.trim()}
          >
            <Text style={styles.sendButtonText}>{waitingForReply ? '...' : 'SEND'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function renderAgentEvent(event: any, setLastResponse: (s: string) => void) {
  if (!event) return;
  // Just surface assistant text blocks; ignore tool_use noise in this compact UI.
  if (event.type === 'assistant' && event.message?.content) {
    const blocks = Array.isArray(event.message.content) ? event.message.content : [];
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        setLastResponse(block.text);
      }
    }
  }
}

function normalizeWsUrl(input: string): string {
  let url = input.trim();
  if (!/^wss?:\/\//i.test(url)) {
    if (/^https:\/\//i.test(url)) url = url.replace(/^https:/i, 'wss:');
    else if (/^http:\/\//i.test(url)) url = url.replace(/^http:/i, 'ws:');
    else url = `wss://${url}`;
  }
  if (!/\/ws(\?|$)/.test(url)) {
    url = url.replace(/\/+$/, '') + '/ws';
  }
  return url;
}

function formatNextRun(ts: number | null): string {
  if (!ts) return 'unknown';
  const delta = ts - Date.now();
  if (delta < 0) return 'overdue';
  if (delta < 60_000) return `in ${Math.ceil(delta / 1000)}s`;
  if (delta < 3600_000) return `in ${Math.ceil(delta / 60_000)}m`;
  if (delta < 86400_000) return `in ${Math.round(delta / 3600_000)}h`;
  return `in ${Math.round(delta / 86400_000)}d`;
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)}h ago`;
  return `${Math.floor(delta / 86400_000)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#003333',
  },
  statusDot: { fontFamily: 'Courier New', fontSize: 12 },
  statusText: { fontFamily: 'Courier New', fontSize: 11, color: '#cccccc', flex: 1 },
  statusButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#00ffff',
    marginLeft: 6,
  },
  statusButtonText: { fontFamily: 'Courier New', fontSize: 10, color: '#00ffff' },
  errorText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff6666', padding: 8 },
  body: { flex: 1 },
  bodyContent: { padding: 8 },
  sectionLabel: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00', marginBottom: 6 },
  scheduleRow: {
    borderWidth: 1,
    borderColor: '#003333',
    padding: 8,
    marginBottom: 6,
  },
  scheduleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  scheduleId: { fontFamily: 'Courier New', fontSize: 12, color: '#00ffff', flex: 1 },
  disabledText: { color: '#666666', textDecorationLine: 'line-through' },
  scheduleCron: { fontFamily: 'Courier New', fontSize: 11, color: '#ffff00', marginRight: 8 },
  runButton: { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#00ff00' },
  runButtonText: { fontFamily: 'Courier New', fontSize: 10, color: '#00ff00' },
  schedulePrompt: { fontFamily: 'Courier New', fontSize: 11, color: '#cccccc', marginBottom: 2 },
  scheduleMeta: { fontFamily: 'Courier New', fontSize: 10, color: '#666666' },
  hint: { fontFamily: 'Courier New', fontSize: 11, color: '#666666' },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  filterToggleText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff' },
  filterToggleHint: { fontFamily: 'Courier New', fontSize: 10, color: '#666666', marginLeft: 8 },
  workspaceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  workspaceChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#003333',
    backgroundColor: '#001a1a',
  },
  workspaceChipActive: {
    borderColor: '#00ff00',
    backgroundColor: '#002a1a',
  },
  workspaceChipText: { fontFamily: 'Courier New', fontSize: 11, color: '#888888' },
  workspaceChipTextActive: { color: '#00ff00' },
  responseText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ff88',
    backgroundColor: 'rgba(0, 40, 40, 0.4)',
    padding: 8,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#003333',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  footerText: { fontFamily: 'Courier New', fontSize: 10, color: '#666666' },
  composer: {
    borderWidth: 1,
    borderColor: '#00ffff',
    margin: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  prompt: { fontFamily: 'Courier New', color: '#00ffff', fontSize: 13, marginRight: 6 },
  input: {
    flex: 1,
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#cccccc',
    minHeight: 24,
    maxHeight: 80,
    outlineStyle: 'none' as any,
  },
  sendButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#00ff00',
    marginLeft: 8,
  },
  sendButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  disabled: { opacity: 0.4 },
});
