-- In-game messaging: host ↔ teams and team ↔ team (cross-team coordination).
-- Convention: from_team null = the host; to_team null = "everyone" when from
-- the host, or "to the host" when from a team. Run once in the SQL editor.

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  from_team   uuid references public.teams(id) on delete cascade,  -- null = host
  to_team     uuid references public.teams(id) on delete cascade,  -- null = everyone/host
  text        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists messages_game_idx on public.messages(game_id, created_at);

alter publication supabase_realtime add table public.messages;
alter table public.messages enable row level security;
drop policy if exists open_all on public.messages;
create policy open_all on public.messages for all to anon, authenticated using (true) with check (true);
