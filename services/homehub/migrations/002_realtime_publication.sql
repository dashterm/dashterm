-- Realtime publication for app_state + apps.
--
-- Realtime self-host seeds a tenant whose config references the
-- `supabase_realtime` publication, but it doesn't create the publication
-- itself — that's left to the operator. So this migration does both:
-- creates the publication if missing, then adds app_state + apps to it.
--
-- supabase_realtime watches WAL changes via Realtime's postgres_cdc_rls
-- extension. As long as wal_level=logical (set by supabase/postgres by
-- default), Realtime auto-creates the replication slot when it subscribes.
--
-- All steps are idempotent — re-running this migration is a no-op once
-- everything is wired up.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice 'created supabase_realtime publication';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state'
  ) then
    alter publication supabase_realtime add table public.app_state;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apps'
  ) then
    alter publication supabase_realtime add table public.apps;
  end if;
end $$;
