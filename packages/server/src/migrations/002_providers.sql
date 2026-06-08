-- AI provider registry + per-app routing.
--
-- providers: each row is one configured backend (an Anthropic key + claude
--   model, an OpenAI key + gpt model, a local ollama URL, etc.). Users can
--   register multiple of the same `kind` — e.g. "claude-pro" pointing at a
--   personal key and "claude-team" pointing at a workspace key.
-- app_provider_bindings: optional override mapping a registered app to a
--   specific provider. Apps without a binding fall back to whichever
--   provider has is_default=1.
--
-- The CLI surface (dashterm provider add/list/remove/set-default/bind)
-- is the canonical way to populate these; the dashboard's settings UI
-- reads through /api/ai/providers and writes via the same RPCs.

create table if not exists providers (
  id              text primary key,         -- uuid
  name            text not null unique,     -- friendly handle
  kind            text not null,            -- 'anthropic'|'openai'|'gemini'|'ollama'
  default_model   text not null,            -- e.g. 'claude-haiku-4-5'
  api_key         text,                     -- nullable for local providers
  base_url        text,                     -- override (OpenAI-compatible / ollama)
  is_default      integer not null default 0,
  created_at      integer not null
);

-- Enforces "at most one row with is_default=1" without a trigger. Sqlite
-- partial indexes are honoured for uniqueness.
create unique index if not exists providers_default_idx
  on providers (is_default)
  where is_default = 1;

create table if not exists app_provider_bindings (
  app_id       text primary key,
  provider_id  text not null references providers(id) on delete cascade
);
