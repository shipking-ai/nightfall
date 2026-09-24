-- Applied to "nightfall" (ueypttzxedsbnbrsmena) on 2026-09-23 as nightfall_accounts.
-- Accounts: one profile per auth user (name, look, role, banned) plus their save.
-- Players can update only name/look (column grants); role/banned are staff/SQL only.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Passer-by' check (char_length(name) between 1 and 24),
  look jsonb not null default '{}'::jsonb check (octet_length(look::text) <= 4096),
  role text not null default 'player' check (role in ('player', 'moderator', 'admin')),
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: read own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, look, updated_at) on public.profiles to authenticated;

create function public.nf_new_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Passer-by'), 24));
  return new;
end $$;
revoke all on function public.nf_new_profile() from public, anon, authenticated;
create trigger nf_on_signup after insert on auth.users
  for each row execute function public.nf_new_profile();

create table public.account_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 32768),
  updated_at timestamptz not null default now()
);
alter table public.account_saves enable row level security;
create policy "account_saves: own" on public.account_saves for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.account_saves from anon, authenticated;
grant select, insert, update on public.account_saves to authenticated;

create function public.nf_is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin', 'moderator') and not p.banned) $$;
revoke all on function public.nf_is_staff() from public, anon;
grant execute on function public.nf_is_staff() to authenticated;
create policy "profiles: staff read all" on public.profiles for select to authenticated
  using ((select public.nf_is_staff()));
