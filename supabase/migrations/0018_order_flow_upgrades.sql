-- ============================================================
-- AZ Dispatch — 0018: order flow upgrades.
-- * Business accept / ready / decline with prep time.
-- * No-rider timeout + cancel, customer-not-reachable and
--   failed-delivery flows. Codes stay MANDATORY everywhere —
--   there is no skip path.
-- * order_events log for the shared order history.
-- Idempotent. Nothing is dropped except functions and policies
-- (recreated). NO DATA IS DELETED.
-- Ends with: notify pgrst, 'reload schema';
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. NEW STATUSES
-- ============================================================
alter type public.order_status add value if not exists 'accepted_by_business';
alter type public.order_status add value if not exists 'ready_for_pickup';
alter type public.order_status add value if not exists 'delivery_failed';

-- ============================================================
-- 2. NEW COLUMNS (nullable — no data loss)
-- ============================================================
alter table public.orders add column if not exists prep_minutes integer;
alter table public.orders add column if not exists business_accepted_at timestamptz;
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists rider_requested_at timestamptz;
alter table public.orders add column if not exists waiting_deadline timestamptz;
alter table public.orders add column if not exists decline_reason text;
alter table public.orders add column if not exists failure_reason text;

-- ============================================================
-- 3. ORDER EVENTS (shared history, readable by the order parties)
-- ============================================================
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_role text,
  event text not null,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

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

-- ============================================================
-- 4. EVENT LOG HELPER (internal — no direct execute grants)
-- ============================================================
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

revoke all on function public.log_order_event(uuid, uuid, text, text, text) from public;

-- ============================================================
-- 5. BUSINESS: accept / ready / decline / extend / cancel
-- ============================================================
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

  if v_order.status not in ('placed', 'rider_requested', 'rider_accepted') then
    raise exception 'ORDER_NOT_ACCEPTABLE: the order cannot be accepted from its current status';
  end if;

  if p_prep_minutes is not null and (p_prep_minutes < 0 or p_prep_minutes > 1440) then
    raise exception 'INVALID_PREP_TIME';
  end if;

  update public.orders
  set
    business_accepted_at = coalesce(business_accepted_at, now()),
    prep_minutes = coalesce(p_prep_minutes, prep_minutes),
    status = case when status = 'placed' then 'accepted_by_business'::public.order_status else status end
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'business_accepted', coalesce(p_prep_minutes::text, ''));
  perform public.notify_user(v_order.customer_user_id, 'Business accepted your order', 'Order ' || v_order.order_number || ' was accepted by the business.', 'order', p_order_id);
end;
$$;

create or replace function public.business_mark_ready(p_order_id uuid)
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

  if v_order.business_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the business can mark this order ready';
  end if;

  if v_order.business_accepted_at is null then
    raise exception 'ACCEPT_FIRST: accept the order before marking it ready';
  end if;

  if v_order.status in ('cancelled', 'delivered', 'delivery_failed', 'arrived_at_pickup', 'pickup_verified', 'picked_up', 'arrived_at_destination') then
    raise exception 'ORDER_NOT_PREPARABLE: the order cannot be marked ready from its current status';
  end if;

  update public.orders
  set
    ready_at = coalesce(ready_at, now()),
    status = case when status = 'accepted_by_business' then 'ready_for_pickup'::public.order_status else status end
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'order_ready', v_order.prep_minutes::text);

  perform public.notify_user(v_order.customer_user_id, 'Order ready for pickup', 'Order ' || v_order.order_number || ' is ready. The rider can now pick it up.', 'order', p_order_id);

  select d.rider_user_id into v_rider from public.deliveries d where d.order_id = p_order_id;
  if v_rider is not null then
    perform public.notify_user(v_rider, 'Order ready for pickup', 'Order ' || v_order.order_number || ' is ready — head to the pickup.', 'order', p_order_id);
  end if;
end;
$$;

create or replace function public.business_decline_order(
  p_order_id uuid,
  p_reason text
)
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
    raise exception 'FORBIDDEN: only the business can decline this order';
  end if;

  if v_order.status not in ('placed', 'accepted_by_business') then
    raise exception 'ORDER_NOT_DECLINABLE';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.orders
  set status = 'cancelled', decline_reason = trim(p_reason)
  where id = p_order_id;

  update public.deliveries set status = 'cancelled' where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'business_declined', trim(p_reason));
  perform public.notify_user(v_order.customer_user_id, 'Order declined', 'Order ' || v_order.order_number || ' was declined: ' || trim(p_reason), 'order', p_order_id);
end;
$$;

create or replace function public.business_extend_waiting(p_order_id uuid)
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
    raise exception 'FORBIDDEN: only the business can extend the wait';
  end if;

  if v_order.status not in ('arrived_at_pickup', 'pickup_verified') then
    raise exception 'NOT_WAITING';
  end if;

  if v_order.waiting_deadline is null then
    raise exception 'NOT_WAITING';
  end if;

  update public.orders
  set waiting_deadline = now() + interval '5 minutes'
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'waiting_extended', '+5 minutes');
  perform public.notify_user(v_order.customer_user_id, 'Business is still waiting', 'The business added 5 more minutes for order ' || v_order.order_number || '.', 'order', p_order_id);
  perform public.notify_user((select rider_user_id from public.deliveries d where d.order_id = p_order_id), 'Business is still waiting', 'The business added 5 more minutes for order ' || v_order.order_number || '.', 'order', p_order_id);
end;
$$;

create or replace function public.business_cancel_order(
  p_order_id uuid,
  p_reason text
)
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

  if v_order.business_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the business can cancel this order';
  end if;

  if v_order.status not in ('arrived_at_pickup', 'pickup_verified') then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.orders
  set status = 'cancelled', decline_reason = trim(p_reason)
  where id = p_order_id;

  update public.deliveries set status = 'cancelled' where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'order_cancelled', trim(p_reason));
  perform public.notify_user(v_order.customer_user_id, 'Order cancelled', 'Order ' || v_order.order_number || ' was cancelled: ' || trim(p_reason), 'order', p_order_id);

  select rider_user_id into v_rider from public.deliveries d where d.order_id = p_order_id;
  if v_rider is not null then
    perform public.notify_user(v_rider, 'Order cancelled — you are released', 'Order ' || v_order.order_number || ' was cancelled. You are released from this job.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 6. CUSTOMER: request rider (re-created with timestamps + log),
--    cancel request, reminders, no-rider notification
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

  if v_order.kind <> 'shop' then
    raise exception 'ORDER_NOT_REQUESTABLE';
  end if;

  if v_order.status not in ('placed', 'accepted_by_business', 'ready_for_pickup') then
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
    rider_requested_at = now(),
    status = 'rider_requested'
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'customer', 'rider_requested', null);

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
    'rider_requested', 'rider_accepted', 'arrived_at_pickup', 'pickup_verified'
  ) then
    raise exception 'ORDER_NOT_CANCELLABLE: after pickup the order can no longer be cancelled';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;
  update public.deliveries set status = 'cancelled' where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'customer', 'order_cancelled', 'cancelled by the customer');

  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Order cancelled', 'The customer cancelled order ' || v_order.order_number || '.', 'order', p_order_id);
  end if;

  select rider_user_id into v_rider from public.deliveries d where d.order_id = p_order_id;
  if v_rider is not null then
    perform public.notify_user(v_rider, 'Order cancelled — you are released', 'Order ' || v_order.order_number || ' was cancelled. You are released from this job.', 'order', p_order_id);
  end if;
end;
$$;

-- Reminder for the customer when no rider request was made yet.
create or replace function public.send_request_reminder(p_order_id uuid)
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

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN';
  end if;

  perform public.log_order_event(p_order_id, auth.uid(), 'system', 'reminder_sent', 'rider request reminder');
  perform public.notify_user(v_order.customer_user_id, 'Rider not requested yet', 'Order ' || v_order.order_number || ' is waiting for you to request a rider.', 'order', p_order_id);
end;
$$;

-- No rider accepted within the timeout window.
create or replace function public.notify_no_rider(p_order_id uuid)
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

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.customer_user_id <> auth.uid() then
    raise exception 'FORBIDDEN';
  end if;

  if v_order.status <> 'rider_requested' then
    raise exception 'ORDER_NOT_WAITING_FOR_RIDER';
  end if;

  perform public.log_order_event(p_order_id, auth.uid(), 'system', 'no_rider_timeout', null);
  perform public.notify_user(v_order.customer_user_id, 'No rider accepted yet', 'Order ' || v_order.order_number || ' has no rider yet. Keep waiting or cancel the request.', 'order', p_order_id);
  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'No rider yet', 'No rider accepted order ' || v_order.order_number || ' yet.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 7. RIDER: accept (log), not reachable, not responding,
--    report failed delivery
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

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'rider_accepted', null);
  perform public.notify_user(v_order.customer_user_id, 'Rider accepted', 'A rider is on the way for order ' || v_order.order_number || '.', 'order', p_order_id);
  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Rider accepted', 'A rider accepted order ' || v_order.order_number || '.', 'order', p_order_id);
  end if;
end;
$$;

create or replace function public.rider_mark_not_reachable(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_arrived timestamptz;
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
    raise exception 'FORBIDDEN: only the assigned rider can report this';
  end if;

  if v_order.status not in ('arrived_at_pickup', 'pickup_verified') then
    raise exception 'NOT_AT_PICKUP';
  end if;

  select created_at into v_arrived
  from public.order_events e
  where e.order_id = p_order_id and e.event = 'arrived_pickup'
  order by created_at desc
  limit 1;

  if v_arrived is not null and now() < v_arrived + interval '5 minutes' then
    raise exception 'TOO_EARLY: wait 5 minutes before reporting the customer unreachable';
  end if;

  update public.orders
  set waiting_deadline = now() + interval '5 minutes'
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'customer_not_reachable', null);
  perform public.notify_user(v_order.customer_user_id, 'Rider cannot reach you', 'The rider tried to reach you at pickup for order ' || v_order.order_number || '. The business can keep waiting or cancel.', 'order', p_order_id);
  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Customer not reachable', 'The rider cannot reach the customer for order ' || v_order.order_number || '. Choose to keep waiting or cancel.', 'order', p_order_id);
  end if;
end;
$$;

create or replace function public.rider_mark_not_responding(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_arrived timestamptz;
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
    raise exception 'FORBIDDEN: only the assigned rider can report this';
  end if;

  if v_order.status <> 'arrived_at_destination' then
    raise exception 'NOT_AT_DESTINATION';
  end if;

  select created_at into v_arrived
  from public.order_events e
  where e.order_id = p_order_id and e.event = 'arrived_destination'
  order by created_at desc
  limit 1;

  if v_arrived is not null and now() < v_arrived + interval '5 minutes' then
    raise exception 'TOO_EARLY: wait 5 minutes before reporting the customer unresponsive';
  end if;

  update public.orders
  set waiting_deadline = now() + interval '10 minutes'
  where id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'customer_not_responding', null);
  perform public.notify_user(v_order.customer_user_id, 'Rider is waiting for you', 'The rider cannot reach you at your door for order ' || v_order.order_number || '. You have 15 minutes before the delivery is reported failed.', 'order', p_order_id);
  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Customer not responding', 'The customer is not responding at the destination for order ' || v_order.order_number || '.', 'order', p_order_id);
  end if;
end;
$$;

create or replace function public.rider_report_failed_delivery(
  p_order_id uuid,
  p_reason text
)
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

  if not exists (
    select 1 from public.deliveries d
    where d.order_id = p_order_id and d.rider_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the assigned rider can report a failed delivery';
  end if;

  if v_order.status <> 'arrived_at_destination' then
    raise exception 'NOT_AT_DESTINATION';
  end if;

  if v_order.waiting_deadline is null or now() < v_order.waiting_deadline then
    raise exception 'TOO_EARLY: the waiting period has not finished yet';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.orders
  set status = 'delivery_failed', failure_reason = trim(p_reason)
  where id = p_order_id;

  update public.deliveries set status = 'cancelled' where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'delivery_failed', trim(p_reason));
  perform public.notify_user(v_order.customer_user_id, 'Delivery failed', 'Order ' || v_order.order_number || ' could not be delivered: ' || trim(p_reason) || '. It is being returned to the business.', 'order', p_order_id);
  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Delivery failed — order returned', 'Order ' || v_order.order_number || ' could not be delivered: ' || trim(p_reason) || '. The order is being returned to you.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 8. PICKUP / DELIVERY FUNCTIONS: ready gate + event logging
--    (codes remain mandatory — nothing here bypasses them)
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

  -- THE PREP GATE: a business order must be marked ready.
  if v_order.business_user_id is not null and v_order.ready_at is null then
    raise exception 'NOT_READY: the business is still preparing the order';
  end if;

  if v_order.business_user_id is null then
    -- Rider-only request: no business pickup check.
    update public.orders set status = 'picked_up' where id = p_order_id;
    update public.deliveries set status = 'picked_up', picked_up_at = now() where order_id = p_order_id;
    perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'picked_up', null);
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

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'arrived_pickup', null);
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

    perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'pickup_code_failed', null);

    if exists (select 1 from public.order_codes c where c.order_id = p_order_id and c.pickup_locked) then
      perform public.notify_user(v_order.business_user_id, 'Pickup code locked', 'Too many wrong pickup attempts for ' || v_order.order_number || '.', 'order', p_order_id);
    end if;

    return false;
  end if;

  update public.order_codes
  set pickup_verified = true, pickup_attempts = 0
  where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'pickup_code_verified', null);

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

  perform public.log_order_event(p_order_id, auth.uid(), 'business', 'rider_confirmed', null);

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

  update public.orders
  set status = 'arrived_at_destination', waiting_deadline = null
  where id = p_order_id;

  update public.deliveries set status = 'delivered_pending_code' where order_id = p_order_id;

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'arrived_destination', null);
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

    perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'delivery_code_failed', null);

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

  perform public.log_order_event(p_order_id, auth.uid(), 'rider', 'delivery_code_verified', null);
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

  perform public.log_order_event(p_order_id, auth.uid(), 'customer', 'delivered', null);

  if v_order.business_user_id is not null then
    perform public.notify_user(v_order.business_user_id, 'Order delivered', 'Order ' || v_order.order_number || ' was delivered.', 'order', p_order_id);
  end if;
end;
$$;

-- ============================================================
-- 9. EXTENDED PROGRESS (timestamps + deadlines for the UI)
-- ============================================================
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
    'failureReason', v_order.failure_reason
  );
end;
$$;

-- ============================================================
-- 10. EVENT ON CREATE (covers place_shop_order + place_rider_order)
-- ============================================================
create or replace function public.log_order_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.order_events (order_id, actor_user_id, actor_role, event)
  values (new.id, new.customer_user_id, 'customer', 'order_placed');
  return new;
end;
$$;

drop trigger if exists trg_orders_events_insert on public.orders;
create trigger trg_orders_events_insert
  after insert on public.orders
  for each row execute function public.log_order_inserted();

-- ============================================================
-- 11. GRANTS
-- ============================================================
revoke all on function public.business_accept_order(uuid, integer) from public;
grant execute on function public.business_accept_order(uuid, integer) to authenticated;

revoke all on function public.business_mark_ready(uuid) from public;
grant execute on function public.business_mark_ready(uuid) to authenticated;

revoke all on function public.business_decline_order(uuid, text) from public;
grant execute on function public.business_decline_order(uuid, text) to authenticated;

revoke all on function public.business_extend_waiting(uuid) from public;
grant execute on function public.business_extend_waiting(uuid) to authenticated;

revoke all on function public.business_cancel_order(uuid, text) from public;
grant execute on function public.business_cancel_order(uuid, text) to authenticated;

revoke all on function public.customer_cancel_request(uuid) from public;
grant execute on function public.customer_cancel_request(uuid) to authenticated;

revoke all on function public.send_request_reminder(uuid) from public;
grant execute on function public.send_request_reminder(uuid) to authenticated;

revoke all on function public.notify_no_rider(uuid) from public;
grant execute on function public.notify_no_rider(uuid) to authenticated;

revoke all on function public.rider_mark_not_reachable(uuid) from public;
grant execute on function public.rider_mark_not_reachable(uuid) to authenticated;

revoke all on function public.rider_mark_not_responding(uuid) from public;
grant execute on function public.rider_mark_not_responding(uuid) to authenticated;

revoke all on function public.rider_report_failed_delivery(uuid, text) from public;
grant execute on function public.rider_report_failed_delivery(uuid, text) to authenticated;

revoke all on function public.accept_rider_request(uuid) from public;
grant execute on function public.accept_rider_request(uuid) to authenticated;

revoke all on function public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text) from public;
grant execute on function public.request_rider_for_order(uuid, jsonb, text, jsonb, text, text) to authenticated;

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

revoke all on function public.get_order_progress(uuid) from public;
grant execute on function public.get_order_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
