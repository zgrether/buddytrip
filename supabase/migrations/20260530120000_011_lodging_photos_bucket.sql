-- Public storage bucket for user-uploaded lodging photos.
--
-- Backs the "Replace photo" / "Add photo" action in AddPropertySheet:
-- the client uploads the chosen image here and stores the resulting
-- public URL in logistics_items.image_url (a normal https URL, so the
-- existing z.string().url() validation on the router still holds).

insert into storage.buckets (id, name, public)
values ('lodging-photos', 'lodging-photos', true)
on conflict (id) do nothing;

-- Any signed-in user may upload into the bucket.
drop policy if exists "lodging_photos_insert" on storage.objects;
create policy "lodging_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lodging-photos');

-- Public read (bucket is public; explicit policy kept for clarity).
drop policy if exists "lodging_photos_select" on storage.objects;
create policy "lodging_photos_select" on storage.objects
  for select to public
  using (bucket_id = 'lodging-photos');

-- Uploaders can replace/remove the objects they own.
drop policy if exists "lodging_photos_update" on storage.objects;
create policy "lodging_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'lodging-photos' and owner = auth.uid());

drop policy if exists "lodging_photos_delete" on storage.objects;
create policy "lodging_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lodging-photos' and owner = auth.uid());
