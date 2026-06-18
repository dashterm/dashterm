import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import { authProvider, storage } from '../../storage';

interface AttachedImage {
  id: string;
  dataUrl: string;        // data:image/png;base64,... — used for the thumbnail
  base64: string;         // just the base64 payload, no data: prefix
  mediaType: string;
  byteLength: number;     // approximate raw size
}

const MAX_IMAGES = 10;
const MAX_BYTES_PER_IMAGE = 5 * 1024 * 1024; // 5MB raw

interface Session {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  log: LogLine[];
}

interface AgenticCoderState {
  // User-configurable so a user can point at their own self-hosted relay.
  relayUrl?: string;
  // Which CLI coding agent this instance drives (e.g. 'claude', 'roo'). The
  // gateway resumes a separate session per agent, so switching agents tears
  // down + re-auths. Defaults to 'claude'.
  agent?: string;
  // Active workspace for this AgenticCoder instance. Different instances can hold
  // different workspaces — that's how you keep two vibe-coding projects open
  // side-by-side without them stepping on each other.
  workspace?: string;
  // History of pushed apps in the *current* workspace. Cleared on workspace
  // switch — it represents what happened in this view, not what exists in DB.
  recentPushes?: PushedApp[];
  // Multiple sessions per workspace. sessions[0] is the live session that
  // receives new claude turns; older items are read-only history snapshots
  // the user can keep around without paying the context cost.
  sessionsByWorkspace?: { [workspace: string]: Session[] };
  // Which session the user is currently viewing per workspace. Defaults to
  // sessions[0] (the live one) when missing.
  viewingSessionByWorkspace?: { [workspace: string]: string };
  // Legacy single-log-per-workspace shape. Kept only so logs written by
  // earlier versions can be migrated into a synthetic session on first load.
  logsByWorkspace?: { [workspace: string]: LogLine[] };
}

interface PushedApp {
  shareCode: string;
  name: string;
  version: number;
  pushedAt: number;
}

interface WorkspaceSummary {
  name: string;
  appCount: number;
  lastActivityAt: number | null;
  hasResumableSession: boolean;
  lastSessionId: string | null;
  // Agent ids with a resumable session here; used to show "resumable" for the
  // currently-selected agent. Older gateways omit it (fall back to the boolean).
  resumableAgents?: string[];
  createdAt: number | null;
}

interface AgentInfo {
  id: string;
  label: string;
  enabled?: boolean;
}

interface HostSummary {
  alias: string;
  host: string;
  port: number;
  user: string | null;
  keyType: string;
  hasKey: boolean;
  createdAt: number | null;
}

interface Props {
  appState: AgenticCoderState;
  onUpdate: (updates: Partial<AgenticCoderState>) => void;
  // Optional: workspace names that are "related" to the currently-active
  // Space (computed by the parent from each app's originWorkspace). When
  // provided and non-empty, the workspace dropdown defaults to showing only
  // these. A 'Show all' tickbox overrides. Leave undefined / empty to show
  // all workspaces unconditionally.
  relatedWorkspaceNames?: string[];
}

// Relay URL default. The gateway now hosts the agent itself at /api/agent/ws,
// so with nothing configured we point at the same gateway the rest of the app
// talks to. An explicit EXPO_PUBLIC_DASHTERM_URL (external relay) still wins.
function defaultRelayUrl(): string {
  const explicit = (process.env.EXPO_PUBLIC_DASHTERM_URL as string) || '';
  if (explicit) return explicit;
  const gateway =
    (process.env.EXPO_PUBLIC_GATEWAY_URL as string) ||
    (typeof window !== 'undefined' && window.location ? window.location.origin : '');
  return gateway ? `${gateway.replace(/\/+$/, '')}/api/agent` : '';
}
const DEFAULT_RELAY_URL = defaultRelayUrl();
const DEFAULT_WORKSPACE = 'default';
const DEFAULT_AGENT = 'claude';
// Fallback shown before the gateway reports the agents it has enabled.
const FALLBACK_AGENTS: AgentInfo[] = [{ id: 'claude', label: 'Claude Code' }];

type ConnState = 'idle' | 'connecting' | 'authing' | 'ready' | 'closed' | 'error';

interface LogLine {
  id: string;
  kind: 'system' | 'user' | 'assistant' | 'tool' | 'stderr' | 'error' | 'push' | 'turn_end';
  text: string;
  ts: number;
}

const LOG_PERSIST_CAP = 200;
const LOG_PERSIST_DEBOUNCE_MS = 1500;
// Keep N most-recent sessions per workspace. Older sessions get evicted so the
// the persisted state blob doesn't grow unboundedly across many "quick tweak" sessions.
const SESSIONS_PER_WORKSPACE_CAP = 8;

// Resolve the session list for a workspace, including a one-time migration of
// the old `logsByWorkspace[ws]` shape into a synthetic seed session. We don't
// mutate state here — the first real write to `sessionsByWorkspace` is what
// makes the migration permanent.
function getSessionsForWorkspace(s: AgenticCoderState, ws: string): Session[] {
  const sessions = s.sessionsByWorkspace?.[ws];
  if (sessions && sessions.length > 0) return sessions;
  const legacy = s.logsByWorkspace?.[ws];
  if (legacy && legacy.length > 0) {
    return [{
      id: `legacy-${ws}`,
      createdAt: legacy[0]?.ts || Date.now(),
      lastActivityAt: legacy[legacy.length - 1]?.ts || Date.now(),
      log: legacy,
    }];
  }
  return [];
}

function makeSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionPreview(session: Session): string {
  const firstUser = session.log.find((l) => l.kind === 'user');
  if (firstUser?.text) return truncate(firstUser.text, 48);
  if (session.log.length > 0) return truncate(session.log[0].text || '', 48);
  return 'empty session';
}

let LOG_SEQ = 0;
const mkLine = (kind: LogLine['kind'], text: string): LogLine => ({
  id: `${Date.now()}-${++LOG_SEQ}`,
  kind,
  text,
  ts: Date.now(),
});

export default function AgenticCoder({ appState, onUpdate, relatedWorkspaceNames }: Props) {
  const state: AgenticCoderState = { recentPushes: [], workspace: DEFAULT_WORKSPACE, ...(appState || {}) };
  const relayUrl = (state.relayUrl || DEFAULT_RELAY_URL || '').trim();
  const workspace = (state.workspace || DEFAULT_WORKSPACE).trim();
  const agent = (state.agent || DEFAULT_AGENT).trim();
  // Filter applies only when the parent provided a non-empty related set —
  // otherwise there's nothing to filter against, so show everything.
  const filterAvailable = !!(relatedWorkspaceNames && relatedWorkspaceNames.length > 0);
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);

  const [conn, setConn] = useState<ConnState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  // Live text Claude is currently generating (from --include-partial-messages
  // deltas). Shown in the working indicator as a "thinking" preview, then
  // cleared once the full message lands in the log.
  const [streamingText, setStreamingText] = useState('');
  // `liveLog` is the in-memory log for the LIVE session (sessions[0]). When
  // the user is viewing an archived session, we show that session's stored
  // log instead — `liveLog` keeps streaming in the background.
  const [liveLog, setLiveLog] = useState<LogLine[]>([]);
  const [waitingForReply, setWaitingForReply] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [showPicker, setShowPicker] = useState(!relayUrl);
  const [showSessionsPicker, setShowSessionsPicker] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>(FALLBACK_AGENTS);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [relayUrlDraft, setRelayUrlDraft] = useState<string>(state.relayUrl || '');
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const inputFocusedRef = useRef(false);
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [showHostsPicker, setShowHostsPicker] = useState(false);
  const [newHostAlias, setNewHostAlias] = useState('');
  const [newHostTarget, setNewHostTarget] = useState('');  // user@host:port
  const [revealedPubkey, setRevealedPubkey] = useState<{ alias: string; pubkey: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const refreshTimerRef = useRef<any>(null);
  // Keep the latest workspace value reachable from inside the WebSocket
  // callbacks without making them dependencies (they capture once at connect).
  const activeWorkspaceRef = useRef<string>(workspace);
  activeWorkspaceRef.current = workspace;
  // Same idea for the active agent — read it from inside the WS callbacks
  // without making them re-bind when it changes.
  const activeAgentRef = useRef<string>(agent);
  activeAgentRef.current = agent;
  const availableAgentsRef = useRef<AgentInfo[]>(availableAgents);
  availableAgentsRef.current = availableAgents;
  const agentLabel = availableAgents.find((a) => a.id === agent)?.label || agent;
  // Ref-reading variant for the long-lived WS callbacks (always current even
  // after an agent switch, which the captured `agentLabel` const would miss).
  const agentLabelNow = () =>
    availableAgentsRef.current.find((a) => a.id === activeAgentRef.current)?.label ||
    activeAgentRef.current;
  // When the user clicks "Start new session" while offline, this flag tells the
  // *next* connect() to send `resume: false` so claude doesn't pull the old
  // session's context back in.
  const pendingFreshConnectRef = useRef<boolean>(false);

  // Derive sessions + viewing state for the current workspace. Sessions come
  // from persisted state (with one-time migration from the legacy log shape).
  const sessions = useMemo(
    () => getSessionsForWorkspace(state, workspace),
    [state.sessionsByWorkspace, state.logsByWorkspace, workspace]
  );
  const liveSessionId = sessions[0]?.id ?? null;
  const viewingSessionId = state.viewingSessionByWorkspace?.[workspace] || liveSessionId;
  const viewedSession = sessions.find((s) => s.id === viewingSessionId) || sessions[0] || null;
  const isViewingLive = viewingSessionId === liveSessionId;
  // What the log scroller actually renders.
  const displayLog = isViewingLive ? liveLog : (viewedSession?.log || []);

  const append = useCallback((line: LogLine) => {
    setLiveLog((prev) => {
      const next = prev.concat(line);
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  // Refs used by debounced persistence — avoid stale closures + unnecessary
  // re-fires when other appState keys change.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const sessionsByWorkspaceRef = useRef(state.sessionsByWorkspace || {});
  sessionsByWorkspaceRef.current = state.sessionsByWorkspace || {};
  const viewingSessionByWorkspaceRef = useRef(state.viewingSessionByWorkspace || {});
  viewingSessionByWorkspaceRef.current = state.viewingSessionByWorkspace || {};
  const logsByWorkspaceRef = useRef(state.logsByWorkspace || {});
  logsByWorkspaceRef.current = state.logsByWorkspace || {};
  const liveLogRef = useRef(liveLog);
  liveLogRef.current = liveLog;
  const recentPushesRef = useRef(state.recentPushes || []);
  recentPushesRef.current = state.recentPushes || [];

  // Hydrate the in-memory liveLog from the persisted live session whenever
  // the workspace changes. We also re-hydrate on the same workspace if the
  // persisted log just became non-empty while ours is still empty — handles
  // the load-race where the appState arrives a few frames after mount.
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    const live = sessions[0];
    const livePersistedLog = live?.log || [];
    if (hydratedForRef.current !== workspace) {
      hydratedForRef.current = workspace;
      setLiveLog(livePersistedLog);
      return;
    }
    if (livePersistedLog.length > 0 && liveLogRef.current.length === 0) {
      setLiveLog(livePersistedLog);
    }
  }, [workspace, sessions]);

  // Persist the live log to the live session on a debounce. If the workspace
  // has no sessions yet (first ever message, or just-migrated legacy state),
  // create the session row on the first write.
  useEffect(() => {
    if (liveLog.length === 0) return;
    const t = setTimeout(() => {
      const trimmed = liveLog.slice(-LOG_PERSIST_CAP);
      const now = Date.now();
      const map = sessionsByWorkspaceRef.current;
      const existing = map[workspace] || [];
      let nextList: Session[];
      let liveId: string;
      if (existing.length === 0) {
        liveId = makeSessionId();
        nextList = [{
          id: liveId,
          createdAt: trimmed[0]?.ts || now,
          lastActivityAt: now,
          log: trimmed,
        }];
      } else {
        liveId = existing[0].id;
        const updatedLive: Session = {
          ...existing[0],
          log: trimmed,
          lastActivityAt: now,
        };
        nextList = [updatedLive, ...existing.slice(1)].slice(0, SESSIONS_PER_WORKSPACE_CAP);
      }
      // Once we own the session row for this workspace, drop the legacy log
      // entry so the two stores don't disagree on reload.
      const legacyMap = logsByWorkspaceRef.current;
      const legacyHadEntry = !!legacyMap[workspace];
      const update: Partial<AgenticCoderState> = {
        sessionsByWorkspace: { ...map, [workspace]: nextList },
      };
      if (legacyHadEntry) {
        const { [workspace]: _drop, ...rest } = legacyMap;
        update.logsByWorkspace = rest;
      }
      // Make sure the viewing pointer points at the live session if it isn't
      // set yet — otherwise the picker would default to "no selection".
      if (!viewingSessionByWorkspaceRef.current[workspace]) {
        update.viewingSessionByWorkspace = {
          ...viewingSessionByWorkspaceRef.current,
          [workspace]: liveId,
        };
      }
      onUpdateRef.current(update);
    }, LOG_PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [liveLog, workspace]);

  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
    }
  }, [displayLog]);

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

  // Paste handler: grab images off the clipboard while our input is focused so
  // the user can drop screenshots straight into a vibe-coding message.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = async (e: ClipboardEvent) => {
      if (!inputFocusedRef.current) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const imageItems: DataTransferItem[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        if (it && it.kind === 'file' && it.type.startsWith('image/')) imageItems.push(it);
      }
      if (imageItems.length === 0) return;
      e.preventDefault();
      const next: AttachedImage[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > MAX_BYTES_PER_IMAGE) {
          setError(`Image too large: ${(file.size / 1_048_576).toFixed(1)}MB (max 5MB)`);
          continue;
        }
        try {
          const dataUrl = await fileToDataUrl(file);
          const base64 = dataUrl.split(',')[1] || '';
          next.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            dataUrl,
            base64,
            mediaType: file.type || 'image/png',
            byteLength: file.size,
          });
        } catch (err) {
          setError(`Could not read pasted image: ${(err as Error).message}`);
        }
      }
      if (next.length === 0) return;
      setError(null);
      setAttachedImages((prev) => {
        const merged = [...prev, ...next];
        if (merged.length > MAX_IMAGES) {
          setError(`Only the first ${MAX_IMAGES} images will be sent.`);
          return merged.slice(0, MAX_IMAGES);
        }
        return merged;
      });
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);

  const connect = useCallback(async (targetWorkspace?: string, options?: { resume?: boolean }) => {
    if (!relayUrl) {
      setError('Set a relay URL first — tap "ws: …" to open the picker.');
      setConn('error');
      setShowPicker(true);
      return;
    }
    if (wsRef.current) closeConnection();

    setError(null);
    setConn('connecting');
    setResumed(false);
    // Default resume = true so re-opening the panel after a refresh picks up
    // where claude left off. The caller (or pendingFreshConnectRef from a
    // "Start new session" click) can override to start fresh.
    const wantResume = options?.resume ?? !pendingFreshConnectRef.current;
    pendingFreshConnectRef.current = false;
    const ws_name = targetWorkspace || workspace;
    append(mkLine('system', `> connecting to ${relayUrl} (workspace: ${ws_name}${wantResume ? '' : ', fresh session'})`));

    const url = normalizeWsUrl(relayUrl);
    // The native gateway authenticates the WebSocket by session cookie, so a
    // bearer token is optional and ignored. External relays still validate it
    // when present — so send it if we have one, but don't fail when we don't.
    let idToken: string | null = null;
    try { idToken = await authProvider.getIdToken(); } catch { idToken = null; }

    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch (err: any) {
      setError(err?.message || 'failed to open websocket');
      setConn('error');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      append(mkLine('system', '> websocket open, authenticating...'));
      setConn('authing');
      ws.send(JSON.stringify({
        type: 'auth',
        ...(idToken ? { idToken } : {}),
        workspace: ws_name,
        agent: activeAgentRef.current,
        resume: wantResume,
      }));
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); }
      catch { return; }
      handleRelayMessage(msg);
    };

    ws.onerror = () => append(mkLine('error', '! websocket error'));

    ws.onclose = (ev) => {
      append(mkLine('system', `> websocket closed (${ev.code}${ev.reason ? ' ' + ev.reason : ''})`));
      setConn('closed');
      setWaitingForReply(false);
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    refreshTimerRef.current = setInterval(async () => {
      try {
        const fresh = await authProvider.getIdToken(true);
        if (fresh && wsRef.current?.readyState === 1) {
          wsRef.current.send(JSON.stringify({ type: 'refresh', idToken: fresh }));
        }
      } catch {}
    }, 45 * 60 * 1000);

    function handleRelayMessage(msg: any) {
      switch (msg.type) {
        case 'ready':
          setConn('ready');
          setResumed(!!msg.resume);
          if (Array.isArray(msg.agents) && msg.agents.length > 0) {
            setAvailableAgents(msg.agents);
          }
          if (msg.workspace && msg.workspace !== activeWorkspaceRef.current) {
            // Server settled on a different workspace name (e.g. defaulted).
            onUpdate({ workspace: msg.workspace, recentPushes: [] });
          }
          if (msg.agent && msg.agent !== activeAgentRef.current) {
            // Server fell back to a different agent (e.g. requested one is off).
            onUpdate({ agent: msg.agent });
          }
          append(mkLine(
            'system',
            `> ready  agent=${msg.agent || activeAgentRef.current}  workspace=${msg.workspace}  ${msg.resume
              ? `resuming session ${shortenSessionId(msg.resumeSessionId)}`
              : 'fresh session'}`,
          ));
          ws.send(JSON.stringify({ type: 'list_workspaces' }));
          ws.send(JSON.stringify({ type: 'list_hosts' }));
          break;
        case 'workspaces':
          setWorkspaces(msg.items || []);
          break;
        case 'hosts':
          setHosts(msg.items || []);
          break;
        case 'host_added':
          append(mkLine('system', `> host added: ${msg.alias} (install pubkey on the target)`));
          setRevealedPubkey({ alias: msg.alias, pubkey: msg.pubkey });
          setNewHostAlias('');
          setNewHostTarget('');
          break;
        case 'host_removed':
          append(mkLine('system', `> host removed: ${msg.alias}`));
          if (revealedPubkey?.alias === msg.alias) setRevealedPubkey(null);
          break;
        case 'host_pubkey':
          setRevealedPubkey({ alias: msg.alias, pubkey: msg.pubkey });
          break;
        case 'claude_event':
          renderClaudeEvent(msg.event);
          break;
        case 'claude_log':
          if (msg.stream === 'stderr') append(mkLine('stderr', msg.text.trim()));
          break;
        case 'session_end':
          // Quiet system note + visual separator marking the end of the turn.
          append(mkLine('system', `> ${agentLabelNow()} finished (exit ${msg.code})`));
          append(mkLine('turn_end', '─────────────────────────────────────'));
          setWaitingForReply(false);
          setStreamingText('');
          // Refresh workspace list so app counts / last activity update.
          ws.send(JSON.stringify({ type: 'list_workspaces' }));
          break;
        case 'app_pushed': {
          const pushed: PushedApp = {
            shareCode: msg.shareCode,
            name: msg.name,
            version: msg.version,
            pushedAt: Date.now(),
          };
          append(mkLine('push', `>> pushed apps/${pushed.shareCode} (${pushed.name}) v${pushed.version}`));
          // Read latest pushes via ref so re-renders of the closure don't drop entries.
          const prevList = recentPushesRef.current || [];
          const without = prevList.filter((p) => p.shareCode !== pushed.shareCode);
          onUpdate({ recentPushes: [pushed, ...without].slice(0, 10) });
          // Proactively refresh the dashboard's custom-app list so the new tile
          // is addable from ⌘K immediately, rather than waiting on the realtime
          // broadcast (which can be missed during a reconnect).
          void storage.refreshApps();
          break;
        }
        case 'app_error':
          append(mkLine('error', `! push failed for ${msg.file}: ${msg.error}`));
          break;
        case 'error':
          append(mkLine('error', `! relay: ${msg.error}`));
          setError(msg.error);
          break;
        default:
          break;
      }
    }

    function renderClaudeEvent(event: any) {
      if (!event || typeof event !== 'object') return;
      // Partial-message deltas (--include-partial-messages): accumulate text as
      // it streams so the working indicator shows a live "thinking" preview.
      if (event.type === 'stream_event') {
        const se = event.event;
        if (se?.type === 'content_block_delta' && se.delta?.type === 'text_delta') {
          setStreamingText((prev) => (prev + se.delta.text).slice(-4000));
        }
        return;
      }
      if (event.type === 'system' && event.subtype === 'init') {
        append(mkLine('system', `> ${agentLabelNow()} session ${shortenSessionId(event.session_id)}`));
        return;
      }
      if (event.type === 'assistant' && event.message?.content) {
        // The full message has arrived — the streamed preview's job is done.
        setStreamingText('');
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            append(mkLine('assistant', block.text));
          } else if (block.type === 'tool_use') {
            const name = block.name;
            const summary = summariseToolInput(name, block.input);
            append(mkLine('tool', `[${name}] ${summary}`));
          }
        }
        return;
      }
      if (event.type === 'user' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            const preview = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c?.text || '').join('\n')
                : '';
            append(mkLine('tool', `← ${truncate(preview, 240)}`));
          }
        }
        return;
      }
      if (event.type === 'result') {
        setWaitingForReply(false);
        setStreamingText('');
        if (event.is_error) {
          append(mkLine('error', `! result: ${event.result || 'unknown error'}`));
        }
        return;
      }
    }
  }, [append, closeConnection, onUpdate, relayUrl, workspace]);

  // Auto-connect when the panel opens so it "just works" — connecting is cheap
  // (cookie auth + workspace setup; no claude process spawns until the first
  // message). Fires only from the initial idle state, so a manual DISCONNECT
  // stays disconnected; after an unexpected drop, [CONNECT] reconnects.
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (autoConnectedRef.current) return;
    if (conn === 'idle' && relayUrl) {
      autoConnectedRef.current = true;
      void connect();
    }
  }, [conn, relayUrl, connect]);

  const send = useCallback(() => {
    const text = input.trim();
    const hasImages = attachedImages.length > 0;
    if ((!text && !hasImages) || !wsRef.current || wsRef.current.readyState !== 1) return;
    if (conn !== 'ready') {
      setError('Relay is not ready yet.');
      return;
    }
    const payload: { type: 'user'; text: string; images?: Array<{ mediaType: string; data: string }> } = {
      type: 'user',
      text,
    };
    if (hasImages) {
      payload.images = attachedImages.map((img) => ({ mediaType: img.mediaType, data: img.base64 }));
    }
    wsRef.current.send(JSON.stringify(payload));
    const logText = hasImages
      ? `${text}${text ? ' ' : ''}[${attachedImages.length} image${attachedImages.length === 1 ? '' : 's'} attached]`
      : text;
    append(mkLine('user', logText));
    setInput('');
    setAttachedImages([]);
    setStreamingText('');
    setWaitingForReply(true);
  }, [append, attachedImages, conn, input]);

  const removeAttachment = useCallback((id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // RN-Web: `multiline` TextInput maps to a <textarea> where Enter inserts a
  // newline by default. Hijack plain Enter and route it to send(); leave
  // Shift+Enter alone so the user can still write multi-line prompts.
  const handleInputKeyPress = useCallback((e: any) => {
    if (Platform.OS !== 'web') return;
    const native = e?.nativeEvent;
    if (!native || native.key !== 'Enter') return;
    if (native.shiftKey || native.metaKey || native.ctrlKey || native.altKey) return;
    e.preventDefault?.();
    native.preventDefault?.();
    send();
  }, [send]);

  const stopClaude = useCallback(() => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      append(mkLine('system', '> stop requested'));
    }
  }, [append]);

  const switchToWorkspace = useCallback((name: string, resume = true) => {
    if (!name || name === workspace) {
      setShowPicker(false);
      return;
    }
    setShowPicker(false);
    // Wipe the in-memory live log so we don't briefly flash the old workspace's
    // log under the new workspace name. The hydration effect will then load
    // whatever the new workspace has persisted (sessions[0].log).
    setLiveLog([]);
    hydratedForRef.current = null;
    onUpdate({ workspace: name, recentPushes: [] });
    if (wsRef.current?.readyState === 1) {
      setConn('authing');
      setResumed(false);
      append(mkLine('system', `> switching to workspace: ${name}`));
      wsRef.current.send(JSON.stringify({ type: 'switch_workspace', workspace: name, resume }));
    } else {
      connect(name);
    }
  }, [append, connect, onUpdate, workspace]);

  // Switch which CLI agent drives this workspace. The gateway resumes a separate
  // session per agent, so this tears down the current child and re-auths with the
  // new agent (resuming that agent's own session if one exists).
  const switchAgent = useCallback((id: string) => {
    setShowAgentPicker(false);
    if (!id || id === activeAgentRef.current) return;
    if (waitingForReply) {
      setError('Wait for the current turn to finish before switching agents.');
      return;
    }
    setError(null);
    onUpdate({ agent: id });
    append(mkLine('system', `> switching agent to ${id}`));
    if (wsRef.current?.readyState === 1) {
      setConn('authing');
      setResumed(false);
      wsRef.current.send(JSON.stringify({ type: 'switch_agent', agent: id, resume: true }));
    }
    // If offline, the next connect() reads the new agent from activeAgentRef.
  }, [append, onUpdate, waitingForReply]);

  // Archive the current live log into sessions[0] (force-flushing the debounced
  // persistence), then create a fresh session and make it the new live + viewed
  // session. If we're connected, reconnect with resume:false so claude starts
  // a clean context — that's the whole point of the button.
  const startNewSession = useCallback(() => {
    if (waitingForReply) {
      setError('Wait for the current turn to finish before starting a new session.');
      return;
    }
    setError(null);
    const now = Date.now();
    const map = sessionsByWorkspaceRef.current;
    const existing = map[workspace] || [];
    // Flush the in-memory liveLog into the old live session before we shift it
    // into the archive — the debounced effect may not have fired yet.
    const trimmedCurrent = liveLogRef.current.slice(-LOG_PERSIST_CAP);
    const archivedHead: Session[] = existing.length > 0
      ? [{ ...existing[0], log: trimmedCurrent.length > 0 ? trimmedCurrent : existing[0].log, lastActivityAt: now }, ...existing.slice(1)]
      : [];
    // Only seed the new session if the previous one has actual content;
    // otherwise just reuse the empty session that's already there.
    const previousHadContent =
      (existing[0]?.log?.length || 0) > 0 || trimmedCurrent.length > 0;
    if (!previousHadContent && existing.length > 0) {
      // No-op: the current session is already empty, no need to make another.
      setShowSessionsPicker(false);
      return;
    }
    const newLive: Session = {
      id: makeSessionId(),
      createdAt: now,
      lastActivityAt: now,
      log: [],
    };
    const nextList = [newLive, ...archivedHead].slice(0, SESSIONS_PER_WORKSPACE_CAP);
    onUpdate({
      sessionsByWorkspace: { ...map, [workspace]: nextList },
      viewingSessionByWorkspace: {
        ...viewingSessionByWorkspaceRef.current,
        [workspace]: newLive.id,
      },
    });
    setLiveLog([]);
    hydratedForRef.current = workspace; // mark as already hydrated for the new live
    setShowSessionsPicker(false);
    if (wsRef.current?.readyState === 1) {
      // Hot-swap: drop the relay's resumed session by reconnecting fresh.
      closeConnection();
      connect(workspace, { resume: false });
    } else {
      // Offline: remember that the next CONNECT must be fresh, so we don't
      // accidentally resume the just-archived session's context.
      pendingFreshConnectRef.current = true;
    }
  }, [closeConnection, connect, onUpdate, waitingForReply, workspace]);

  const viewSession = useCallback((sessionId: string) => {
    setShowSessionsPicker(false);
    if (sessionId === viewingSessionId) return;
    onUpdate({
      viewingSessionByWorkspace: {
        ...viewingSessionByWorkspaceRef.current,
        [workspace]: sessionId,
      },
    });
  }, [onUpdate, viewingSessionId, workspace]);

  const deleteSession = useCallback((sessionId: string) => {
    const map = sessionsByWorkspaceRef.current;
    const existing = map[workspace] || [];
    if (existing.length <= 1) {
      setError('Can\'t delete the only session — start a new one first.');
      return;
    }
    if (sessionId === existing[0].id) {
      setError('Can\'t delete the live session — start a new one to archive it first.');
      return;
    }
    const nextList = existing.filter((s) => s.id !== sessionId);
    const viewing = viewingSessionByWorkspaceRef.current[workspace];
    const update: Partial<AgenticCoderState> = {
      sessionsByWorkspace: { ...map, [workspace]: nextList },
    };
    if (viewing === sessionId) {
      update.viewingSessionByWorkspace = {
        ...viewingSessionByWorkspaceRef.current,
        [workspace]: nextList[0].id,
      };
    }
    onUpdate(update);
  }, [onUpdate, workspace]);

  const createWorkspace = useCallback(() => {
    const name = newWorkspaceName.trim().toLowerCase();
    if (!isValidWorkspaceName(name)) {
      setError('workspace names: lowercase, 1-32 chars, [a-z0-9_-]');
      return;
    }
    setNewWorkspaceName('');
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'new_workspace', workspace: name }));
      // After the server re-emits workspaces, switch into it.
      setTimeout(() => switchToWorkspace(name, false), 250);
    } else {
      // Not connected yet — record locally and connect into it.
      onUpdate({ workspace: name, recentPushes: [] });
      connect(name);
    }
  }, [connect, newWorkspaceName, onUpdate, switchToWorkspace]);

  const deleteWorkspace = useCallback((name: string) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (name === workspace) {
      setError('Switch to a different workspace before deleting this one.');
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'delete_workspace', workspace: name }));
  }, [workspace]);

  const addHost = useCallback(() => {
    if (conn !== 'ready' || !wsRef.current || wsRef.current.readyState !== 1) {
      // Not connected yet — kick off a connect and ask the user to retry.
      // (Auto-connect on open means this is rarely hit.)
      setError('Connecting to the gateway — click ADD again in a moment.');
      if (conn === 'idle' || conn === 'closed' || conn === 'error') void connect();
      return;
    }
    const alias = newHostAlias.trim();
    const parsed = parseHostTarget(newHostTarget);
    if (!alias) { setError('Host alias is required.'); return; }
    if (!/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(alias)) {
      setError('Alias must start alphanumeric, lowercase, max 32 chars; letters/digits/dot/dash/underscore.');
      return;
    }
    if (!parsed.host) { setError('Target must be host or user@host or user@host:port.'); return; }
    setError(null);
    wsRef.current.send(JSON.stringify({
      type: 'add_host',
      alias,
      host: parsed.host,
      port: parsed.port,
      user: parsed.user || undefined,
    }));
  }, [conn, connect, newHostAlias, newHostTarget]);

  const removeHost = useCallback((alias: string) => {
    if (conn !== 'ready' || !wsRef.current || wsRef.current.readyState !== 1) {
      setError('Connect to the relay first.');
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'remove_host', alias }));
  }, [conn]);

  const showHostPubkey = useCallback((alias: string) => {
    if (conn !== 'ready' || !wsRef.current || wsRef.current.readyState !== 1) {
      setError('Connect to the relay first.');
      return;
    }
    wsRef.current.send(JSON.stringify({ type: 'get_host_pubkey', alias }));
  }, [conn]);

  const copyToClipboard = useCallback(async (text: string) => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }, []);

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
          {conn.toUpperCase()}
          {relayUrl ? `  ${shortenUrl(relayUrl)}` : '  (no relay url)'}
        </Text>
        <Pressable
          onPress={() => { setShowAgentPicker((v) => !v); setShowPicker(false); setShowHostsPicker(false); setShowSessionsPicker(false); }}
          style={styles.agentButton}
        >
          <Text style={styles.agentButtonText} numberOfLines={1} ellipsizeMode="tail">
            {`ag:${agent}${showAgentPicker ? '▴' : '▾'}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setShowPicker((v) => !v); setShowHostsPicker(false); setShowSessionsPicker(false); setShowAgentPicker(false); }}
          style={styles.workspaceButton}
        >
          <Text
            style={styles.workspaceButtonText}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {`ws:${workspace}`}{resumed ? '⟲' : ''}{showPicker ? '▴' : '▾'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setShowSessionsPicker((v) => !v); setShowPicker(false); setShowHostsPicker(false); setShowAgentPicker(false); }}
          style={styles.sessionButton}
        >
          <Text style={styles.sessionButtonText} numberOfLines={1} ellipsizeMode="tail">
            {`sess:${Math.max(sessions.length, 1)}${!isViewingLive ? '*' : ''}${showSessionsPicker ? '▴' : '▾'}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => { setShowHostsPicker((v) => !v); setShowPicker(false); setShowSessionsPicker(false); setShowAgentPicker(false); }}
          style={styles.workspaceButton}
        >
          <Text style={styles.workspaceButtonText} numberOfLines={1} ellipsizeMode="tail">
            {`hosts:${hosts.length}${showHostsPicker ? '▴' : '▾'}`}
          </Text>
        </Pressable>
        {conn === 'idle' || conn === 'closed' || conn === 'error' ? (
          <Pressable onPress={() => connect()} style={styles.statusButton}>
            <Text style={styles.statusButtonText}>[CONNECT]</Text>
          </Pressable>
        ) : (
          <Pressable onPress={closeConnection} style={styles.statusButton}>
            <Text style={styles.statusButtonText}>[DISCONNECT]</Text>
          </Pressable>
        )}
      </View>

      {showAgentPicker && (
        <View style={styles.picker}>
          <Text style={styles.label}>+-- CODING AGENT --+</Text>
          <Text style={styles.help}>
            {`Pick which preconfigured CLI agent builds your apps. Each agent keeps\nits own resumable session per workspace. Enable more in \`dashterm setup\`.`}
          </Text>
          {availableAgents.map((a) => {
            const isActive = a.id === agent;
            const resumableHere = (
              workspaces.find((w) => w.name === workspace)?.resumableAgents || []
            ).includes(a.id);
            return (
              <View key={a.id} style={styles.pickerRow}>
                <Pressable onPress={() => switchAgent(a.id)} style={styles.pickerNameButton}>
                  <Text style={[styles.pickerName, isActive && styles.pickerNameActive]}>
                    {`${isActive ? '> ' : '  '}${a.label}`}
                  </Text>
                  <Text style={styles.pickerMeta}>
                    {`${a.id}${resumableHere ? ' · resumable here' : ''}`}
                  </Text>
                </Pressable>
              </View>
            );
          })}
          {availableAgents.length <= 1 && (
            <Text style={styles.hint}>
              {`Only one agent is enabled — add another (e.g. Roo Code) with \`dashterm setup\`.`}
            </Text>
          )}
        </View>
      )}

      {showPicker && (
        <View style={styles.picker}>
          <Text style={styles.label}>+-- DASHTERM URL --+</Text>
          <Text style={styles.help}>
            {`Examples:\n  wss://your-host.example.com/dashterm\n  ws://192.168.1.10:18790`}
          </Text>
          <View style={styles.newRow}>
            <Text style={styles.prompt}>+</Text>
            <TextInput
              value={relayUrlDraft}
              onChangeText={setRelayUrlDraft}
              placeholder="wss://your-host/dashterm"
              placeholderTextColor="#005555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.newInput}
            />
            <Pressable
              onPress={() => {
                const next = relayUrlDraft.trim();
                onUpdate({ relayUrl: next });
                setError(null);
              }}
              style={[
                styles.statusButton,
                relayUrlDraft.trim() === (state.relayUrl || '').trim() && styles.disabled,
              ]}
              disabled={relayUrlDraft.trim() === (state.relayUrl || '').trim()}
            >
              <Text style={styles.statusButtonText}>[ SAVE ]</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>+-- WORKSPACES --+</Text>
          {filterAvailable && (
            <Pressable
              onPress={() => setShowAllWorkspaces((v) => !v)}
              style={styles.filterToggle}
            >
              <Text style={styles.filterToggleText}>
                {`[${showAllWorkspaces ? 'x' : ' '}] show all workspaces`}
              </Text>
              <Text style={styles.filterToggleHint}>
                {showAllWorkspaces
                  ? 'showing every workspace'
                  : `filtered to apps in this space (${relatedWorkspaceNames!.length})`}
              </Text>
            </Pressable>
          )}
          {(() => {
            const visibleWorkspaces =
              filterAvailable && !showAllWorkspaces
                ? workspaces.filter(
                    (w) => relatedWorkspaceNames!.includes(w.name) || w.name === workspace
                  )
                : workspaces;
            return visibleWorkspaces.length === 0 ? (
            <Text style={styles.help}>
              {`No saved workspaces yet${conn === 'ready' ? '' : ' — connect to load them'}.`}
            </Text>
          ) : (
            visibleWorkspaces.map((w) => (
              <View key={w.name} style={styles.pickerRow}>
                <Pressable
                  onPress={() => switchToWorkspace(w.name, true)}
                  style={styles.pickerNameButton}
                >
                  <Text
                    style={[
                      styles.pickerName,
                      w.name === workspace && styles.pickerNameActive,
                    ]}
                  >
                    {w.name === workspace ? '> ' : '  '}{w.name}
                  </Text>
                  <Text style={styles.pickerMeta}>
                    {`${w.appCount} app${w.appCount === 1 ? '' : 's'} · ${formatRelative(w.lastActivityAt)}${(w.resumableAgents ? w.resumableAgents.includes(agent) : w.hasResumableSession) ? ' · resumable' : ''}`}
                  </Text>
                </Pressable>
                {w.name !== workspace && conn === 'ready' && (
                  <Pressable onPress={() => deleteWorkspace(w.name)} style={styles.pickerDelete}>
                    <Text style={styles.pickerDeleteText}>×</Text>
                  </Pressable>
                )}
              </View>
            ))
          );
          })()}
          <View style={styles.newRow}>
            <Text style={styles.prompt}>+</Text>
            <TextInput
              value={newWorkspaceName}
              onChangeText={setNewWorkspaceName}
              placeholder="new workspace name"
              placeholderTextColor="#005555"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.newInput}
              onSubmitEditing={createWorkspace}
            />
            <Pressable
              onPress={createWorkspace}
              style={[styles.statusButton, !isValidWorkspaceName(newWorkspaceName.trim().toLowerCase()) && styles.disabled]}
              disabled={!isValidWorkspaceName(newWorkspaceName.trim().toLowerCase())}
            >
              <Text style={styles.statusButtonText}>[ CREATE ]</Text>
            </Pressable>
          </View>
        </View>
      )}

      {showSessionsPicker && (
        <View style={styles.picker}>
          <Text style={styles.label}>+-- SESSIONS ({workspace}) --+</Text>
          <Text style={styles.help}>
            {`Each session is its own claude context. Start a new one to keep\nthe context window small for quick tweaks — older sessions stay\nreadable here. Up to ${SESSIONS_PER_WORKSPACE_CAP} sessions per workspace.`}
          </Text>
          <Pressable
            onPress={startNewSession}
            style={[styles.statusButton, { alignSelf: 'flex-start', marginTop: 4 }, waitingForReply && styles.disabled]}
            disabled={waitingForReply}
          >
            <Text style={styles.statusButtonText}>[ + NEW SESSION ]</Text>
          </Pressable>
          {sessions.length === 0 ? (
            <Text style={styles.hint}>
              {`No sessions yet — your first message will create one.`}
            </Text>
          ) : (
            sessions.map((s, idx) => {
              const isLive = idx === 0;
              const isViewing = s.id === viewingSessionId;
              return (
                <View key={s.id} style={styles.pickerRow}>
                  <Pressable
                    onPress={() => viewSession(s.id)}
                    style={styles.pickerNameButton}
                  >
                    <Text style={[styles.pickerName, isViewing && styles.pickerNameActive]}>
                      {`${isViewing ? '> ' : '  '}${isLive ? 'live' : `archive ${idx}`}  ${sessionPreview(s)}`}
                    </Text>
                    <Text style={styles.pickerMeta}>
                      {`${s.log.length} line${s.log.length === 1 ? '' : 's'} · ${formatRelative(s.lastActivityAt)}${isLive ? ' · current context' : ''}`}
                    </Text>
                  </Pressable>
                  {!isLive && (
                    <Pressable onPress={() => deleteSession(s.id)} style={styles.pickerDelete}>
                      <Text style={styles.pickerDeleteText}>×</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </View>
      )}

      {showHostsPicker && (
        <View style={styles.picker}>
          <Text style={styles.label}>+-- SSH HOSTS --+</Text>
          <Text style={styles.help}>
            {`Hosts are per-user and shared across all your workspaces.\nClaude reaches them via the Bash tool: ssh <alias> 'command'.`}
          </Text>
          {conn !== 'ready' && (
            <Text style={styles.hint}>
              {`! [CONNECT] to the relay before adding/managing hosts.`}
            </Text>
          )}
          {hosts.length === 0 ? (
            <Text style={styles.hint}>
              {`No hosts yet — add one below. DashTerm generates an ed25519 key per host;\ninstall the pubkey on the target into ~/.ssh/authorized_keys.`}
            </Text>
          ) : (
            hosts.map((h) => (
              <View key={h.alias} style={styles.pickerRow}>
                <View style={styles.pickerNameButton}>
                  <Text style={[styles.pickerName, styles.pickerNameActive]}>
                    {`  ${h.alias}`}
                  </Text>
                  <Text style={styles.pickerMeta}>
                    {`${h.user ? h.user + '@' : ''}${h.host}${h.port !== 22 ? ':' + h.port : ''}  ${h.hasKey ? 'key✓' : '!no key'}`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => showHostPubkey(h.alias)}
                  style={[styles.statusButton, { marginRight: 6 }]}
                >
                  <Text style={styles.statusButtonText}>[pubkey]</Text>
                </Pressable>
                <Pressable onPress={() => removeHost(h.alias)} style={styles.pickerDelete}>
                  <Text style={styles.pickerDeleteText}>×</Text>
                </Pressable>
              </View>
            ))
          )}

          <Text style={[styles.label, { marginTop: 10 }]}>+-- ADD HOST --+</Text>
          <View style={styles.newRow}>
            <Text style={styles.prompt}>+</Text>
            <TextInput
              value={newHostAlias}
              onChangeText={setNewHostAlias}
              placeholder="alias (e.g. nas)"
              placeholderTextColor="#005555"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { flex: 0.4, marginRight: 6 }]}
            />
            <TextInput
              value={newHostTarget}
              onChangeText={setNewHostTarget}
              placeholder="user@host:port"
              placeholderTextColor="#005555"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { flex: 1, marginRight: 6 }]}
              onSubmitEditing={addHost}
            />
            <Pressable
              onPress={addHost}
              style={[
                styles.statusButton,
                (!newHostAlias.trim() || !newHostTarget.trim()) && styles.disabled,
              ]}
              disabled={!newHostAlias.trim() || !newHostTarget.trim()}
            >
              <Text style={styles.statusButtonText}>[ ADD ]</Text>
            </Pressable>
          </View>

          {revealedPubkey && (
            <View style={styles.pubkeyPanel}>
              <Text style={styles.label}>
                {`+-- PUBKEY: ${revealedPubkey.alias} --+`}
              </Text>
              <Text style={styles.help}>
                {`Install this on the target with:\n  echo '<below>' >> ~/.ssh/authorized_keys`}
              </Text>
              <Text selectable style={styles.pubkeyText}>{revealedPubkey.pubkey}</Text>
              <View style={styles.newRow}>
                <Pressable
                  onPress={() => copyToClipboard(revealedPubkey.pubkey)}
                  style={styles.statusButton}
                >
                  <Text style={styles.statusButtonText}>[ copy ]</Text>
                </Pressable>
                <Pressable
                  onPress={() => setRevealedPubkey(null)}
                  style={[styles.statusButton, { marginLeft: 8 }]}
                >
                  <Text style={styles.statusButtonText}>[ close ]</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {error ? <Text style={styles.errorText}>! {error}</Text> : null}

      {!isViewingLive && viewedSession && (
        <View style={styles.archiveBanner}>
          <Text style={styles.archiveBannerText} numberOfLines={2}>
            {`viewing archive — ${sessionPreview(viewedSession)}`}
          </Text>
          <Pressable
            onPress={() => liveSessionId && viewSession(liveSessionId)}
            style={styles.statusButton}
          >
            <Text style={styles.statusButtonText}>[ back to live ]</Text>
          </Pressable>
        </View>
      )}

      <ScrollView ref={scrollRef} style={styles.log} contentContainerStyle={styles.logContent}>
        {displayLog.length === 0 ? (
          <Text style={styles.placeholder}>
            {`+-- AGENT LOG --+
> Connect to the relay, then type an app idea.
> e.g. "make me a habit tracker for water intake.
>       4-8 glasses target, no resets across days."
> Generated files auto-push to your dashboard.`}
          </Text>
        ) : (
          displayLog.map((line) => {
            if (line.kind === 'user') {
              return (
                <View key={line.id} style={styles.userTurn}>
                  <Text style={styles.userTurnLabel}>YOU</Text>
                  <Text style={styles.userTurnText}>{line.text}</Text>
                </View>
              );
            }
            if (line.kind === 'turn_end') {
              return (
                <Text key={line.id} style={styles.turnSeparator}>{line.text}</Text>
              );
            }
            return (
              <Text key={line.id} style={[styles.logLine, styles[`log_${line.kind}`]]}>
                {line.text}
              </Text>
            );
          })
        )}
      </ScrollView>

      {waitingForReply && <WorkingIndicator streamingText={streamingText} agentLabel={agentLabel} />}

      {(state.recentPushes || []).length > 0 && (
        <View style={styles.pushesPanel}>
          <Text style={styles.label}>+-- RECENT PUSHES ({workspace}) --+</Text>
          {(state.recentPushes || []).slice(0, 5).map((p) => (
            <Text key={p.shareCode} style={styles.pushLine}>
              {`  ${p.shareCode}  ${p.name}  v${p.version}`}
            </Text>
          ))}
          <Text style={styles.hint}>
            Add an app to a Space from the command palette (⌘K → name).
          </Text>
        </View>
      )}

      <View style={styles.composer}>
        {attachedImages.length > 0 && (
          <View style={styles.thumbnailRow}>
            {attachedImages.map((img) => (
              <View key={img.id} style={styles.thumbnailWrap}>
                <Image source={{ uri: img.dataUrl }} style={styles.thumbnail} resizeMode="cover" />
                <Pressable
                  onPress={() => removeAttachment(img.id)}
                  style={styles.thumbnailRemove}
                  accessibilityLabel="Remove attached image"
                >
                  <Text style={styles.thumbnailRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={styles.inputRow}>
          <Text style={styles.prompt}>{'>'}</Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={!isViewingLive
              ? 'viewing archive — click [back to live] above to send'
              : conn === 'ready'
                ? 'describe an app, follow up, or paste a screenshot — enter to send, shift+enter for newline'
                : 'connect first'}
            placeholderTextColor="#005555"
            style={styles.input}
            editable={conn === 'ready' && !waitingForReply && isViewingLive}
            onKeyPress={handleInputKeyPress}
            onFocus={() => { inputFocusedRef.current = true; }}
            onBlur={() => { inputFocusedRef.current = false; }}
            multiline
          />
          <Pressable
            onPress={send}
            style={[
              styles.sendButton,
              (conn !== 'ready' || waitingForReply || !isViewingLive || (!input.trim() && attachedImages.length === 0)) && styles.disabled,
            ]}
            disabled={conn !== 'ready' || waitingForReply || !isViewingLive || (!input.trim() && attachedImages.length === 0)}
          >
            <Text style={styles.sendButtonText}>{waitingForReply ? '...' : 'SEND'}</Text>
          </Pressable>
          {waitingForReply && (
            <Pressable onPress={stopClaude} style={styles.stopButton}>
              <Text style={styles.stopButtonText}>STOP</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// Live "still working" indicator shown while a turn is in flight. Claude's
// long tool calls (e.g. ssh) produce gaps with no output; this makes it clear
// the session is busy, not hung. When partial-message text is streaming, shows
// a live tail of it as a "thinking" preview. Mounts fresh each turn.
function WorkingIndicator({ streamingText, agentLabel }: { streamingText: string; agentLabel: string }) {
  const [tick, setTick] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(id);
  }, []);
  const frames = ['|', '/', '-', '\\'];
  const dots = '.'.repeat(tick % 4);
  const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
  // Show the tail of what's streaming so the box stays a fixed size.
  const preview = streamingText ? streamingText.slice(-280) : '';
  return (
    <View style={styles.workingBox}>
      <View style={styles.workingRow}>
        <Text style={styles.workingText}>{`${frames[tick % frames.length]} ${agentLabel} is ${preview ? 'writing' : 'working'}${dots}`}</Text>
        <Text style={styles.workingMeta}>{`${elapsed}s · STOP to interrupt`}</Text>
      </View>
      {preview ? (
        <Text style={styles.workingStream} numberOfLines={3}>{preview}</Text>
      ) : null}
    </View>
  );
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

function shortenUrl(url: string): string {
  return url.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '');
}

function shortenSessionId(id?: string | null): string {
  return id || '';
}

function isValidWorkspaceName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name);
}

function summariseToolInput(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  // Claude Code tool names.
  if (name === 'Write' || name === 'Edit' || name === 'Read') return input.file_path || '';
  if (name === 'Bash') return truncate(input.command || '', 120);
  if (name === 'Grep') return `${input.pattern || ''} ${input.path ? `in ${input.path}` : ''}`.trim();
  // Roo Code tool names.
  if (name === 'execute_command') return truncate(input.command || '', 120);
  if (
    name === 'write_to_file' ||
    name === 'read_file' ||
    name === 'apply_diff' ||
    name === 'insert_content' ||
    name === 'search_and_replace' ||
    name === 'list_files'
  ) {
    return input.path || input.file_path || '';
  }
  if (name === 'search_files') return `${input.regex || ''} ${input.path ? `in ${input.path}` : ''}`.trim();
  if (name === 'ask_followup_question') return truncate(input.question || '', 120);
  // Codex tool names.
  if (name === 'apply_patch') return truncate(input.summary || '', 120);
  if (name === 'web_search') return truncate(input.query || '', 120);
  return truncate(JSON.stringify(input), 120);
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function parseHostTarget(raw: string): { user: string | null; host: string; port: number } {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { user: null, host: '', port: 22 };
  let user: string | null = null;
  let rest = trimmed;
  const at = trimmed.indexOf('@');
  if (at >= 0) {
    user = trimmed.slice(0, at);
    rest = trimmed.slice(at + 1);
  }
  let host = rest;
  let port = 22;
  // Bracketed IPv6 with optional :port
  const bracket = rest.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) {
    host = bracket[1];
    if (bracket[2]) port = Number(bracket[2]);
  } else {
    const colon = rest.lastIndexOf(':');
    // Only treat as host:port if the part after `:` is a number (so IPv6 without brackets doesn't get split).
    if (colon > 0 && /^\d+$/.test(rest.slice(colon + 1))) {
      host = rest.slice(0, colon);
      port = Number(rest.slice(colon + 1));
    }
  }
  return { user: user || null, host, port: Number.isInteger(port) ? port : 22 };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('unexpected_reader_result'));
    };
    reader.readAsDataURL(file);
  });
}

function formatRelative(ts: number | null): string {
  if (!ts) return 'never';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)}h ago`;
  return `${Math.floor(delta / 86400_000)}d ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    padding: 8,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
  },
  statusDot: { fontFamily: 'Courier New', fontSize: 12, flexShrink: 0 },
  statusText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#cccccc',
    flex: 1,
    minWidth: 0,
    marginRight: 6,
  },
  statusButton: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
    flexShrink: 0,
  },
  statusButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff' },
  workspaceButton: {
    borderWidth: 1,
    borderColor: '#00ff00',
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 1,
    maxWidth: 140,
  },
  workspaceButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00' },
  sessionButton: {
    borderWidth: 1,
    borderColor: '#ffff00',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
    flexShrink: 0,
  },
  sessionButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#ffff00' },
  agentButton: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    flexShrink: 1,
    maxWidth: 120,
  },
  agentButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff' },
  archiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#665500',
    backgroundColor: 'rgba(40, 30, 0, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
  },
  archiveBannerText: {
    flex: 1,
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ffcc33',
    marginRight: 8,
  },
  picker: {
    borderWidth: 1,
    borderColor: '#00ff00',
    padding: 8,
    marginBottom: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  pickerNameButton: { flex: 1 },
  pickerName: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#cccccc',
  },
  pickerNameActive: { color: '#00ff00' },
  pickerMeta: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
    marginLeft: 14,
  },
  pickerDelete: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#330000',
  },
  pickerDeleteText: { fontFamily: 'Courier New', fontSize: 12, color: '#ff6666' },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  filterToggleText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00ffff',
  },
  filterToggleHint: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#666666',
    marginLeft: 8,
  },
  pubkeyPanel: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#003333',
  },
  pubkeyText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#00ff88',
    backgroundColor: 'rgba(0, 40, 40, 0.4)',
    padding: 8,
    marginVertical: 6,
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#003300',
  },
  newInput: {
    flex: 1,
    fontFamily: 'Courier New',
    color: '#00ff00',
    fontSize: 12,
    marginLeft: 6,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#003300',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  errorText: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#ff0000',
    marginBottom: 4,
  },
  log: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#003333',
    backgroundColor: '#000000',
    padding: 8,
    marginBottom: 8,
  },
  logContent: { paddingBottom: 12 },
  placeholder: { fontFamily: 'Courier New', fontSize: 11, color: '#005555' },
  logLine: {
    fontFamily: 'Courier New',
    fontSize: 11,
    marginBottom: 2,
    lineHeight: 16,
  },
  log_system:    { color: '#005588' },
  log_user:      { color: '#ffff00' },
  log_assistant: { color: '#00ff00' },
  log_tool:      { color: '#888888' },
  log_stderr:    { color: '#888800' },
  log_error:     { color: '#ff0000' },
  log_push:      { color: '#00ff88' },
  log_turn_end:  { color: '#003333', textAlign: 'center', marginVertical: 4 },
  // Each user message is the visible header of a turn — the chunky block
  // makes the chat read like a back-and-forth rather than a continuous log.
  userTurn: {
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ffff00',
    backgroundColor: 'rgba(40, 40, 0, 0.25)',
  },
  userTurnLabel: {
    fontFamily: 'Courier New',
    fontSize: 9,
    color: '#ffff00',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  userTurnText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffffff',
    lineHeight: 18,
  },
  turnSeparator: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#003333',
    marginVertical: 6,
    textAlign: 'center',
  },
  pushesPanel: {
    borderWidth: 1,
    borderColor: '#00ff00',
    padding: 8,
    marginBottom: 8,
  },
  label: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff00', marginBottom: 4 },
  pushLine: { fontFamily: 'Courier New', fontSize: 11, color: '#00ff88' },
  hint: { fontFamily: 'Courier New', fontSize: 10, color: '#666666', marginTop: 4 },
  help: { fontFamily: 'Courier New', fontSize: 11, color: '#666666', marginBottom: 4 },
  composer: {
    borderWidth: 1,
    borderColor: '#00ffff',
  },
  thumbnailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#003333',
  },
  thumbnailWrap: {
    position: 'relative',
    width: 44,
    height: 44,
    marginRight: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#00ffff',
  },
  thumbnail: { width: '100%', height: '100%' },
  thumbnailRemove: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#ff0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailRemoveText: { color: '#ff0000', fontFamily: 'Courier New', fontSize: 11, lineHeight: 12 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  prompt: {
    fontFamily: 'Courier New',
    color: '#00ffff',
    fontSize: 13,
    marginRight: 6,
    marginTop: 2,
  },
  input: {
    flex: 1,
    fontFamily: 'Courier New',
    color: '#00ff00',
    fontSize: 12,
    lineHeight: 18,
    minHeight: 72,
    maxHeight: 240,
    padding: 0,
  },
  sendButton: {
    borderWidth: 1,
    borderColor: '#00ffff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  sendButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#00ffff' },
  stopButton: {
    borderWidth: 1,
    borderColor: '#ff0000',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 6,
  },
  stopButtonText: { fontFamily: 'Courier New', fontSize: 11, color: '#ff0000' },
  disabled: { opacity: 0.4 },
  workingBox: {
    borderWidth: 1,
    borderColor: '#665500',
    backgroundColor: 'rgba(40, 30, 0, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  workingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workingText: { fontFamily: 'Courier New', fontSize: 12, color: '#ffcc33' },
  workingMeta: { fontFamily: 'Courier New', fontSize: 10, color: '#998800' },
  workingStream: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#c9b06a',
    marginTop: 6,
    lineHeight: 15,
  },
});
