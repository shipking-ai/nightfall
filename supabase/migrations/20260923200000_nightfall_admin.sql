-- Applied to "nightfall" (ueypttzxedsbnbrsmena) on 2026-09-23 as nightfall_admin.
-- Admin tools: bans (by staff), a stats summary, and world notes (the content editor).

-- Ban / unban an account. Staff only; an admin can't be banned this way (demote first, in SQL).
create function public.nf_admin_ban(target uuid, "on" boolean default true) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.nf_is_staff() then raise exception 'not allowed'; end if;
  update public.profiles set banned = "on", updated_at = now() where id = target and role <> 'admin';
  return found;
end $$;
revoke all on function public.nf_admin_ban(uuid, boolean) from public, anon;
grant execute on function public.nf_admin_ban(uuid, boolean) to authenticated;

-- Staff: find an account by (part of) its display name, to ban or unban.
create function public.nf_admin_find(q text) returns table (id uuid, name text, role text, banned boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.nf_is_staff() then raise exception 'not allowed'; end if;
  return query select p.id, p.name, p.role, p.banned, p.created_at from public.profiles p
    where p.name ilike '%' || left(coalesce(q, ''), 24) || '%' order by p.created_at desc limit 25;
end $$;
revoke all on function public.nf_admin_find(text) from public, anon;
grant execute on function public.nf_admin_find(text) to authenticated;

-- Staff: the numbers.
create function public.nf_admin_stats() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.nf_is_staff() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'accounts', (select count(*) from public.profiles),
    'accounts_24h', (select count(*) from public.profiles where created_at > now() - interval '24 hours'),
    'banned', (select count(*) from public.profiles where banned),
    'staff', (select count(*) from public.profiles where role in ('admin', 'moderator')),
    'account_saves', (select count(*) from public.account_saves),
    'guest_saves', (select count(*) from public.saves),
    'active_24h', (select count(*) from public.account_saves where updated_at > now() - interval '24 hours')
      + (select count(*) from public.saves where updated_at > now() - interval '24 hours'),
    'notes', (select count(*) from public.world_notes)
  );
end $$;

-- Notes staff leave in the world: everyone can read them; only staff write.
create table public.world_notes (
  id uuid primary key default gen_random_uuid(),
  x real not null check (x between -2000 and 2000),
  y real not null default 0.15 check (y between -50 and 200),
  z real not null check (z between -2000 and 2000),
  title text not null default 'Notice' check (char_length(title) between 1 and 40),
  body text not null check (char_length(body) between 1 and 280),
  author uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.world_notes enable row level security;
create policy "world_notes: read" on public.world_notes for select to anon, authenticated using (true);
create policy "world_notes: staff insert" on public.world_notes for insert to authenticated with check ((select public.nf_is_staff()));
create policy "world_notes: staff delete" on public.world_notes for delete to authenticated using ((select public.nf_is_staff()));
revoke all on public.world_notes from anon, authenticated;
grant select on public.world_notes to anon, authenticated;
grant insert (x, y, z, title, body), delete on public.world_notes to authenticated;

revoke all on function public.nf_admin_stats() from public, anon;
grant execute on function public.nf_admin_stats() to authenticated;
