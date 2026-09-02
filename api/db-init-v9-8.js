import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

export const SQL=`
create table if not exists manufacturer_members (
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 email text not null, display_name text default '', role text not null default 'member', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists manufacturer_members_email_lower_uq on manufacturer_members(manufacturer_id,lower(email));

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

-- V9.8.3 Living Intelligence: globally shared public evidence, strictly separate from tenant-private catalog/CRM tables.
create table if not exists evidence_sources (
 id uuid primary key default gen_random_uuid(), source_url text not null, source_kind text not null default 'public_web',
 publisher text default '', domain text default '', active boolean not null default true, refresh_tier text not null default 'weekly',
 last_observed_at timestamptz, last_verified_at timestamptz, last_status text not null default 'UNKNOWN',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists evidence_sources_url_uq on evidence_sources(source_url);
create index if not exists evidence_sources_refresh_idx on evidence_sources(refresh_tier,last_verified_at);

create table if not exists commercial_evidence (
 id bigserial primary key, source_id uuid not null references evidence_sources(id) on delete restrict,
 account_id uuid references accounts(id) on delete cascade, organization_id uuid references retail_organizations(id) on delete cascade,
 subject_type text not null, subject_key text not null, evidence_type text not null, payload jsonb not null default '{}'::jsonb,
 content_hash text not null, observed_at timestamptz not null, last_verified_at timestamptz,
 confidence integer not null default 0, verification_status text not null default 'UNKNOWN', validation_notes text default '',
 acquired_by text not null default 'public_web', created_at timestamptz not null default now()
);
create unique index if not exists commercial_evidence_snapshot_uq on commercial_evidence(source_id,subject_type,subject_key,content_hash,observed_at);
create index if not exists commercial_evidence_subject_idx on commercial_evidence(subject_type,subject_key,observed_at desc);
create index if not exists commercial_evidence_account_idx on commercial_evidence(account_id,observed_at desc);

create table if not exists current_commercial_truth (
 subject_type text not null, subject_key text not null, evidence_id bigint not null references commercial_evidence(id) on delete restrict,
 payload jsonb not null default '{}'::jsonb, content_hash text not null, source_url text not null,
 observed_at timestamptz not null, last_verified_at timestamptz not null, confidence integer not null,
 evidence_type text not null, verification_status text not null, changed_at timestamptz not null default now(),
 primary key(subject_type,subject_key)
);

create table if not exists intelligence_change_events (
 id bigserial primary key, account_id uuid references accounts(id) on delete cascade, organization_id uuid references retail_organizations(id) on delete cascade,
 subject_type text not null, subject_key text not null, event_type text not null,
 previous_evidence_id bigint references commercial_evidence(id) on delete restrict, current_evidence_id bigint not null references commercial_evidence(id) on delete restrict,
 previous_hash text default '', current_hash text not null, previous_payload jsonb, current_payload jsonb not null,
 source_url text not null, observed_at timestamptz not null, detected_at timestamptz not null default now(),
 meaningful boolean not null default true, verification_status text not null default 'REVIEW_REQUIRED'
);
drop trigger if exists intelligence_change_events_immutable on intelligence_change_events;
alter table intelligence_change_events add column if not exists account_id uuid references accounts(id) on delete cascade;
alter table intelligence_change_events add column if not exists organization_id uuid references retail_organizations(id) on delete cascade;
update intelligence_change_events ice set account_id=coalesce(ice.account_id,ce.account_id),organization_id=coalesce(ice.organization_id,ce.organization_id) from commercial_evidence ce where ce.id=ice.current_evidence_id and (ice.account_id is null or ice.organization_id is null);
create index if not exists intelligence_changes_subject_idx on intelligence_change_events(subject_type,subject_key,detected_at desc);
create index if not exists intelligence_changes_pending_idx on intelligence_change_events(verification_status,detected_at desc);
create index if not exists intelligence_changes_account_idx on intelligence_change_events(account_id,detected_at desc);
create index if not exists intelligence_changes_org_idx on intelligence_change_events(organization_id,detected_at desc);

create table if not exists intelligence_change_event_processing (
 change_event_id bigint not null references intelligence_change_events(id) on delete cascade, processor text not null,
 status text not null default 'pending', attempts integer not null default 0, last_attempt_at timestamptz,
 processed_at timestamptz, error text default '', metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(change_event_id,processor)
);
create index if not exists intelligence_change_processing_status_idx on intelligence_change_event_processing(processor,status,updated_at);
do $$ begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='intelligence_change_events' and column_name='processed_at') then
  execute 'insert into intelligence_change_event_processing(change_event_id,processor,status,processed_at,last_attempt_at) select id,''legacy'',case when processed_at is null then ''pending'' else ''processed'' end,processed_at,processed_at from intelligence_change_events on conflict(change_event_id,processor) do nothing';
  execute 'alter table intelligence_change_events drop column processed_at';
 end if;
end $$;

create table if not exists intelligence_proposals (
 id bigserial primary key, manufacturer_id uuid references manufacturers(id) on delete cascade, account_id uuid references accounts(id) on delete cascade,
 change_event_id bigint references intelligence_change_events(id) on delete restrict, proposal_type text not null,
 proposed_payload jsonb not null default '{}'::jsonb, model text default '', status text not null default 'REVIEW_REQUIRED',
 deterministic_update_allowed boolean not null default false, created_at timestamptz not null default now(), reviewed_at timestamptz
);
create index if not exists intelligence_proposals_review_idx on intelligence_proposals(manufacturer_id,status,created_at desc);

create table if not exists monitor_targets (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references evidence_sources(id) on delete cascade,
 account_id uuid references accounts(id) on delete cascade, organization_id uuid references retail_organizations(id) on delete cascade,
 target_type text not null, refresh_tier text not null default 'weekly', provider text not null default 'firecrawl',
 provider_monitor_id text default '', webhook_events text[] not null default '{monitor.page,monitor.check.completed}',
 state text not null default 'pending', next_check_at timestamptz, last_check_at timestamptz, last_error text default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_id,target_type)
);
alter table monitor_targets add column if not exists account_id uuid references accounts(id) on delete cascade;
alter table monitor_targets add column if not exists organization_id uuid references retail_organizations(id) on delete cascade;
alter table monitor_targets add column if not exists category_focus text not null default '';
create index if not exists monitor_targets_due_idx on monitor_targets(state,next_check_at);

create table if not exists monitor_webhook_events (
 id bigserial primary key, provider text not null default 'firecrawl', provider_event_id text not null,
 provider_monitor_id text default '', event_type text not null, payload jsonb not null default '{}'::jsonb,
 received_at timestamptz not null default now(), processed_at timestamptz, status text not null default 'received', error text default ''
);
create unique index if not exists monitor_webhook_event_uq on monitor_webhook_events(provider,provider_event_id);

alter table accounts add column if not exists source_url text default '';
alter table accounts add column if not exists observed_at timestamptz;
alter table accounts add column if not exists last_verified_at timestamptz;
alter table accounts add column if not exists confidence integer not null default 0;
alter table accounts add column if not exists evidence_type text default '';
alter table accounts add column if not exists verification_status text not null default 'UNKNOWN';
alter table accounts add column if not exists organization_id uuid references retail_organizations(id) on delete set null;
update accounts a set organization_id=ro.id from retail_organizations ro where a.organization_id is null and a.domain<>'' and ro.domain<>'' and lower(regexp_replace(a.domain,'^www\\.',''))=lower(regexp_replace(ro.domain,'^www\\.',''));
alter table buyers add column if not exists observed_at timestamptz;
alter table buyers add column if not exists last_verified_at timestamptz;
alter table buyers add column if not exists evidence_type text default 'buyer';
alter table buyers add column if not exists verification_status text not null default 'UNKNOWN';
alter table competitive_products add column if not exists observed_at timestamptz;
alter table competitive_products add column if not exists last_verified_at timestamptz;
alter table competitive_products add column if not exists evidence_type text default 'assortment_product';
alter table competitive_products add column if not exists verification_status text not null default 'UNKNOWN';
alter table retail_observations add column if not exists last_verified_at timestamptz;
alter table retail_observations add column if not exists confidence integer not null default 0;
alter table retail_observations add column if not exists evidence_type text default '';
alter table retail_observations add column if not exists verification_status text not null default 'UNKNOWN';
alter table opportunity_scores add column if not exists manufacturer_id uuid references manufacturers(id) on delete cascade;
create index if not exists opportunity_scores_tenant_idx on opportunity_scores(manufacturer_id,scored_at desc);

create or replace function prevent_l36_immutable_mutation() returns trigger language plpgsql as $$
begin raise exception '% is immutable; append a new record instead',tg_table_name; end $$;
drop trigger if exists commercial_evidence_immutable on commercial_evidence;
create trigger commercial_evidence_immutable before update or delete on commercial_evidence for each row execute function prevent_l36_immutable_mutation();
create trigger intelligence_change_events_immutable before update or delete on intelligence_change_events for each row execute function prevent_l36_immutable_mutation();
`;
export default async function handler(req,res){if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});if(!requireAdmin(req,res))return;try{const sql=db();await sql.unsafe(SQL);return res.status(200).json({initialized:true,version:'9.8.3',architecture:'multi_tenant_living_retail_intelligence'})}catch(e){return res.status(500).json({error:e.message})}}
