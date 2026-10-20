-- ============================================================
-- AZ Dispatch — 0013: items insert fix (owner id / policy).
-- Run this in the Supabase SQL Editor.
-- It replaces the insert policy with one that depends ONLY on
-- business_profiles (no roles.status, no company), and re-asserts
-- the select/update/delete policies.
-- ============================================================

-- ---------- 0. Diagnostics (run these first, read the results) ----------
-- select id, email, created_at from auth.users order by created_at;
-- select user_id, business_name, created_at from public.business_profiles;
-- select user_id, role_type, status from public.roles where role_type = 'business';
-- Compare the auth.users.id of ogahaffiong@gmail.com with the
-- business_profiles.user_id. They must be the SAME uuid.

-- ---------- 1. Company column is optional ----------
alter table public.items
  alter column company_id drop not null;

alter table public.business_profiles
  alter column company_id drop not null;

-- ---------- 2. Drop every items insert policy variant ----------
drop policy if exists items_insert_approved_business on public.items;
drop policy if exists items_insert_own_business on public.items;

-- ---------- 3. Insert policy: business_profiles row only ----------
create policy items_insert_own_business
  on public.items for insert to authenticated
  with check (
    auth.uid() = business_user_id
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = auth.uid()
    )
  );

-- ---------- 4. Re-assert select/update/delete policies ----------
drop policy if exists items_select_company_owner on public.items;
drop policy if exists items_select_own on public.items;
drop policy if exists items_select_customer on public.items;
drop policy if exists items_select_available on public.items;
drop policy if exists items_select_own_business on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_update_own_business on public.items;
drop policy if exists items_delete_own on public.items;
drop policy if exists items_delete_own_business on public.items;

alter table public.items enable row level security;

create policy items_select_available
  on public.items for select to authenticated
  using (is_available = true);

create policy items_select_own_business
  on public.items for select to authenticated
  using (auth.uid() = business_user_id);

create policy items_update_own_business
  on public.items for update to authenticated
  using (auth.uid() = business_user_id)
  with check (auth.uid() = business_user_id);

create policy items_delete_own_business
  on public.items for delete to authenticated
  using (auth.uid() = business_user_id);

-- ---------- 5. Make sure the business role is active (in case an old
--             registration left it 'pending'; harmless otherwise) ----------
update public.roles
set status = 'active'
where role_type = 'business'
  and user_id in (select user_id from public.business_profiles)
  and status <> 'active';
