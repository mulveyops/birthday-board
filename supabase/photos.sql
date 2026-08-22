-- Party Cam: every photo anyone takes during the game, in one place.
--
-- Two flavors in one table, told apart by `drinks`:
--   drinks = 0  a moment — just a picture for the record, no coins
--   drinks > 0  a DRINK CHECK — a selfie with the drinks, paid instantly at
--               `drinkCoins` per drink. Submission alone is enough; a host or
--               referee VETOES (claws the coins back) if the photo is clearly
--               not what was claimed.
--
-- Coins are paid at submit and stored in `coins`, so a veto knows exactly how
-- much to take back even if the config changed in between. `vetoed` flips once
-- via a guarded update (WHERE vetoed = false) so two admin phones tapping the
-- same photo can't double-refund. Run once in the Supabase SQL editor.

create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  -- set null, not cascade: the gallery outlives the game's teams. The name and
  -- emoji are snapshotted so a photo still reads right with no team row left.
  team_id     uuid references public.teams(id) on delete set null,
  team_name   text not null default 'someone',
  team_emoji  text not null default '🎲',
  url         text not null,
  caption     text not null default '',
  drinks      integer not null default 0 check (drinks >= 0),
  coins       integer not null default 0,  -- paid at submit; the clawback amount
  vetoed      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists photos_game_idx on public.photos(game_id, created_at desc);

-- Guarded so the whole file stays safe to re-run: adding a table that's already
-- in the publication raises, and one raise aborts the entire script.
do $$
begin
  alter publication supabase_realtime add table public.photos;
exception
  when duplicate_object then null;
end $$;
alter table public.photos enable row level security;
drop policy if exists open_all on public.photos;
create policy open_all on public.photos for all to anon, authenticated using (true) with check (true);

-- Storage: a public bucket of the party's pictures, one folder per game so the
-- whole album downloads as a unit afterwards. Anon can upload and read but NOT
-- delete (same as trivia-photos) — deleting a row hides a photo from the app
-- while the file itself survives in the bucket; purge from the dashboard.
insert into storage.buckets (id, name, public)
values ('party-photos', 'party-photos', true)
on conflict (id) do nothing;

drop policy if exists "party photos anon upload" on storage.objects;
create policy "party photos anon upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'party-photos');

drop policy if exists "party photos anon read" on storage.objects;
create policy "party photos anon read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'party-photos');

-- A DELETE only publishes the primary key unless the table replicates the whole
-- old row — which means the `game_id=eq.…` filter every client subscribes with
-- never matches, and a deleted photo lingers in everyone's album until they
-- reload. The table is small; replicating the full row costs nothing.
alter table public.photos replica identity full;
