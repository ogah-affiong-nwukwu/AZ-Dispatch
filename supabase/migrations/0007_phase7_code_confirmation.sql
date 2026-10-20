-- ============================================================
-- AZ Dispatch — Phase 7: customer code confirmation with a
-- 5-attempt lock + company resolution, rider earnings, and the
-- standalone "request a dispatch rider" flow.
-- ============================================================

-- ---------- Rider earnings recorded on completed deliveries ----------
alter table public.deliveries
add column if not exists earnings_naira integer;

-- ---------- RLS: customers see their order's delivery state ----------
create policy deliveries_select_customer
  on public.deliveries for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = deliveries.order_id and o.customer_user_id = auth.uid()
    )
  );

-- ---------- RPC: customer confirms receipt with the code ----------
create or replace function public.verify_delivery_code(
  p_order_id uuid,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.deliveries;
  v_hash text;
begin
  select * into v_delivery
  from public.deliveries d
  where d.order_id = p_order_id
  for update;

  if not found then
    raise exception 'DELIVERY_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.customer_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the customer can confirm this delivery';
  end if;

  if v_delivery.status <> 'delivered_pending_code' then
    raise exception 'DELIVERY_NOT_PENDING';
  end if;

  if v_delivery.failed_attempts >= 5 then
    raise exception 'CODE_LOCKED';
  end if;

  v_hash := encode(digest(trim(p_code), 'sha256'), 'hex');

  if v_hash = v_delivery.code_hash then
    update public.deliveries
    set
      status = 'delivered',
      delivered_at = now(),
      earnings_naira = (
        select delivery_fee_naira from public.orders where id = p_order_id
      )
    where id = v_delivery.id;

    update public.orders set status = 'delivered' where id = p_order_id;
    return true;
  end if;

  update public.deliveries
  set failed_attempts = failed_attempts + 1
  where id = v_delivery.id;

  return false;
end;
$$;

-- ---------- RPC: company owner resolves a locked delivery ----------
create or replace function public.resolve_delivery(
  p_order_id uuid,
  p_resolution text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_delivery public.deliveries;
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
    raise exception 'FORBIDDEN: only the company owner can resolve this delivery';
  end if;

  if p_resolution not in ('delivered', 'cancelled') then
    raise exception 'INVALID_RESOLUTION';
  end if;

  select * into v_delivery
  from public.deliveries d
  where d.order_id = p_order_id;

  if not found then
    raise exception 'DELIVERY_NOT_FOUND';
  end if;

  if v_delivery.status <> 'delivered_pending_code' then
    raise exception 'DELIVERY_NOT_PENDING';
  end if;

  if p_resolution = 'delivered' then
    update public.deliveries
    set
      status = 'delivered',
      delivered_at = now(),
      earnings_naira = v_order.delivery_fee_naira
    where id = v_delivery.id;

    update public.orders set status = 'delivered' where id = p_order_id;
  else
    update public.deliveries
    set status = 'cancelled'
    where id = v_delivery.id;

    update public.orders set status = 'cancelled' where id = p_order_id;
  end if;
end;
$$;

-- ---------- RPC: standalone dispatch rider request ----------
create or replace function public.place_rider_order(
  p_company_id uuid,
  p_pickup_address jsonb,
  p_delivery_address jsonb,
  p_item_description text,
  p_delivery_fee integer,
  p_recipient_name text,
  p_recipient_phone text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  if p_item_description is null or length(trim(p_item_description)) = 0 then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if p_delivery_fee is null or p_delivery_fee <= 0 then
    raise exception 'INVALID_FEE';
  end if;

  insert into public.orders (
    order_number,
    customer_user_id,
    company_id,
    business_user_id,
    kind,
    status,
    item_total_naira,
    delivery_fee_naira,
    total_naira,
    item_description,
    pickup_address,
    delivery_address,
    recipient_name,
    recipient_phone
  )
  values (
    'AZD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_user_id,
    p_company_id,
    null,
    'rider_only',
    'awaiting_payment',
    0,
    p_delivery_fee,
    p_delivery_fee,
    trim(p_item_description),
    p_pickup_address,
    p_delivery_address,
    p_recipient_name,
    p_recipient_phone
  )
  returning * into v_order;

  insert into public.payments (order_id, customer_user_id, company_id, amount_naira, status)
  values (v_order.id, v_user_id, p_company_id, p_delivery_fee, 'awaiting');

  return v_order;
end;
$$;

-- ---------- Permissions: authenticated only ----------
revoke all on function public.verify_delivery_code(uuid, text) from public;
grant execute on function public.verify_delivery_code(uuid, text) to authenticated;

revoke all on function public.resolve_delivery(uuid, text) from public;
grant execute on function public.resolve_delivery(uuid, text) to authenticated;

revoke all on function public.place_rider_order(uuid, jsonb, jsonb, text, integer, text, text) from public;
grant execute on function public.place_rider_order(uuid, jsonb, jsonb, text, integer, text, text) to authenticated;
