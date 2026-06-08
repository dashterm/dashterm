/**
 * Anthropic adapter. Speaks OpenAI-shape on the in/out boundary,
 * translates to the /v1/messages wire format internally.
 *
 * Key shape differences from OpenAI:
 *   - System prompt is a top-level `system` field, not a message
 *   - Content blocks are typed objects (text / tool_use / tool_result)
 *   - Tool definitions use `input_schema` instead of `parameters`
 *   - Tool responses come back as separate content blocks rather than a
 *     dedicated tool_calls field
 */

import type {
  AdapterContext,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ProviderAdapter,
} from './types';

const DEFAULT_BASE = 'https://api.anthropic.com/v1';

interface AnthropicTextBlock { type: 'text'; text: string }
interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  usage: { input_tokens: number; output_tokens: number };
}

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
}

function toAnthropic(messages: ChatMessage[]): { system: string; msgs: AnthropicMessage[] } {
  let system = '';
  const msgs: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text = flattenContent(m.content);
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }
    if (m.role === 'tool') {
      // OpenAI's 'tool' message → Anthropic 'user' message with a
      // tool_result block. tool_use_id ties it to the matching tool_use
      // in the prior assistant turn.
      msgs.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: flattenContent(m.content),
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant') {
      // Combine text + any tool calls into a single assistant turn.
      const blocks: AnthropicContentBlock[] = [];
      const text = flattenContent(m.content);
      if (text) blocks.push({ type: 'text', text });
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
      }
      msgs.push({
        role: 'assistant',
        content: blocks.length === 1 && blocks[0].type === 'text'
          ? blocks[0].text  // collapse for cheaper tokenisation
          : blocks,
      });
      continue;
    }
    // user
    msgs.push({ role: 'user', content: flattenContent(m.content) });
  }
  return { system, msgs };
}

function fromAnthropic(resp: AnthropicResponse): ChatResponse {
  const textBlocks = resp.content.filter((b): b is AnthropicTextBlock => b.type === 'text');
  const toolBlocks = resp.content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');
  const message: ChatMessage = {
    role: 'assistant',
    content: textBlocks.map((b) => b.text).join('\n') || undefined,
    toolCalls: toolBlocks.length
      ? toolBlocks.map<ChatToolCall>((b) => ({ id: b.id, name: b.name, arguments: b.input }))
      : undefined,
  };
  return {
    message,
    finishReason: resp.stop_reason === 'tool_use' ? 'tool_calls'
      : resp.stop_reason === 'max_tokens' ? 'length'
      : 'stop',
    usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
    servedBy: { provider: '', kind: 'anthropic', model: resp.model },
  };
}

export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  async chat(req: ChatRequest, ctx: AdapterContext): Promise<ChatResponse> {
    if (!ctx.apiKey) throw new Error('anthropic provider has no api_key configured');
    const { system, msgs } = toAnthropic(req.messages);
    const body: Record<string, unknown> = {
      model: ctx.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: msgs,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (req.toolChoice === 'auto' || !req.toolChoice) {
        body.tool_choice = { type: 'auto' };
      } else if (req.toolChoice === 'none') {
        body.tool_choice = { type: 'none' };
      } else if (typeof req.toolChoice === 'object') {
        body.tool_choice = { type: 'tool', name: req.toolChoice.name };
      }
    }
    const url = `${ctx.baseUrl ?? DEFAULT_BASE}/messages`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ctx.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`anthropic HTTP ${r.status}: ${text.slice(0, 500)}`);
    }
    const data = (await r.json()) as AnthropicResponse;
    const out = fromAnthropic(data);
    out.servedBy = { ...out.servedBy, provider: ctx.providerName };
    return out;
  },
};
