-- ============================================================
-- AZ Dispatch — 0012: items RLS fix (self-serve products).
-- * Drops the old company/approval-dependent policies on items
--   and item_images.
-- * New rules: a user with a business_profiles row owns items
--   under business_user_id = auth.uid().
-- * Anyone signed in can read available items; a business can
--   read/update/delete all of its own items.
-- * Photo bucket: the logged-in business uploads into its own
--   folder only.
-- Run in the Supabase SQL Editor (idempotent).
-- ============================================================

-- ---------- 1. Company is optional on products/businesses ----------
alter table public.items
  alter column company_id drop not null;

alter table public.business_profiles
  alter column company_id drop not null;

-- ---------- 2. Backfill business_profiles for existing business roles ----------
insert into public.business_profiles (user_id, company_id, business_name)
select
  r.user_id,
  r.company_id,
  coalesce(p.business_name, 'Business')
from public.roles r
join public.profiles p on p.id = r.user_id
where r.role_type = 'business'
  and not exists (
    select 1 from public.business_profiles bp where bp.user_id = r.user_id
  )
on conflict (user_id) do nothing;

-- ---------- 3. Remove old items policies (company / approval based) ----------
drop policy if exists items_insert_approved_business on public.items;
drop policy if exists items_insert_own_business on public.items;
drop policy if exists items_select_company_owner on public.items;
drop policy if exists items_select_own on public.items;
drop policy if exists items_select_customer on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_delete_own on public.items;

drop policy if exists item_images_select_business on public.item_images;
drop policy if exists item_images_select_company_owner on public.item_images;
drop policy if exists item_images_select_customer on public.item_images;
drop policy if exists item_images_insert_business on public.item_images;
drop policy if exists item_images_delete_business on public.item_images;

-- ---------- 4. Ensure RLS is enabled ----------
alter table public.items enable row level security;
alter table public.item_images enable row level security;

-- ---------- 5. New items policies ----------

-- INSERT: only a user with a business profile, into its own account.
create policy items_insert_own_business
  on public.items for insert to authenticated
  with check (
    auth.uid() = business_user_id
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = auth.uid()
    )
  );

-- SELECT: anyone signed in can read available items…
create policy items_select_available
  on public.items for select to authenticated
  using (is_available = true);

-- …and a business can read all of its own items.
create policy items_select_own_business
  on public.items for select to authenticated
  using (auth.uid() = business_user_id);

-- UPDATE: only the business that owns the item.
create policy items_update_own_business
  on public.items for update to authenticated
  using (auth.uid() = business_user_id)
  with check (auth.uid() = business_user_id);

-- DELETE: only the business that owns the item.
create policy items_delete_own_business
  on public.items for delete to authenticated
  using (auth.uid() = business_user_id);

-- ---------- 6. New item_images policies ----------

create policy item_images_select_available
  on public.item_images for select to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.is_available = true
    )
  );

create policy item_images_select_own_business
  on public.item_images for select to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.business_user_id = auth.uid()
    )
  );

create policy item_images_insert_own_business
  on public.item_images for insert to authenticated
  with check (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.business_user_id = auth.uid()
    )
  );

create policy item_images_delete_own_business
  on public.item_images for delete to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.business_user_id = auth.uid()
    )
  );

-- ---------- 7. Storage bucket: item photos ----------
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

-- Only a logged-in business may upload/update/delete in its own folder.
drop policy if exists item_images_upload_own on storage.objects;
drop policy if exists item_images_upload_business on storage.objects;
drop policy if exists item_images_update_own on storage.objects;
drop policy if exists item_images_delete_own on storage.objects;

create policy item_images_upload_business
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = auth.uid()
    )
  );

create policy item_images_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = auth.uid()
    )
  );

create policy item_images_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = auth.uid()
    )
  );
