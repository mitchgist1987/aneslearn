-- Stage A (non-breaking): foundation for real per-resident logins via Supabase Auth.
-- Adds a profiles table (auth user -> resident row + role) and private helper functions.
-- Nothing in the live site reads these yet, so this is safe to apply before the new frontend ships.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  resident_id text unique,
  role        text not null default 'resident' check (role in ('resident','admin')),
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helpers live in a schema PostgREST does not expose, so they cannot be called as /rpc endpoints.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = (select auth.uid()) and role = 'admin');
$$;
create or replace function private.my_resident() returns text
language sql stable security definer set search_path = '' as $$
  select resident_id from public.profiles where user_id = (select auth.uid());
$$;
revoke all on function private.is_admin(), private.my_resident() from public, anon;
grant execute on function private.is_admin(), private.my_resident() to authenticated;

-- Clients may read their own profile (admins read all). Only the admin edge function (service role) writes.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
