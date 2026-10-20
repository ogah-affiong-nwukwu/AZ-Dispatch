-- ============================================================
-- AZ Dispatch — 0017: full order flow (pickup & delivery codes).
-- ONE idempotent migration. Nothing is dropped except functions,
-- triggers and policies (all recreated). NO DATA IS DELETED.
-- Ends with: notify pgrst, 'reload schema';
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. NEW ORDER STATUSES (added to the existing enum — no data loss)
-- ============================================================
alter type public.order_status add value if not exists 'placed';
alter type public.order_status add value if not exists 'rider_requested';
alter type public.order_status add value if not exists 'rider_accepted';
alter type public.order_status add value if not exists 'arrived_at_pickup';
alter type public.order_status add value if not exists 'pickup_verified';
alter type public.order_status add value if not exists 'arrived_at_destination';

-- ============================================================
-- 2. NEW / EXTENDED COLUMNS
-- ============================================================
alter table public.orders add column if not exists pickup_phone text;
alter table public.orders add column if not exists linked_order_id uuid
  references public.orders (id) on delete set null;

alter table public.business_profiles add column if not exists business_address text;
alter table public.business_profiles add column if not exists business_phone text;

alter table public.notifications add column if not exists order_id uuid;

-- ============================================================
-- 3. ORDER CODES (pickup + delivery, one row per order)
--    Nobody can read these columns directly: they are exposed
--    only through SECURITY DEFINER getters that check the caller.
-- ============================================================
create table if not exists public.order_codes (
  order_id uuid primary key references public.orders (id) on delete cascade,
  pickup_code text,
  delivery_code text,
  pickup_attempts integer not null default 0,
  delivery_attempts integer not null default 0,
  pickup_locked boolean not null default false,
  delivery_locked boolean not null default false,
  pickup_verified boolean not null default false,
  business_confirmed boolean not null default false,
  delivery_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_codes enable row level security;

drop policy if exists order_codes_select_own on public.order_codes;
create policy order_codes_select_own
  on public.order_codes for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.customer_user_id = auth.uid()
    )
    or exists (
      select 1 from public.orders o
      where o.id = order_id and o.business_user_id = auth.uid()
    )
  );

-- Column security: even the row owners cannot read the codes directly.
revoke select on public.order_codes from anon, authenticated;
revoke select (pickup_code, delivery_code) on public.order_codes from anon, authenticated;

-- ============================================================
-- 4. HELPER: notify user (kept from earlier phases)
-- ============================================================
create or replace function public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text default 'info',
  p_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, title, body, kind, order_id)
  values (p_user_id, p_title, p_body, p_kind, p_order_id);
end;
$$;

-- ============================================================
-- 5. place_shop_order — NO delivery fee, status 'placed',
--    one order per business, notifies the business, returns id.
-- ============================================================
drop function if exists public.place_shop_order(uuid, uuid, jsonb, jsonb, text, text);
drop function if exists public.place_shop_order(jsonb, jsonb, text, text);

create or replace function public.place_shop_order(
  p_items jsonb,
  p_delivery_address jsonb,
  p_recipient_name text,
  p_recipient_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_customer_name text;
  v_order public.orders;
  v_elem record;
  v_item_id uuid;
  v_name text;
  v_price integer;
  v_available integer;
  v_qty integer;
  v_line_business uuid;
  v_group record;
  v_last_order_id uuid := null;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.customer_profiles cp where cp.user_id = v_user_id
  ) then
    raise exception 'CUSTOMER_PROFILE_REQUIRED: complete your customer profile before ordering';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;

  if p_delivery_address is null
     or jsonb_typeof(p_delivery_address) <> 'object'
     or p_delivery_address = '{}'::jsonb then
    raise exception 'ADDRESS_REQUIRED: enter a delivery address';
  end if;

  if p_recipient_name is null or length(trim(p_recipient_name)) = 0 then
    raise exception 'RECIPIENT_NAME_REQUIRED';
  end if;

  if p_recipient_phone is null or length(trim(p_recipient_phone)) = 0 then
    raise exception 'RECIPIENT_PHONE_REQUIRED';
  end if;

  select p.full_name into v_customer_name from public.profiles p where p.id = v_user_id;

  create temp table _cart_items (
    item_id uuid,
    business_user_id uuid,
    name text,
    price integer,
    qty integer
  ) on commit drop;

  for v_elem in
    select elem.value
    from jsonb_array_elements(p_items) as elem
  loop
    v_item_id := (v_elem.value ->> 'item_id')::uuid;
    v_qty := coalesce((v_elem.value ->> 'quantity')::int, 0);

    if v_item_id is null or v_qty <= 0 then
      raise exception 'INVALID_CART';
    end if;

    select i.name, i.price_naira, i.quantity, i.business_user_id
    into v_name, v_price, v_available, v_line_business
    from public.items i
    where i.id = v_item_id
      and i.is_available;

    if not found then
      raise exception 'ITEM_UNAVAILABLE: an item in your cart is no longer available';
    end if;

    if v_available < v_qty then
      raise exception 'ITEM_UNAVAILABLE: an item in your cart does not have enough quantity left';
    end if;

    insert into _cart_items (item_id, business_user_id, name, price, qty)
    values (v_item_id, v_line_business, v_name, v_price, v_qty);
  end loop;

  -- One order per business. No delivery fee on the shop bill.
  for v_group in
    select c.business_user_id,
           sum(c.price * c.qty)::integer as item_total
    from _cart_items c
    group by c.business_user_id
    order by c.business_user_id
  loop
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
      delivery_address,
      recipient_name,
      recipient_phone
    )
    values (
      'AZD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
      v_user_id,
      null,
      v_group.business_user_id,
      'shop',
      'placed',
      v_group.item_total,
      0,
      v_group.item_total,
      p_delivery_address,
      trim(p_recipient_name),
      trim(p_recipient_phone)
    )
    returning * into v_order;

    insert into public.order_items (order_id, item_id, item_name, unit_price_naira, quantity)
    select v_order.id, c.item_id, c.name, c.price, c.qty
    from _cart_items c
    where c.business_user_id = v_group.business_user_id;

    perform public.notify_user(
      v_group.business_user_id,
      'New order',
      'New order from ' || coalesce(v_customer_name, 'a customer'),
      'order',
      v_order.id
    );

    v_last_order_id := v_order.id;
  end loop;

  update public.items i
  set quantity = i.quantity - c.qty
  from _cart_items c
  where i.id = c.item_id;

  return v_last_order_id;
end;
$$;

-- ============================================================
-- 6. place_rider_order — rider-only request (no products).
-- ============================================================
drop function if exists public.place_rider_order(uuid, jsonb, jsonb, text, integer, text, text);
drop function if exists public.place_rider_order(jsonb, jsonb, text, integer, text, text);

create or replace function public.place_rider_order(
  p_pickup_address jsonb,
  p_pickup_phone text,
  p_delivery_address jsonb,
  p_delivery_phone text,
  p_item_description text,
  p_delivery_fee integer,
  p_recipient_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders;
  v_rider record;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_pickup_address is null
     or jsonb_typeof(p_pickup_address) <> 'object'
     or p_pickup_address = '{}'::jsonb then
    raise exception 'PICKUP_ADDRESS_REQUIRED';
  end if;

  if p_pickup_phone is null or length(trim(p_pickup_phone)) = 0 then
    raise exception 'PICKUP_PHONE_REQUIRED';
  end if;

  if p_delivery_address is null
     or jsonb_typeof(p_delivery_address) <> 'object'
     or p_delivery_address = '{}'::jsonb then
    raise exception 'ADDRESS_REQUIRED: enter a delivery address';
  end if;

  if p_delivery_phone is null or length(trim(p_delivery_phone)) = 0 then
    raise exception 'RECIPIENT_PHONE_REQUIRED';
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
    pickup_phone,
    delivery_address,
    recipient_name,
    recipient_phone
  )
  values (
    'AZD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_user_id,
    null,
    null,
    'rider_only',
    'rider_requested',
    0,
    p_delivery_fee,
    p_delivery_fee,
    trim(p_item_description),
    p_pickup_address,
    trim(p_pickup_phone),
    p_delivery_address,
    trim(p_recipient_name),
    trim(p_delivery_phone)
  )
  returning * into v_order;

  for v_rider in
    select r.user_id
    from public.roles r
    join public.rider_profiles rp on rp.user_id = r.user_id
    where r.role_type = 'rider' and r.status = 'active' and rp.clocked_in
  loop
    perform public.notify_user(v_rider.user_id, 'New job available', 'Order ' || v_order.order_number || ' is waiting for a rider.', 'order', v_order.id);
  end loop;

  return v_order.id;
end;
$$;

-- ============================================================
-- 7. request_rider_for_order — link a rider request to a placed
--    shop order (same order keeps ONE timeline).
-- ============================================================
create or replace function public.request_rider_for_order(
  p_order_id uuid,
  p_pickup_address jsonb,
  p_pickup_phone text,
  p_delivery_address jsonb,
  p_delivery_phone text,
  p_item_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rider record;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the customer can request a rider for this order';
  end if;

  if v_order.kind <> 'shop' or v_order.status <> 'placed' then
    raise exception 'ORDER_NOT_REQUESTABLE';
  end if;

  if p_pickup_address is null
     or jsonb_typeof(p_pickup_address) <> 'object'
     or p_pickup_address = '{}'::jsonb then
    raise exception 'PICKUP_ADDRESS_REQUIRED';
  end if;

  if p_pickup_phone is null or length(trim(p_pickup_phone)) = 0 then
    raise exception 'PICKUP_PHONE_REQUIRED';
  end if;

  if p_delivery_address is null
     or jsonb_typeof(p_delivery_address) <> 'object'
     or p_delivery_address = '{}'::jsonb then
    raise exception 'ADDRESS_REQUIRED: enter a delivery address';
  end if;

  if p_delivery_phone is null or length(trim(p_delivery_phone)) = 0 then
    raise exception 'RECIPIENT_PHONE_REQUIRED';
  end if;

  update public.orders
  set
    pickup_address = p_pickup_address,
    pickup_phone = trim(p_pickup_phone),
    delivery_address = p_delivery_address,
    recipient_phone = trim(p_delivery_phone),
    item_description = coalesce(trim(p_item_description), item_description),
    status = 'rider_requested'
  where id = p_order_id;

  for v_rider in
    select r.user_id
    from public.roles r
    join public.rider_profiles rp on rp.user_id = r.user_id
    where r.role_type = 'rider' and r.status = 'active' and rp.clocked_in
  loop
    perform public.notify_user(v_rider.user_id, 'New job available', 'Order ' || v_order.order_number || ' is waiting for a rider.', 'order', p_order_id);
  end loop;
end;
$$;

-- ============================================================
-- 8. accept_rider_request — clocked-in riders only, first wins.
-- ============================================================
create or replace function public.accept_rider_request(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.rider_profiles rp
    where rp.user_id = auth.uid() and rp.clocked_in
  ) then
    raise exception 'NOT_CLOCKED_IN: clock in to accept orders';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.user_id = auth.uid()
      and r.role_type = 'rider'
      and r.status = 'active'
  ) then
    raise exception 'FORBIDDEN: only a registered rider can accept the job';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'rider_requested' then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;

  if exists (select 1 from public.deliveries d where d.order_id = p_order_id) then
    raise exception 'ORDER_ALREADY_ACCEPTED';
  end if;

  insert into public.deliveries (order_id, rider_user_id, status, accepted_at)
  values (p_order_id, auth.uid(), 'accepted', now());

  update public.orders set status = 'rider_accepted' where id = p_order_id;

  perform public.notify_user(v_order.customer_user_id, 'Rider accepted', 'A rider is on the way for order ' || v_order.order_number || '.', 'order', p_order_id);
  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Rider accepted', 'A rider accepted order ' || v_order.order_number || '.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 9. Pickup flow
-- ============================================================
create or replace function public.rider_arrived_pickup(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.deliveries d
    where d.order_id = p_order_id and d.rider_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the assigned rider can update this job';
  end if;

  if v_order.status <> 'rider_accepted' then
    raise exception 'ORDER_NOT_ACCEPTED';
  end if;

  if v_order.business_user_id is null then
    -- Rider-only request: no business pickup check.
    update public.orders set status = 'picked_up' where id = p_order_id;
    update public.deliveries set status = 'picked_up', picked_up_at = now() where order_id = p_order_id;
    perform public.notify_user(v_order.customer_user_id, 'Order picked up', 'Order ' || v_order.order_number || ' is on its way to you.', 'order', p_order_id);
    return;
  end if;

  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');

  insert into public.order_codes (order_id, pickup_code, pickup_attempts, pickup_locked, pickup_verified, business_confirmed, delivery_verified)
  values (p_order_id, v_code, 0, false, false, false, false)
  on conflict (order_id) do update
  set
    pickup_code = excluded.pickup_code,
    pickup_attempts = 0,
    pickup_locked = false,
    pickup_verified = false,
    business_confirmed = false;

  update public.orders set status = 'arrived_at_pickup' where id = p_order_id;

  perform public.notify_user(
    v_order.business_user_id,
    'Rider at your door',
    'The rider arrived for order ' || v_order.order_number || '. Give the 6-digit pickup code to the customer over the phone, then confirm the rider.',
    'order',
    p_order_id
  );
end;
$$;

create or replace function public.verify_pickup_code(
  p_order_id uuid,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_codes public.order_codes;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.deliveries d
    where d.order_id = p_order_id and d.rider_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the assigned rider can verify the pickup';
  end if;

  if v_order.status not in ('arrived_at_pickup', 'pickup_verified') then
    raise exception 'NOT_AT_PICKUP';
  end if;

  select * into v_codes from public.order_codes c where c.order_id = p_order_id for update;

  if not found then
    raise exception 'NO_CODE';
  end if;

  if v_codes.pickup_locked then
    raise exception 'CODE_LOCKED';
  end if;

  if p_code is null or length(trim(p_code)) <> 6 or trim(p_code) <> v_codes.pickup_code then
    update public.order_codes
    set pickup_attempts = pickup_attempts + 1,
        pickup_locked = case when pickup_attempts + 1 >= 5 then true else pickup_locked end
    where order_id = p_order_id;

    if exists (select 1 from public.order_codes c where c.order_id = p_order_id and c.pickup_locked) then
      perform public.notify_user(v_order.business_user_id, 'Pickup code locked', 'Too many wrong pickup attempts for ' || v_order.order_number || '.', 'order', p_order_id);
    end if;

    return false;
  end if;

  update public.order_codes
  set pickup_verified = true, pickup_attempts = 0
  where order_id = p_order_id;

  if exists (
    select 1 from public.order_codes c
    where c.order_id = p_order_id and c.business_confirmed
  ) then
    update public.orders set status = 'picked_up' where id = p_order_id;
    update public.deliveries set status = 'picked_up', picked_up_at = now() where order_id = p_order_id;
    perform public.notify_user(v_order.customer_user_id, 'Order picked up', 'Order ' || v_order.order_number || ' is on its way to you.', 'order', p_order_id);
  else
    update public.orders set status = 'pickup_verified' where id = p_order_id;
  end if;

  return true;
end;
$$;

create or replace function public.business_confirm_rider(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.business_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the business can confirm the rider';
  end if;

  if v_order.status not in ('arrived_at_pickup', 'pickup_verified') then
    raise exception 'NOT_AT_PICKUP';
  end if;

  update public.order_codes set business_confirmed = true where order_id = p_order_id;

  if exists (
    select 1 from public.order_codes c
    where c.order_id = p_order_id and c.pickup_verified
  ) then
    update public.orders set status = 'picked_up' where id = p_order_id;
    update public.deliveries set status = 'picked_up', picked_up_at = now() where order_id = p_order_id;
    perform public.notify_user(v_order.customer_user_id, 'Order picked up', 'Order ' || v_order.order_number || ' is on its way to you.', 'order', p_order_id);
  else
    update public.orders set status = 'pickup_verified' where id = p_order_id;
  end if;
end;
$$;

-- ============================================================
-- 10. Delivery flow
-- ============================================================
create or replace function public.rider_arrived_destination(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.deliveries d
    where d.order_id = p_order_id and d.rider_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the assigned rider can update this job';
  end if;

  if v_order.status <> 'picked_up' then
    raise exception 'ORDER_NOT_PICKED_UP';
  end if;

  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');

  insert into public.order_codes (order_id, delivery_code, delivery_attempts, delivery_locked, delivery_verified)
  values (p_order_id, v_code, 0, false, false)
  on conflict (order_id) do update
  set
    delivery_code = excluded.delivery_code,
    delivery_attempts = 0,
    delivery_locked = false,
    delivery_verified = false;

  update public.orders set status = 'arrived_at_destination' where id = p_order_id;
  update public.deliveries set status = 'delivered_pending_code' where order_id = p_order_id;

  perform public.notify_user(
    v_order.customer_user_id,
    'Rider has arrived',
    'Order ' || v_order.order_number || ': your delivery code is ' || v_code || '. Tell it to the rider.',
    'order',
    p_order_id
  );
end;
$$;

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
  v_order public.orders;
  v_codes public.order_codes;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.deliveries d
    where d.order_id = p_order_id and d.rider_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the assigned rider can verify the delivery';
  end if;

  if v_order.status <> 'arrived_at_destination' then
    raise exception 'NOT_AT_DESTINATION';
  end if;

  select * into v_codes from public.order_codes c where c.order_id = p_order_id for update;

  if not found then
    raise exception 'NO_CODE';
  end if;

  if v_codes.delivery_locked then
    raise exception 'CODE_LOCKED';
  end if;

  if p_code is null or length(trim(p_code)) <> 6 or trim(p_code) <> v_codes.delivery_code then
    update public.order_codes
    set delivery_attempts = delivery_attempts + 1,
        delivery_locked = case when delivery_attempts + 1 >= 5 then true else delivery_locked end
    where order_id = p_order_id;

    if exists (select 1 from public.order_codes c where c.order_id = p_order_id and c.delivery_locked) then
      perform public.notify_user(v_order.customer_user_id, 'Delivery code locked', 'Too many wrong delivery attempts for ' || v_order.order_number || '.', 'order', p_order_id);
      if v_order.business_user_id is not null then
        perform public.notify_user(v_order.business_user_id, 'Delivery code locked', 'Too many wrong delivery attempts for ' || v_order.order_number || '.', 'order', p_order_id);
      end if;
    end if;

    return false;
  end if;

  update public.order_codes
  set delivery_verified = true, delivery_attempts = 0
  where order_id = p_order_id;

  perform public.notify_user(v_order.customer_user_id, 'Code verified', 'The rider verified the code for ' || v_order.order_number || '. Confirm you received your order.', 'order', p_order_id);

  return true;
end;
$$;

create or replace function public.customer_confirm_received(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the customer can confirm receipt';
  end if;

  if v_order.status <> 'arrived_at_destination' then
    raise exception 'NOT_AT_DESTINATION';
  end if;

  if not exists (
    select 1 from public.order_codes c
    where c.order_id = p_order_id and c.delivery_verified
  ) then
    raise exception 'NOT_VERIFIED: the rider has not entered your delivery code yet';
  end if;

  update public.orders set status = 'delivered' where id = p_order_id;
  update public.deliveries
  set status = 'delivered', delivered_at = now()
  where order_id = p_order_id;

  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Order delivered', 'Order ' || v_order.order_number || ' was delivered.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 11. SECURE CODE GETTERS (only via these functions)
-- ============================================================
create or replace function public.get_pickup_code(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found or v_order.business_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the business can read the pickup code';
  end if;

  select pickup_code into v_code from public.order_codes c where c.order_id = p_order_id;

  if v_code is null then
    raise exception 'NO_CODE';
  end if;

  return v_code;
end;
$$;

create or replace function public.get_delivery_code(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found or v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the customer can read the delivery code';
  end if;

  select delivery_code into v_code from public.order_codes c where c.order_id = p_order_id;

  if v_code is null then
    raise exception 'NO_CODE';
  end if;

  return v_code;
end;
$$;

-- Progress flags for the UI (order parties only; codes excluded).
create or replace function public.get_order_progress(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_codes public.order_codes;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid()
     and v_order.business_user_id <> auth.uid()
     and not exists (
       select 1 from public.deliveries d
       where d.order_id = p_order_id and d.rider_user_id = auth.uid()
     ) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_codes from public.order_codes c where c.order_id = p_order_id;

  return jsonb_build_object(
    'pickupVerified', coalesce(v_codes.pickup_verified, false),
    'businessConfirmed', coalesce(v_codes.business_confirmed, false),
    'deliveryVerified', coalesce(v_codes.delivery_verified, false),
    'pickupLocked', coalesce(v_codes.pickup_locked, false),
    'deliveryLocked', coalesce(v_codes.delivery_locked, false),
    'pickupAttempts', coalesce(v_codes.pickup_attempts, 0),
    'deliveryAttempts', coalesce(v_codes.delivery_attempts, 0)
  );
end;
$$;

-- Rider identity for the business / customer (name, phone, vehicle).
create or replace function public.get_rider_identity(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rider record;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid()
     and v_order.business_user_id <> auth.uid()
     and not exists (
       select 1 from public.deliveries d
       where d.order_id = p_order_id and d.rider_user_id = auth.uid()
     ) then
    raise exception 'FORBIDDEN';
  end if;

  select
    p.full_name,
    p.phone,
    rp.vehicle_type,
    rp.plate_number
  into v_rider
  from public.deliveries d
  join public.profiles p on p.id = d.rider_user_id
  left join public.rider_profiles rp on rp.user_id = d.rider_user_id
  where d.order_id = p_order_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'fullName', v_rider.full_name,
    'phone', v_rider.phone,
    'vehicleType', v_rider.vehicle_type,
    'plateNumber', v_rider.plate_number
  );
end;
$$;

-- ============================================================
-- 12. RLS UPDATE: riders see 'rider_requested' orders
-- ============================================================
drop policy if exists orders_select_available_rider on public.orders;
create policy orders_select_available_rider
  on public.orders for select to authenticated
  using (
    status = 'rider_requested'
    and exists (
      select 1 from public.roles r
      where r.user_id = auth.uid()
        and r.role_type = 'rider'
        and r.status = 'active'
    )
    and exists (
      select 1 from public.rider_profiles rp
      where rp.user_id = auth.uid() and rp.clocked_in
    )
  );

-- ============================================================
-- 13. REALTIME for notifications
-- ============================================================
alter table public.notifications replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- ============================================================
-- 14. GRANTS
-- ============================================================
revoke all on function public.place_shop_order(jsonb, jsonb, text, text) from public;
grant execute on function public.place_shop_order(jsonb, jsonb, text, text) to authenticated;

revoke all on function public.place_rider_order(jsonb, text, jsonb, text, text, integer, text) from public;
grant execute on function public.place_rider_order(jsonb, text, jsonb, text, text, integer, text) to authenticated;

revoke all on function public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text) from public;
grant execute on function public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text) to authenticated;

revoke all on function public.accept_rider_request(uuid) from public;
grant execute on function public.accept_rider_request(uuid) to authenticated;

revoke all on function public.rider_arrived_pickup(uuid) from public;
grant execute on function public.rider_arrived_pickup(uuid) to authenticated;

revoke all on function public.verify_pickup_code(uuid, text) from public;
grant execute on function public.verify_pickup_code(uuid, text) to authenticated;

revoke all on function public.business_confirm_rider(uuid) from public;
grant execute on function public.business_confirm_rider(uuid) to authenticated;

revoke all on function public.rider_arrived_destination(uuid) from public;
grant execute on function public.rider_arrived_destination(uuid) to authenticated;

revoke all on function public.verify_delivery_code(uuid, text) from public;
grant execute on function public.verify_delivery_code(uuid, text) to authenticated;

revoke all on function public.customer_confirm_received(uuid) from public;
grant execute on function public.customer_confirm_received(uuid) to authenticated;

revoke all on function public.get_pickup_code(uuid) from public;
grant execute on function public.get_pickup_code(uuid) to authenticated;

revoke all on function public.get_delivery_code(uuid) from public;
grant execute on function public.get_delivery_code(uuid) to authenticated;

revoke all on function public.get_order_progress(uuid) from public;
grant execute on function public.get_order_progress(uuid) to authenticated;

revoke all on function public.get_rider_identity(uuid) from public;
grant execute on function public.get_rider_identity(uuid) to authenticated;

revoke all on function public.notify_user(uuid, text, text, text, uuid) from public;
grant execute on function public.notify_user(uuid, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
