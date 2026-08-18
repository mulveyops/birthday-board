-- Shared authoring content, independent of any board layout: the trivia
-- question bank and the chance card deck. Each question/card is its OWN row so
-- two people (Steven on the designer, Abby on her phone) can edit at the same
-- time without clobbering each other. Publish snapshots these into the game.
-- Run once in the SQL editor.

create table if not exists public.content (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('trivia', 'chance')),
  data        jsonb not null,
  pos         double precision not null default 0,  -- sort order within a kind
  updated_at  timestamptz not null default now()
);
create index if not exists content_kind_idx on public.content(kind, pos);

alter publication supabase_realtime add table public.content;
alter table public.content enable row level security;
drop policy if exists open_all on public.content;
create policy open_all on public.content for all to anon, authenticated using (true) with check (true);
