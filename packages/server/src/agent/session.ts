/**
 * One AgentSession per /api/agent/ws connection. Owns a single `claude`
 * child process for the active workspace, bridges the WebSocket protocol the
 * AgenticCoder client speaks to the CLI's stream-json stdio, and pushes
 * generated apps after each turn.
 *
 * claude is run with --permission-mode bypassPermissions (gated by
 * config.agentEnabled), so it can Write files and run Bash with no prompts.
 * cwd is the per-user workspace dir; that is NOT a hard sandbox.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import type { GatewayConfig } from '../config';
import { pushChangedApps } from './pushApps';
import {
  DEFAULT_WORKSPACE,
  ensureWorkspace,
  isValidWorkspaceName,
  listWorkspaces,
  deleteWorkspace,
  readSession,
  writeSession,
} from './workspace';
import {
  addHost,
  ensureSshScaffold,
  getHostPubkey,
  listHosts,
  removeHost,
  sshBinDir,
} from './sshHosts';

const AUTHORING_CONTRACT = [
  'You are a coding agent embedded in DashTerm, a terminal-aesthetic dashboard.',
  'Your job is to build small self-contained "apps" the user can drop onto their dashboard.',
  '',
  'FRONTEND — write ONE app as a single React Native component file at apps/<slug>.tsx',
  '  (slug: lowercase letters, digits, dashes — it becomes the filename).',
  '- The component MUST be the default export. Props: { appState, onUpdateState, appId, backend, events, userProfile } — e.g. `export default function Foo({ appState, onUpdateState, backend, events }) { ... }`.',
  '- Persist state with onUpdateState(partialUpdates) — it shallow-merges at the TOP level, so independent keys update separately without clobbering each other. Read back from appState (always default-guard: `const s = { items: [], ...(appState||{}) }`).',
  '- Do NOT add import statements — these are provided globally at runtime and any imports are stripped at compile time:',
  '  React, useState, useEffect, useRef, View, Text, TextInput, ScrollView, Pressable, Image, StyleSheet.',
  '- Style with StyleSheet and the terminal aesthetic: background #0a0a0a, borders/text in #00ffff (cyan) or #00ff00 (green),',
  '  accents #ff0000/#ffff00, font "Courier New" monospace. No external assets.',
  '- Styles pass straight to the DOM style prop, so real web CSS works: gradients (background: "conic-gradient(...)"), transition, boxShadow, flexWrap, "%" sizes. Caveats: write transform as a CSS STRING ("rotate(45deg)"), not an RN array; numeric lineHeight is treated as PIXELS like RN (lineHeight: 19 == 19px) — for a multiplier use a small number like 1.4; there is no onLayout/measure and View is not a ref target (you cannot read element size); Animated is a no-op — animate with CSS transition.',
  '- Optional metadata: a leading `// name: My App` and `// description: ...` comment, or an apps/<slug>.json sidecar { "name", "description" }.',
  '',
  'BUILT-IN RUNTIME HELPERS available to the frontend (no fixed per-feature endpoints needed):',
  '- backend(path, init?)  — prop passed to your component; calls THIS app\'s own backend (see below) and resolves parsed JSON. e.g. `await backend("/uptime")`.',
  '- events  — prop passed to your component; the cross-app event bus, so apps on the same dashboard can talk to each other. events.emit(name, data) broadcasts as "<thisAppId>:<name>"; events.on(pattern, handler) subscribes and returns an unsubscribe fn. Patterns: exact "K7XM2:priceDrop", namespace "K7XM2:*", or "*". ALWAYS subscribe inside a useEffect and return the unsub for cleanup: `useEffect(() => events.on("OTHER_ID:ping", e => {...}), [])`. Note: in-memory and local to the current browser tab — not synced across tabs/devices.',
  '- window.dashterm.ai.chat(messages, opts?)        — OpenAI-shaped chat via the user\'s configured AI provider.',
  '- window.dashterm.secrets.fetch(url, init?)        — call a 3rd-party API with {{secret.NAME}} and/or {{var.NAME}} placeholders substituted server-side (a secret value never reaches the browser). window.dashterm.secrets.names() lists available secret names.',
  '- window.dashterm.vars.get(name) / .all() / .names() — read VARIABLES: non-secret config the user stores and edits (e.g. a base URL, hostname, username). Unlike secrets these ARE readable on the frontend. Pair them: build `https://{{var.SONARR_URL}}/api/v3/series` with header `X-Api-Key: {{secret.SONARR_API_KEY}}`. Keep credentials in secrets, everything else in vars.',
  '- window.DASHTERM_API_BASE                          — gateway REST API base. It ALREADY ends in /api: append routes directly, e.g. DASHTERM_API_BASE + "/hosts" (NOT "/api/hosts"). (backend() already handles this for your own backend.)',
  '',
  'BACKEND (optional, only when the app needs server-side work like SSH, shell commands, or reaching LAN/private services) —',
  'write apps/<slug>.server.ts alongside the frontend:',
  '- `export default function register(router) { router.get("/uptime", async (req, ctx) => ({ ... })) }`.',
  '- router.get/post/put/delete/patch(path, handler). Paths support :params and a trailing *. handler(req, ctx) returns JSON-serializable data.',
  '- req = { method, path, params, query, body, headers }.',
  '- ctx capabilities (this is how you do ANYTHING server-side — do NOT ask for new gateway endpoints):',
  '    ctx.db                   → this app\'s OWN private SQLite database; data persists across requests and restarts, isolated per app.',
  '        ctx.db.exec(sql)                     run DDL, e.g. `create table if not exists notes (id integer primary key, text)` — do this before first use.',
  '        ctx.db.run(sql, params?)             insert/update/delete → { changes, lastInsertRowid }. params = positional array for ? or an object for @named.',
  '        ctx.db.get(sql, params?)             one row (or undefined).',
  '        ctx.db.all(sql, params?)             all matching rows. Use real SQL: where/order by/limit/joins/aggregates.',
  '    ctx.ssh(alias, command)  → { ok, code, stdout, stderr }  run a command on a configured SSH host (same aliases as your Bash ssh <alias>; list them via GET /api/hosts)',
  '    ctx.exec(command)        → { ok, code, stdout, stderr }  run a command on the gateway host itself',
  '    ctx.fetch(url, init?)    → Response  server-side fetch that CAN reach LAN/private services (no browser CORS/SSRF limits)',
  '    ctx.secrets.get(name) / ctx.secrets.names()             the owner\'s stored secrets (write-only credentials)',
  '    ctx.vars.get(name) / ctx.vars.names()                   the owner\'s stored variables (readable non-secret config, e.g. base URLs)',
  '    ctx.ai.chat(messages, opts?)                            the owner\'s AI provider (single-shot completion)',
  '    ctx.ai.run({ system, messages, tools })                 a SERVER-SIDE tool/agent loop — use this for "chat that can DO things" instead of hand-rolling call->tool_calls->call. tools: [{ def: { name, description, parameters }, handler: async (args) => result }]. The model calls your tools, each handler runs server-side with full ctx and its return value is fed back, and the loop repeats until the model answers or hits maxSteps (default 8). Returns { reply, steps:[{name,args,ok,result}], servedBy, stoppedAt }. It also handles every provider\'s tool round-trip quirks for you, so the frontend can stay a thin chat view that POSTs to your backend.',
  '    ctx.userId, ctx.log(...)',
  '- The frontend reaches its own backend via the backend() prop — it does NOT need the share code. Backends run owner-only.',
  '- Prefer composing ctx.ssh/ctx.exec/ctx.fetch over hard-coding data. Discover the user\'s hosts dynamically (e.g. GET /api/hosts) rather than baking in hostnames.',
  '',
  'After every turn the gateway automatically compiles and publishes any changed apps/*.tsx (and its .server.ts) — do not run a build step or ask the user to. If a file fails to compile, the error is reported back to you to fix.',
  'Keep one app per file. To edit an existing app, edit its files in place. Be concise in chat; let the code do the talking.',
].join('\n');

// Appends a note about the user's configured SSH hosts so claude knows it can
// reach them from Bash. Aliases resolve via a managed ssh config on PATH.
function buildSystemPrompt(hostAliases: string[]): string {
  if (hostAliases.length === 0) return AUTHORING_CONTRACT;
  return (
    AUTHORING_CONTRACT +
    '\n\nRemote hosts: you can run commands on the user\'s configured machines from the Bash tool as ' +
    '`ssh <alias> \'command\'` (also `scp` works). Available aliases: ' +
    hostAliases.join(', ') +
    '. These are pre-configured with keys — no setup needed.'
  );
}

type ConnSend = (envelope: unknown) => void;

// Minimal structural type for the WS socket — we only ever send on it (the
// route owns message/close/error wiring). Avoids depending on `ws` types.
interface SocketLike {
  send(data: string): void;
}

export class AgentSession {
  private workspace = DEFAULT_WORKSPACE;
  private dir = '';
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuf = '';
  private turnActive = false;
  private turnStartedAt = 0;
  private currentSessionId: string | null = null;
  private everSpawned = false;
  private resumeMode = true;
  private disposed = false;

  constructor(
    private readonly socket: SocketLike,
    private readonly uid: string,
    private readonly ownerName: string,
    private readonly config: GatewayConfig,
  ) {}

  private send: ConnSend = (envelope) => {
    if (this.disposed) return;
    try {
      this.socket.send(JSON.stringify(envelope));
    } catch {
      /* socket may have closed */
    }
  };

  onMessage(raw: Buffer): void {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg?.type) {
      case 'auth':
        this.handleAuth(msg.workspace, msg.resume);
        break;
      case 'user':
        this.handleUser(msg);
        break;
      case 'refresh':
        // Cookie carries identity on the native gateway — nothing to refresh.
        break;
      case 'stop':
        this.stop();
        break;
      case 'switch_workspace':
        this.handleAuth(msg.workspace, msg.resume);
        break;
      case 'list_workspaces':
        this.send({ type: 'workspaces', items: listWorkspaces(this.config, this.uid) });
        break;
      case 'new_workspace':
        this.handleNewWorkspace(msg.workspace);
        break;
      case 'delete_workspace':
        this.handleDeleteWorkspace(msg.workspace);
        break;
      case 'list_hosts':
        this.send({ type: 'hosts', items: listHosts(this.config, this.uid) });
        break;
      case 'add_host':
        this.handleAddHost(msg);
        break;
      case 'remove_host':
        this.handleRemoveHost(msg.alias);
        break;
      case 'get_host_pubkey':
        this.handleGetHostPubkey(msg.alias);
        break;
      default:
        break;
    }
  }

  private handleAuth(workspace: unknown, resume: unknown): void {
    const ws = typeof workspace === 'string' && workspace.trim() ? workspace.trim() : DEFAULT_WORKSPACE;
    if (!isValidWorkspaceName(ws)) {
      this.send({ type: 'error', error: `invalid workspace name: ${ws}` });
      return;
    }
    // Switching workspaces means a different claude session — tear down first.
    this.killChild();
    this.everSpawned = false;
    this.currentSessionId = null;
    this.resumeMode = resume !== false;
    this.workspace = ws;
    this.dir = ensureWorkspace(this.config, this.uid, ws);
    const session = readSession(this.dir);
    const resumeSessionId = this.resumeMode ? session.lastSessionId ?? undefined : undefined;
    this.send({
      type: 'ready',
      workspace: ws,
      resume: !!resumeSessionId,
      resumeSessionId,
    });
  }

  private handleNewWorkspace(workspace: unknown): void {
    const ws = typeof workspace === 'string' ? workspace.trim() : '';
    if (!isValidWorkspaceName(ws)) {
      this.send({ type: 'error', error: 'workspace names: lowercase, 1-32 chars, [a-z0-9_-]' });
      return;
    }
    ensureWorkspace(this.config, this.uid, ws);
    this.send({ type: 'workspaces', items: listWorkspaces(this.config, this.uid) });
  }

  private handleDeleteWorkspace(workspace: unknown): void {
    const ws = typeof workspace === 'string' ? workspace.trim() : '';
    if (!isValidWorkspaceName(ws)) {
      this.send({ type: 'error', error: 'invalid workspace name' });
      return;
    }
    if (ws === this.workspace) {
      this.send({ type: 'error', error: 'switch to a different workspace before deleting this one' });
      return;
    }
    deleteWorkspace(this.config, this.uid, ws);
    this.send({ type: 'workspaces', items: listWorkspaces(this.config, this.uid) });
  }

  private handleAddHost(msg: { alias?: string; host?: string; port?: number; user?: string }): void {
    try {
      const { alias, pubkey } = addHost(this.config, this.uid, {
        alias: msg.alias ?? '',
        host: msg.host ?? '',
        port: msg.port,
        user: msg.user,
      });
      this.send({ type: 'host_added', alias, pubkey });
      // Refresh the list so the client's hosts:N count updates.
      this.send({ type: 'hosts', items: listHosts(this.config, this.uid) });
    } catch (err) {
      this.send({ type: 'error', error: (err as Error).message });
    }
  }

  private handleRemoveHost(alias: unknown): void {
    try {
      removeHost(this.config, this.uid, String(alias ?? ''));
      this.send({ type: 'host_removed', alias });
      this.send({ type: 'hosts', items: listHosts(this.config, this.uid) });
    } catch (err) {
      this.send({ type: 'error', error: (err as Error).message });
    }
  }

  private handleGetHostPubkey(alias: unknown): void {
    try {
      const pubkey = getHostPubkey(this.config, this.uid, String(alias ?? ''));
      this.send({ type: 'host_pubkey', alias, pubkey });
    } catch (err) {
      this.send({ type: 'error', error: (err as Error).message });
    }
  }

  private handleUser(msg: { text?: string; images?: Array<{ mediaType: string; data: string }> }): void {
    if (this.turnActive) {
      this.send({ type: 'error', error: 'a turn is already in progress' });
      return;
    }
    if (!this.dir) {
      this.send({ type: 'error', error: 'not authenticated to a workspace' });
      return;
    }
    const child = this.ensureChild();
    if (!child) return;

    const content: any[] = [];
    const text = (msg.text ?? '').trim();
    if (text) content.push({ type: 'text', text });
    for (const img of msg.images ?? []) {
      if (!img?.data) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.data },
      });
    }
    if (content.length === 0) return;

    this.turnStartedAt = Date.now();
    this.turnActive = true;
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } });
    try {
      child.stdin.write(line + '\n');
    } catch (err) {
      this.turnActive = false;
      this.send({ type: 'error', error: `failed to send to claude: ${(err as Error).message}` });
    }
  }

  /** Spawn (or reuse) the claude child for the active workspace. */
  private ensureChild(): ChildProcessWithoutNullStreams | null {
    if (this.child) return this.child;

    const session = readSession(this.dir);
    // Continue the live session on respawn; honour an explicit resume request;
    // otherwise start fresh with an id we assign up front.
    let resumeId: string | null = null;
    let assignId: string | null = null;
    if (this.everSpawned && this.currentSessionId) resumeId = this.currentSessionId;
    else if (this.resumeMode && session.lastSessionId) resumeId = session.lastSessionId;
    else assignId = randomUUID();
    this.currentSessionId = resumeId ?? assignId;

    // Set up per-user SSH so claude's Bash can `ssh <alias> '...'`. The wrapper
    // dir goes first on PATH so `ssh`/`scp` resolve to the managed config.
    let sshBin: string | null = null;
    let hostAliases: string[] = [];
    try {
      ensureSshScaffold(this.config, this.uid);
      sshBin = sshBinDir(this.config, this.uid);
      hostAliases = listHosts(this.config, this.uid).map((h) => h.alias);
    } catch {
      sshBin = null;
    }

    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      // Emit partial-message deltas so the client can show text as it streams.
      '--include-partial-messages',
      '--permission-mode',
      this.config.agentPermissionMode,
      '--append-system-prompt',
      buildSystemPrompt(hostAliases),
    ];
    if (this.config.claudeModel) args.push('--model', this.config.claudeModel);
    if (resumeId) args.push('--resume', resumeId);
    else if (assignId) args.push('--session-id', assignId);

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (sshBin) env.PATH = `${sshBin}:${process.env.PATH ?? ''}`;
    // Claude Code refuses --permission-mode bypassPermissions as root unless
    // IS_SANDBOX is set. Running the agent as root is full RCE as root, so it's
    // opt-in: without DASHTERM_AGENT_ALLOW_ROOT we refuse with a clear message;
    // with it we set the sandbox flag so Claude will run. Non-root installs
    // never hit the guard.
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (isRoot && !this.config.agentAllowRoot) {
      this.send({
        type: 'error',
        error:
          'The DashTerm gateway is running as root, and Claude Code refuses to ' +
          'run agent sessions with bypassed permissions as root. Re-run DashTerm ' +
          'as a non-root user (recommended), or set DASHTERM_AGENT_ALLOW_ROOT=1 ' +
          'to override on a disposable/sandboxed host.',
      });
      return null;
    }
    if (isRoot) env.IS_SANDBOX = '1';

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.config.claudeBin, args, {
        cwd: this.dir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.send({ type: 'error', error: `failed to spawn claude: ${(err as Error).message}` });
      return null;
    }

    this.child = child;
    this.everSpawned = true;
    this.stdoutBuf = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.send({ type: 'claude_log', stream: 'stderr', text });
    });
    child.on('error', (err) => {
      this.send({ type: 'error', error: `claude process error: ${err.message}` });
    });
    child.on('close', (code) => {
      if (this.child === child) this.child = null;
      if (this.turnActive) {
        this.turnActive = false;
        this.send({ type: 'session_end', code: code ?? 1 });
      }
    });
    return child;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      this.handleClaudeEvent(event);
    }
  }

  private handleClaudeEvent(event: any): void {
    if (event?.type === 'result') {
      // Ignore a result for a turn that already ended — e.g. the dying process
      // after a user stop — so we don't forward a spurious error line or emit a
      // second session_end. Flip turnActive synchronously to make this idempotent.
      if (!this.turnActive) return;
      this.turnActive = false;
      this.send({ type: 'claude_event', event });
      void this.finishTurn(event);
      return;
    }
    // Forward everything else verbatim — the client's renderClaudeEvent
    // understands the shapes.
    this.send({ type: 'claude_event', event });
    if (event?.type === 'system' && event?.subtype === 'init' && event?.session_id) {
      this.currentSessionId = event.session_id;
      writeSession(this.dir, { lastSessionId: event.session_id, lastActivityAt: Date.now() });
    }
  }

  private async finishTurn(event: any): Promise<void> {
    const since = this.turnStartedAt;
    try {
      const { pushed, errors } = await pushChangedApps({
        uid: this.uid,
        ownerName: this.ownerName,
        dir: this.dir,
        sinceMs: since,
      });
      for (const p of pushed) {
        this.send({ type: 'app_pushed', shareCode: p.shareCode, name: p.name, version: p.version });
      }
      for (const e of errors) {
        this.send({ type: 'app_error', file: e.file, error: e.error });
      }
    } catch (err) {
      this.send({ type: 'app_error', file: 'apps/*', error: (err as Error).message });
    }
    if (this.currentSessionId) {
      writeSession(this.dir, { lastSessionId: this.currentSessionId, lastActivityAt: Date.now() });
    }
    this.turnActive = false;
    const code = event?.is_error || event?.subtype === 'error' ? 1 : 0;
    this.send({ type: 'session_end', code });
  }

  private killChild(): void {
    if (this.child) {
      try {
        this.child.kill('SIGINT');
      } catch {
        /* already gone */
      }
      this.child = null;
    }
  }

  stop(): void {
    if (!this.child && !this.turnActive) return;
    // No interrupt message in stream-json mode — kill and resume on next turn.
    this.killChild();
    this.turnActive = false;
    this.send({ type: 'session_end', code: 0 });
  }

  dispose(): void {
    this.disposed = true;
    this.killChild();
  }
}
