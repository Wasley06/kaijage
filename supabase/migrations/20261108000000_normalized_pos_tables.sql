-- Add a normalized relational model alongside the existing KV store.
-- The old table is deliberately retained until operators validate the cutover.
begin;

create table if not exists public.businesses (
  id text primary key,
  name text not null,
  brand text not null,
  created_at timestamptz not null default now()
);
insert into public.businesses (id, name, brand) values
  ('entity_id_001', 'Kaijage Hardware', 'hardware'),
  ('entity_id_002', 'Kaijage Cosmetics', 'cosmetics')
on conflict (id) do nothing;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null unique,
  full_name text not null default '',
  role text not null check (role in ('super_admin','admin','manager','cashier','stock_manager')),
  active boolean not null default true,
  avatar text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_businesses (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  business_id text not null references public.businesses(id),
  primary key (user_id, business_id)
);

create table if not exists public.products (
  id text primary key,
  business_id text not null references public.businesses(id),
  name text not null,
  sku text not null,
  category text not null default '',
  unit text not null default 'Piece',
  buy_price numeric(14,2) not null default 0 check (buy_price >= 0),
  sell_price numeric(14,2) not null default 0 check (sell_price >= 0),
  stock numeric(14,3) not null default 0 check (stock >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  needs_pricing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record_data jsonb not null default '{}'::jsonb,
  unique (business_id, sku),
  unique (business_id, name)
);
create table if not exists public.customers (
  id text primary key,
  business_id text not null references public.businesses(id),
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record_data jsonb not null default '{}'::jsonb,
  unique (business_id, name)
);
create table if not exists public.suppliers (
  id text primary key,
  business_id text not null references public.businesses(id),
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record_data jsonb not null default '{}'::jsonb,
  unique (business_id, name)
);
create table if not exists public.sales (
  id text primary key,
  business_id text not null references public.businesses(id),
  receipt text not null,
  sold_at timestamptz not null default now(),
  customer_id text references public.customers(id) on delete set null,
  customer_name text not null default 'Walk-in customer',
  payment text not null default 'Cash',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  amount_received numeric(14,2) not null default 0 check (amount_received >= 0),
  change_due numeric(14,2) not null default 0 check (change_due >= 0),
  cost numeric(14,2) not null default 0 check (cost >= 0),
  status text not null default 'Completed',
  created_by uuid references auth.users(id) on delete set null,
  record_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (business_id, receipt)
);
create table if not exists public.sale_items (
  id bigint generated always as identity primary key,
  sale_id text not null references public.sales(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  unique (sale_id, product_id)
);
create table if not exists public.purchases (
  id text primary key,
  business_id text not null references public.businesses(id),
  number text not null,
  invoice text not null,
  supplier_id text references public.suppliers(id) on delete set null,
  supplier_name text not null default '',
  purchased_at timestamptz not null default now(),
  total numeric(14,2) not null default 0 check (total >= 0),
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance numeric(14,2) not null default 0 check (balance >= 0),
  status text not null default 'Paid',
  created_by uuid references auth.users(id) on delete set null,
  record_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (business_id, number),
  unique (business_id, invoice)
);
create table if not exists public.purchase_items (
  id bigint generated always as identity primary key,
  purchase_id text not null references public.purchases(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create table if not exists public.expenses (
  id text primary key,
  business_id text not null references public.businesses(id),
  number text not null,
  spent_at timestamptz not null default now(),
  category text not null default '',
  description text not null default '',
  amount numeric(14,2) not null check (amount >= 0),
  payment text not null default '',
  reference text not null default '',
  recorded_by text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  record_data jsonb not null default '{}'::jsonb,
  unique (business_id, number)
);
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references public.businesses(id),
  product_id text not null references public.products(id),
  movement_type text not null check (movement_type in ('purchase','sale','adjustment','opening')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,2) not null default 0,
  source_type text not null,
  source_id text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id, product_id, movement_type)
);
create table if not exists public.notifications (
  id text primary key,
  business_id text not null references public.businesses(id),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  message text not null default '',
  target text not null default 'inventory',
  is_read boolean not null default false,
  record_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.edit_requests (
  id text primary key,
  business_id text not null references public.businesses(id),
  resource text not null,
  record_id text not null,
  record_label text not null default '',
  changes jsonb not null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create table if not exists public.request_deduplication (
  idempotency_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists products_business_idx on public.products (business_id);
create index if not exists sales_business_date_idx on public.sales (business_id, sold_at desc);
create index if not exists purchases_business_date_idx on public.purchases (business_id, purchased_at desc);
create index if not exists inventory_product_date_idx on public.inventory_movements (product_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, is_read, created_at desc);
create index if not exists edit_requests_pending_idx on public.edit_requests (business_id, status, created_at desc);

do $$ declare t text; begin
  foreach t in array array['businesses','user_profiles','user_businesses','products','customers','suppliers','sales','sale_items','purchases','purchase_items','expenses','inventory_movements','notifications','edit_requests','request_deduplication'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
  grant usage, select on all sequences in schema public to service_role;
end $$;

commit;
