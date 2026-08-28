
create extension if not exists pgcrypto;

create table if not exists manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid references manufacturers(id) on delete cascade,
  name text not null,
  category text default '',
  positioning text default '',
  differentiator text default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text default '',
  variant_name text default '',
  msrp numeric(12,2) default 0,
  map numeric(12,2) default 0,
  wholesale numeric(12,2) default 0,
  attributes jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, sku, variant_name)
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text default '',
  coverage text default '',
  region text default '',
  domain text default '',
  category text default '',
  potential numeric(14,2) default 0,
  score integer default 0,
  notes text default '',
  source text default 'app',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists accounts_name_lower_uq on accounts(lower(name));
create index if not exists accounts_type_idx on accounts(type);
create index if not exists accounts_region_idx on accounts(region);

create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  title text default '',
  email text default '',
  phone text default '',
  linkedin text default '',
  category text default '',
  source text default 'public',
  source_url text default '',
  confidence integer default 0,
  verified_at date,
  status text not null default 'Current',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists buyers_identity_uq on buyers(account_id, lower(name), lower(title));
create index if not exists buyers_account_idx on buyers(account_id);
create index if not exists buyers_status_idx on buyers(status);

create table if not exists competitive_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  brand text not null,
  product_name text not null,
  category text default '',
  price_text text default '',
  price_numeric numeric(12,2) default 0,
  availability text default '',
  source_url text not null default '',
  verified_at date,
  active boolean not null default true,
  raw_text text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, brand, product_name, source_url)
);
create index if not exists competitive_products_account_idx on competitive_products(account_id);
create index if not exists competitive_products_brand_idx on competitive_products(brand);
create index if not exists competitive_products_verified_idx on competitive_products(verified_at);

create table if not exists retail_observations (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  observation_type text not null,
  entity_key text not null,
  payload jsonb not null default '{}'::jsonb,
  source_url text default '',
  observed_at timestamptz not null default now()
);
create index if not exists observations_account_time_idx on retail_observations(account_id, observed_at desc);
create index if not exists observations_type_idx on retail_observations(observation_type);

create table if not exists opportunity_scores (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  product_variant_id uuid references product_variants(id) on delete cascade,
  overall_score integer default 0,
  assortment_gap integer default 0,
  price_white_space integer default 0,
  feature_differentiation integer default 0,
  competitive_density integer default 0,
  buyer_accessibility integer default 0,
  online_fit integer default 0,
  in_store_fit integer default 0,
  explanation jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null default now()
);
create index if not exists opportunity_account_time_idx on opportunity_scores(account_id, scored_at desc);

create table if not exists refresh_runs (
  id bigserial primary key,
  job_type text not null,
  status text not null default 'started',
  accounts_processed integer not null default 0,
  buyers_upserted integer not null default 0,
  products_upserted integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists change_events (
  id bigserial primary key,
  account_id uuid references accounts(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info',
  title text not null,
  detail text default '',
  previous_value jsonb,
  current_value jsonb,
  detected_at timestamptz not null default now(),
  acknowledged boolean not null default false
);
create index if not exists change_events_detected_idx on change_events(detected_at desc);
