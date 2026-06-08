-- DashTerm homehub — initial schema
--
-- Maps onto the AppState shape that survived Phase 2:
--   profiles  ← UserProfile (one row per auth.users)
--   app_state ← AppState   (one row per user; one JSONB column)
--   apps      ← CustomApp  (shared catalog, owner-write, RLS-readable)
--
-- RLS mirrors the old database.rules.json:
--   users/$uid → self read/write     → app_state + profiles policies
--   apps/$code → owner write, auth read → apps policies
--
-- Realtime is enabled on app_state + apps via supabase_realtime publication.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  photo_url    text,
  created_at   timestamptz not null default now(),
  last_active  timestamptz not null default now()
);

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 5-char shareCode is the natural primary key (the natural primary key shape)
create table if not exists public.apps (
  id             text primary key,
  name           text not null,
  description    text,
  code           text not null,
  compiled_code  text,
  functions      jsonb,
  queryable_data jsonb,
  owner_id       uuid references auth.users(id) on delete cascade,
  owner_name     text,
  visibility     text not null default 'private'
                 check (visibility in ('private', 'unlisted', 'public')),
  category       text,
  version        int  not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists apps_owner_id_idx     on public.apps (owner_id);
create index if not exists apps_visibility_idx   on public.apps (visibility);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles  enable row level security;
alter table public.app_state enable row level security;
alter table public.apps      enable row level security;

-- profiles: each user reads/writes their own row
drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles self upsert" on public.profiles;
create policy "profiles self upsert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- app_state: each user reads/writes their own row
drop policy if exists "app_state self select" on public.app_state;
create policy "app_state self select" on public.app_state
  for select using (auth.uid() = user_id);

drop policy if exists "app_state self upsert" on public.app_state;
create policy "app_state self upsert" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "app_state self update" on public.app_state;
create policy "app_state self update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- apps: owner can write, anyone authenticated can read non-private,
-- the owner can always read their own private apps.
drop policy if exists "apps read" on public.apps;
create policy "apps read" on public.apps
  for select using (
    visibility in ('public', 'unlisted')
    or owner_id = auth.uid()
  );

drop policy if exists "apps owner insert" on public.apps;
create policy "apps owner insert" on public.apps
  for insert with check (auth.uid() = owner_id);

drop policy if exists "apps owner update" on public.apps;
create policy "apps owner update" on public.apps
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "apps owner delete" on public.apps;
create policy "apps owner delete" on public.apps
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- Grants — PostgREST connects as `authenticator` and switches role to
-- `anon` / `authenticated` / `service_role` per request based on the JWT.
-- Without explicit GRANT on each table, PostgREST returns 401 "permission
-- denied" BEFORE RLS even gets a chance to filter (RLS only applies on top
-- of an existing privilege). Granting all-tables and ALL-future-tables in
-- public to the role identities means new tables added by later migrations
-- are reachable automatically.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant all on table public.profiles  to anon, authenticated, service_role;
grant all on table public.app_state to anon, authenticated, service_role;
grant all on table public.apps      to anon, authenticated, service_role;

-- Future-proofing: any table the postgres superuser creates in public
-- (i.e., via future migrations) gets the same grants.
alter default privileges for role postgres in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- Realtime publication membership lives in 002_realtime_publication.sql —
-- it requires the supabase_realtime publication, which doesn't exist until
-- the realtime container has booted. Keeping it here in 001 means the
-- migrate ledger would mark it applied before the publication is around to
-- be modified, and the subscriptions would never light up.

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_state_touch on public.app_state;
create trigger app_state_touch
  before update on public.app_state
  for each row execute function public.touch_updated_at();

drop trigger if exists apps_touch on public.apps;
create trigger apps_touch
  before update on public.apps
  for each row execute function public.touch_updated_at();
