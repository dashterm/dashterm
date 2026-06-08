/**
 * Ollama adapter for locally-hosted models. Default base is
 * http://localhost:11434/api — override via providers.base_url when
 * the ollama daemon lives somewhere else.
 *
 * No api_key required.
 *
 * Tool calling: ollama's /api/chat supports OpenAI-shaped tools on
 * recent versions (0.1.35+). We hand the same body that the OpenAI
 * adapter would, minus the auth.
 */

import type {
  AdapterContext,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from './types';

const DEFAULT_BASE = 'http://localhost:11434/api';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: {
    function: { name: string; arguments: Record<string, unknown> };
  }[];
}

interface OllamaResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: 'stop' | 'length';
  prompt_eval_count?: number;
  eval_count?: number;
}

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
}

function toOllama(m: ChatMessage): OllamaMessage {
  const out: OllamaMessage = { role: m.role, content: flattenContent(m.content) };
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((tc) => ({
      function: { name: tc.name, arguments: tc.arguments },
    }));
  }
  return out;
}

export const ollamaAdapter: ProviderAdapter = {
  kind: 'ollama',
  async chat(req: ChatRequest, ctx: AdapterContext): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: req.messages.map(toOllama),
      stream: false,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.temperature !== undefined || req.maxTokens !== undefined) {
      body.options = {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { num_predict: req.maxTokens } : {}),
      };
    }
    const r = await fetch(`${ctx.baseUrl ?? DEFAULT_BASE}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`ollama HTTP ${r.status}: ${text.slice(0, 500)}`);
    }
    const data = (await r.json()) as OllamaResponse;
    const m = data.message;
    return {
      message: {
        role: 'assistant',
        content: m.content || undefined,
        toolCalls: m.tool_calls?.length
          ? m.tool_calls.map((tc, i) => ({
              id: `call_${i}_${Date.now()}`,
              name: tc.function.name,
              arguments: tc.function.arguments,
            }))
          : undefined,
      },
      finishReason: data.done_reason === 'length' ? 'length' : 'stop',
      usage:
        data.prompt_eval_count !== undefined || data.eval_count !== undefined
          ? { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 }
          : undefined,
      servedBy: { provider: ctx.providerName, kind: 'ollama', model: data.model },
    };
  },
};
