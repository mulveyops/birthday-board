-- The ambusher picks the game. Their trap is sprung by the VICTIM's phone, so
-- the choice has to live on the quest row — the victim's client is what builds
-- the duel, and it can't know what you picked otherwise.
-- Run once in the Supabase SQL editor.
alter table public.quests add column if not exists choice text;
