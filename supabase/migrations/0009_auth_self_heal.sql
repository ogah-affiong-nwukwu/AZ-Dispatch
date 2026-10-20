-- ============================================================
-- AZ Dispatch — Auth self-heal:
-- 1. The signup trigger now creates the ROLE row (and pending
--    company membership for business/rider) from the signup
--    metadata, so accounts registered while email confirmation
--    is enabled still get their role row immediately.
-- 2. ensure_profile() lets the app repair a missing profile row
--    for a signed-in user.
-- ============================================================

-- ---------- Signup trigger: profile + role from metadata ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.role_type;
  v_company uuid;
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  v_role := case new.raw_user_meta_data ->> 'role'
    when 'customer' then 'customer'::public.role_type
    when 'company_owner' then 'company_owner'::public.role_type
    when 'business' then 'business'::public.role_type
    when 'rider' then 'rider'::public.role_type
    else null
  end;

  if v_role is null then
    return new;
  end if;

  if new.raw_user_meta_data ->> 'company_id' ~ '^[0-9a-fA-F-]{36}$' then
    v_company := (new.raw_user_meta_data ->> 'company_id')::uuid;
  else
    v_company := null;
  end if;

  if v_role in ('business', 'rider') then
    if v_company is not null then
      insert into public.roles (user_id, role_type, company_id, status)
      values (new.id, v_role, v_company, 'pending')
      on conflict (user_id, role_type) do nothing;

      insert into public.company_members (company_id, user_id, member_type, status)
      values (v_company, new.id, (v_role::text)::public.member_type, 'pending')
      on conflict (company_id, user_id, member_type) do nothing;
    end if;
  else
    insert into public.roles (user_id, role_type, company_id, status)
    values (new.id, v_role, null, 'active')
    on conflict (user_id, role_type) do nothing;
  end if;

  return new;
end;
$$;

-- Re-run the trigger for any auth.users that already exist so
-- legacy accounts get their role rows backfilled from metadata.
insert into public.roles (user_id, role_type, company_id, status)
select
  u.id,
  case u.raw_user_meta_data ->> 'role'
    when 'customer' then 'customer'::public.role_type
    when 'company_owner' then 'company_owner'::public.role_type
    when 'business' then 'business'::public.role_type
    when 'rider' then 'rider'::public.role_type
  end,
  case
    when u.raw_user_meta_data ->> 'role' in ('business', 'rider')
      and u.raw_user_meta_data ->> 'company_id' ~ '^[0-9a-fA-F-]{36}$'
    then (u.raw_user_meta_data ->> 'company_id')::uuid
    else null
  end,
  case
    when u.raw_user_meta_data ->> 'role' in ('business', 'rider') then 'pending'
    else 'active'
  end::public.role_status
from auth.users u
where u.raw_user_meta_data ->> 'role' in ('customer', 'business', 'rider', 'company_owner')
  and not exists (
    select 1 from public.roles r
    where r.user_id = u.id
      and r.role_type = case u.raw_user_meta_data ->> 'role'
        when 'customer' then 'customer'::public.role_type
        when 'company_owner' then 'company_owner'::public.role_type
        when 'business' then 'business'::public.role_type
        when 'rider' then 'rider'::public.role_type
      end
  );

-- ---------- Self-heal: repair a missing profile row ----------
create or replace function public.ensure_profile(p_full_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (id, full_name)
  values (
    v_user_id,
    coalesce(p_full_name, split_part(auth.email()::text, '@', 1))
  )
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = v_user_id;
  return v_profile;
end;
$$;

revoke all on function public.ensure_profile(text) from public;
grant execute on function public.ensure_profile(text) to authenticated;
