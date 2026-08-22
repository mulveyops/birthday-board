-- Side quests. One per team at a time — a quest doesn't freeze you out of the
-- game, it just occupies the slot, so you keep playing while it runs.
--
-- TAG is the first: you're given a rival to hunt, you find them from their last
-- check-in on the map, and you have to check in where they check in within a
-- couple of minutes of them doing it. They are NOT told. If the clock runs out
-- they get a smaller purse for having evaded you without ever knowing.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.quests (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  kind         text not null check (kind in ('tag', 'explorer', 'ambush', 'recon', 'wanted')),
  -- who you're hunting (tag), or where you're headed (explorer)
  target_team  uuid references public.teams(id) on delete set null,
  target_spot  text,
  -- the space that offered it, so the same space can't offer twice
  from_spot    text,
  status       text not null default 'active' check (status in ('active', 'done', 'failed')),
  reward       integer not null default 0,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists quests_game_idx on public.quests(game_id, status);
-- The slot: one running quest per team. Everything else is a normal play.
create unique index if not exists quests_one_active
  on public.quests(game_id, team_id) where status = 'active';

do $$
begin
  alter publication supabase_realtime add table public.quests;
exception when duplicate_object then null;
end $$;

alter table public.quests enable row level security;
drop policy if exists open_all on public.quests;
create policy open_all on public.quests for all to anon, authenticated using (true) with check (true);

-- Watched with a game_id filter, so a DELETE needs the whole old row (see photos.sql).
alter table public.quests replica identity full;
