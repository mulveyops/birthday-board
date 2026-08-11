-- Milwaukee Birthday Game — real-time backend schema
-- Run this once in your dedicated Supabase project: SQL Editor → paste → Run.
-- Dedicated project, so everything lives in `public`. Tables are small; scale is ~8 phones.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                 -- short join code (e.g. "MKE7Q")
  name        text not null default 'Birthday Game',
  board       jsonb not null,                       -- the published board (boundary, edges, squares, scenery)
  status      text not null default 'lobby',        -- lobby | live | ended
  config      jsonb not null default '{}'::jsonb,   -- tunables (star cost, radius, timings…)
  created_at  timestamptz not null default now(),
  started_at  timestamptz
);

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  name        text not null,
  emoji       text not null default '🎲',
  coins       integer not null default 0,
  stars       integer not null default 0,
  items       integer not null default 0,
  device      text not null,                        -- per-phone secret; only this device controls the team
  created_at  timestamptz not null default now(),
  unique (game_id, name)
);
create index if not exists teams_game_idx on public.teams(game_id);

-- Static, per-team spot clears (each team may clear a spot once).
create table if not exists public.spot_claims (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  spot_id     text not null,
  team_id     uuid not null references public.teams(id) on delete cascade,
  kind        text not null default 'static',
  created_at  timestamptz not null default now(),
  unique (game_id, spot_id, team_id)                -- the per-team once rule
);
create index if not exists spot_claims_game_idx on public.spot_claims(game_id);

-- Dynamic first-come drops. Whole schedule is written at game start; clients show by time.
create table if not exists public.spawns (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  spot_id     text,
  lat         double precision,
  lng         double precision,
  reward      integer not null default 40,
  spawn_at    timestamptz not null,
  expires_at  timestamptz not null,
  claimed_by  uuid references public.teams(id)      -- set via guarded update → exactly one winner
);
create index if not exists spawns_game_idx on public.spawns(game_id);

-- Star claim meters. One live/locked claim per bar (partial unique).
create table if not exists public.star_claims (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  bar_spot_id  text not null,
  team_id      uuid not null references public.teams(id) on delete cascade,
  started_at   timestamptz not null default now(),
  ends_at      timestamptz not null,
  status       text not null default 'claiming'     -- claiming | locked | lost
);
create unique index if not exists star_one_active_per_bar
  on public.star_claims(game_id, bar_spot_id) where status <> 'lost';

-- Last known position per team (for the live board). Upsert on team_id.
create table if not exists public.positions (
  team_id     uuid primary key references public.teams(id) on delete cascade,
  game_id     uuid not null references public.games(id) on delete cascade,
  lat         double precision,
  lng         double precision,
  spot_id     text,
  updated_at  timestamptz not null default now()
);

-- Activity feed: robberies, battle outcomes, star locks…
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  ts          timestamptz not null default now(),
  type        text not null,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists events_game_idx on public.events(game_id);

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes on these tables to subscribed clients.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.spot_claims;
alter publication supabase_realtime add table public.spawns;
alter publication supabase_realtime add table public.star_claims;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.events;

-- ---------------------------------------------------------------------------
-- Row-Level Security. Private party + throwaway project → permissive but explicit.
-- (Tighten later per BACKEND_PLAN §11 if desired.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['games','teams','spot_claims','spawns','star_claims','positions','events']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists open_all on public.%I;', t);
    execute format(
      'create policy open_all on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Designer cloud sync: shared, named board layouts (see board_layouts.sql).
-- ---------------------------------------------------------------------------
create table if not exists public.board_layouts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  board       jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists board_layouts_updated_idx on public.board_layouts(updated_at desc);
alter publication supabase_realtime add table public.board_layouts;
alter table public.board_layouts enable row level security;
drop policy if exists open_all on public.board_layouts;
create policy open_all on public.board_layouts
  for all to anon, authenticated using (true) with check (true);
