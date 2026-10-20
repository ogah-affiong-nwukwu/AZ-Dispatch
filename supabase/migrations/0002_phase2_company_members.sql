-- ============================================================
-- AZ Dispatch — Phase 2: company creation, business/rider
-- registration under a company, and the approval flow.
-- All approval transitions happen in SECURITY DEFINER functions
-- so only the company owner can approve/reject, enforced here.
-- ============================================================

-- ---------- RLS: companies ----------
create policy companies_select_authenticated
  on public.companies for select
  using (auth.role() = 'authenticated');

create policy companies_insert_own
  on public.companies for insert
  with check (auth.uid() = owner_user_id);

create policy companies_update_own
  on public.companies for update
  using (auth.uid() = owner_user_id);

-- ---------- RLS: company_members ----------
create policy company_members_select_own
  on public.company_members for select
  using (auth.uid() = user_id);

create policy company_members_select_company_owner
  on public.company_members for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_user_id = auth.uid()
    )
  );

-- ---------- RLS: business_profiles ----------
create policy business_profiles_select_related
  on public.business_profiles for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_user_id = auth.uid()
    )
  );

-- ---------- RLS: profiles readable by company owners ----------
create policy profiles_select_company_owner
  on public.profiles for select
  using (
    exists (
      select 1
      from public.company_members cm
      join public.companies c on c.id = cm.company_id
      where cm.user_id = profiles.id and c.owner_user_id = auth.uid()
    )
  );

-- ---------- Tighten role creation ----------
-- Business/rider roles must start pending and belong to a company;
-- customer/company_owner roles are active and company-less.
drop policy roles_insert_own on public.roles;

create policy roles_insert_own
  on public.roles for insert
  with check (
    auth.uid() = user_id
    and (
      (
        role_type in ('customer', 'company_owner')
        and status = 'active'
        and company_id is null
      )
      or (
        role_type in ('business', 'rider')
        and status = 'pending'
        and company_id is not null
      )
    )
  );

-- ---------- RPC: register under a company ----------
create or replace function public.register_company_member(
  p_company_id uuid,
  p_member_type public.member_type,
  p_business_name text default null
)
returns public.company_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_member public.company_members;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.roles r
    where r.user_id = v_user_id and r.role_type = p_member_type::public.role_type
  ) then
    raise exception 'ALREADY_REGISTERED: you already have an account for this role';
  end if;

  if exists (
    select 1 from public.company_members cm
    where cm.user_id = v_user_id and cm.member_type = p_member_type
  ) then
    raise exception 'ALREADY_REGISTERED: you already have a membership request';
  end if;

  v_name := trim(coalesce(p_business_name, ''));

  insert into public.roles (user_id, role_type, company_id, status)
  values (v_user_id, p_member_type::public.role_type, p_company_id, 'pending');

  insert into public.company_members (company_id, user_id, member_type, status)
  values (p_company_id, v_user_id, p_member_type, 'pending')
  returning * into v_member;

  if p_member_type = 'business' and length(v_name) > 0 then
    update public.profiles set business_name = v_name where id = v_user_id;
  end if;

  return v_member;
end;
$$;

-- ---------- RPC: approve a member (company owner only) ----------
create or replace function public.approve_company_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_member_type public.member_type;
  v_business_name text;
begin
  select cm.company_id, cm.user_id, cm.member_type
  into v_company_id, v_user_id, v_member_type
  from public.company_members cm
  where cm.id = p_member_id;

  if v_company_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = v_company_id and c.owner_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the company owner can approve members';
  end if;

  update public.company_members
  set
    status = 'approved',
    rejection_reason = null,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_member_id;

  update public.roles
  set status = 'active', company_id = v_company_id
  where user_id = v_user_id and role_type = v_member_type::public.role_type;

  if v_member_type = 'business' then
    select coalesce(business_name, 'Business')
    into v_business_name
    from public.profiles
    where id = v_user_id;

    insert into public.business_profiles (user_id, company_id, business_name)
    values (v_user_id, v_company_id, v_business_name)
    on conflict (user_id) do update
    set
      company_id = excluded.company_id,
      business_name = excluded.business_name;
  end if;
end;
$$;

-- ---------- RPC: reject a member with a reason (company owner only) ----------
create or replace function public.reject_company_member(
  p_member_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_member_type public.member_type;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  select cm.company_id, cm.user_id, cm.member_type
  into v_company_id, v_user_id, v_member_type
  from public.company_members cm
  where cm.id = p_member_id;

  if v_company_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = v_company_id and c.owner_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the company owner can reject members';
  end if;

  update public.company_members
  set
    status = 'rejected',
    rejection_reason = trim(p_reason),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_member_id;

  update public.roles
  set status = 'rejected', company_id = v_company_id
  where user_id = v_user_id and role_type = v_member_type::public.role_type;
end;
$$;

-- ---------- Permissions: authenticated only ----------
revoke all on function public.register_company_member(uuid, public.member_type, text) from public;
grant execute on function public.register_company_member(uuid, public.member_type, text) to authenticated;

revoke all on function public.approve_company_member(uuid) from public;
grant execute on function public.approve_company_member(uuid) to authenticated;

revoke all on function public.reject_company_member(uuid, text) from public;
grant execute on function public.reject_company_member(uuid, text) to authenticated;
