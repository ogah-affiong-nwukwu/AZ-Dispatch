-- ============================================================
-- AZ Dispatch — Multi-role accounts, Company role removed.
-- Steps:
--   1. Existing business/rider roles become active (no company
--      approval step anymore).
--   2. company_owner role rows are deleted and the role_type enum
--      is recreated as (customer, rider, business).
--   3. The company-email exclusivity trigger is dropped.
--   4. Every existing user keeps their current role AND gets the
--      customer role (backfill).
--   5. The signup trigger now always creates the customer role
--      plus the picked role, all active.
--   6. RLS updated: users may insert any of their own roles.
-- Run this in the Supabase SQL Editor after migrations 0001–0009.
-- ============================================================

-- ---------- 1. No more pending/rejected (no approvers left) ----------
update public.roles
set status = 'active'
where role_type in ('business', 'rider') and status <> 'active';

-- ---------- 2. Remove company_owner rows + enum value ----------
delete from public.roles where role_type = 'company_owner';

create type public.role_type_new as enum ('customer', 'rider', 'business');

alter table public.roles
  alter column role_type type public.role_type_new
  using (role_type::text::public.role_type_new);

drop type public.role_type;
alter type public.role_type_new rename to role_type;

-- ---------- 3. Drop the company-email exclusivity trigger ----------
drop trigger if exists trg_company_email_exclusive on public.roles;
drop function if exists public.enforce_company_email_exclusive();

-- ---------- 4. Backfill: every user keeps their role + gets customer ----------
insert into public.roles (user_id, role_type, company_id, status)
select u.id, 'customer'::public.role_type, null, 'active'::public.role_status
from auth.users u
where not exists (
  select 1 from public.roles r
  where r.user_id = u.id and r.role_type = 'customer'
);

-- ---------- 5. Signup trigger: customer role always + picked role ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.role_type;
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.roles (user_id, role_type, company_id, status)
  values (new.id, 'customer'::public.role_type, null, 'active'::public.role_status)
  on conflict (user_id, role_type) do nothing;

  v_role := case new.raw_user_meta_data ->> 'role'
    when 'rider' then 'rider'::public.role_type
    when 'business' then 'business'::public.role_type
    else null
  end;

  if v_role is not null then
    insert into public.roles (user_id, role_type, company_id, status)
    values (new.id, v_role, null, 'active'::public.role_status)
    on conflict (user_id, role_type) do nothing;
  end if;

  return new;
end;
$$;

-- ---------- 6. RLS: any own role, active, no company ----------
drop policy if exists roles_insert_own on public.roles;

create policy roles_insert_own
  on public.roles for insert
  with check (auth.uid() = user_id and company_id is null);
