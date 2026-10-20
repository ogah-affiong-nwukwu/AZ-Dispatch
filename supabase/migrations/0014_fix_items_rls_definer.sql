-- ============================================================
-- AZ Dispatch — 0014: items insert fix via SECURITY DEFINER.
-- The EXISTS(business_profiles) subquery inside the old insert
-- policy is evaluated as the authenticated role, so it can be
-- blocked by business_profiles RLS or leftover conditions.
-- Fix: a SECURITY DEFINER helper that bypasses RLS, and clean,
-- subquery-free policies for the insert + returning select.
-- Run the whole file in the Supabase SQL Editor (idempotent).
-- ============================================================

-- ---------- 0. Diagnostics (optional) ----------
-- select policyname, cmd, qual, with_check
-- from pg_policies where tablename = 'items';
-- select policyname, cmd, qual
-- from pg_policies where tablename = 'business_profiles';

-- ---------- 1. SECURITY DEFINER helper (bypasses RLS) ----------
create or replace function public.has_business_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_profiles bp
    where bp.user_id = p_user_id
  );
$$;

revoke all on function public.has_business_profile(uuid) from public;
grant execute on function public.has_business_profile(uuid) to authenticated;

-- ---------- 2. Company column stays optional ----------
alter table public.items
  alter column company_id drop not null;

alter table public.business_profiles
  alter column company_id drop not null;

-- ---------- 3. Rebuild the items insert policy ----------
drop policy if exists items_insert_approved_business on public.items;
drop policy if exists items_insert_own_business on public.items;

create policy items_insert_own_business
  on public.items for insert to authenticated
  with check (
    auth.uid() = business_user_id
    and public.has_business_profile(auth.uid())
  );

-- ---------- 4. business_profiles: own-row SELECT policy ----------
drop policy if exists business_profiles_select_related on public.business_profiles;
drop policy if exists business_profiles_select_authenticated on public.business_profiles;

alter table public.business_profiles enable row level security;

create policy business_profiles_select_own
  on public.business_profiles for select to authenticated
  using (auth.uid() = user_id);

-- Keep public names for marketplace display (orders show business names).
create policy business_profiles_select_authenticated
  on public.business_profiles for select to authenticated
  using (auth.role() = 'authenticated');

-- ---------- 5. items SELECT: plain owner check, no subqueries ----------
-- The insert uses select=* returning the row, so the returning row
-- must also pass a SELECT policy.
drop policy if exists items_select_company_owner on public.items;
drop policy if exists items_select_own on public.items;
drop policy if exists items_select_own_business on public.items;
drop policy if exists items_select_customer on public.items;
drop policy if exists items_select_available on public.items;

alter table public.items enable row level security;

create policy items_select_own_business
  on public.items for select to authenticated
  using (business_user_id = auth.uid());

create policy items_select_available
  on public.items for select to authenticated
  using (is_available = true);

-- ---------- 6. UPDATE / DELETE: owner only ----------
drop policy if exists items_update_own on public.items;
drop policy if exists items_update_own_business on public.items;
drop policy if exists items_delete_own on public.items;
drop policy if exists items_delete_own_business on public.items;

create policy items_update_own_business
  on public.items for update to authenticated
  using (auth.uid() = business_user_id)
  with check (auth.uid() = business_user_id);

create policy items_delete_own_business
  on public.items for delete to authenticated
  using (auth.uid() = business_user_id);
