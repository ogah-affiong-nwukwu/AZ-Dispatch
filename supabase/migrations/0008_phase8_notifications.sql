-- ============================================================
-- AZ Dispatch — Phase 8: notifications.
-- Notifications are written by SECURITY DEFINER triggers on
-- orders, payments, deliveries and company_members, so every
-- status change reaches the right people automatically.
-- Users can only read/update their own notifications.
-- ============================================================

-- ---------- Helper ----------
create or replace function public.notify_user(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text default 'info'
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
  insert into public.notifications (user_id, title, body, kind)
  values (p_user_id, p_title, p_body, p_kind);
end;
$$;

-- ---------- Order status changes ----------
create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_owner uuid;
  v_rider uuid;
  v_title text;
begin
  if old.status = new.status then
    return new;
  end if;

  v_title := case new.status
    when 'awaiting_payment' then 'Payment required'
    when 'payment_submitted' then 'Payment slip received'
    when 'payment_confirmed' then 'Payment confirmed'
    when 'awaiting_business_approval' then 'Order awaiting your approval'
    when 'awaiting_rider' then 'Order ready for dispatch'
    when 'rider_assigned' then 'Rider assigned'
    when 'picked_up' then 'Order picked up'
    when 'delivered' then 'Delivered'
    when 'cancelled' then 'Order cancelled'
    when 'delayed' then 'Order delayed'
    else 'Order update'
  end;

  perform public.notify_user(
    new.customer_user_id,
    v_title,
    'Order ' || new.order_number || ' was updated.'
  );

  if new.business_user_id is not null then
    perform public.notify_user(
      new.business_user_id,
      v_title,
      'Order ' || new.order_number || ' was updated.'
    );
  end if;

  select c.owner_user_id
  into v_company_owner
  from public.companies c
  where c.id = new.company_id;

  perform public.notify_user(
    v_company_owner,
    v_title,
    'Order ' || new.order_number || ' was updated.'
  );

  if new.status = 'awaiting_rider' then
    for v_rider in
      select r.user_id
      from public.roles r
      where r.role_type = 'rider'
        and r.status = 'active'
        and r.company_id = new.company_id
    loop
      perform public.notify_user(
        v_rider,
        'New paid job available',
        'Order ' || new.order_number || ' is waiting for a rider.'
      );
    end loop;
  end if;

  select d.rider_user_id
  into v_rider
  from public.deliveries d
  where d.order_id = new.id;

  perform public.notify_user(
    v_rider,
    v_title,
    'Order ' || new.order_number || ' was updated.'
  );

  return new;
end;
$$;

create trigger trg_orders_notify
  after update on public.orders
  for each row execute function public.notify_order_status_change();

-- ---------- Payment slip review ----------
create or replace function public.notify_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_owner uuid;
  v_order public.orders;
begin
  if old.status = new.status then
    return new;
  end if;

  select * into v_order from public.orders o where o.id = new.order_id;

  if new.status = 'submitted' then
    select c.owner_user_id
    into v_company_owner
    from public.companies c
    where c.id = new.company_id;

    perform public.notify_user(
      v_company_owner,
      'New payment slip to review',
      'Order ' || v_order.order_number || ' uploaded a payment slip.'
    );
  elsif new.status = 'confirmed' then
    perform public.notify_user(
      new.customer_user_id,
      'Payment confirmed',
      'Your payment for ' || v_order.order_number || ' was confirmed.'
    );
  elsif new.status = 'rejected' then
    perform public.notify_user(
      new.customer_user_id,
      'Payment rejected',
      'Your slip for ' || v_order.order_number || ' was rejected: '
        || coalesce(new.rejection_reason, 'no reason given')
    );
  end if;

  return new;
end;
$$;

create trigger trg_payments_notify
  after update on public.payments
  for each row execute function public.notify_payment_status_change();

-- ---------- Delivery state changes & code locks ----------
create or replace function public.notify_delivery_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_company_owner uuid;
begin
  select * into v_order from public.orders o where o.id = new.order_id;

  if old.status is distinct from new.status then
    if new.status = 'delivered_pending_code' then
      perform public.notify_user(
        v_order.customer_user_id,
        'Rider delivered — confirm with your code',
        'Order ' || v_order.order_number
          || ' is at your door. Enter the 6-digit code to confirm receipt.'
      );
    elsif new.status = 'delivered' then
      perform public.notify_user(
        new.rider_user_id,
        'Delivery confirmed',
        'Order ' || v_order.order_number || ' is delivered — your earnings were credited.'
      );
    elsif new.status = 'cancelled' then
      perform public.notify_user(
        new.rider_user_id,
        'Delivery cancelled',
        'Order ' || v_order.order_number || ' was cancelled.'
      );
    end if;
  end if;

  if new.failed_attempts >= 5 and old.failed_attempts < 5 then
    select c.owner_user_id
    into v_company_owner
    from public.companies c
    where c.id = v_order.company_id;

    perform public.notify_user(
      v_company_owner,
      'Delivery code locked',
      'Order ' || v_order.order_number
        || ' had too many wrong code attempts — resolve it.'
    );
  end if;

  return new;
end;
$$;

create trigger trg_deliveries_notify
  after update on public.deliveries
  for each row execute function public.notify_delivery_status_change();

-- ---------- Member approval / rejection ----------
create or replace function public.notify_member_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if new.status = 'approved' then
    perform public.notify_user(
      new.user_id,
      'Application approved',
      'Your ' || new.member_type::text || ' account was approved. You can use it now.'
    );
  elsif new.status = 'rejected' then
    perform public.notify_user(
      new.user_id,
      'Application rejected',
      'Your ' || new.member_type::text || ' application was rejected: '
        || coalesce(new.rejection_reason, 'no reason given')
    );
  end if;

  return new;
end;
$$;

create trigger trg_company_members_notify
  after update on public.company_members
  for each row execute function public.notify_member_status_change();

-- ---------- RLS: notifications ----------
create policy notifications_select_own
  on public.notifications for select
  using (auth.uid() = user_id);

create policy notifications_update_own
  on public.notifications for update
  using (auth.uid() = user_id);
