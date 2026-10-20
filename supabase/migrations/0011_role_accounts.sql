-- ============================================================
-- AZ Dispatch — Separate role accounts & self-serve products.
-- * Creates customer_profiles and rider_profiles (business_profiles
--   already exists) linked to auth.users via profiles.
-- * Backfills existing data — NOTHING is deleted.
-- * Removes company approval: businesses can create products
--   immediately; orders no longer require a company or payment step.
-- * Enforces role + data isolation with RLS and function guards.
-- Run in the Supabase SQL Editor after migrations 0001–0010.
-- ============================================================

-- ---------- 1. Per-role profile tables ----------
create table if not exists public.customer_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text,
  default_address jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rider_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  clocked_in boolean not null default false,
  clocked_in_at timestamptz,
  vehicle_type text,
  plate_number text,
  zone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_customer_profiles_updated_at
  before update on public.customer_profiles
  for each row execute function public.set_updated_at();

create trigger trg_rider_profiles_updated_at
  before update on public.rider_profiles
  for each row execute function public.set_updated_at();

-- ---------- 2. Backfill from existing profiles (no data loss) ----------
insert into public.customer_profiles (user_id, phone, default_address)
select p.id, p.phone, p.default_address
from public.profiles p
where exists (
  select 1 from public.roles r
  where r.user_id = p.id and r.role_type = 'customer'
)
on conflict (user_id) do nothing;

insert into public.rider_profiles (user_id, clocked_in, vehicle_type, plate_number, zone)
select
  p.id,
  coalesce((p.rider_profile ->> 'clockedIn')::boolean, false),
  p.rider_profile ->> 'vehicleType',
  p.rider_profile ->> 'plateNumber',
  p.rider_profile ->> 'zone'
from public.profiles p
where p.rider_profile is not null
on conflict (user_id) do nothing;

insert into public.business_profiles (user_id, company_id, business_name)
select p.id, null, p.business_name
from public.profiles p
where exists (
  select 1 from public.roles r
  where r.user_id = p.id and r.role_type = 'business'
)
  and p.business_name is not null
  and not exists (select 1 from public.business_profiles bp where bp.user_id = p.id)
on conflict (user_id) do nothing;

-- ---------- 3. Company becomes optional for products/orders ----------
alter table public.business_profiles alter column company_id drop not null;
alter table public.items alter column company_id drop not null;

-- ---------- 4. Products: no approval, self-serve ----------
drop policy if exists items_insert_approved_business on public.items;

create policy items_insert_own_business
  on public.items for insert
  with check (
    auth.uid() = business_user_id
    and exists (
      select 1 from public.roles r
      where r.user_id = auth.uid()
        and r.role_type = 'business'
        and r.status = 'active'
    )
  );

-- Marketplace: all available products (no daily date filter)
drop policy if exists items_select_customer on public.items;

create policy items_select_customer
  on public.items for select
  using (is_available and quantity > 0);

drop policy if exists item_images_select_customer on public.item_images;

create policy item_images_select_customer
  on public.item_images for select
  using (
    exists (
      select 1 from public.items i
      where i.id = item_id and i.is_available and i.quantity > 0
    )
  );

-- ---------- 5. Business sees orders containing its products ----------
drop policy if exists orders_select_business on public.orders;

create policy orders_select_business
  on public.orders for select
  using (
    exists (
      select 1
      from public.order_items oi
      join public.items i on i.id = oi.item_id
      where oi.order_id = orders.id and i.business_user_id = auth.uid()
    )
  );

-- ---------- 6. Rider visibility requires clocked in ----------
drop policy if exists orders_select_available_rider on public.orders;

create policy orders_select_available_rider
  on public.orders for select
  using (
    status = 'awaiting_rider'
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

-- ---------- 7. accept_delivery: must be clocked in ----------
create or replace function public.accept_delivery(p_order_id uuid)
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

  if v_order.status <> 'awaiting_rider' then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;

  if exists (select 1 from public.deliveries d where d.order_id = p_order_id) then
    raise exception 'ORDER_ALREADY_ACCEPTED';
  end if;

  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');

  insert into public.deliveries (order_id, rider_user_id, status, code_hash, accepted_at)
  values (
    p_order_id,
    auth.uid(),
    'accepted',
    encode(digest(v_code, 'sha256'), 'hex'),
    now()
  );

  update public.orders set status = 'rider_assigned' where id = p_order_id;

  return v_code;
end;
$$;

-- ---------- 8. place_shop_order: multi-business, no company, straight to riders ----------
drop function if exists public.place_shop_order(uuid, uuid, jsonb, jsonb, text, text);

create or replace function public.place_shop_order(
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
      and i.is_available;

    if not found then
      raise exception 'ITEM_UNAVAILABLE: an item in your cart is no longer available';
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
    null,
    null,
    'shop',
    'awaiting_rider',
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

  return v_order;
end;
$$;

-- ---------- 9. place_rider_order: no company, straight to riders ----------
drop function if exists public.place_rider_order(uuid, jsonb, jsonb, text, integer, text, text);

create or replace function public.place_rider_order(
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
    null,
    null,
    'rider_only',
    'awaiting_rider',
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

  return v_order;
end;
$$;

-- ---------- 10. Signup: only the registered role, no auto-customer ----------
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

  v_role := case new.raw_user_meta_data ->> 'role'
    when 'customer' then 'customer'::public.role_type
    when 'rider' then 'rider'::public.role_type
    when 'business' then 'business'::public.role_type
    else null
  end;

  if v_role is not null then
    insert into public.roles (user_id, role_type, company_id, status)
    values (new.id, v_role, null, 'active'::public.role_status)
    on conflict (user_id, role_type) do nothing;

    if v_role = 'business' then
      insert into public.business_profiles (user_id, company_id, business_name)
      values (
        new.id,
        null,
        coalesce(new.raw_user_meta_data ->> 'business_name', split_part(new.email, '@', 1))
      )
      on conflict (user_id) do nothing;
    elsif v_role = 'rider' then
      insert into public.rider_profiles (user_id, clocked_in, vehicle_type, plate_number, zone)
      values (
        new.id,
        false,
        coalesce(new.raw_user_meta_data ->> 'vehicle_type', 'Motorcycle'),
        new.raw_user_meta_data ->> 'plate_number',
        new.raw_user_meta_data ->> 'zone'
      )
      on conflict (user_id) do nothing;
    elsif v_role = 'customer' then
      insert into public.customer_profiles (user_id, phone)
      values (new.id, null)
      on conflict (user_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- ---------- 11. RLS for the new profile tables ----------
alter table public.customer_profiles enable row level security;

create policy customer_profiles_select_own
  on public.customer_profiles for select
  using (auth.uid() = user_id);

create policy customer_profiles_insert_own
  on public.customer_profiles for insert
  with check (auth.uid() = user_id);

create policy customer_profiles_update_own
  on public.customer_profiles for update
  using (auth.uid() = user_id);

alter table public.rider_profiles enable row level security;

create policy rider_profiles_select_any
  on public.rider_profiles for select
  using (auth.role() = 'authenticated');

create policy rider_profiles_insert_own
  on public.rider_profiles for insert
  with check (auth.uid() = user_id);

create policy rider_profiles_update_own
  on public.rider_profiles for update
  using (auth.uid() = user_id);

-- ---------- 12. Grants for the new function signatures ----------
revoke all on function public.place_shop_order(jsonb, jsonb, text, text) from public;
grant execute on function public.place_shop_order(jsonb, jsonb, text, text) to authenticated;

revoke all on function public.place_rider_order(jsonb, jsonb, text, integer, text, text) from public;
grant execute on function public.place_rider_order(jsonb, jsonb, text, integer, text, text) to authenticated;
