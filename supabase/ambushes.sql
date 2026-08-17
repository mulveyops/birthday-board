-- Ambushes: two allied teams escrow coins to trap a spot; a third team landing
-- there springs it → 2v1 physical showdown. Win: pot back + steal from victim.
-- Lose: victim takes the pot. One active trap per spot (partial unique index).
-- Run once in the SQL editor.

create table if not exists public.ambushes (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  spot_id     text not null,
  initiator   uuid not null references public.teams(id) on delete cascade,
  ally        uuid not null references public.teams(id) on delete cascade,
  victim      uuid references public.teams(id) on delete cascade,
  status      text not null default 'proposed',  -- proposed|armed|sprung|won|lost|cancelled
  created_at  timestamptz not null default now(),
  sprung_at   timestamptz
);
create unique index if not exists ambush_one_active_per_spot
  on public.ambushes(game_id, spot_id) where status in ('proposed','armed','sprung');
create index if not exists ambushes_game_idx on public.ambushes(game_id);

alter publication supabase_realtime add table public.ambushes;
alter table public.ambushes enable row level security;
drop policy if exists open_all on public.ambushes;
create policy open_all on public.ambushes for all to anon, authenticated using (true) with check (true);
