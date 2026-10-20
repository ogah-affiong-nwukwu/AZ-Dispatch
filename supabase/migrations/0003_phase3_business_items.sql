-- ============================================================
-- AZ Dispatch — Phase 3: business daily items with photos.
-- Item photos live in a public storage bucket (they are shown
-- to customers), capped at 2MB and image mime types only —
-- enforced server-side by the bucket configuration.
-- ============================================================

-- ---------- Storage bucket: item photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies: uploads restricted to each user's own folder.
create policy item_images_upload_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy item_images_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy item_images_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- RLS: items ----------
create policy items_select_own
  on public.items for select
  using (auth.uid() = business_user_id);

create policy items_select_company_owner
  on public.items for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_user_id = auth.uid()
    )
  );

-- Only APPROVED businesses (they have a business_profiles row)
-- can create items, and only under their own company.
create policy items_insert_approved_business
  on public.items for insert
  with check (
    auth.uid() = business_user_id
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = auth.uid() and bp.company_id = company_id
    )
  );

create policy items_update_own
  on public.items for update
  using (auth.uid() = business_user_id);

create policy items_delete_own
  on public.items for delete
  using (auth.uid() = business_user_id);

-- ---------- RLS: item_images ----------
create policy item_images_select_business
  on public.item_images for select
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.business_user_id = auth.uid()
    )
  );

create policy item_images_select_company_owner
  on public.item_images for select
  using (
    exists (
      select 1
      from public.items i
      join public.companies c on c.id = i.company_id
      where i.id = item_id and c.owner_user_id = auth.uid()
    )
  );

create policy item_images_insert_business
  on public.item_images for insert
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.business_user_id = auth.uid()
    )
  );

create policy item_images_delete_business
  on public.item_images for delete
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.business_user_id = auth.uid()
    )
  );
