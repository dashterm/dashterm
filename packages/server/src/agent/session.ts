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

const AUTHORING_CONTRACT = [
  'You are a coding agent embedded in DashTerm, a terminal-aesthetic dashboard.',
  'Your job is to build small self-contained "apps" the user can drop onto their dashboard.',
  '',
  'How apps work here:',
  '- Write ONE app as a single React Native component file at apps/<slug>.tsx',
  '  (slug: lowercase letters, digits, dashes — it becomes the filename).',
  '- The component MUST be the default export: `export default function Foo({ appState, onUpdateState }) { ... }`.',
  '- Persist state by calling onUpdateState(partialUpdates); read it from appState (always default-guard: `const s = { items: [], ...(appState||{}) }`).',
  '- Do NOT add import statements — these are provided globally at runtime and any imports are stripped at compile time:',
  '  React, useState, useEffect, useRef, View, Text, TextInput, ScrollView, Pressable, Image, StyleSheet.',
  '- Style with StyleSheet and the terminal aesthetic: background #0a0a0a, borders/text in #00ffff (cyan) or #00ff00 (green),',
  '  accents #ff0000/#ffff00, font "Courier New" monospace. No external assets.',
  '- You may call the gateway API from the app via the global window.DASHTERM_API_BASE (e.g. `fetch(window.DASHTERM_API_BASE + "/state")`).',
  '- Optional metadata: a leading `// name: My App` and `// description: ...` comment, or an apps/<slug>.json sidecar { "name", "description" }.',
  '',
  'After every turn the gateway automatically compiles and publishes any changed apps/*.tsx to the dashboard — do not run a build step or ask the user to.',
  'Keep one app per file. To edit an existing app, edit its apps/<slug>.tsx in place. Be concise in chat; let the code do the talking.',
].join('\n');

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
        // SSH hosts are not supported by the native gateway yet.
        this.send({ type: 'hosts', items: [] });
        break;
      case 'add_host':
      case 'remove_host':
      case 'get_host_pubkey':
        this.send({ type: 'error', error: 'SSH hosts are not supported by the native gateway yet' });
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

    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      this.config.agentPermissionMode,
      '--append-system-prompt',
      AUTHORING_CONTRACT,
    ];
    if (this.config.claudeModel) args.push('--model', this.config.claudeModel);
    if (resumeId) args.push('--resume', resumeId);
    else if (assignId) args.push('--session-id', assignId);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.config.claudeBin, args, {
        cwd: this.dir,
        env: process.env,
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
    // Forward raw — the client's renderClaudeEvent understands the shapes.
    this.send({ type: 'claude_event', event });

    if (event?.type === 'system' && event?.subtype === 'init' && event?.session_id) {
      this.currentSessionId = event.session_id;
      writeSession(this.dir, { lastSessionId: event.session_id, lastActivityAt: Date.now() });
      return;
    }
    if (event?.type === 'result') {
      void this.finishTurn(event);
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
