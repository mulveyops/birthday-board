-- Messaging channels: 'all' = the Party room, 'host:<teamId>' = that team's
-- private line to the hosts, 'dm:<idA>:<idB>' (ids sorted) = team-to-team.
-- Needed because "team -> everyone" and "team -> host" were the same bits
-- (to_team null) before teams could post in the Party room.
-- Run once in the Supabase SQL editor.

alter table public.messages add column if not exists channel text;
