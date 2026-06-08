/**
 * Gemini adapter. Raw fetch against generativelanguage.googleapis.com
 * — we deliberately don't pull @google/generative-ai back in; the SDK
 * adds a couple MB to the gateway for one POST shape we can hand-write.
 *
 * Wire format quirks vs OpenAI:
 *   - Endpoint embeds the model: /v1beta/models/{model}:generateContent
 *   - Auth via ?key= query param, not Bearer header
 *   - System prompt is `systemInstruction` (object with parts[])
 *   - Messages are `contents`; role 'assistant' → 'model'
 *   - Tools as `functionDeclarations`; tool_calls → `functionCall` parts
 *   - Tool results → `functionResponse` parts inside a 'user' role turn
 */

import type {
  AdapterContext,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderAdapter,
} from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiTextPart { text: string }
interface GeminiFunctionCall { name: string; args: Record<string, unknown> }
interface GeminiFunctionResponse { name: string; response: { content: string } }
interface GeminiFunctionCallPart { functionCall: GeminiFunctionCall }
interface GeminiFunctionResponsePart { functionResponse: GeminiFunctionResponse }
type GeminiPart = GeminiTextPart | GeminiFunctionCallPart | GeminiFunctionResponsePart;

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates: {
    content: GeminiContent;
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  }[];
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  modelVersion?: string;
}

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
}

function toGemini(messages: ChatMessage[]): { system: string; contents: GeminiContent[] } {
  let system = '';
  const contents: GeminiContent[] = [];
  // Gemini wants every tool_use+tool_result pair attached to its adjacent
  // turn. We assemble contents by walking messages in order.
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'system') {
      const t = flattenContent(m.content);
      system = system ? `${system}\n\n${t}` : t;
      i++;
      continue;
    }
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.name ?? m.toolCallId ?? 'tool',
              response: { content: flattenContent(m.content) },
            },
          },
        ],
      });
      i++;
      continue;
    }
    if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      const text = flattenContent(m.content);
      if (text) parts.push({ text });
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
      }
      contents.push({ role: 'model', parts });
      i++;
      continue;
    }
    contents.push({ role: 'user', parts: [{ text: flattenContent(m.content) }] });
    i++;
  }
  return { system, contents };
}

function fromGemini(resp: GeminiResponse, providerName: string, model: string): ChatResponse {
  const cand = resp.candidates?.[0];
  if (!cand) {
    return {
      message: { role: 'assistant', content: '' },
      finishReason: 'error',
      servedBy: { provider: providerName, kind: 'gemini', model: resp.modelVersion ?? model },
    };
  }
  const parts = cand.content.parts;
  const textParts = parts.filter((p): p is GeminiTextPart => 'text' in p);
  const callParts = parts.filter((p): p is GeminiFunctionCallPart => 'functionCall' in p);
  return {
    message: {
      role: 'assistant',
      content: textParts.map((p) => p.text).join('\n') || undefined,
      toolCalls: callParts.length
        ? callParts.map((p, idx) => ({
            id: `call_${idx}_${Date.now()}`,
            name: p.functionCall.name,
            arguments: p.functionCall.args,
          }))
        : undefined,
    },
    finishReason:
      cand.finishReason === 'MAX_TOKENS' ? 'length'
      : callParts.length ? 'tool_calls'
      : 'stop',
    usage: resp.usageMetadata
      ? {
          inputTokens: resp.usageMetadata.promptTokenCount,
          outputTokens: resp.usageMetadata.candidatesTokenCount,
        }
      : undefined,
    servedBy: { provider: providerName, kind: 'gemini', model: resp.modelVersion ?? model },
  };
}

export const geminiAdapter: ProviderAdapter = {
  kind: 'gemini',
  async chat(req: ChatRequest, ctx: AdapterContext): Promise<ChatResponse> {
    if (!ctx.apiKey) throw new Error('gemini provider has no api_key configured');
    const { system, contents } = toGemini(req.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
      if (req.toolChoice && req.toolChoice !== 'auto') {
        body.toolConfig = {
          functionCallingConfig:
            req.toolChoice === 'none'
              ? { mode: 'NONE' }
              : { mode: 'ANY', allowedFunctionNames: [req.toolChoice.name] },
        };
      }
    }
    const url = `${ctx.baseUrl ?? DEFAULT_BASE}/models/${encodeURIComponent(ctx.model)}:generateContent?key=${encodeURIComponent(ctx.apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`gemini HTTP ${r.status}: ${text.slice(0, 500)}`);
    }
    return fromGemini((await r.json()) as GeminiResponse, ctx.providerName, ctx.model);
  },
};
