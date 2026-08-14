-- Space ownership for the "own-a-space toll" mechanic. A team can secretly own a
-- Chance square (won via a chance roll); rivals who land there pay a toll to the
-- owner. First owner wins and is locked in (unique per game+spot). Run once.

create table if not exists public.space_owners (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  spot_id     text not null,
  team_id     uuid not null references public.teams(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (game_id, spot_id)                     -- first claimer wins, locked in
);
create index if not exists space_owners_game_idx on public.space_owners(game_id);

alter publication supabase_realtime add table public.space_owners;
alter table public.space_owners enable row level security;
drop policy if exists open_all on public.space_owners;
create policy open_all on public.space_owners for all to anon, authenticated using (true) with check (true);
