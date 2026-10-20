-- ============================================================
-- AZ Dispatch — 0016: fix place_shop_order (min(uuid) error).
-- The 0015 version called min(business_user_id) on a uuid
-- column, which Postgres does not support. This version groups
-- the cart with a plain GROUP BY on the uuid column and creates
-- ONE ORDER PER BUSINESS, then returns the id of the last order
-- created (for a single-business cart that is THE order id).
-- Idempotent: create or replace only. Run the whole file.
-- ============================================================

create extension if not exists pgcrypto;

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
  v_order public.orders;
  v_elem record;
  v_item_id uuid;
  v_name text;
  v_price integer;
  v_available integer;
  v_qty integer;
  v_line_business uuid;
  v_group record;
  v_delivery_fee integer := 1500;
  v_total integer := 0;
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

  -- One order per business. GROUP BY on a uuid column is supported
  -- (unlike min()/max()), and sum(integer) is cast back to integer.
  for v_group in
    select c.business_user_id,
           sum(c.price * c.qty)::integer as item_total
    from _cart_items c
    group by c.business_user_id
    order by c.business_user_id
  loop
    v_total := v_group.item_total + v_delivery_fee;

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
      'awaiting_rider',
      v_group.item_total,
      v_delivery_fee,
      v_total,
      p_delivery_address,
      trim(p_recipient_name),
      trim(p_recipient_phone)
    )
    returning * into v_order;

    insert into public.order_items (order_id, item_id, item_name, unit_price_naira, quantity)
    select v_order.id, c.item_id, c.name, c.price, c.qty
    from _cart_items c
    where c.business_user_id = v_group.business_user_id;

    v_last_order_id := v_order.id;
  end loop;

  update public.items i
  set quantity = i.quantity - c.qty
  from _cart_items c
  where i.id = c.item_id;

  return v_last_order_id;
end;
$$;

revoke all on function public.place_shop_order(jsonb, jsonb, text, text) from public;
grant execute on function public.place_shop_order(jsonb, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
