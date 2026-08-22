-- Make live updates actually live. Run once in the Supabase SQL editor.
--
-- Two separate faults, both of which look like "I had to refresh":
--
-- 1. star_spawns was never added to the realtime publication at all. It got a
--    table, RLS and a policy, and nothing else — so a star landing at a bar
--    broadcast NOTHING. The announcement in the feed still arrived, because
--    `events` is published, which is why the notification showed up and the
--    star didn't. That's the exact symptom.
--
-- 2. Every subscription in the app filters on `game_id=eq.<id>` (see net.ts).
--    Postgres only publishes the columns in a table's REPLICA IDENTITY, which
--    defaults to the primary key alone. So on an UPDATE or a DELETE the payload
--    carries an id and nothing else, the game_id filter has nothing to match,
--    and the change is dropped before it ever reaches a phone.
--
--    INSERTs are unaffected — they always carry the whole new row. That is why
--    checking in somewhere new worked and *changing* something didn't: a star
--    claim going from claiming to contested is an UPDATE, so the defender was
--    never told they were being contested. Coins moving is an UPDATE on teams.
--    Walking back to a spot you've already been is now an UPDATE on spot_claims.
--
-- `replica identity full` makes every column available to the filter, which is
-- what these tables have needed all along. The cost is a slightly larger WAL
-- record per row — irrelevant at eight teams and a few thousand rows.

-- ---- 1. the table that was never published --------------------------------
do $$
begin
  alter publication supabase_realtime add table public.star_spawns;
exception when duplicate_object then null;
end $$;

-- ---- 2. publish whole rows, so game_id filters can match -------------------
alter table public.star_spawns  replica identity full;
alter table public.star_claims  replica identity full;  -- contests, claim timers
alter table public.teams        replica identity full;  -- coins and stars changing
alter table public.positions    replica identity full;  -- where rivals are now
alter table public.spot_claims  replica identity full;  -- re-claims after cooldown
alter table public.spawns       replica identity full;
alter table public.games        replica identity full;  -- status: live/ended
alter table public.events       replica identity full;
alter table public.territory    replica identity full;  -- corners changing hands
alter table public.raid_locks   replica identity full;
alter table public.messages     replica identity full;

-- ---- 3. confirm ------------------------------------------------------------
-- Every row below should read TRUE / f. Anything showing 'd' for relreplident
-- is still on default (primary key only) and will keep dropping updates.
select c.relname                          as table_name,
       c.relreplident                     as replica_identity,   -- 'f' = full
       (p.pubname is not null)            as in_realtime
from   pg_class c
join   pg_namespace n on n.oid = c.relnamespace
left   join (
         select pc.oid, pb.pubname
         from   pg_publication pb
         join   pg_publication_rel pr on pr.prpubid = pb.oid
         join   pg_class pc on pc.oid = pr.prrelid
         where  pb.pubname = 'supabase_realtime'
       ) p on p.oid = c.oid
where  n.nspname = 'public'
  and  c.relname in ('star_spawns','star_claims','teams','positions','spot_claims',
                     'spawns','games','events','territory','raid_locks','messages',
                     'photos','duels','camps','quests')
order  by c.relname;
