-- Per-user variables (non-secret config).
--
-- The sibling to `secrets` with the OPPOSITE disclosure rule: a variable is
-- non-sensitive configuration (a base URL, a hostname, a username, a default
-- profile name) that the owner WANTS to read back and edit later. Unlike a
-- secret, GET /api/vars returns the value. Apps read them on the frontend via
-- dashterm.vars / on the backend via ctx.vars, and reference them in proxied
-- requests with `{{var.NAME}}` placeholders (resolved alongside {{secret.NAME}}
-- by POST /api/secrets/proxy).
--
-- Scoped per user: variables.user_id → users.id, cascade-deleted with the
-- account. `unique(user_id, name)` makes PUT /api/vars/:name an upsert.

create table if not exists variables (
  id         text primary key,         -- uuid
  user_id    text not null references users(id) on delete cascade,
  name       text not null,            -- e.g. 'SONARR_URL'
  value      text not null,            -- returned to the owner (non-secret)
  created_at integer not null,
  updated_at integer not null,
  unique(user_id, name)
);

create index if not exists variables_user_idx on variables (user_id);
