#!/usr/bin/env bash
# Create the Supabase service roles + grant the right privileges.
#
# Versions of supabase/postgres earlier than 15.6.x bundled these in their
# own init, but the current image expects the operator to bootstrap them.
# This is the standard sequence from the official supabase docker-compose
# (volumes/db/init/99-roles.sql), with POSTGRES_PASSWORD reused for every
# service role.
#
# Runs ONCE on first DB init via /docker-entrypoint-initdb.d/.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Role identities (no login) referenced by RLS via JWT claims.
  do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon')
      then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated')
      then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role')
      then create role service_role nologin noinherit bypassrls; end if;
  end \$\$;

  -- Login roles that the services connect as.
  do \$\$ begin
    if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
      create role supabase_admin login superuser createdb createrole replication bypassrls password '$POSTGRES_PASSWORD';
    else
      alter role supabase_admin with password '$POSTGRES_PASSWORD' login;
    end if;

    if not exists (select 1 from pg_roles where rolname = 'authenticator') then
      create role authenticator login noinherit password '$POSTGRES_PASSWORD';
    else
      alter role authenticator with password '$POSTGRES_PASSWORD' login;
    end if;

    if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
      create role supabase_auth_admin login noinherit createrole password '$POSTGRES_PASSWORD';
    else
      alter role supabase_auth_admin with password '$POSTGRES_PASSWORD' login;
    end if;

    if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
      create role supabase_storage_admin login noinherit createrole password '$POSTGRES_PASSWORD';
    else
      alter role supabase_storage_admin with password '$POSTGRES_PASSWORD' login;
    end if;

    if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
      create role supabase_realtime_admin login replication password '$POSTGRES_PASSWORD';
    else
      alter role supabase_realtime_admin with password '$POSTGRES_PASSWORD' login;
    end if;
  end \$\$;

  -- Authenticator can become any of the role identities (this is how
  -- PostgREST + GoTrue's per-request role switch works).
  grant anon, authenticated, service_role to authenticator;

  -- Supabase admins can manage their respective namespaces.
  grant create on database "$POSTGRES_DB" to supabase_admin;
  grant create on database "$POSTGRES_DB" to supabase_auth_admin;
  grant create on database "$POSTGRES_DB" to supabase_storage_admin;
  grant create on database "$POSTGRES_DB" to supabase_realtime_admin;

  -- Default ownership / search path so GoTrue's own migrations land
  -- in the expected schema.
  alter user supabase_auth_admin set search_path = 'auth';

  -- Pre-create the service schemas. GoTrue / storage-api / realtime
  -- expect these to exist and to be owned by their respective service
  -- roles; without pre-creation, they fail with "no schema has been
  -- selected to create in (SQLSTATE 3F000)" because the service roles
  -- lack CREATE on public.
  create schema if not exists auth      authorization supabase_auth_admin;
  create schema if not exists storage   authorization supabase_storage_admin;
  create schema if not exists _realtime authorization supabase_realtime_admin;

  -- Realtime keeps a per-tenant config in _realtime; set the per-user
  -- search_path so its ecto migrations land there by default.
  alter user supabase_realtime_admin set search_path = '_realtime';
EOSQL

echo "[init] supabase service roles created"
