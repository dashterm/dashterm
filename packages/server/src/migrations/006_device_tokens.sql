-- Push device tokens for the native app.
--
-- The native DashTerm shell registers its Expo push token here (via
-- POST /api/devices, through the WebView's authenticated session) so the
-- gateway can deliver push notifications to the user's phone — e.g. when a
-- vibe-coded app's backend calls ctx.notify(...).
--
-- Scoped per user: device_tokens.user_id → users.id, cascade-deleted with the
-- account. `unique(user_id, token)` makes register an idempotent upsert and
-- lets one physical device serve more than one account.

create table if not exists device_tokens (
  id         text primary key,         -- uuid
  user_id    text not null references users(id) on delete cascade,
  token      text not null,            -- ExponentPushToken[...]
  platform   text not null default '', -- 'ios' | 'android' | ''
  created_at integer not null,
  updated_at integer not null,
  unique(user_id, token)
);

create index if not exists device_tokens_user_idx on device_tokens (user_id);
