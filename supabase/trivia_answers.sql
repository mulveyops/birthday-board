-- Every trivia answer a team gives, one row per question, so after the party we
-- can see which questions were easy or brutal and how each team did. Purely
-- analytics: nothing in the game reads this table, and a failed write never
-- interrupts play. Run once in the Supabase SQL editor.

create table if not exists public.trivia_answers (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  -- where the question was asked: a challenge spot, a Bowser space, or a
  -- turf-steal play (steals are the high-pressure ones — worth splitting out)
  context      text not null check (context in ('spot', 'bowser', 'steal')),
  spot_id      text,
  -- content-row id when the question came from the shared bank; inline
  -- questions authored straight onto a square have none, so keep the prompt
  -- text too and group on that when the id is null. Deliberately text, not
  -- uuid: an odd id from an older published board must not cost us the row.
  question_id  text,
  question     text not null,
  choices      jsonb not null,
  pick         integer not null,   -- index into choices that the team chose
  correct      integer not null,   -- index into choices that was right
  is_correct   boolean not null,
  ts           timestamptz not null default now()
);
create index if not exists trivia_answers_game_idx on public.trivia_answers(game_id, ts);
create index if not exists trivia_answers_question_idx on public.trivia_answers(game_id, question_id);
create index if not exists trivia_answers_team_idx on public.trivia_answers(game_id, team_id);

-- Same open policy as the rest of the party tables (the whole app runs on the
-- anon key). Not added to the realtime publication: nothing subscribes to it.
-- Deliberately before the views: capture is what matters on party day, so
-- everything the app writes to exists before any read-side SQL runs.
alter table public.trivia_answers enable row level security;
drop policy if exists open_all on public.trivia_answers;
create policy open_all on public.trivia_answers for all to anon, authenticated using (true) with check (true);

-- --- read side: the two questions this was built to answer -----------------
-- (Everything above is what the app needs. If either view below errors, the
-- capture path is already live — the views can be fixed after the party.)

-- Difficulty board: hardest questions first. `pick_spread` counts how many
-- teams chose each option — a lopsided spread means one distractor did all the
-- work of fooling people.
create or replace view public.trivia_question_stats as
with keyed as (
  select
    game_id,
    coalesce(question_id, 'inline:' || question) as question_key,
    question,
    pick,
    is_correct
  from public.trivia_answers
),
spread as (
  select game_id, question_key, jsonb_object_agg(pick::text, n) as pick_spread
  from (
    select game_id, question_key, pick, count(*) as n
    from keyed
    group by game_id, question_key, pick
  ) per_pick
  group by game_id, question_key
)
select
  k.game_id,
  k.question_key,
  min(k.question)                      as question,
  count(*)                             as times_asked,
  count(*) filter (where k.is_correct) as times_right,
  round(100.0 * count(*) filter (where k.is_correct) / count(*), 1) as pct_right,
  s.pick_spread
from keyed k
join spread s on s.game_id = k.game_id and s.question_key = k.question_key
group by k.game_id, k.question_key, s.pick_spread
order by pct_right asc, times_asked desc;

-- Scoreboard by team, split by context so a team that crushes calm spot trivia
-- but folds on steals is visible.
create or replace view public.trivia_team_stats as
select
  a.game_id,
  a.team_id,
  t.name                                             as team_name,
  a.context,
  count(*)                                           as answered,
  count(*) filter (where a.is_correct)               as right_count,
  round(100.0 * count(*) filter (where a.is_correct) / count(*), 1) as pct_right
from public.trivia_answers a
join public.teams t on t.id = a.team_id
group by a.game_id, a.team_id, t.name, a.context
order by a.game_id, team_name, a.context;
