-- ============================================================
-- AZ Dispatch — 0020: rider quotes, secure order lists, prep-time
-- gate, and RLS/realtime repairs. RUN AFTER 0019.
--
-- * get_business_orders() / get_customer_orders(): SECURITY DEFINER
--   order lists (orders + items + customer name/phone) so the
--   business and customer pages always see their orders.
-- * Rider quotes the delivery fee (rider_quote_price), customer
--   accepts or declines (customer_accept_quote /
--   customer_decline_quote). A quote holds the request for
--   QUOTE_HOLD interval '5 minutes'.
-- * The customer never types a price: place_rider_order loses the
--   delivery-fee argument; shop orders keep delivery_fee_naira = 0.
-- * business_accept_order now REQUIRES a preparation time and tells
--   the customer "{Business} will have your food ready in N minutes".
-- * request_rider_for_order only works AFTER the business accepted
--   (prep gate).
-- * Orders + order_items join the supabase_realtime publication.
--
-- Idempotent. Nothing is dropped except functions, triggers and
-- policies (all recreated). NO DATA IS DELETED.
-- Ends with: notify pgrst, 'reload schema';
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 0. DEFENSIVE FALLBACKS (idempotent — these normally come from
--    earlier migrations; recreated here so 0020 is self-contained)
-- ============================================================

-- The generic order-status trigger trg_orders_notify runs
-- notify_order_status_change(), whose body calls notify_user.
-- 0020 removes that trigger for good (see section 7), so drop it
-- FIRST — before any function below is dropped and recreated — so
-- nothing depends on the functions being redefined.
drop trigger if exists trg_orders_notify on public.orders;

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_role text,
  event text not null,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx
  on public.order_events (order_id, created_at);

alter table public.order_events enable row level security;

drop policy if exists order_events_select_party on public.order_events;
create policy order_events_select_party
  on public.order_events for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.customer_user_id = auth.uid()
          or o.business_user_id = auth.uid()
          or exists (
            select 1 from public.deliveries d
            where d.order_id = o.id and d.rider_user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists order_events_insert_party on public.order_events;
create policy order_events_insert_party
  on public.order_events for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.customer_user_id = auth.uid()
          or o.business_user_id = auth.uid()
          or exists (
            select 1 from public.deliveries d
            where d.order_id = o.id and d.rider_user_id = auth.uid()
          )
        )
    )
  );

drop function if exists public.log_order_event(uuid, uuid, text, text, text);
create or replace function public.log_order_event(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_event text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_events (order_id, actor_user_id, actor_role, event, details)
  values (p_order_id, p_actor_user_id, p_actor_role, p_event, p_details);
end;
$$;

drop function if exists public.notify_user(uuid, text, text, text, uuid);
create or replace function public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text,
  p_order_id uuid
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
-- 1. NEW COLUMNS (nullable — no data loss)
-- ============================================================
alter table public.orders add column if not exists quoted_fee_naira integer;
alter table public.orders add column if not exists quote_rider_user_id uuid
  references public.profiles (id) on delete set null;
alter table public.orders add column if not exists quote_expires_at timestamptz;
alter table public.orders add column if not exists prep_minutes integer;
alter table public.orders add column if not exists business_accepted_at timestamptz;
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists rider_requested_at timestamptz;

-- ============================================================
-- 2. RLS REPAIRS
-- ============================================================

-- Riders can see requests while they are open for quotes
-- (rider_requested) AND while a quote is held (rider_quoted).
drop policy if exists orders_select_available_rider on public.orders;
create policy orders_select_available_rider
  on public.orders for select to authenticated
  using (
    status in ('rider_requested', 'rider_quoted')
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

-- A business must be able to read the name and phone of the
-- customers who ordered from it (this policy was dropped in 0015,
-- which is why the business order list joined to profiles could
-- come back empty).
drop policy if exists profiles_select_order_business on public.profiles;
create policy profiles_select_order_business
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.customer_user_id = profiles.id
        and o.business_user_id = auth.uid()
    )
  );

-- Riders see the items of requests that are open for quotes,
-- not only the items of jobs already assigned to them.
drop policy if exists order_items_select_rider on public.order_items;
create policy order_items_select_rider
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.deliveries d
      where d.order_id = order_items.order_id
        and d.rider_user_id = auth.uid()
    )
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.status in ('rider_requested', 'rider_quoted')
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
    )
  );

-- ============================================================
-- 3. SECURE ORDER LIST GETTERS
--    The client no longer builds the list with a direct PostgREST
--    select (which failed under RLS because the business could not
--    read the joined customer profiles). These SECURITY DEFINER
--    functions return everything the UI needs in one call.
-- ============================================================

drop function if exists public.get_business_orders();
create or replace function public.get_business_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  return coalesce((
    select jsonb_agg(o.json order by o.created_at desc)
    from (
      select
        ord.created_at,
        jsonb_build_object(
          'id', ord.id,
          'order_number', ord.order_number,
          'customer_user_id', ord.customer_user_id,
          'company_id', ord.company_id,
          'business_user_id', ord.business_user_id,
          'kind', ord.kind,
          'status', ord.status,
          'item_total_naira', ord.item_total_naira,
          'delivery_fee_naira', ord.delivery_fee_naira,
          'total_naira', ord.total_naira,
          'item_description', ord.item_description,
          'pickup_address', ord.pickup_address,
          'pickup_phone', ord.pickup_phone,
          'delivery_address', ord.delivery_address,
          'recipient_name', ord.recipient_name,
          'recipient_phone', ord.recipient_phone,
          'linked_order_id', ord.linked_order_id,
          'prep_minutes', ord.prep_minutes,
          'business_accepted_at', ord.business_accepted_at,
          'ready_at', ord.ready_at,
          'rider_requested_at', ord.rider_requested_at,
          'waiting_deadline', ord.waiting_deadline,
          'decline_reason', ord.decline_reason,
          'failure_reason', ord.failure_reason,
          'quoted_fee_naira', ord.quoted_fee_naira,
          'quote_rider_user_id', ord.quote_rider_user_id,
          'quote_expires_at', ord.quote_expires_at,
          'created_at', ord.created_at,
          'updated_at', ord.updated_at,
          'customer_name', p.full_name,
          'customer_phone', p.phone,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', oi.id,
              'order_id', oi.order_id,
              'item_id', oi.item_id,
              'item_name', oi.item_name,
              'unit_price_naira', oi.unit_price_naira,
              'quantity', oi.quantity,
              'created_at', oi.created_at
            ) order by oi.created_at)
            from public.order_items oi
            where oi.order_id = ord.id
          ), '[]'::jsonb),
          'delivery', (
            select jsonb_build_object(
              'id', d.id,
              'status', d.status,
              'failed_attempts', d.failed_attempts
            )
            from public.deliveries d
            where d.order_id = ord.id
          ),
          'payment', null
        ) as json
      from public.orders ord
      join public.profiles p on p.id = ord.customer_user_id
      where ord.business_user_id = v_user
         or exists (
           select 1
           from public.order_items oi
           join public.items i on i.id = oi.item_id
           where oi.order_id = ord.id and i.business_user_id = v_user
         )
    ) o
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.get_customer_orders();
create or replace function public.get_customer_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  return coalesce((
    select jsonb_agg(o.json order by o.created_at desc)
    from (
      select
        ord.created_at,
        jsonb_build_object(
          'id', ord.id,
          'order_number', ord.order_number,
          'customer_user_id', ord.customer_user_id,
          'company_id', ord.company_id,
          'business_user_id', ord.business_user_id,
          'kind', ord.kind,
          'status', ord.status,
          'item_total_naira', ord.item_total_naira,
          'delivery_fee_naira', ord.delivery_fee_naira,
          'total_naira', ord.total_naira,
          'item_description', ord.item_description,
          'pickup_address', ord.pickup_address,
          'pickup_phone', ord.pickup_phone,
          'delivery_address', ord.delivery_address,
          'recipient_name', ord.recipient_name,
          'recipient_phone', ord.recipient_phone,
          'linked_order_id', ord.linked_order_id,
          'prep_minutes', ord.prep_minutes,
          'business_accepted_at', ord.business_accepted_at,
          'ready_at', ord.ready_at,
          'rider_requested_at', ord.rider_requested_at,
          'waiting_deadline', ord.waiting_deadline,
          'decline_reason', ord.decline_reason,
          'failure_reason', ord.failure_reason,
          'quoted_fee_naira', ord.quoted_fee_naira,
          'quote_rider_user_id', ord.quote_rider_user_id,
          'quote_expires_at', ord.quote_expires_at,
          'created_at', ord.created_at,
          'updated_at', ord.updated_at,
          'business_name', bp.business_name,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', oi.id,
              'order_id', oi.order_id,
              'item_id', oi.item_id,
              'item_name', oi.item_name,
              'unit_price_naira', oi.unit_price_naira,
              'quantity', oi.quantity,
              'created_at', oi.created_at
            ) order by oi.created_at)
            from public.order_items oi
            where oi.order_id = ord.id
          ), '[]'::jsonb),
          'delivery', (
            select jsonb_build_object(
              'id', d.id,
              'status', d.status,
              'failed_attempts', d.failed_attempts
            )
            from public.deliveries d
            where d.order_id = ord.id
          ),
          'payment', null
        ) as json
      from public.orders ord
      left join public.business_profiles bp on bp.user_id = ord.business_user_id
      where ord.customer_user_id = v_user
    ) o
  ), '[]'::jsonb);
end;
$$;

-- ============================================================
-- 4. RIDER QUOTES
--    rider_quote_price: a clocked-in rider quotes a fee in naira.
--    The request is HELD for that rider for QUOTE_HOLD (5 minutes)
--    so other riders cannot quote/take it at the same time.
--    customer_accept_quote assigns the rider and stores the fee.
--    customer_decline_quote releases the hold.
-- ============================================================

drop function if exists public.rider_quote_price(uuid, integer);
create or replace function public.rider_quote_price(
  p_order_id uuid,
  p_fee_naira integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rider_name text;
  v_vehicle text;
  -- CHANGE THE HOLD LENGTH HERE (single constant, easy to change):
  v_hold interval := interval '5 minutes';
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.rider_profiles rp
    where rp.user_id = auth.uid() and rp.clocked_in
  ) then
    raise exception 'NOT_CLOCKED_IN: clock in to quote a price';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.user_id = auth.uid()
      and r.role_type = 'rider'
      and r.status = 'active'
  ) then
    raise exception 'FORBIDDEN: only a registered rider can quote a price';
  end if;

  if p_fee_naira is null or p_fee_naira <= 0 then
    raise exception 'INVALID_FEE: enter the delivery fee in naira';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status <> 'rider_requested' and v_order.status <> 'rider_quoted' then
    raise exception 'ORDER_NOT_QUOTABLE: this request is no longer open';
  end if;

  -- A hold by ANOTHER rider that has not expired blocks the quote.
  if v_order.quote_rider_user_id is not null
     and v_order.quote_rider_user_id <> auth.uid()
     and v_order.quote_expires_at is not null
     and v_order.quote_expires_at >= now() then
    raise exception 'HELD_BY_ANOTHER_RIDER: another rider holds this request';
  end if;

  select p.full_name, rp.vehicle_type
  into v_rider_name, v_vehicle
  from public.profiles p
  left join public.rider_profiles rp on rp.user_id = p.id
  where p.id = auth.uid();

  update public.orders
  set
    status = 'rider_quoted',
    quoted_fee_naira = p_fee_naira,
    quote_rider_user_id = auth.uid(),
    quote_expires_at = now() + v_hold
  where id = p_order_id;

  perform public.log_order_event(
    p_order_id, auth.uid(), 'rider', 'rider_quoted', p_fee_naira::text
  );

  perform public.notify_user(
    v_order.customer_user_id,
    'New quote for your order',
    'Rider ' || coalesce(v_rider_name, 'a rider')
      || coalesce(' (' || v_vehicle || ')', '')
      || ' quoted ₦' || p_fee_naira || ' for order ' || v_order.order_number
      || '. Accept or decline within 5 minutes.',
    'order',
    p_order_id
  );
end;
$$;

drop function if exists public.customer_accept_quote(uuid);
create or replace function public.customer_accept_quote(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rider_name text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the customer can accept a quote';
  end if;

  if v_order.status <> 'rider_quoted' then
    raise exception 'NO_QUOTE: there is no quote to accept';
  end if;

  if v_order.quote_rider_user_id is null then
    raise exception 'NO_QUOTE: there is no quote to accept';
  end if;

  -- Lazy release: an expired quote cannot be accepted.
  if v_order.quote_expires_at is not null and v_order.quote_expires_at < now() then
    update public.orders
    set
      status = 'rider_requested',
      quoted_fee_naira = null,
      quote_rider_user_id = null,
      quote_expires_at = null
    where id = p_order_id;
    perform public.log_order_event(p_order_id, auth.uid(), 'system', 'quote_expired', null);
    perform public.notify_user(
      v_order.quote_rider_user_id,
      'Your quote expired',
      'The customer did not answer in time for order ' || v_order.order_number
        || '. The request is open to the other riders again.',
      'order',
      p_order_id
    );
    raise exception 'QUOTE_EXPIRED: this quote has expired — request again or wait for a new quote';
  end if;

  if exists (select 1 from public.deliveries d where d.order_id = p_order_id) then
    raise exception 'ORDER_ALREADY_ACCEPTED';
  end if;

  if not exists (
    select 1 from public.roles r
    where r.user_id = v_order.quote_rider_user_id
      and r.role_type = 'rider'
      and r.status = 'active'
  ) then
    update public.orders
    set
      status = 'rider_requested',
      quoted_fee_naira = null,
      quote_rider_user_id = null,
      quote_expires_at = null
    where id = p_order_id;
    raise exception 'RIDER_UNAVAILABLE: this rider can no longer take the job';
  end if;

  select p.full_name into v_rider_name
  from public.profiles p
  where p.id = v_order.quote_rider_user_id;

  insert into public.deliveries (order_id, rider_user_id, status, accepted_at, earnings_naira)
  values (p_order_id, v_order.quote_rider_user_id, 'accepted', now(), v_order.quoted_fee_naira);

  update public.orders
  set
    status = 'rider_accepted',
    delivery_fee_naira = v_order.quoted_fee_naira,
    total_naira = v_order.item_total_naira + v_order.quoted_fee_naira,
    quote_expires_at = null
  where id = p_order_id;

  perform public.log_order_event(
    p_order_id, auth.uid(), 'customer', 'quote_accepted', v_order.quoted_fee_naira::text
  );

  perform public.notify_user(
    v_order.quote_rider_user_id,
    'Quote accepted — job assigned',
    'The customer accepted your ₦' || v_order.quoted_fee_naira
      || ' quote for order ' || v_order.order_number || '. Head to the pickup.',
    'order',
    p_order_id
  );

  if v_order.business_user_id is not null then
    perform public.notify_user(
      v_order.business_user_id,
      'Rider assigned',
      'Rider ' || coalesce(v_rider_name, 'a rider')
        || ' was assigned to order ' || v_order.order_number
        || ' for ₦' || v_order.quoted_fee_naira || '.',
      'order',
      p_order_id
    );
  end if;
end;
$$;

drop function if exists public.customer_decline_quote(uuid);
create or replace function public.customer_decline_quote(p_order_id uuid)
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

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the customer can decline a quote';
  end if;

  if v_order.status <> 'rider_quoted' then
    raise exception 'NO_QUOTE: there is no quote to decline';
  end if;

  update public.orders
  set
    status = 'rider_requested',
    quoted_fee_naira = null,
    quote_rider_user_id = null,
    quote_expires_at = null
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'customer', 'quote_declined', null);

  if v_order.quote_rider_user_id is not null then
    perform public.notify_user(
      v_order.quote_rider_user_id,
      'Quote declined',
      'The customer declined your quote for order ' || v_order.order_number
        || '. The request is open to the other riders again.',
      'order',
      p_order_id
    );
  end if;
end;
$$;

-- Releases every quote whose 5-minute hold expired with no answer.
-- Called periodically by the app (and by accept/quote calls above).
drop function if exists public.expire_stale_quotes();
create or replace function public.expire_stale_quotes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  for v_order in
    select o.id, o.order_number, o.customer_user_id,
           o.quote_rider_user_id, o.quoted_fee_naira
    from public.orders o
    where o.status = 'rider_quoted'
      and o.quote_expires_at is not null
      and o.quote_expires_at < now()
  loop
    update public.orders
    set
      status = 'rider_requested',
      quoted_fee_naira = null,
      quote_rider_user_id = null,
      quote_expires_at = null
    where id = v_order.id;

    perform public.log_order_event(v_order.id, null, 'system', 'quote_expired', null);

    if v_order.quote_rider_user_id is not null then
      perform public.notify_user(
        v_order.quote_rider_user_id,
        'Your quote expired',
        'The customer did not answer in time for order ' || v_order.order_number
          || '. The request is open to the other riders again.',
        'order',
        v_order.id
      );
    end if;

    if v_order.customer_user_id is not null then
      perform public.notify_user(
        v_order.customer_user_id,
        'Quote expired',
        'The ₦' || coalesce(v_order.quoted_fee_naira, 0)
          || ' quote for order ' || v_order.order_number
          || ' expired with no answer. Other riders can quote again.',
        'order',
        v_order.id
      );
    end if;
  end loop;
end;
$$;

-- Identity of the rider who currently holds the quote, for the
-- customer's Accept / Decline card.
drop function if exists public.get_quote_rider_identity(uuid);
create or replace function public.get_quote_rider_identity(p_order_id uuid)
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
     and v_order.quote_rider_user_id <> auth.uid() then
    raise exception 'FORBIDDEN';
  end if;

  if v_order.quote_rider_user_id is null then
    return null;
  end if;

  select p.full_name, p.phone, rp.vehicle_type, rp.plate_number
  into v_rider
  from public.profiles p
  left join public.rider_profiles rp on rp.user_id = p.id
  where p.id = v_order.quote_rider_user_id;

  return jsonb_build_object(
    'fullName', v_rider.full_name,
    'phone', v_rider.phone,
    'vehicleType', v_rider.vehicle_type,
    'plateNumber', v_rider.plate_number
  );
end;
$$;

-- ============================================================
-- 5. ORDER PLACEMENT / PREP GATE / CANCELLATION UPDATES
-- ============================================================

-- The customer never types a price: the fee argument is gone.
drop function if exists public.place_rider_order(uuid, jsonb, jsonb, text, integer, text, text);
drop function if exists public.place_rider_order(jsonb, jsonb, text, integer, text, text);
drop function if exists public.place_rider_order(jsonb, text, jsonb, text, text, integer, text);
drop function if exists public.place_rider_order(jsonb, text, jsonb, text, text, text);

create or replace function public.place_rider_order(
  p_pickup_address jsonb,
  p_pickup_phone text,
  p_delivery_address jsonb,
  p_delivery_phone text,
  p_item_description text,
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
    recipient_phone,
    rider_requested_at
  )
  values (
    'AZD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
    v_user_id,
    null,
    null,
    'rider_only',
    'rider_requested',
    0,
    0,
    0,
    trim(p_item_description),
    p_pickup_address,
    trim(p_pickup_phone),
    p_delivery_address,
    trim(p_recipient_name),
    trim(p_delivery_phone),
    now()
  )
  returning * into v_order;

  for v_rider in
    select r.user_id
    from public.roles r
    join public.rider_profiles rp on rp.user_id = r.user_id
    where r.role_type = 'rider' and r.status = 'active' and rp.clocked_in
  loop
    perform public.notify_user(
      v_rider.user_id,
      'New job available',
      'Order ' || v_order.order_number || ' is waiting for a rider. Quote a price to take it.',
      'order',
      v_order.id
    );
  end loop;

  return v_order.id;
end;
$$;

-- The prep gate: a shop order can only get a rider AFTER the
-- business accepted and gave a preparation time.
drop function if exists public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text);
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

  if v_order.kind <> 'shop' then
    raise exception 'ORDER_NOT_REQUESTABLE';
  end if;

  if v_order.status not in ('accepted_by_business', 'ready_for_pickup') then
    raise exception 'BUSINESS_NOT_READY: wait for the business to accept the order and give a preparation time';
  end if;

  if v_order.business_accepted_at is null then
    raise exception 'BUSINESS_NOT_READY: wait for the business to accept the order and give a preparation time';
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
    rider_requested_at = coalesce(rider_requested_at, now()),
    status = 'rider_requested'
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'customer', 'rider_requested', null);

  for v_rider in
    select r.user_id
    from public.roles r
    join public.rider_profiles rp on rp.user_id = r.user_id
    where r.role_type = 'rider' and r.status = 'active' and rp.clocked_in
  loop
    perform public.notify_user(
      v_rider.user_id,
      'New job available',
      'Order ' || v_order.order_number || ' is waiting for a rider. Quote a price to take it.',
      'order',
      p_order_id
    );
  end loop;
end;
$$;

-- Accepting an order REQUIRES a preparation time; the customer is
-- told "{Business} will have your food ready in N minutes".
drop function if exists public.business_accept_order(uuid, integer);
create or replace function public.business_accept_order(
  p_order_id uuid,
  p_prep_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_business_name text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.business_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the business can accept this order';
  end if;

  if p_prep_minutes is null or p_prep_minutes <= 0 or p_prep_minutes > 1440 then
    raise exception 'PREP_TIME_REQUIRED: choose a preparation time in minutes';
  end if;

  if v_order.status not in ('placed', 'rider_requested', 'rider_accepted') then
    raise exception 'ORDER_NOT_ACCEPTABLE: the order cannot be accepted from its current status';
  end if;

  select bp.business_name into v_business_name
  from public.business_profiles bp
  where bp.user_id = v_order.business_user_id;

  update public.orders
  set
    business_accepted_at = coalesce(business_accepted_at, now()),
    prep_minutes = p_prep_minutes,
    status = case when status = 'placed' then 'accepted_by_business'::public.order_status else status end
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'business_accepted', p_prep_minutes::text);

  perform public.notify_user(
    v_order.customer_user_id,
    'Business accepted your order',
    coalesce(v_business_name, 'The business') || ' will have your food ready in '
      || p_prep_minutes || ' minutes. Order ' || v_order.order_number || '.',
    'order',
    p_order_id
  );
end;
$$;

-- customer_cancel_request must also cover the quote step.
drop function if exists public.customer_cancel_request(uuid);
create or replace function public.customer_cancel_request(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_rider uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the customer can cancel this request';
  end if;

  if v_order.status not in (
    'placed', 'accepted_by_business', 'ready_for_pickup',
    'rider_requested', 'rider_quoted', 'rider_accepted',
    'arrived_at_pickup', 'pickup_verified'
  ) then
    raise exception 'ORDER_NOT_CANCELLABLE: after pickup the order can no longer be cancelled';
  end if;

  update public.orders
  set status = 'cancelled', quote_expires_at = null
  where id = p_order_id;

  update public.deliveries set status = 'cancelled' where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'customer', 'order_cancelled', 'cancelled by the customer');

  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Order cancelled', 'The customer cancelled order ' || v_order.order_number || '.', 'order', p_order_id);
  end if;

  select d.rider_user_id into v_rider from public.deliveries d where d.order_id = p_order_id;
  if v_rider is null then
    v_rider := v_order.quote_rider_user_id;
  end if;
  if v_rider is not null then
    perform public.notify_user(v_rider, 'Order cancelled — you are released', 'Order ' || v_order.order_number || ' was cancelled. You are released from this job.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 6. get_order_progress: add the quote fields the UIs need
-- ============================================================
drop function if exists public.get_order_progress(uuid);
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
    'deliveryAttempts', coalesce(v_codes.delivery_attempts, 0),
    'ready', v_order.ready_at is not null,
    'businessAcceptedAt', v_order.business_accepted_at,
    'readyAt', v_order.ready_at,
    'riderRequestedAt', v_order.rider_requested_at,
    'waitingDeadline', v_order.waiting_deadline,
    'prepMinutes', v_order.prep_minutes,
    'declineReason', v_order.decline_reason,
    'failureReason', v_order.failure_reason,
    'quotedFeeNaira', v_order.quoted_fee_naira,
    'quoteRiderUserId', v_order.quote_rider_user_id,
    'quoteExpiresAt', v_order.quote_expires_at
  );
end;
$$;

-- ============================================================
-- 7. Remove the generic order-status notification trigger so the
--    precise per-step notifications above are the only ones sent.
--    (trg_orders_notify is dropped at the top of this file, before
--    the functions it uses are recreated.)
-- ============================================================

-- ============================================================
-- 8. REALTIME: orders + order_items join the publication so the
--    business/customer pages refetch on insert and update.
-- ============================================================
alter table public.orders replica identity full;
alter table public.order_items replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null; end $$;

-- ============================================================
-- 9. GRANTS
-- ============================================================
revoke all on function public.get_business_orders() from public;
grant execute on function public.get_business_orders() to authenticated;

revoke all on function public.get_customer_orders() from public;
grant execute on function public.get_customer_orders() to authenticated;

revoke all on function public.rider_quote_price(uuid, integer) from public;
grant execute on function public.rider_quote_price(uuid, integer) to authenticated;

revoke all on function public.customer_accept_quote(uuid) from public;
grant execute on function public.customer_accept_quote(uuid) to authenticated;

revoke all on function public.customer_decline_quote(uuid) from public;
grant execute on function public.customer_decline_quote(uuid) to authenticated;

revoke all on function public.expire_stale_quotes() from public;
grant execute on function public.expire_stale_quotes() to authenticated;

revoke all on function public.get_quote_rider_identity(uuid) from public;
grant execute on function public.get_quote_rider_identity(uuid) to authenticated;

revoke all on function public.place_rider_order(jsonb, text, jsonb, text, text, text) from public;
grant execute on function public.place_rider_order(jsonb, text, jsonb, text, text, text) to authenticated;

revoke all on function public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text) from public;
grant execute on function public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text) to authenticated;

revoke all on function public.business_accept_order(uuid, integer) from public;
grant execute on function public.business_accept_order(uuid, integer) to authenticated;

revoke all on function public.customer_cancel_request(uuid) from public;
grant execute on function public.customer_cancel_request(uuid) to authenticated;

revoke all on function public.get_order_progress(uuid) from public;
grant execute on function public.get_order_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
