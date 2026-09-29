-- staff can view punch photos
drop policy if exists "staff read timeclock photos" on storage.objects;
create policy "staff read timeclock photos" on storage.objects for select using (bucket_id = 'timeclock' and public.is_staff());
