-- Public RSVP submissions for the birthday site (/rsvp form → admin responses view).
-- Anyone can INSERT (submit) and SELECT (admin reads them) — curtain-only privacy,
-- matches the rest of this throwaway project.

create table if not exists public.rsvps (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  coming      text not null,                         -- yes | no | maybe
  plus_ones   integer not null default 0,
  drinking    boolean not null default false,
  duration    text,                                  -- whole | parts
  group_pref  text,                                  -- know | meet | dontcare
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists rsvps_created_idx on public.rsvps(created_at desc);

alter table public.rsvps enable row level security;
drop policy if exists rsvp_insert on public.rsvps;
create policy rsvp_insert on public.rsvps for insert to anon, authenticated with check (true);
drop policy if exists rsvp_select on public.rsvps;
create policy rsvp_select on public.rsvps for select to anon, authenticated using (true);
