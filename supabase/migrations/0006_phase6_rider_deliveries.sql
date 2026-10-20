-- ============================================================
-- AZ Dispatch — Phase 6: rider available rides, job acceptance
-- and hashed delivery-code generation.
-- The plain 6-digit code is returned ONCE to the rider by
-- accept_delivery; only its SHA-256 hash is stored, and the
-- hash column is unreadable from the API.
-- Riders can never see customer phone numbers or payment info.
-- ============================================================

-- ---------- RLS: riders see available jobs of their company ----------
create policy orders_select_available_rider
  on public.orders for select
  using (
    status = 'awaiting_rider'
    and exists (
      select 1 from public.roles r
      where r.user_id = auth.uid()
        and r.role_type = 'rider'
        and r.status = 'active'
        and r.company_id = orders.company_id
    )
  );

-- ---------- RLS: riders see their own accepted orders ----------
create policy orders_select_assigned_rider
  on public.orders for select
  using (
    exists (
      select 1 from public.deliveries d
      where d.order_id = orders.id and d.rider_user_id = auth.uid()
    )
  );

create policy order_items_select_rider
  on public.order_items for select
  using (
    exists (
      select 1 from public.deliveries d
      where d.order_id = order_items.order_id and d.rider_user_id = auth.uid()
    )
  );

-- ---------- RLS: deliveries ----------
create policy deliveries_select_rider
  on public.deliveries for select
  using (auth.uid() = rider_user_id);

create policy deliveries_select_company_owner
  on public.deliveries for select
  using (
    exists (
      select 1
      from public.orders o
      join public.companies c on c.id = o.company_id
      where o.id = deliveries.order_id and c.owner_user_id = auth.uid()
    )
  );

-- ---------- Column security ----------
-- Riders must never see customer contact details or the code hash.
revoke select (recipient_name, recipient_phone) on public.orders from anon, authenticated;
revoke select (code_hash) on public.deliveries from anon, authenticated;

-- ---------- RPC: accept a job, generate + return the code once ----------
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

  if not exists (
    select 1 from public.roles r
    where r.user_id = auth.uid()
      and r.role_type = 'rider'
      and r.status = 'active'
      and r.company_id = v_order.company_id
  ) then
    raise exception 'FORBIDDEN: only an approved rider of this company can accept the job';
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

-- ---------- RPC: rider marks the job picked up ----------
create or replace function public.mark_delivery_picked_up(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.deliveries;
begin
  select * into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'DELIVERY_NOT_FOUND';
  end if;

  if v_delivery.rider_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the assigned rider can update this job';
  end if;

  if v_delivery.status <> 'accepted' then
    raise exception 'DELIVERY_NOT_ACCEPTED';
  end if;

  update public.deliveries
  set status = 'picked_up', picked_up_at = now()
  where id = p_delivery_id;

  update public.orders
  set status = 'picked_up'
  where id = v_delivery.order_id;
end;
$$;

-- ---------- RPC: rider hands over — waiting for customer code ----------
create or replace function public.mark_delivery_pending_code(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.deliveries;
begin
  select * into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'DELIVERY_NOT_FOUND';
  end if;

  if v_delivery.rider_user_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the assigned rider can update this job';
  end if;

  if v_delivery.status <> 'picked_up' then
    raise exception 'DELIVERY_NOT_PICKED_UP';
  end if;

  update public.deliveries
  set status = 'delivered_pending_code'
  where id = p_delivery_id;

  -- The order stays 'picked_up' until the customer confirms the code.
end;
$$;

-- ---------- Permissions: authenticated only ----------
revoke all on function public.accept_delivery(uuid) from public;
grant execute on function public.accept_delivery(uuid) to authenticated;

revoke all on function public.mark_delivery_picked_up(uuid) from public;
grant execute on function public.mark_delivery_picked_up(uuid) to authenticated;

revoke all on function public.mark_delivery_pending_code(uuid) from public;
grant execute on function public.mark_delivery_pending_code(uuid) to authenticated;
