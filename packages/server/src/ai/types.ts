/**
 * Wire format for the AI proxy — internally we speak OpenAI-shape
 * because it has the broadest adapter coverage, and translate to
 * provider-specific wire formats inside each adapter. Clients that
 * already know one provider's shape (e.g. supabase-js code that
 * hand-rolled Gemini parts) should rewrite to this shape rather than
 * teaching the proxy a second dialect.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  // Plain string for the simple case; structured content for vision /
  // tool-result payloads. Adapters can flatten back to string when the
  // provider doesn't accept arrays.
  content?: string | ChatContentPart[];
  // Assistant messages that decided to call a tool surface their calls
  // here; user code echoes them back with a matching 'tool' role message.
  toolCalls?: ChatToolCall[];
  // Required on role='tool' messages; lines up the response with the
  // assistant's tool_calls[].id.
  toolCallId?: string;
  // Optional human name on assistant / tool messages — Anthropic ignores;
  // OpenAI surfaces in some flows.
  name?: string;
}

export interface ChatContentPart {
  type: 'text' | 'image';
  text?: string;
  imageUrl?: string;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  // Opaque per-provider round-trip state captured from the model's response
  // and replayed verbatim on the next turn. Adapters populate and consume
  // this; the proxy and app authors never touch it. Gemini 2.5+/3.x stash
  // a `thoughtSignature` here (required, or multi-step tool calls 400). The
  // bag is deliberately provider-agnostic so Anthropic (thinking-block
  // signatures, when extended thinking is enabled) can reuse the same path.
  providerData?: Record<string, unknown>;
}

export interface ChatToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ChatRequest {
  // Optional model override; falls back to the provider's default_model.
  model?: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: 'auto' | 'none' | { name: string };
  temperature?: number;
  maxTokens?: number;
  // Which app is asking. Used to look up the per-app provider binding;
  // if absent, falls back to the default provider.
  appId?: string;
}

export interface ChatResponse {
  message: ChatMessage; // role='assistant'
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  // Provider name + model that actually answered. Helps debugging and
  // surfaces in the UI.
  servedBy: { provider: string; kind: string; model: string };
}

export interface ProviderRow {
  id: string;
  name: string;
  kind: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  default_model: string;
  api_key: string | null;
  base_url: string | null;
  is_default: number; // 0|1
  created_at: number;
}

export interface ProviderAdapter {
  kind: ProviderRow['kind'];
  chat(req: ChatRequest, ctx: AdapterContext): Promise<ChatResponse>;
}

export interface AdapterContext {
  // The model to use — either the request's override or the provider's
  // default_model. Adapter doesn't have to re-resolve.
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  providerName: string;
}

// Public-shape view of a provider — same row minus secrets. Used by
// /api/ai/providers (GET) and by the CLI's list command.
export interface ProviderSummary {
  id: string;
  name: string;
  kind: ProviderRow['kind'];
  defaultModel: string;
  baseUrl: string | null;
  isDefault: boolean;
  hasApiKey: boolean;
  createdAt: number;
}
