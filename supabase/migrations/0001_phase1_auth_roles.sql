-- ============================================================
-- AZ Dispatch — Phase 1: auth profiles, roles, role system
-- Company-email exclusivity is enforced here at the database
-- level (trigger), not just in the UI.
-- Full domain schema is created upfront; RLS policies for the
-- domain tables land with their phases.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================
create type public.role_type as enum (
  'customer',
  'business',
  'rider',
  'company_owner'
);

create type public.role_status as enum ('active', 'pending', 'rejected');

create type public.member_type as enum ('business', 'rider');

create type public.member_status as enum ('pending', 'approved', 'rejected');

create type public.order_status as enum (
  'draft',
  'awaiting_payment',
  'payment_submitted',
  'payment_confirmed',
  'payment_rejected',
  'awaiting_business_approval',
  'awaiting_rider',
  'rider_assigned',
  'picked_up',
  'delivered',
  'delayed',
  'cancelled'
);

create type public.payment_status as enum (
  'awaiting',
  'submitted',
  'confirmed',
  'rejected'
);

create type public.delivery_status as enum (
  'accepted',
  'picked_up',
  'delivered_pending_code',
  'delivered',
  'cancelled'
);

-- ============================================================
-- PROFILES (1:1 with auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  business_name text,
  default_address jsonb,
  rider_profile jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- COMPANIES (owned by a dispatch company owner)
-- ============================================================
create table public.companies (
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

-- ============================================================
-- ROLES (a user may hold customer + business + rider roles;
-- a company_owner role is exclusive per email — see trigger)
-- ============================================================
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_type public.role_type not null,
  company_id uuid references public.companies (id) on delete set null,
  status public.role_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role_type)
);

-- ============================================================
-- COMPANY MEMBERS (business/rider registration & approval)
-- ============================================================
create table public.company_members (
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

-- ============================================================
-- BUSINESS PROFILES
-- ============================================================
create table public.business_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  business_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ITEMS (daily business items)
-- ============================================================
create table public.items (
  id uuid primary key default gen_random_uuid(),
  business_user_id uuid not null references public.profiles (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text not null default '',
  price_naira integer not null check (price_naira >= 0),
  quantity integer not null default 1 check (quantity >= 0),
  is_available boolean not null default true,
  listed_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- ITEM IMAGES
-- ============================================================
create table public.item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ORDERS (kind: 'shop' = bought from a business,
-- 'rider_only' = standalone dispatch request)
-- ============================================================
create table public.orders (
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

-- ============================================================
-- ORDER ITEMS
-- ============================================================
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  item_name text not null,
  unit_price_naira integer not null,
  quantity integer not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PAYMENTS (bank slip upload + company review)
-- ============================================================
create table public.payments (
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

-- ============================================================
-- DELIVERIES (rider job; code stored as hash only)
-- ============================================================
create table public.deliveries (
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

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null default 'info',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index roles_user_id_idx on public.roles (user_id);
create index company_members_company_id_idx on public.company_members (company_id);
create index items_company_available_idx on public.items (company_id, listed_on, is_available);
create index orders_customer_idx on public.orders (customer_user_id, status);
create index orders_company_idx on public.orders (company_id, status);
create index order_items_order_idx on public.order_items (order_id);
create index payments_order_idx on public.payments (order_id);
create index deliveries_rider_idx on public.deliveries (rider_user_id, status);
create index notifications_user_idx on public.notifications (user_id, read);

-- ============================================================
-- updated_at maintenance
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

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create trigger trg_company_members_updated_at
  before update on public.company_members
  for each row execute function public.set_updated_at();

create trigger trg_business_profiles_updated_at
  before update on public.business_profiles
  for each row execute function public.set_updated_at();

create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create trigger trg_deliveries_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create a profile row whenever an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Company-email exclusivity, enforced at the database level:
--   * a company_owner role cannot coexist with any other role
--   * any other role cannot be added to a company_owner email
create or replace function public.enforce_company_email_exclusive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  other_roles_exist boolean;
  company_role_exists boolean;
begin
  select exists (
    select 1 from public.roles r
    where r.user_id = new.user_id and r.role_type <> 'company_owner'
  ) into other_roles_exist;

  select exists (
    select 1 from public.roles r
    where r.user_id = new.user_id and r.role_type = 'company_owner'
  ) into company_role_exists;

  if new.role_type = 'company_owner' and other_roles_exist then
    raise exception 'COMPANY_EMAIL_RULE: a dispatch company account must use its own dedicated email';
  end if;

  if new.role_type <> 'company_owner' and company_role_exists then
    raise exception 'COMPANY_EMAIL_RULE: a dispatch company email cannot also be a customer, business or rider';
  end if;

  return new;
end;
$$;

create trigger trg_company_email_exclusive
  before insert on public.roles
  for each row execute function public.enforce_company_email_exclusive();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  using (auth.uid() = id);

create policy profiles_update_own
  on public.profiles for update
  using (auth.uid() = id);

alter table public.roles enable row level security;

create policy roles_select_own
  on public.roles for select
  using (auth.uid() = user_id);

create policy roles_insert_own
  on public.roles for insert
  with check (auth.uid() = user_id);

-- Domain tables are RLS-enabled from day one with default-deny;
-- per-phase policies are added with each feature.
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.business_profiles enable row level security;
alter table public.items enable row level security;
alter table public.item_images enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.deliveries enable row level security;
alter table public.notifications enable row level security;
