/**
 * Server-side tool/agent loop — the primitive behind `ctx.ai.run`.
 *
 * `/api/ai/chat` (and `ctx.ai.chat`) are single-shot: the caller is left to
 * re-implement call → finishReason==='tool_calls' → execute calls → append
 * assistant+tool messages → repeat, plus every provider's round-trip quirk.
 * This owns that loop ONCE: an app supplies tool *handlers*, not plumbing, and
 * tool execution stays server-side with the owner's full `ctx`.
 *
 * Because the loop owns both sides of the round-trip it makes the adapter
 * quirks invisible: it echoes each assistant turn back verbatim (carrying
 * ChatToolCall.providerData — e.g. Gemini's thoughtSignature) and stamps every
 * tool result with `toolCallId` AND `name`, so each adapter can line results
 * up regardless of how it matches them.
 *
 * Single-shot for now: returns only the final {reply, steps}. Streaming
 * per-step back to the frontend is a future addition on the same shape.
 */
import { adapterFor, resolveProvider } from './registry';
import type { AdapterContext, ChatMessage, ChatRequest, ChatToolDef, ProviderAdapter } from './types';

export interface AiLoopTool {
  def: ChatToolDef;
  /** Runs server-side with the owner's ctx; its return value is fed back to
   *  the model as the tool result. A thrown error is caught and reported as a
   *  failed step (the model sees the message and can recover or explain). */
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface AiLoopOptions {
  /** Prepended as a leading system message; adapters fold it into their slot. */
  system?: string;
  messages: ChatMessage[];
  tools?: AiLoopTool[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Hard ceiling on model<->tool round-trips before we force a text reply. */
  maxSteps?: number;
  /** Which app is asking — selects the per-app provider binding. */
  appId?: string;
}

export interface AiLoopStep {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface AiLoopResult {
  reply: string;
  steps: AiLoopStep[];
  servedBy: { provider: string; kind: string; model: string };
  stoppedAt: 'stop' | 'length' | 'max_steps' | 'error';
}

const DEFAULT_MAX_STEPS = 8;

function flattenText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
}

export async function runAiLoop(opts: AiLoopOptions): Promise<AiLoopResult> {
  const providerRow = resolveProvider(opts.appId);
  const adapter = adapterFor(providerRow);
  const adapterCtx: AdapterContext = {
    model: opts.model || providerRow.default_model,
    apiKey: providerRow.api_key,
    baseUrl: providerRow.base_url,
    providerName: providerRow.name,
  };
  return driveAiLoop(adapter, adapterCtx, opts);
}

/**
 * The provider-agnostic loop, split out from provider resolution so it can be
 * driven against any adapter (real or a fake) without touching the db. This is
 * also the seam a headless `app invoke` self-test would drive.
 */
export async function driveAiLoop(
  adapter: Pick<ProviderAdapter, 'chat'>,
  adapterCtx: AdapterContext,
  opts: AiLoopOptions,
): Promise<AiLoopResult> {
  const toolByName = new Map((opts.tools ?? []).map((t) => [t.def.name, t]));
  const toolDefs = opts.tools?.length ? opts.tools.map((t) => t.def) : undefined;

  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push(...opts.messages);

  const baseReq: Omit<ChatRequest, 'messages'> = {
    tools: toolDefs,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  };

  const steps: AiLoopStep[] = [];
  const maxSteps = Math.max(1, opts.maxSteps ?? DEFAULT_MAX_STEPS);
  // Overwritten by the first adapter.chat call below (maxSteps >= 1), so this
  // placeholder is never the returned value — it only satisfies the type.
  let servedBy: AiLoopResult['servedBy'] = {
    provider: adapterCtx.providerName,
    kind: '',
    model: adapterCtx.model,
  };

  for (let step = 0; step < maxSteps; step++) {
    const res = await adapter.chat({ ...baseReq, messages }, adapterCtx);
    servedBy = res.servedBy;
    // Echo the assistant turn back verbatim — carries toolCalls + providerData
    // (e.g. Gemini thoughtSignature) so the next turn round-trips cleanly.
    messages.push(res.message);

    if (res.finishReason !== 'tool_calls' || !res.message.toolCalls?.length) {
      return {
        reply: flattenText(res.message.content),
        steps,
        servedBy,
        stoppedAt: res.finishReason === 'length' ? 'length' : res.finishReason === 'error' ? 'error' : 'stop',
      };
    }

    // Execute each requested call server-side, append a matching tool message
    // with name + toolCallId so every adapter lines the result up.
    for (const call of res.message.toolCalls) {
      const tool = toolByName.get(call.name);
      let ok = false;
      let result: unknown;
      if (!tool) {
        result = `error: no handler registered for tool "${call.name}"`;
      } else {
        try {
          result = await tool.handler(call.arguments);
          ok = true;
        } catch (err) {
          result = `error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      steps.push({ name: call.name, args: call.arguments, ok, result });
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: typeof result === 'string' ? result : JSON.stringify(result ?? null),
      });
    }
  }

  // Ran out of steps with the model still asking for tools. One final
  // text-only call (no tools offered) coaxes a closing reply instead of an
  // empty result or an unbounded loop.
  const final = await adapter.chat(
    { messages, temperature: opts.temperature, maxTokens: opts.maxTokens },
    adapterCtx,
  );
  return { reply: flattenText(final.message.content), steps, servedBy: final.servedBy, stoppedAt: 'max_steps' };
}
