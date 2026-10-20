-- ============================================================
-- AZ Dispatch — Phase 5: company payment confirmation screen
-- and the business order-approval step.
-- Transitions run in SECURITY DEFINER functions so only the
-- company owner can confirm/reject payments and only the order's
-- business owner can approve it.
-- ============================================================

-- ---------- Profiles readable by order parties ----------
create policy profiles_select_order_customer
  on public.profiles for select
  using (
    exists (
      select 1
      from public.orders o
      join public.companies c on c.id = o.company_id
      where o.customer_user_id = profiles.id and c.owner_user_id = auth.uid()
    )
  );

create policy profiles_select_order_business
  on public.profiles for select
  using (
    exists (
      select 1 from public.orders o
      where o.customer_user_id = profiles.id and o.business_user_id = auth.uid()
    )
  );

-- ---------- RPC: confirm or reject a payment slip ----------
create or replace function public.review_payment(
  p_order_id uuid,
  p_approved boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = v_order.company_id and c.owner_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the company owner can review payments';
  end if;

  if v_order.status <> 'payment_submitted' then
    raise exception 'ORDER_NOT_REVIEWABLE';
  end if;

  if p_approved then
    update public.payments
    set
      status = 'confirmed',
      rejection_reason = null,
      reviewed_by = auth.uid(),
      reviewed_at = now()
    where order_id = v_order.id;

    update public.orders
    set status = case
      when v_order.kind = 'shop' then 'awaiting_business_approval'
      else 'awaiting_rider'
    end
    where id = v_order.id;
  else
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'REASON_REQUIRED';
    end if;

    update public.payments
    set
      status = 'rejected',
      rejection_reason = trim(p_reason),
      reviewed_by = auth.uid(),
      reviewed_at = now()
    where order_id = v_order.id;

    update public.orders
    set status = 'awaiting_payment'
    where id = v_order.id;
  end if;
end;
$$;

-- ---------- RPC: business approves a paid shop order ----------
create or replace function public.approve_business_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.business_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the order''s business owner can approve it';
  end if;

  if v_order.status <> 'awaiting_business_approval' then
    raise exception 'ORDER_NOT_APPROVABLE';
  end if;

  update public.orders
  set status = 'awaiting_rider'
  where id = v_order.id;
end;
$$;

-- ---------- Permissions: authenticated only ----------
revoke all on function public.review_payment(uuid, boolean, text) from public;
grant execute on function public.review_payment(uuid, boolean, text) to authenticated;

revoke all on function public.approve_business_order(uuid) from public;
grant execute on function public.approve_business_order(uuid) to authenticated;
