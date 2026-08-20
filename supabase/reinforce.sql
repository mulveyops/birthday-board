-- Turf reinforcement: a 🧱 charge (won from a chance card) fortifies one corner
-- you own. A steal attempt there is a 2-question gauntlet, and a failed attacker
-- forfeits coins to the defender. Run once in the Supabase SQL editor
-- (after territory.sql).

alter table public.territory add column if not exists reinforced boolean not null default false;
alter table public.teams add column if not exists reinforcements integer not null default 0;
