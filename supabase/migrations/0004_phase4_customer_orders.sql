-- ============================================================
-- AZ Dispatch — Phase 4: customer shop browsing, cart, order
-- placement and payment slip upload.
-- Order creation and every status transition run through
-- SECURITY DEFINER functions — customers can never set their
-- own order to "payment_confirmed" etc.
-- Payment slips live in a PRIVATE bucket; only the customer,
-- the business owner and the company owner can read them.
-- ============================================================

-- ---------- Storage bucket: payment slips (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {company_id}/{order_id}/slip-{stamp}.{ext}
create policy payment_slips_insert_customer
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[2])::uuid
        and o.customer_user_id = auth.uid()
        and o.status in ('awaiting_payment', 'payment_rejected')
    )
  );

create policy payment_slips_select_related
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[2])::uuid
        and (
          o.customer_user_id = auth.uid()
          or o.business_user_id = auth.uid()
          or exists (
            select 1 from public.companies c
            where c.id = o.company_id and c.owner_user_id = auth.uid()
          )
        )
    )
  );

-- ---------- RLS: customer-facing item browsing ----------
create policy items_select_customer
  on public.items for select
  using (
    is_available
    and listed_on = current_date
    and quantity > 0
    and exists (
      select 1 from public.business_profiles bp
      where bp.user_id = business_user_id and bp.company_id = company_id
    )
  );

create policy item_images_select_customer
  on public.item_images for select
  using (
    exists (
      select 1
      from public.items i
      join public.business_profiles bp
        on bp.user_id = i.business_user_id
        and bp.company_id = i.company_id
      where i.id = item_id
        and i.is_available
        and i.listed_on = current_date
        and i.quantity > 0
    )
  );

create policy business_profiles_select_authenticated
  on public.business_profiles for select
  using (auth.role() = 'authenticated');

-- ---------- RLS: orders & related tables ----------
create policy orders_select_own
  on public.orders for select
  using (auth.uid() = customer_user_id);

create policy orders_select_business
  on public.orders for select
  using (auth.uid() = business_user_id);

create policy orders_select_company_owner
  on public.orders for select
  using (
    exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_user_id = auth.uid()
    )
  );

create policy order_items_select_order_party
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.customer_user_id = auth.uid()
          or o.business_user_id = auth.uid()
          or exists (
            select 1 from public.companies c
            where c.id = o.company_id and c.owner_user_id = auth.uid()
          )
        )
    )
  );

create policy payments_select_order_party
  on public.payments for select
  using (
    customer_user_id = auth.uid()
    or exists (
      select 1 from public.orders o
      where o.id = order_id and o.business_user_id = auth.uid()
    )
    or exists (
      select 1 from public.companies c
      where c.id = company_id and c.owner_user_id = auth.uid()
    )
  );

create unique index payments_order_unique_idx on public.payments (order_id);

-- ---------- RPC: place a shop order ----------
create or replace function public.place_shop_order(
  p_company_id uuid,
  p_business_user_id uuid,
  p_items jsonb,
  p_delivery_address jsonb,
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
  v_elem record;
  v_item_id uuid;
  v_name text;
  v_price integer;
  v_available integer;
  v_qty integer;
  v_item_total integer := 0;
  v_delivery_fee integer := 1500;
  v_total integer := 0;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;

  create temp table _cart_items (
    item_id uuid,
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

    select i.name, i.price_naira, i.quantity
    into v_name, v_price, v_available
    from public.items i
    where i.id = v_item_id
      and i.business_user_id = p_business_user_id
      and i.company_id = p_company_id
      and i.is_available
      and i.listed_on = current_date;

    if not found then
      raise exception 'ITEM_UNAVAILABLE: an item in your cart is no longer available today';
    end if;

    if v_available < v_qty then
      raise exception 'ITEM_UNAVAILABLE: an item in your cart does not have enough quantity left';
    end if;

    insert into _cart_items (item_id, name, price, qty)
    values (v_item_id, v_name, v_price, v_qty);

    v_item_total := v_item_total + (v_price * v_qty);
  end loop;

  v_total := v_item_total + v_delivery_fee;

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
    p_company_id,
    p_business_user_id,
    'shop',
    'awaiting_payment',
    v_item_total,
    v_delivery_fee,
    v_total,
    p_delivery_address,
    p_recipient_name,
    p_recipient_phone
  )
  returning * into v_order;

  insert into public.order_items (order_id, item_id, item_name, unit_price_naira, quantity)
  select v_order.id, c.item_id, c.name, c.price, c.qty from _cart_items c;

  update public.items i
  set quantity = i.quantity - c.qty
  from _cart_items c
  where i.id = c.item_id;

  insert into public.payments (order_id, customer_user_id, company_id, amount_naira, status)
  values (v_order.id, v_user_id, p_company_id, v_total, 'awaiting');

  return v_order;
end;
$$;

-- ---------- RPC: submit a payment slip ----------
create or replace function public.submit_payment_slip(
  p_order_id uuid,
  p_slip_path text,
  p_slip_type text
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
  where o.id = p_order_id and o.customer_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status not in ('awaiting_payment', 'payment_rejected') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;

  if p_slip_type not in ('image', 'pdf') then
    raise exception 'INVALID_SLIP_TYPE';
  end if;

  insert into public.payments (
    order_id, customer_user_id, company_id, amount_naira,
    slip_path, slip_type, status
  )
  values (
    v_order.id, v_order.customer_user_id, v_order.company_id,
    v_order.total_naira, p_slip_path, p_slip_type, 'submitted'
  )
  on conflict (order_id) do update
  set
    slip_path = excluded.slip_path,
    slip_type = excluded.slip_type,
    status = 'submitted',
    rejection_reason = null,
    reviewed_by = null,
    reviewed_at = null;

  update public.orders
  set status = 'payment_submitted'
  where id = v_order.id;
end;
$$;

-- ---------- RPC: cancel an order (customer) ----------
create or replace function public.cancel_order(p_order_id uuid)
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
  where o.id = p_order_id and o.customer_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status not in (
    'draft',
    'awaiting_payment',
    'payment_submitted',
    'payment_rejected',
    'awaiting_business_approval',
    'awaiting_rider'
  ) then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.orders set status = 'cancelled' where id = v_order.id;
end;
$$;

-- ---------- Permissions: authenticated only ----------
revoke all on function public.place_shop_order(uuid, uuid, jsonb, jsonb, text, text) from public;
grant execute on function public.place_shop_order(uuid, uuid, jsonb, jsonb, text, text) to authenticated;

revoke all on function public.submit_payment_slip(uuid, text, text) from public;
grant execute on function public.submit_payment_slip(uuid, text, text) to authenticated;

revoke all on function public.cancel_order(uuid) from public;
grant execute on function public.cancel_order(uuid) to authenticated;
