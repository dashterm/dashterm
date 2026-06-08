/**
 * OpenAI adapter. Since the proxy speaks OpenAI-shape natively, this
 * adapter is mostly a pass-through with role/tool field translation
 * to the actual /v1/chat/completions wire format.
 *
 * Works against any OpenAI-compatible endpoint via `base_url` —
 * Together, Groq, OpenRouter, vLLM, all answer the same shape.
 */

import type {
  AdapterContext,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from './types';

const DEFAULT_BASE = 'https://api.openai.com/v1';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAiResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: OpenAiMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
}

function toOpenAi(m: ChatMessage): OpenAiMessage {
  const out: OpenAiMessage = { role: m.role, content: flattenContent(m.content) || null };
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  if (m.name) out.name = m.name;
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  return out;
}

function fromOpenAi(resp: OpenAiResponse, providerName: string): ChatResponse {
  const choice = resp.choices[0];
  const m = choice.message;
  const message: ChatMessage = {
    role: 'assistant',
    content: m.content ?? undefined,
    toolCalls: m.tool_calls?.length
      ? m.tool_calls.map((tc) => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            /* leave empty on malformed args */
          }
          return { id: tc.id, name: tc.function.name, arguments: parsed };
        })
      : undefined,
  };
  return {
    message,
    finishReason:
      choice.finish_reason === 'length' ? 'length'
      : choice.finish_reason === 'tool_calls' ? 'tool_calls'
      : 'stop',
    usage: resp.usage
      ? { inputTokens: resp.usage.prompt_tokens, outputTokens: resp.usage.completion_tokens }
      : undefined,
    servedBy: { provider: providerName, kind: 'openai', model: resp.model },
  };
}

export const openaiAdapter: ProviderAdapter = {
  kind: 'openai',
  async chat(req: ChatRequest, ctx: AdapterContext): Promise<ChatResponse> {
    if (!ctx.apiKey) throw new Error('openai provider has no api_key configured');
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: req.messages.map(toOpenAi),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (req.toolChoice === 'auto' || !req.toolChoice) body.tool_choice = 'auto';
      else if (req.toolChoice === 'none') body.tool_choice = 'none';
      else if (typeof req.toolChoice === 'object') {
        body.tool_choice = { type: 'function', function: { name: req.toolChoice.name } };
      }
    }
    const url = `${ctx.baseUrl ?? DEFAULT_BASE}/chat/completions`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`openai HTTP ${r.status}: ${text.slice(0, 500)}`);
    }
    return fromOpenAi((await r.json()) as OpenAiResponse, ctx.providerName);
  },
};
