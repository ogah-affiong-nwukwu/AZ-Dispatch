-- ============================================================
-- AZ Dispatch — 0015: consolidated live-database repair.
-- Creates EVERYTHING the app needs that may be missing on the
-- live project (tables, enums, functions, triggers, RLS, buckets).
-- Idempotent: nothing existing is dropped except functions,
-- triggers and policies (which are recreated). NO DATA IS DELETED.
-- Run the whole file in the Supabase SQL editor, then the final
-- line reloads the PostgREST schema cache.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================
do $$ begin
  create type public.role_type as enum ('customer', 'rider', 'business');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.role_status as enum ('active', 'pending', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_type as enum ('business', 'rider');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum (
    'draft', 'awaiting_payment', 'payment_submitted', 'payment_confirmed',
    'payment_rejected', 'awaiting_business_approval', 'awaiting_rider',
    'rider_assigned', 'picked_up', 'delivered', 'delayed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('awaiting', 'submitted', 'confirmed', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.delivery_status as enum (
    'accepted', 'picked_up', 'delivered_pending_code', 'delivered', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ============================================================
-- 2. TABLES (create only when missing — existing data untouched)
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  business_name text,
  default_address jsonb,
  rider_profile jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null,
  address text not null default '',
  city text not null default '',
  state text not null default '',
  phone text not null default '',
  bank_name text not null default '',
  bank_account_name text not null default '',
  bank_account_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_type public.role_type not null,
  company_id uuid references public.companies (id) on delete set null,
  status public.role_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role_type)
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_type public.member_type not null,
  status public.member_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, member_type)
);

create table if not exists public.business_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  business_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  business_user_id uuid not null references public.profiles (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  name text not null,
  description text not null default '',
  price_naira integer not null check (price_naira >= 0),
  quantity integer not null default 1 check (quantity >= 0),
  is_available boolean not null default true,
  listed_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_user_id uuid not null references public.profiles (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  business_user_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'shop' check (kind in ('shop', 'rider_only')),
  status public.order_status not null default 'draft',
  item_total_naira integer not null default 0,
  delivery_fee_naira integer not null default 0,
  total_naira integer not null default 0,
  item_description text,
  pickup_address jsonb,
  delivery_address jsonb,
  recipient_name text,
  recipient_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  item_name text not null,
  unit_price_naira integer not null,
  quantity integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  customer_user_id uuid not null references public.profiles (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  amount_naira integer not null,
  slip_path text,
  slip_type text check (slip_type in ('image', 'pdf')),
  status public.payment_status not null default 'awaiting',
  rejection_reason text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  rider_user_id uuid references public.profiles (id) on delete set null,
  status public.delivery_status not null default 'accepted',
  code_hash text,
  failed_attempts integer not null default 0,
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deliveries add column if not exists earnings_naira integer;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null default 'info',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

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

alter table public.items alter column company_id drop not null;
alter table public.business_profiles alter column company_id drop not null;

-- ============================================================
-- 3. INDEXES
-- ============================================================
create index if not exists roles_user_id_idx on public.roles (user_id);
create index if not exists company_members_company_id_idx on public.company_members (company_id);
create index if not exists items_company_available_idx on public.items (company_id, listed_on, is_available);
create index if not exists orders_customer_idx on public.orders (customer_user_id, status);
create index if not exists orders_company_idx on public.orders (company_id, status);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists payments_order_idx on public.payments (order_id);
create unique index if not exists payments_order_unique_idx on public.payments (order_id);
create index if not exists deliveries_rider_idx on public.deliveries (rider_user_id, status);
create index if not exists notifications_user_idx on public.notifications (user_id, read);

-- ============================================================
-- 4. FUNCTIONS
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---- signup trigger: profile + roles + role profiles (current model) ----
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

  insert into public.roles (user_id, role_type, company_id, status)
  values (new.id, 'customer'::public.role_type, null, 'active'::public.role_status)
  on conflict (user_id, role_type) do nothing;

  v_role := case new.raw_user_meta_data ->> 'role'
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
    end if;
  end if;

  insert into public.customer_profiles (user_id, phone)
  values (new.id, null)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---- self-heal helpers ----
create or replace function public.ensure_profile(p_full_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.profiles (id, full_name)
  values (
    v_user_id,
    coalesce(p_full_name, split_part(auth.email()::text, '@', 1))
  )
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = v_user_id;
  return v_profile;
end;
$$;

create or replace function public.has_business_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_profiles bp
    where bp.user_id = p_user_id
  );
$$;

-- ---- notifications ----
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
    loop
      perform public.notify_user(
        v_rider,
        'New job available',
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

-- ---- company member flows ----
create or replace function public.register_company_member(
  p_company_id uuid,
  p_member_type public.member_type,
  p_business_name text default null
)
returns public.company_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_member public.company_members;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'COMPANY_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.roles r
    where r.user_id = v_user_id and r.role_type = p_member_type::public.role_type
  ) then
    raise exception 'ALREADY_REGISTERED: you already have an account for this role';
  end if;

  if exists (
    select 1 from public.company_members cm
    where cm.user_id = v_user_id and cm.member_type = p_member_type
  ) then
    raise exception 'ALREADY_REGISTERED: you already have a membership request';
  end if;

  v_name := trim(coalesce(p_business_name, ''));

  insert into public.roles (user_id, role_type, company_id, status)
  values (v_user_id, p_member_type::public.role_type, p_company_id, 'pending');

  insert into public.company_members (company_id, user_id, member_type, status)
  values (p_company_id, v_user_id, p_member_type, 'pending')
  returning * into v_member;

  if p_member_type = 'business' and length(v_name) > 0 then
    update public.profiles set business_name = v_name where id = v_user_id;
  end if;

  return v_member;
end;
$$;

create or replace function public.approve_company_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_member_type public.member_type;
  v_business_name text;
begin
  select cm.company_id, cm.user_id, cm.member_type
  into v_company_id, v_user_id, v_member_type
  from public.company_members cm
  where cm.id = p_member_id;

  if v_company_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = v_company_id and c.owner_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the company owner can approve members';
  end if;

  update public.company_members
  set
    status = 'approved',
    rejection_reason = null,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_member_id;

  update public.roles
  set status = 'active', company_id = v_company_id
  where user_id = v_user_id and role_type = v_member_type::public.role_type;

  if v_member_type = 'business' then
    select coalesce(business_name, 'Business')
    into v_business_name
    from public.profiles
    where id = v_user_id;

    insert into public.business_profiles (user_id, company_id, business_name)
    values (v_user_id, v_company_id, v_business_name)
    on conflict (user_id) do update
    set
      company_id = excluded.company_id,
      business_name = excluded.business_name;
  end if;
end;
$$;

create or replace function public.reject_company_member(
  p_member_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_member_type public.member_type;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  select cm.company_id, cm.user_id, cm.member_type
  into v_company_id, v_user_id, v_member_type
  from public.company_members cm
  where cm.id = p_member_id;

  if v_company_id is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = v_company_id and c.owner_user_id = auth.uid()
  ) then
    raise exception 'FORBIDDEN: only the company owner can reject members';
  end if;

  update public.company_members
  set
    status = 'rejected',
    rejection_reason = trim(p_reason),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_member_id;

  update public.roles
  set status = 'rejected', company_id = v_company_id
  where user_id = v_user_id and role_type = v_member_type::public.role_type;
end;
$$;

-- ---- payment review / business approval ----
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

-- ---- payment slip upload ----
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
    'draft', 'awaiting_payment', 'payment_submitted', 'payment_rejected',
    'awaiting_business_approval', 'awaiting_rider'
  ) then
    raise exception 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.orders set status = 'cancelled' where id = v_order.id;
end;
$$;

-- ============================================================
-- place_shop_order — the signature the app calls:
--   rpc('place_shop_order', { p_items, p_delivery_address,
--                             p_recipient_name, p_recipient_phone })
-- Old signatures are dropped so the function cannot mismatch.
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
  v_order public.orders;
  v_elem record;
  v_item_id uuid;
  v_name text;
  v_price integer;
  v_available integer;
  v_qty integer;
  v_line_business uuid;
  v_business_user_id uuid := null;
  v_item_total integer := 0;
  v_delivery_fee integer := 1500;
  v_total integer := 0;
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

    v_item_total := v_item_total + (v_price * v_qty);
  end loop;

  -- Grouped by business: when every line belongs to the SAME business,
  -- attribute the order to it; multi-business carts stay null and each
  -- order_items line keeps its item_id -> business link.
  select min(g.business_user_id)
  into v_business_user_id
  from (select business_user_id from _cart_items group by business_user_id) g
  having count(*) = 1;

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
    v_business_user_id,
    'shop',
    'awaiting_rider',
    v_item_total,
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
  order by c.business_user_id;

  update public.items i
  set quantity = i.quantity - c.qty
  from _cart_items c
  where i.id = c.item_id;

  return v_order.id;
end;
$$;

-- ============================================================
-- place_rider_order — current 6-arg signature (company removed).
-- ============================================================
drop function if exists public.place_rider_order(uuid, jsonb, jsonb, text, integer, text, text);
drop function if exists public.place_rider_order(jsonb, jsonb, text, integer, text, text);

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
    trim(p_recipient_name),
    trim(p_recipient_phone)
  )
  returning * into v_order;

  return v_order;
end;
$$;

-- ---- rider job functions (current model: clocked in, no company) ----
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

-- ============================================================
-- 5. TRIGGERS
-- ============================================================
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists trg_company_members_updated_at on public.company_members;
create trigger trg_company_members_updated_at
  before update on public.company_members
  for each row execute function public.set_updated_at();

drop trigger if exists trg_business_profiles_updated_at on public.business_profiles;
create trigger trg_business_profiles_updated_at
  before update on public.business_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_items_updated_at on public.items;
create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_deliveries_updated_at on public.deliveries;
create trigger trg_deliveries_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_customer_profiles_updated_at on public.customer_profiles;
create trigger trg_customer_profiles_updated_at
  before update on public.customer_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_rider_profiles_updated_at on public.rider_profiles;
create trigger trg_rider_profiles_updated_at
  before update on public.rider_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_orders_notify on public.orders;
create trigger trg_orders_notify
  after update on public.orders
  for each row execute function public.notify_order_status_change();

drop trigger if exists trg_payments_notify on public.payments;
create trigger trg_payments_notify
  after update on public.payments
  for each row execute function public.notify_payment_status_change();

drop trigger if exists trg_deliveries_notify on public.deliveries;
create trigger trg_deliveries_notify
  after update on public.deliveries
  for each row execute function public.notify_delivery_status_change();

drop trigger if exists trg_company_members_notify on public.company_members;
create trigger trg_company_members_notify
  after update on public.company_members
  for each row execute function public.notify_member_status_change();

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_company_owner on public.profiles;
drop policy if exists profiles_select_order_customer on public.profiles;
drop policy if exists profiles_select_order_business on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id);

alter table public.roles enable row level security;
drop policy if exists roles_select_own on public.roles;
drop policy if exists roles_insert_own on public.roles;
create policy roles_select_own on public.roles for select to authenticated using (auth.uid() = user_id);
create policy roles_insert_own on public.roles for insert to authenticated with check (auth.uid() = user_id and company_id is null);

alter table public.companies enable row level security;
drop policy if exists companies_select_authenticated on public.companies;
drop policy if exists companies_insert_own on public.companies;
drop policy if exists companies_update_own on public.companies;
create policy companies_select_authenticated on public.companies for select to authenticated using (auth.role() = 'authenticated');
create policy companies_insert_own on public.companies for insert to authenticated with check (auth.uid() = owner_user_id);
create policy companies_update_own on public.companies for update to authenticated using (auth.uid() = owner_user_id);

alter table public.company_members enable row level security;
drop policy if exists company_members_select_own on public.company_members;
drop policy if exists company_members_select_company_owner on public.company_members;
create policy company_members_select_own on public.company_members for select to authenticated using (auth.uid() = user_id);
create policy company_members_select_company_owner on public.company_members for select to authenticated using (
  exists (
    select 1 from public.companies c
    where c.id = company_id and c.owner_user_id = auth.uid()
  )
);

alter table public.business_profiles enable row level security;
drop policy if exists business_profiles_select_related on public.business_profiles;
drop policy if exists business_profiles_select_authenticated on public.business_profiles;
drop policy if exists business_profiles_select_own on public.business_profiles;
create policy business_profiles_select_own on public.business_profiles for select to authenticated using (auth.uid() = user_id);
create policy business_profiles_select_authenticated on public.business_profiles for select to authenticated using (auth.role() = 'authenticated');

alter table public.customer_profiles enable row level security;
drop policy if exists customer_profiles_select_own on public.customer_profiles;
drop policy if exists customer_profiles_insert_own on public.customer_profiles;
drop policy if exists customer_profiles_update_own on public.customer_profiles;
create policy customer_profiles_select_own on public.customer_profiles for select to authenticated using (auth.uid() = user_id);
create policy customer_profiles_insert_own on public.customer_profiles for insert to authenticated with check (auth.uid() = user_id);
create policy customer_profiles_update_own on public.customer_profiles for update to authenticated using (auth.uid() = user_id);

alter table public.rider_profiles enable row level security;
drop policy if exists rider_profiles_select_any on public.rider_profiles;
drop policy if exists rider_profiles_insert_own on public.rider_profiles;
drop policy if exists rider_profiles_update_own on public.rider_profiles;
create policy rider_profiles_select_any on public.rider_profiles for select to authenticated using (auth.role() = 'authenticated');
create policy rider_profiles_insert_own on public.rider_profiles for insert to authenticated with check (auth.uid() = user_id);
create policy rider_profiles_update_own on public.rider_profiles for update to authenticated using (auth.uid() = user_id);

alter table public.items enable row level security;
drop policy if exists items_select_own on public.items;
drop policy if exists items_select_company_owner on public.items;
drop policy if exists items_select_customer on public.items;
drop policy if exists items_select_available on public.items;
drop policy if exists items_select_own_business on public.items;
drop policy if exists items_insert_approved_business on public.items;
drop policy if exists items_insert_own_business on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_update_own_business on public.items;
drop policy if exists items_delete_own on public.items;
drop policy if exists items_delete_own_business on public.items;
create policy items_insert_own_business on public.items for insert to authenticated
  with check (auth.uid() = business_user_id and public.has_business_profile(auth.uid()));
create policy items_select_available on public.items for select to authenticated using (is_available = true);
create policy items_select_own_business on public.items for select to authenticated using (business_user_id = auth.uid());
create policy items_update_own_business on public.items for update to authenticated
  using (auth.uid() = business_user_id) with check (auth.uid() = business_user_id);
create policy items_delete_own_business on public.items for delete to authenticated
  using (auth.uid() = business_user_id);

alter table public.item_images enable row level security;
drop policy if exists item_images_select_business on public.item_images;
drop policy if exists item_images_select_company_owner on public.item_images;
drop policy if exists item_images_select_customer on public.item_images;
drop policy if exists item_images_select_available on public.item_images;
drop policy if exists item_images_select_own_business on public.item_images;
drop policy if exists item_images_insert_business on public.item_images;
drop policy if exists item_images_insert_own_business on public.item_images;
drop policy if exists item_images_delete_business on public.item_images;
drop policy if exists item_images_delete_own_business on public.item_images;
create policy item_images_select_available on public.item_images for select to authenticated using (
  exists (select 1 from public.items i where i.id = item_id and i.is_available = true)
);
create policy item_images_select_own_business on public.item_images for select to authenticated using (
  exists (select 1 from public.items i where i.id = item_id and i.business_user_id = auth.uid())
);
create policy item_images_insert_own_business on public.item_images for insert to authenticated with check (
  exists (select 1 from public.items i where i.id = item_id and i.business_user_id = auth.uid())
);
create policy item_images_delete_own_business on public.item_images for delete to authenticated using (
  exists (select 1 from public.items i where i.id = item_id and i.business_user_id = auth.uid())
);

alter table public.orders enable row level security;
drop policy if exists orders_select_own on public.orders;
drop policy if exists orders_select_business on public.orders;
drop policy if exists orders_select_company_owner on public.orders;
drop policy if exists orders_select_available_rider on public.orders;
drop policy if exists orders_select_assigned_rider on public.orders;
create policy orders_select_own on public.orders for select to authenticated using (auth.uid() = customer_user_id);
create policy orders_select_business on public.orders for select to authenticated using (
  business_user_id = auth.uid()
  or exists (
    select 1
    from public.order_items oi
    join public.items i on i.id = oi.item_id
    where oi.order_id = orders.id and i.business_user_id = auth.uid()
  )
);
create policy orders_select_available_rider on public.orders for select to authenticated using (
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
create policy orders_select_assigned_rider on public.orders for select to authenticated using (
  exists (
    select 1 from public.deliveries d
    where d.order_id = orders.id and d.rider_user_id = auth.uid()
  )
);

alter table public.order_items enable row level security;
drop policy if exists order_items_select_order_party on public.order_items;
drop policy if exists order_items_select_rider on public.order_items;
create policy order_items_select_order_party on public.order_items for select to authenticated using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_user_id = auth.uid() or o.business_user_id = auth.uid())
  )
);
create policy order_items_select_rider on public.order_items for select to authenticated using (
  exists (
    select 1 from public.deliveries d
    where d.order_id = order_items.order_id and d.rider_user_id = auth.uid()
  )
);

alter table public.payments enable row level security;
drop policy if exists payments_select_order_party on public.payments;
create policy payments_select_order_party on public.payments for select to authenticated using (
  customer_user_id = auth.uid()
  or exists (
    select 1 from public.orders o
    where o.id = order_id and o.business_user_id = auth.uid()
  )
);

alter table public.deliveries enable row level security;
drop policy if exists deliveries_select_rider on public.deliveries;
drop policy if exists deliveries_select_company_owner on public.deliveries;
drop policy if exists deliveries_select_customer on public.deliveries;
create policy deliveries_select_rider on public.deliveries for select to authenticated using (auth.uid() = rider_user_id);
create policy deliveries_select_customer on public.deliveries for select to authenticated using (
  exists (
    select 1 from public.orders o
    where o.id = deliveries.order_id and o.customer_user_id = auth.uid()
  )
);

alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated using (auth.uid() = user_id);
create policy notifications_update_own on public.notifications for update to authenticated using (auth.uid() = user_id);

-- ---- column security: riders never see customer contact info / code hash ----
revoke select (recipient_name, recipient_phone) on public.orders from anon, authenticated;
revoke select (code_hash) on public.deliveries from anon, authenticated;

-- ============================================================
-- 7. STORAGE BUCKETS
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-images', 'item-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists item_images_upload_own on storage.objects;
drop policy if exists item_images_upload_business on storage.objects;
drop policy if exists item_images_update_own on storage.objects;
drop policy if exists item_images_delete_own on storage.objects;
create policy item_images_upload_business on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_business_profile(auth.uid())
  );
create policy item_images_update_own on storage.objects for update to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_business_profile(auth.uid())
  );
create policy item_images_delete_own on storage.objects for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.has_business_profile(auth.uid())
  );

drop policy if exists payment_slips_insert_customer on storage.objects;
drop policy if exists payment_slips_select_related on storage.objects;
create policy payment_slips_insert_customer on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[2])::uuid
        and o.customer_user_id = auth.uid()
        and o.status in ('awaiting_payment', 'payment_rejected')
    )
  );
create policy payment_slips_select_related on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and exists (
      select 1 from public.orders o
      where o.id = ((storage.foldername(name))[2])::uuid
        and (o.customer_user_id = auth.uid() or o.business_user_id = auth.uid())
    )
  );

-- ============================================================
-- 8. BACKFILLS (inserts only — nothing deleted)
-- ============================================================

-- every user keeps their roles; business/rider roles become active
update public.roles
set status = 'active'
where role_type in ('business', 'rider') and status <> 'active';

insert into public.roles (user_id, role_type, company_id, status)
select u.id, 'customer'::public.role_type, null, 'active'::public.role_status
from auth.users u
where not exists (
  select 1 from public.roles r where r.user_id = u.id and r.role_type = 'customer'
);

insert into public.customer_profiles (user_id, phone, default_address)
select p.id, p.phone, p.default_address
from public.profiles p
where not exists (select 1 from public.customer_profiles cp where cp.user_id = p.id)
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
  and not exists (select 1 from public.rider_profiles rp where rp.user_id = p.id)
on conflict (user_id) do nothing;

insert into public.business_profiles (user_id, company_id, business_name)
select r.user_id, r.company_id, coalesce(p.business_name, 'Business')
from public.roles r
join public.profiles p on p.id = r.user_id
where r.role_type = 'business'
  and not exists (select 1 from public.business_profiles bp where bp.user_id = r.user_id)
on conflict (user_id) do nothing;

-- ============================================================
-- 9. GRANTS
-- ============================================================
grant usage on schema public to anon, authenticated;

revoke all on function public.ensure_profile(text) from public;
grant execute on function public.ensure_profile(text) to authenticated;

revoke all on function public.has_business_profile(uuid) from public;
grant execute on function public.has_business_profile(uuid) to authenticated;

revoke all on function public.register_company_member(uuid, public.member_type, text) from public;
grant execute on function public.register_company_member(uuid, public.member_type, text) to authenticated;

revoke all on function public.approve_company_member(uuid) from public;
grant execute on function public.approve_company_member(uuid) to authenticated;

revoke all on function public.reject_company_member(uuid, text) from public;
grant execute on function public.reject_company_member(uuid, text) to authenticated;

revoke all on function public.review_payment(uuid, boolean, text) from public;
grant execute on function public.review_payment(uuid, boolean, text) to authenticated;

revoke all on function public.approve_business_order(uuid) from public;
grant execute on function public.approve_business_order(uuid) to authenticated;

revoke all on function public.submit_payment_slip(uuid, text, text) from public;
grant execute on function public.submit_payment_slip(uuid, text, text) to authenticated;

revoke all on function public.cancel_order(uuid) from public;
grant execute on function public.cancel_order(uuid) to authenticated;

revoke all on function public.place_shop_order(jsonb, jsonb, text, text) from public;
grant execute on function public.place_shop_order(jsonb, jsonb, text, text) to authenticated;

revoke all on function public.place_rider_order(jsonb, jsonb, text, integer, text, text) from public;
grant execute on function public.place_rider_order(jsonb, jsonb, text, integer, text, text) to authenticated;

revoke all on function public.accept_delivery(uuid) from public;
grant execute on function public.accept_delivery(uuid) to authenticated;

revoke all on function public.mark_delivery_picked_up(uuid) from public;
grant execute on function public.mark_delivery_picked_up(uuid) to authenticated;

revoke all on function public.mark_delivery_pending_code(uuid) from public;
grant execute on function public.mark_delivery_pending_code(uuid) to authenticated;

revoke all on function public.verify_delivery_code(uuid, text) from public;
grant execute on function public.verify_delivery_code(uuid, text) to authenticated;

revoke all on function public.resolve_delivery(uuid, text) from public;
grant execute on function public.resolve_delivery(uuid, text) to authenticated;

revoke all on function public.notify_user(uuid, text, text, text) from public;
grant execute on function public.notify_user(uuid, text, text, text) to authenticated;

-- ============================================================
-- 10. RELOAD THE POSTGREST SCHEMA CACHE
-- ============================================================
notify pgrst, 'reload schema';
