-- Atomic coin math for cross-team changes (robbing, tolls). A single locked
-- statement per row → no lost updates when two phones touch a balance at once.
-- Run once in the Supabase SQL editor.

-- Add or remove coins from one team (floored at 0). Returns the new balance.
create or replace function public.adjust_coins(p_team uuid, p_delta int)
returns int
language sql
as $$
  update public.teams
     set coins = greatest(0, coins + p_delta)
   where id = p_team
  returning coins;
$$;

-- Move up to p_amount coins from one team to another (never below 0 on the
-- source; conserves coins). Locks the source row so concurrent transfers
-- serialize. Returns the amount actually moved.
create or replace function public.transfer_coins(p_from uuid, p_to uuid, p_amount int)
returns int
language plpgsql
as $$
declare
  have  int;
  moved int;
begin
  select coins into have from public.teams where id = p_from for update;
  if have is null then
    return 0;
  end if;
  moved := least(greatest(p_amount, 0), have);
  update public.teams set coins = coins - moved where id = p_from;
  update public.teams set coins = coins + moved where id = p_to;
  return moved;
end;
$$;

-- Add or remove stars from one team (floored at 0). Host fix-it tool.
create or replace function public.adjust_stars(p_team uuid, p_delta int)
returns int
language sql
as $$
  update public.teams
     set stars = greatest(0, stars + p_delta)
   where id = p_team
  returning stars;
$$;

grant execute on function public.adjust_coins(uuid, int) to anon, authenticated;
grant execute on function public.transfer_coins(uuid, uuid, int) to anon, authenticated;
grant execute on function public.adjust_stars(uuid, int) to anon, authenticated;
