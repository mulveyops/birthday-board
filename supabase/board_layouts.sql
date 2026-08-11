-- Designer cloud sync: shared, named board layouts.
-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- Lets Steven & Abby edit the same boards from any device, and keep several
-- named versions ("Version A", "Version B", …) to switch between.

create table if not exists public.board_layouts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  board       jsonb not null,                        -- the full board (area, spaces, paths, scenery)
  updated_by  text,                                  -- device id of the last editor (echo suppression)
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists board_layouts_updated_idx on public.board_layouts(updated_at desc);

-- Realtime so an edit on one device shows up on the other.
alter publication supabase_realtime add table public.board_layouts;

-- Row-Level Security: private, throwaway project → permissive but explicit
-- (matches the game tables in schema.sql).
alter table public.board_layouts enable row level security;
drop policy if exists open_all on public.board_layouts;
create policy open_all on public.board_layouts
  for all to anon, authenticated using (true) with check (true);
