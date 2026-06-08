-- Initial schema for the native (non-Docker) install.
--
-- One sqlite file lives at DASHTERM_DATA_DIR/state.db (default
-- ~/.dashterm/state.db). better-sqlite3 holds an exclusive write lock
-- but allows concurrent readers; for a single-gateway-process install
-- that's all we need.
--
-- WAL mode is enabled at runtime in db.ts so reads don't block writes.

create table if not exists users (
  id                    text primary key,         -- uuidv4
  email                 text not null unique,
  password_hash         text not null,             -- argon2id encoded string
  display_name          text not null default '',
  is_admin              integer not null default 0,
  must_reset_password   integer not null default 0,
  metadata              text not null default '{}',
  created_at            integer not null,
  last_active           integer not null
);

-- One row per user. State is a JSON blob so vibe-coded apps can store
-- whatever shape they want without us evolving columns. The web app
-- snapshots this on every change.
create table if not exists app_state (
  user_id      text primary key references users(id) on delete cascade,
  state        text not null default '{}',
  last_updated integer not null
);

-- Shared vibe-coded apps. Visible to anyone with the share code.
create table if not exists apps (
  id              text primary key,                   -- 5-char share code
  name            text not null,
  description     text not null default '',
  code            text not null,
  compiled_code   text,
  functions       text not null default '[]',         -- json array
  queryable_data  text not null default '[]',         -- json array
  owner_id        text not null references users(id) on delete cascade,
  owner_name      text not null,
  visibility      text not null default 'private',    -- 'private'|'unlisted'|'public'
  category        text,
  version         integer not null default 1,
  created_at      integer not null,
  updated_at      integer not null
);

create index if not exists apps_owner_idx on apps(owner_id);
create index if not exists apps_updated_idx on apps(updated_at desc);
