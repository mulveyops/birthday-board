-- Two mechanics, one migration. Run once in the Supabase SQL editor.
--
-- DUELS: any head-to-head that real life decides — a physical challenge at a
-- bar, catching a camper, settling a side quest. Both phones show the same
-- prompt and the same two buttons; whoever taps first resolves it. That's the
-- same trust model the bar battles already run on (everyone's standing right
-- there), but shared instead of living on one phone.
--
-- CAMPS: park at a bar and coins accrue on a timer, escalating the longer you
-- stay — but they sit in a BANK that only pays out when you check in somewhere
-- else, and anyone who finds you can challenge for half of it. You have to
-- re-ping every few minutes to prove you're still there.

create table if not exists public.duels (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  challenger   uuid not null references public.teams(id) on delete cascade,
  opponent     uuid not null references public.teams(id) on delete cascade,
  -- what kind of fight this is, so the payout code knows what's at stake
  kind         text not null check (kind in ('camp', 'quest', 'battle')),
  prompt       text not null,          -- the challenge, in words, for both phones
  stake        integer not null default 0,
  spot_id      text,
  status       text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  winner       uuid references public.teams(id) on delete set null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists duels_game_idx on public.duels(game_id, created_at desc);
-- One open duel per pair per spot: a double-tap can't start two fights.
create unique index if not exists duels_one_open
  on public.duels(game_id, challenger, opponent, coalesce(spot_id, ''))
  where status = 'open';

create table if not exists public.camps (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  spot_id      text not null,
  started_at   timestamptz not null default now(),
  -- the last "still here" ping; a stale one ends the escalation
  last_ping    timestamptz not null default now(),
  ticks        integer not null default 0,   -- how many intervals survived
  banked       integer not null default 0,   -- coins waiting to be carried out
  status       text not null default 'active' check (status in ('active', 'collected', 'raided', 'lapsed')),
  created_at   timestamptz not null default now()
);
create index if not exists camps_game_idx on public.camps(game_id, status);
-- A team can only be in one place at a time.
create unique index if not exists camps_one_active
  on public.camps(game_id, team_id) where status = 'active';

do $$
begin
  alter publication supabase_realtime add table public.duels;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.camps;
exception when duplicate_object then null;
end $$;

alter table public.duels enable row level security;
drop policy if exists open_all on public.duels;
create policy open_all on public.duels for all to anon, authenticated using (true) with check (true);

alter table public.camps enable row level security;
drop policy if exists open_all on public.camps;
create policy open_all on public.camps for all to anon, authenticated using (true) with check (true);

-- Both tables get watched with a game_id filter, and a DELETE only publishes
-- the primary key without this (see photos.sql for the same trap).
alter table public.duels replica identity full;
alter table public.camps replica identity full;
