-- Territory: intersection corners a team paints by clearing them. Consecutive
-- owned corners (a run along the streets — turns allowed) pay X coins per tick,
-- where X = the team's longest run. Rivals can steal a corner by winning a
-- trivia play; a failed steal locks that attacker out of hitting that defender
-- again for a cooldown. Run once in the Supabase SQL editor.

-- Current owner of each corner. One row per corner; steals UPDATE the row
-- (guarded on the expected old owner) so two simultaneous steals can't both win.
create table if not exists public.territory (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  spot_id     text not null,
  team_id     uuid not null references public.teams(id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  unique (game_id, spot_id)
);
create index if not exists territory_game_idx on public.territory(game_id);

-- Failed-steal cooldowns: attacker can't hit that defender again until `until`.
-- One row per attacker→defender pair, refreshed by upsert.
create table if not exists public.raid_locks (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  attacker    uuid not null references public.teams(id) on delete cascade,
  defender    uuid not null references public.teams(id) on delete cascade,
  until_ts    timestamptz not null,
  unique (game_id, attacker, defender)
);
create index if not exists raid_locks_game_idx on public.raid_locks(game_id);

-- Income ticks: a guarded insert (unique game+tick) elects exactly one client
-- to compute run lengths and pay every team for that tick window.
create table if not exists public.territory_ticks (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  tick_no     integer not null,
  paid_by     uuid references public.teams(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (game_id, tick_no)
);
create index if not exists territory_ticks_game_idx on public.territory_ticks(game_id);

alter publication supabase_realtime add table public.territory;
alter publication supabase_realtime add table public.raid_locks;

do $$
declare t text;
begin
  foreach t in array array['territory','raid_locks','territory_ticks']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists open_all on public.%I;', t);
    execute format(
      'create policy open_all on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
