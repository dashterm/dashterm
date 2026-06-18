/**
 * Agent profiles — one per supported CLI coding agent.
 *
 * The gateway spawns a headless coding-agent CLI per AgentSession and bridges
 * its stdin/stdout to the AgenticCoder WebSocket protocol. Each agent speaks a
 * slightly different stream-json dialect, so an AgentProfile encapsulates the
 * differences and keeps AgentSession itself agent-agnostic:
 *
 *   - which binary to spawn and which argv to pass;
 *   - how to frame a user turn on stdin. Claude takes one `user` message per
 *     turn (every turn looks the same). Roo's `--stdin-prompt-stream` protocol
 *     opens a task with a `start` command (carrying the resumable taskId) and
 *     sends each follow-up as a `message` command keyed by requestId;
 *   - how to translate the agent's native NDJSON events into the *Claude-shaped*
 *     events the AgenticCoder client already renders. Normalising on the server
 *     means the client keeps a single renderer (renderClaudeEvent) regardless of
 *     which agent produced the stream.
 *
 * Adding an agent = adding a profile here + surfacing it from availableAgents().
 * Codex / Grok Build are intentionally absent until their CLIs ship a
 * resumable headless mode (see cli/src/commands/onboard.ts).
 */
import fs from 'fs';
import path from 'path';
import type { GatewayConfig } from '../config';

export type AgentId = 'claude' | 'roo' | 'codex';

/** What the client needs to render the agent picker. */
export interface AgentInfo {
  id: AgentId;
  label: string;
  enabled: boolean;
}

/** Inputs for building the spawn argv. */
export interface SpawnPlan {
  /** Existing session/task id to resume, or null to start fresh. */
  resumeId: string | null;
  /** Freshly-minted session/task id when not resuming, or null. */
  assignId: string | null;
  /** Authoring contract (+ SSH host note) injected as the system prompt. */
  systemPrompt: string;
  /** --permission-mode value (Claude). */
  permissionMode: string;
  /** Model override, or null for the CLI default (Claude). */
  model: string | null;
  /** Absolute path to the per-user workspace dir (Roo's -w / cwd). */
  workspaceDir: string;
}

/** One user turn to frame onto the child's stdin. */
export interface UserTurn {
  text: string;
  images: Array<{ mediaType: string; data: string }>;
  /** Correlation id for this turn (Roo echoes it on control events). */
  requestId: string;
  /** True when this is the first turn for the current child process. */
  isFirstTurn: boolean;
  /** True when the current child was spawned to resume an existing session. */
  isResume: boolean;
  /** The session/task id of the current child (Roo's start taskId). */
  sessionId: string | null;
  /** Authoring contract — delivered in-band by agents without a system-prompt flag. */
  systemPrompt: string;
}

/**
 * Normalised signal the session acts on, derived from one native stdout event.
 * Keeping the terminal event *inside* the turn_end signal lets the session apply
 * the "ignore a result for an already-ended turn" guard to both the forward and
 * the finish in one place.
 */
export type AgentSignal =
  | { kind: 'event'; event: unknown } // forward to the client as a claude_event
  | { kind: 'session'; sessionId: string } // record/persist the agent's session id
  | { kind: 'turn_end'; isError: boolean; event?: unknown } // the active turn finished
  | { kind: 'error'; error: string }; // surface a relay error line

export interface AgentProfile {
  id: AgentId;
  label: string;
  /**
   * Process model:
   *  - 'persistent': one long-lived child; turns stream onto its stdin
   *    (`buildArgs` once at spawn, `buildTurn` per turn). Claude, Roo.
   *  - 'perTurn': a fresh child per turn with the prompt baked into argv; the
   *    child runs one turn to completion and exits, resuming an existing session
   *    by id (`buildPerTurnArgs`). Codex (`codex exec` / `codex exec resume`).
   */
  lifecycle: 'persistent' | 'perTurn';
  /** Resolve the binary to spawn from gateway config. */
  bin(config: GatewayConfig): string;
  /** Needs IS_SANDBOX to run with bypassed permissions as root (Claude does). */
  needsRootSandbox: boolean;
  /** Optional pre-spawn workspace prep (e.g. drop a rules / AGENTS.md file). */
  prepareWorkspace?(dir: string, systemPrompt: string): void;
  /** persistent: build argv once at spawn (excluding the binary itself). */
  buildArgs?(plan: SpawnPlan): string[];
  /** persistent: frame a user turn as NDJSON stdin line(s) (no trailing newline). */
  buildTurn?(turn: UserTurn): string[];
  /** perTurn: the complete argv for a single turn (prompt + resume baked in). */
  buildPerTurnArgs?(plan: SpawnPlan, turn: UserTurn): string[];
  /** Translate one native stdout event into zero or more session signals. */
  normalizeEvent(event: any, ctx: { knownSessionId: string | null }): AgentSignal[];
}

// ---------------------------------------------------------------------------
// Claude Code — the original profile. Behaviour is byte-for-byte what
// AgentSession did before profiles existed.
// ---------------------------------------------------------------------------

const claudeProfile: AgentProfile = {
  id: 'claude',
  label: 'Claude Code',
  lifecycle: 'persistent',
  needsRootSandbox: true,
  bin: (config) => config.claudeBin,
  buildArgs(plan) {
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
      plan.permissionMode,
      '--append-system-prompt',
      plan.systemPrompt,
    ];
    if (plan.model) args.push('--model', plan.model);
    if (plan.resumeId) args.push('--resume', plan.resumeId);
    else if (plan.assignId) args.push('--session-id', plan.assignId);
    return args;
  },
  buildTurn(turn) {
    const content: any[] = [];
    if (turn.text) content.push({ type: 'text', text: turn.text });
    for (const img of turn.images) {
      if (!img?.data) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.data },
      });
    }
    if (content.length === 0) return [];
    return [JSON.stringify({ type: 'user', message: { role: 'user', content } })];
  },
  normalizeEvent(event) {
    if (event?.type === 'result') {
      const isError = !!event.is_error || event.subtype === 'error';
      return [{ kind: 'turn_end', isError, event }];
    }
    const out: AgentSignal[] = [{ kind: 'event', event }];
    if (event?.type === 'system' && event?.subtype === 'init' && event?.session_id) {
      out.push({ kind: 'session', sessionId: event.session_id });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Roo Code — runs `roo --print --stdin-prompt-stream --output-format
// stream-json`. The user configures Roo's own provider/key (settings.json or an
// *_API_KEY env var); the gateway passes no credentials. The resumable session
// id is the start command's taskId (a UUID we assign), so — unlike Claude — we
// already know it before spawn and never read it back from an init event.
// Event field shapes are from apps/cli/src/agent/json-event-emitter.ts.
// ---------------------------------------------------------------------------

function toDataUrls(images: UserTurn['images']): string[] {
  return images
    .filter((i) => i?.data)
    .map((i) => `data:${i.mediaType || 'image/png'};base64,${i.data}`);
}

// Roo's stdin parser rejects an empty prompt, so image-only turns still need text.
const IMAGE_ONLY_PROMPT = '(see the attached image — please act on it)';

const rooProfile: AgentProfile = {
  id: 'roo',
  label: 'Roo Code',
  lifecycle: 'persistent',
  needsRootSandbox: false,
  bin: (config) => config.rooBin,
  buildArgs(plan) {
    // Auto-approval is Roo's default (we deliberately omit --require-approval),
    // matching Claude's bypassPermissions. Provider/model/key come from Roo's
    // own config, so we pass none. The session id rides on the start command's
    // taskId, not an argv flag.
    return [
      '--print',
      '--stdin-prompt-stream',
      '--output-format',
      'stream-json',
      '-w',
      plan.workspaceDir,
    ];
  },
  prepareWorkspace(dir, systemPrompt) {
    // Roo has no --append-system-prompt; a workspace rules file is picked up on
    // every turn (including resumes). We ALSO prepend the contract to a fresh
    // start prompt (see buildTurn) as a guaranteed-delivery belt-and-braces.
    try {
      const rulesDir = path.join(dir, '.roo', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, '01-dashterm-authoring.md'), systemPrompt);
    } catch {
      /* best-effort — buildTurn's prepend still delivers the contract */
    }
  },
  buildTurn(turn) {
    const prompt = turn.text || IMAGE_ONLY_PROMPT;
    const images = toDataUrls(turn.images);
    if (turn.isFirstTurn) {
      // On a fresh session prepend the authoring contract so Roo learns the
      // dashterm app format even if the rules file isn't honoured; on resume the
      // contract is already in history + the rules file, so don't repeat it.
      const startPrompt = turn.isResume
        ? prompt
        : `${turn.systemPrompt}\n\n----- BEGIN USER REQUEST -----\n\n${prompt}`;
      const cmd: Record<string, unknown> = {
        command: 'start',
        requestId: turn.requestId,
        prompt: startPrompt,
      };
      if (turn.sessionId) cmd.taskId = turn.sessionId; // resume or create-with-id
      if (images.length) cmd.images = images;
      return [JSON.stringify(cmd)];
    }
    const cmd: Record<string, unknown> = {
      command: 'message',
      requestId: turn.requestId,
      prompt,
    };
    if (images.length) cmd.images = images;
    return [JSON.stringify(cmd)];
  },
  normalizeEvent(event, ctx) {
    const t = event?.type;

    // The init event carries no session id; surface the one we assigned so the
    // client can print its "<agent> session <id>" line.
    if (t === 'system' && event?.subtype === 'init') {
      return ctx.knownSessionId
        ? [{ kind: 'event', event: { type: 'system', subtype: 'init', session_id: ctx.knownSessionId } }]
        : [];
    }

    // control:done is the per-turn completion signal in stdin-stream mode.
    if (t === 'control') {
      if (event.subtype === 'done') return [{ kind: 'turn_end', isError: event.success === false }];
      if (event.subtype === 'error') {
        const msg = String(event.content || event.code || 'roo error');
        return [{ kind: 'error', error: msg }, { kind: 'turn_end', isError: true }];
      }
      return []; // ack — nothing to show
    }

    // A taskCompleted result is a redundant completion signal; the session's
    // turnActive guard makes a second turn_end idempotent.
    if (t === 'result') return [{ kind: 'turn_end', isError: event.success === false }];

    if (t === 'error') return [{ kind: 'error', error: String(event.content || 'roo error') }];

    // assistant: partials carry deltas (feed the live preview), the final
    // (done) carries the full text (append it as a log line, clearing preview).
    if (t === 'assistant') {
      if (event.done) {
        return typeof event.content === 'string' && event.content.length
          ? [{ kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'text', text: event.content }] } } }]
          : [];
      }
      return typeof event.content === 'string' && event.content.length
        ? [textDelta(event.content)]
        : [];
    }

    // reasoning — show progress in the preview only; don't persist a line.
    if (t === 'thinking') {
      return !event.done && typeof event.content === 'string' && event.content.length
        ? [textDelta(event.content)]
        : [];
    }

    // The first say:text is the echoed user prompt; the client already shows the
    // user's message locally, so drop Roo's echo + any user_feedback.
    if (t === 'user') return [];

    // tool_use — only the completed (non-partial) call, to skip delta noise.
    if (t === 'tool_use') {
      if (event.done && event.tool_use) {
        const name = event.tool_use.name || 'tool';
        return [
          { kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'tool_use', name, input: event.tool_use.input }] } } },
        ];
      }
      return [];
    }

    // tool_result — forward any chunk that carries output, rendered as `← …`.
    if (t === 'tool_result') {
      const out = event.tool_result?.output;
      return typeof out === 'string' && out.length
        ? [{ kind: 'event', event: { type: 'user', message: { content: [{ type: 'tool_result', content: out }] } } }]
        : [];
    }

    return []; // queue snapshots and anything unmapped
  },
};

/** Build a Claude-shaped streaming text delta (feeds the client's live preview). */
function textDelta(text: string): AgentSignal {
  return {
    kind: 'event',
    event: { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } },
  };
}

// ---------------------------------------------------------------------------
// Codex — OpenAI's CLI agent. Unlike Claude/Roo, `codex exec` is one-shot per
// process: it runs a single turn and exits, and a follow-up is a fresh
// `codex exec resume <thread_id>` process (lifecycle: 'perTurn'). The prompt
// rides in argv; the resumable session id is the `thread_id` Codex reports in
// its `thread.started` event (we can't pre-assign it). Codex self-configures
// its provider (ChatGPT login or API key in ~/.codex); the gateway passes none.
// Event/item shapes are from openai/codex sdk/typescript/src/{events,items}.ts.
// We run with approvals + sandbox bypassed for parity with Claude/Roo (which run
// fully unsandboxed); the same DASHTERM_AGENT_ALLOW_ROOT gate applies.
// ---------------------------------------------------------------------------

function codexErr(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message ?? 'codex error');
  }
  return String(error ?? 'codex error');
}

// Map one Codex thread item to client-facing signals. `completed` is false for
// item.started (used to announce a running command), true for item.completed.
function codexItemSignals(item: any, completed: boolean): AgentSignal[] {
  if (!item || typeof item !== 'object') return [];
  switch (item.type) {
    case 'agent_message':
      return completed && item.text
        ? [{ kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'text', text: item.text }] } } }]
        : [];
    case 'command_execution':
      if (!completed) {
        return item.command
          ? [{ kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'execute_command', input: { command: item.command } }] } } }]
          : [];
      }
      return typeof item.aggregated_output === 'string' && item.aggregated_output.length
        ? [{ kind: 'event', event: { type: 'user', message: { content: [{ type: 'tool_result', content: item.aggregated_output }] } } }]
        : [];
    case 'file_change': {
      if (!completed) return [];
      const summary = Array.isArray(item.changes)
        ? item.changes.map((c: any) => `${c.kind} ${c.path}`).join(', ')
        : '';
      return [{ kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'apply_patch', input: { summary } }] } } }];
    }
    case 'mcp_tool_call':
      return completed
        ? [{ kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'tool_use', name: `${item.server}/${item.tool}`, input: item.arguments }] } } }]
        : [];
    case 'web_search':
      return completed
        ? [{ kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'web_search', input: { query: item.query } }] } } }]
        : [];
    case 'error':
      return completed && item.message ? [{ kind: 'error', error: String(item.message) }] : [];
    // reasoning + todo_list are intentionally dropped to keep the log readable.
    default:
      return [];
  }
}

const codexProfile: AgentProfile = {
  id: 'codex',
  label: 'Codex',
  lifecycle: 'perTurn',
  needsRootSandbox: false,
  bin: (config) => config.codexBin,
  prepareWorkspace(dir, systemPrompt) {
    // Codex reads AGENTS.md natively — drop the authoring contract there so it
    // applies to every turn (including resumes); buildPerTurnArgs additionally
    // prepends it to a fresh thread's first prompt for guaranteed delivery.
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), systemPrompt);
    } catch {
      /* best-effort — the fresh-thread prepend still delivers the contract */
    }
  },
  buildPerTurnArgs(plan, turn) {
    const isResume = !!plan.resumeId;
    const userText = turn.text || 'Please continue.';
    const prompt = isResume
      ? userText
      : `${turn.systemPrompt}\n\n----- BEGIN USER REQUEST -----\n\n${userText}`;
    const head = isResume ? ['exec', 'resume', plan.resumeId as string] : ['exec'];
    return [
      ...head,
      '--json',
      // Parity with Claude/Roo (fully unsandboxed); gated by DASHTERM_AGENT_ALLOW_ROOT.
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-C',
      plan.workspaceDir,
      prompt,
    ];
  },
  normalizeEvent(event, ctx) {
    const t = event?.type;
    if (t === 'thread.started') {
      void ctx;
      return event.thread_id
        ? [
            { kind: 'session', sessionId: event.thread_id },
            { kind: 'event', event: { type: 'system', subtype: 'init', session_id: event.thread_id } },
          ]
        : [];
    }
    if (t === 'turn.completed') return [{ kind: 'turn_end', isError: false }];
    if (t === 'turn.failed') return [{ kind: 'error', error: codexErr(event.error) }, { kind: 'turn_end', isError: true }];
    if (t === 'error') return [{ kind: 'error', error: String(event.message || 'codex error') }, { kind: 'turn_end', isError: true }];
    if (t === 'item.started') return codexItemSignals(event.item, false);
    if (t === 'item.completed') return codexItemSignals(event.item, true);
    // turn.started, item.updated (full snapshots; no stateless delta) → ignore.
    return [];
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROFILES: Record<AgentId, AgentProfile> = {
  claude: claudeProfile,
  roo: rooProfile,
  codex: codexProfile,
};

/** All agents the operator has turned on, in display order. */
export function availableAgents(config: GatewayConfig): AgentInfo[] {
  const all: AgentInfo[] = [
    { id: 'claude', label: claudeProfile.label, enabled: config.agentEnabled },
    { id: 'roo', label: rooProfile.label, enabled: config.agentEnabled && config.rooEnabled },
    { id: 'codex', label: codexProfile.label, enabled: config.agentEnabled && config.codexEnabled },
  ];
  return all.filter((a) => a.enabled);
}

export function isAgentEnabled(config: GatewayConfig, id: string): boolean {
  return availableAgents(config).some((a) => a.id === id);
}

/** Resolve an agent id to its profile, defaulting to Claude. */
export function getProfile(id: string): AgentProfile {
  return PROFILES[id as AgentId] ?? claudeProfile;
}
