-- Admin role: the operator's account, seeded by `dashterm homehub up` on
-- first run. Admins can list + delete other users from the User Management
-- app in the dashboard. Normal users only see their own row, same as before.
--
-- Supabase has no built-in admin concept — we layer it on as a column on
-- public.profiles. JWT-included alternatives exist (raw_app_meta_data or
-- the custom_access_token_hook), but a profile column reads cleanly in RLS
-- and is easier to grant/revoke via SQL or PostgREST.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Cheap predicate the RLS policies below use. Marked stable + SECURITY
-- DEFINER so it doesn't re-evaluate per-row and so it can see the row even
-- when the calling user can't (i.e., during the very check we're making).
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.current_user_is_admin() to anon, authenticated, service_role;

-- Admin RLS on profiles: admins can SELECT/UPDATE/DELETE any row, on top of
-- the existing self-only policies from 001_init.sql. Normal users are
-- unaffected.
drop policy if exists "profiles admin select" on public.profiles;
create policy "profiles admin select" on public.profiles
  for select using (public.current_user_is_admin());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
  for update using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "profiles admin delete" on public.profiles;
create policy "profiles admin delete" on public.profiles
  for delete using (public.current_user_is_admin());

-- Admins can also list app_state rows (read-only for audit / "see what
-- another user has in their workspace if they ask for help"). We don't add
-- INSERT/UPDATE/DELETE — admins shouldn't be silently editing user state.
drop policy if exists "app_state admin select" on public.app_state;
create policy "app_state admin select" on public.app_state
  for select using (public.current_user_is_admin());

-- Same idea on apps — admins can see all apps regardless of visibility,
-- useful for moderation. Owner-write/delete policies still hold.
drop policy if exists "apps admin select" on public.apps;
create policy "apps admin select" on public.apps
  for select using (public.current_user_is_admin());

-- Auto-provision a profile row whenever GoTrue creates a new auth.users
-- entry. Without this, the dashboard would 404 on every newly-created
-- user until they manually upserted their own profile. The trigger runs
-- as the function owner (postgres) so it bypasses RLS on profiles.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_name text;
begin
  -- Display name: full_name from user_metadata, then the email's local part,
  -- then a placeholder. Operator can change it later.
  default_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    split_part(coalesce(new.email, ''), '@', 1),
    'User'
  );

  insert into public.profiles (id, email, display_name, last_active)
  values (new.id, new.email, default_name, now())
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Admin-only user deletion. The dashboard can't hold the SERVICE_ROLE_KEY
-- safely, so we expose a SECURITY DEFINER function that an authenticated
-- admin can call via PostgREST RPC. It deletes from auth.users; the
-- profile + app_state rows cascade-delete via their FKs.
create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'permission denied: caller is not admin';
  end if;
  if target_id = auth.uid() then
    raise exception 'cannot delete your own account';
  end if;
  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Notify PostgREST so the schema cache picks up the new column + function.
notify pgrst, 'reload schema';
