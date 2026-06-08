-- Per-user secrets (vault).
--
-- A secret is a named credential the user stores once and references from
-- their custom (vibe-coded) apps WITHOUT the raw value ever reaching the
-- browser. Apps send requests through POST /api/secrets/proxy with
-- `{{secret.NAME}}` placeholders; the gateway substitutes the value
-- server-side and performs the outbound call.
--
-- Scoped per user: secrets.user_id → users.id, cascade-deleted with the
-- account. `unique(user_id, name)` makes PUT /api/secrets/:name an upsert.
-- The value is stored as-is (the sqlite file already lives in the user's
-- 0700 data dir); it is never returned by any read endpoint.

create table if not exists secrets (
  id         text primary key,         -- uuid
  user_id    text not null references users(id) on delete cascade,
  name       text not null,            -- e.g. 'WEATHER_KEY'
  value      text not null,            -- never serialized back to clients
  created_at integer not null,
  updated_at integer not null,
  unique(user_id, name)
);

create index if not exists secrets_user_idx on secrets (user_id);
