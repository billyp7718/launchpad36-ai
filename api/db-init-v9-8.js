import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

const SQL=`
create table if not exists manufacturer_members (
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 email text not null, display_name text default '', role text not null default 'member', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(manufacturer_id,lower(email))
);

alter table brands add column if not exists logo_url text default '';
alter table brands add column if not exists description text default '';
alter table brands add column if not exists updated_at timestamptz not null default now();

alter table products add column if not exists product_family text default '';
alter table products add column if not exists description text default '';
alter table products add column if not exists product_url text default '';
alter table products add column if not exists image_url text default '';
alter table products add column if not exists source_type text default 'manual';
alter table products add column if not exists source_url text default '';

alter table product_variants add column if not exists upc text default '';
alter table product_variants add column if not exists model_number text default '';
alter table product_variants add column if not exists image_url text default '';
alter table product_variants add column if not exists product_url text default '';

create table if not exists channels (
 id bigserial primary key, code text not null unique, name text not null, description text default '', active boolean not null default true
);
insert into channels(code,name) values
 ('mass','Mass Retail'),('ce','Consumer Electronics'),('ecommerce','E-commerce'),('distribution','Distribution'),
 ('specialty_av','Specialty AV'),('office','Office'),('furniture','Furniture'),('club','Club/Warehouse'),
 ('home_improvement','Home Improvement'),('automotive','Automotive'),('department','Department Store'),('dealer','Dealer Network')
on conflict(code) do nothing;

create table if not exists product_channels (
 product_id uuid not null references products(id) on delete cascade, channel_id bigint not null references channels(id) on delete cascade,
 primary key(product_id,channel_id)
);
create table if not exists product_categories (
 product_id uuid not null references products(id) on delete cascade, category text not null,
 primary key(product_id,category)
);

create table if not exists retail_organizations (
 id uuid primary key default gen_random_uuid(), name text not null, domain text default '', organization_type text not null default 'retailer',
 channel_codes text[] not null default '{}', categories text[] not null default '{}', coverage text default '', region text default '',
 footprint integer default 0, ecommerce boolean default false, active boolean not null default true,
 verification_status text not null default 'DISCOVERY_CANDIDATE', source_url text default '', last_verified timestamptz,
 confidence integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists retail_org_name_idx on retail_organizations(lower(name));
create index if not exists retail_org_channels_gin on retail_organizations using gin(channel_codes);
create index if not exists retail_org_categories_gin on retail_organizations using gin(categories);

create table if not exists manufacturer_account_targets (
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 organization_id uuid not null references retail_organizations(id) on delete cascade, brand_id uuid references brands(id) on delete set null,
 product_id uuid references products(id) on delete set null, status text not null default 'prospect', fit_score integer default 0,
 whitespace_score integer default 0, priority text default '', notes text default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(manufacturer_id,organization_id,brand_id,product_id)
);
create index if not exists manufacturer_targets_tenant_idx on manufacturer_account_targets(manufacturer_id,fit_score desc);

create table if not exists catalog_import_runs (
 id bigserial primary key, manufacturer_id uuid not null references manufacturers(id) on delete cascade, source_type text not null,
 source_name text default '', rows_seen integer default 0, rows_imported integer default 0, rows_rejected integer default 0,
 status text not null default 'started', errors jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), finished_at timestamptz
);

create table if not exists retail_universe_import_runs (
 id bigserial primary key, source_name text default '', rows_seen integer default 0, rows_imported integer default 0,
 status text default 'started', errors jsonb not null default '[]'::jsonb, created_at timestamptz default now(), finished_at timestamptz
);
`;
export default async function handler(req,res){if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});if(!requireAdmin(req,res))return;try{const sql=db();await sql.unsafe(SQL);return res.status(200).json({initialized:true,version:'9.8',architecture:'multi_tenant_retail_intelligence'})}catch(e){return res.status(500).json({error:e.message})}}
