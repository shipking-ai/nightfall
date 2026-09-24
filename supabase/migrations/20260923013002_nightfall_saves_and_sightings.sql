-- Applied to Supabase project "nightfall" (ueypttzxedsbnbrsmena) on 2026-09-23.
-- Cloud copy of the save + "also recorded by N others".
-- No Supabase Auth: each browser holds a random token (the "save code");
-- only its SHA-256 is stored. Tables are closed (RLS on, no policies, no grants);
-- the browser can only call the four nf_* functions below.

create extension if not exists pgcrypto with schema extensions;

create table public.saves (
  token_hash bytea primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.sightings (
  token_hash bytea not null,
  entry_id text not null,
  found_at timestamptz not null default now(),
  primary key (token_hash, entry_id)
);
create index sightings_entry_idx on public.sightings (entry_id);

alter table public.saves enable row level security;
alter table public.sightings enable row level security;
revoke all on public.saves, public.sightings from anon, authenticated;

create function public.nf_hash(p_token uuid) returns bytea
language sql immutable set search_path = ''
as $$ select extensions.digest(p_token::text, 'sha256') $$;
revoke all on function public.nf_hash(uuid) from public, anon, authenticated;

create function public.nf_save_get(p_token uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$ select s.data from public.saves s where s.token_hash = public.nf_hash(p_token) $$;

create function public.nf_save_put(p_token uuid, p_data jsonb) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare ts timestamptz := now();
begin
  if p_token is null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'bad save';
  end if;
  if octet_length(p_data::text) > 32768 then
    raise exception 'save too large';
  end if;
  insert into public.saves (token_hash, data, updated_at)
  values (public.nf_hash(p_token), p_data, ts)
  on conflict (token_hash) do update set data = excluded.data, updated_at = ts;
  return ts;
end $$;

create function public.nf_sight(p_token uuid, p_entry text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare n bigint;
begin
  if p_token is null or p_entry !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'bad entry';
  end if;
  insert into public.sightings (token_hash, entry_id)
  values (public.nf_hash(p_token), p_entry)
  on conflict do nothing;
  select count(*) into n from public.sightings where entry_id = p_entry;
  return n;
end $$;

create function public.nf_sighting_counts() returns table (entry_id text, n bigint)
language sql stable security definer set search_path = ''
as $$ select s.entry_id, count(*) from public.sightings s group by s.entry_id $$;

revoke all on function public.nf_save_get(uuid), public.nf_save_put(uuid, jsonb),
  public.nf_sight(uuid, text), public.nf_sighting_counts() from public;
grant execute on function public.nf_save_get(uuid), public.nf_save_put(uuid, jsonb),
  public.nf_sight(uuid, text), public.nf_sighting_counts() to anon, authenticated;
