-- Public storage bucket for photo-trivia images. Photos are resized client-side,
-- uploaded here, and referenced by their public URL in a question (keeps the board
-- JSON small). Curtain model: anyone with the site can upload/read. Run once.

insert into storage.buckets (id, name, public)
values ('trivia-photos', 'trivia-photos', true)
on conflict (id) do nothing;

drop policy if exists "trivia photos anon upload" on storage.objects;
create policy "trivia photos anon upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'trivia-photos');

drop policy if exists "trivia photos anon read" on storage.objects;
create policy "trivia photos anon read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'trivia-photos');
