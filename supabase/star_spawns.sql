-- Stars LAND at bars over time instead of every bar always selling one.
-- One row per landed star. A bar's available count = stars landed here minus
-- claims started here (claiming or locked); buy-a-round is only offered while
-- that is positive. Auto drops elect exactly one client per star tick via the
-- partial unique (game, tick) index; admin-forced drops have tick_no null.
-- Run once in the Supabase SQL editor.

create table if not exists public.star_spawns (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  bar_spot_id text not null,
  tick_no     integer,              -- null = host-forced drop
  created_at  timestamptz not null default now()
);
create index if not exists star_spawns_game_idx on public.star_spawns(game_id);
create unique index if not exists star_spawns_tick_uniq
  on public.star_spawns(game_id, tick_no) where tick_no is not null;

alter table public.star_spawns enable row level security;
drop policy if exists open_all on public.star_spawns;
create policy open_all on public.star_spawns for all to anon, authenticated using (true) with check (true);
