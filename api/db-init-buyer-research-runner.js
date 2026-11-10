import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

export const BUYER_RESEARCH_RUNNER_SQL=`
create table if not exists buyer_research_settings(
 manufacturer_id uuid primary key references manufacturers(id) on delete cascade,
 zero_paid_api_mode boolean not null default true, allow_paid_bulk_research boolean not null default false,
 max_public_pages_per_account integer not null default 10, min_interval_seconds integer not null default 120,
 automatic_refresh_enabled boolean not null default false, refresh_interval_days integer not null default 30,
 updated_by_user_id uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table buyer_research_settings add column if not exists automatic_refresh_enabled boolean not null default false;
alter table buyer_research_settings add column if not exists refresh_interval_days integer not null default 30;

create table if not exists buyer_research_jobs(
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 idempotency_key text not null, status text not null default 'QUEUED' check(status in('QUEUED','RUNNING','PAUSED','CANCEL_REQUESTED','CANCELLED','PREVIEWING','AWAITING_APPROVAL','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')),
 baseline_retail_organizations integer not null default 0, baseline_accounts integer not null default 0, baseline_buyers integer not null default 0,
 requested_accounts integer not null default 0, accounts_completed integer not null default 0, accounts_succeeded integer not null default 0,
 accounts_no_results integer not null default 0, accounts_failed integer not null default 0, candidates_found integer not null default 0,
 verified_candidates integer not null default 0, update_candidates integer not null default 0, unchanged_candidates integer not null default 0,
 unverified_candidates integer not null default 0, stale_candidates integer not null default 0, conflicting_candidates integer not null default 0,
 duplicate_candidates integer not null default 0, preview_batches integer not null default 0,
 research_mode text not null default 'ZERO_PAID_API', public_pages_fetched integer not null default 0,
 robots_blocked_accounts integer not null default 0, external_api_cost_cents integer not null default 0,
 zero_paid_runs integer not null default 0, zero_paid_authorized boolean not null default false,
 provider_call_budget integer not null default 550, provider_calls_used integer not null default 0,
 max_attempts integer not null default 2, min_interval_seconds integer not null default 60, max_concurrency integer not null default 1,
 requested_by_user_id uuid references manufacturer_members(id) on delete set null, request_id text not null default '',
 last_error text not null default '', next_run_at timestamptz, started_at timestamptz, checkpoint_at timestamptz,
 completed_at timestamptz, cancelled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(manufacturer_id,idempotency_key)
);
alter table buyer_research_jobs add column if not exists baseline_retail_organizations integer not null default 0;
alter table buyer_research_jobs add column if not exists baseline_accounts integer not null default 0;
alter table buyer_research_jobs add column if not exists baseline_buyers integer not null default 0;
alter table buyer_research_jobs add column if not exists research_mode text not null default 'ZERO_PAID_API';
alter table buyer_research_jobs add column if not exists public_pages_fetched integer not null default 0;
alter table buyer_research_jobs add column if not exists robots_blocked_accounts integer not null default 0;
alter table buyer_research_jobs add column if not exists external_api_cost_cents integer not null default 0;
alter table buyer_research_jobs add column if not exists zero_paid_runs integer not null default 0;
alter table buyer_research_jobs add column if not exists zero_paid_authorized boolean not null default false;
create index if not exists buyer_research_jobs_tenant_time_idx on buyer_research_jobs(manufacturer_id,created_at desc);
create index if not exists buyer_research_jobs_work_idx on buyer_research_jobs(status,next_run_at,created_at);
create unique index if not exists buyer_research_jobs_one_active_uq on buyer_research_jobs(manufacturer_id) where status in('QUEUED','RUNNING','PAUSED','CANCEL_REQUESTED','PREVIEWING');

create table if not exists buyer_research_job_accounts(
 id uuid primary key default gen_random_uuid(), job_id uuid not null references buyer_research_jobs(id) on delete restrict,
 organization_id uuid not null references retail_organizations(id) on delete restrict, account_id uuid references accounts(id) on delete restrict,
 account_name text not null, account_domain text not null default '', organization_type text not null default 'retailer',
 categories jsonb not null default '[]'::jsonb, channels jsonb not null default '[]'::jsonb,
 existing_buyer_count integer not null default 0, priority_rank integer not null default 0,
 research_method text not null default 'DIRECT_PUBLIC_WEB', public_pages_fetched integer not null default 0,
 robots_status text not null default '', source_urls jsonb not null default '[]'::jsonb,
 status text not null default 'PENDING' check(status in('PENDING','PROCESSING','RETRY','SUCCEEDED','NO_RESULTS','FAILED','CANCELLED')),
 attempts integer not null default 0, provider_status text not null default '', candidates_found integer not null default 0,
 error text not null default '', next_attempt_at timestamptz, started_at timestamptz, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(job_id,organization_id)
);
alter table buyer_research_job_accounts add column if not exists research_method text not null default 'DIRECT_PUBLIC_WEB';
alter table buyer_research_job_accounts add column if not exists public_pages_fetched integer not null default 0;
alter table buyer_research_job_accounts add column if not exists robots_status text not null default '';
alter table buyer_research_job_accounts add column if not exists source_urls jsonb not null default '[]'::jsonb;
create index if not exists buyer_research_accounts_queue_idx on buyer_research_job_accounts(job_id,status,priority_rank,next_attempt_at);
create index if not exists buyer_research_accounts_org_idx on buyer_research_job_accounts(organization_id,created_at desc);

create table if not exists buyer_research_candidates(
 id uuid primary key default gen_random_uuid(), job_id uuid not null references buyer_research_jobs(id) on delete restrict,
 job_account_id uuid not null references buyer_research_job_accounts(id) on delete restrict,
 manufacturer_id uuid not null references manufacturers(id) on delete restrict,
 organization_id uuid not null references retail_organizations(id) on delete restrict,
 account_id uuid references accounts(id) on delete restrict, existing_buyer_id uuid references buyers(id) on delete restrict,
 record_key text not null, classification text not null check(classification in('NEW_VERIFIED_BUYER','EXISTING_BUYER_REQUIRING_UPDATE','EXISTING_VERIFIED_RECORD_UNCHANGED','STALE_OR_DEPARTED_BUYER','CONFLICTING_EVIDENCE','UNVERIFIED_CANDIDATE','DUPLICATE')),
 proposed_record jsonb not null, source_urls jsonb not null default '[]'::jsonb, evidence_date timestamptz,
 identity_confidence integer not null default 0, category_confidence integer not null default 0,
 identity_verification_status text not null default 'UNCONFIRMED', category_verification_status text not null default 'UNCONFIRMED',
 research_method text not null default 'DIRECT_PUBLIC_WEB', external_api_cost_cents integer not null default 0,
 created_at timestamptz not null default now(), unique(job_id,organization_id,record_key)
);
alter table buyer_research_candidates add column if not exists research_method text not null default 'DIRECT_PUBLIC_WEB';
alter table buyer_research_candidates add column if not exists external_api_cost_cents integer not null default 0;
create index if not exists buyer_research_candidates_job_idx on buyer_research_candidates(job_id,classification,created_at);
create index if not exists buyer_research_candidates_existing_idx on buyer_research_candidates(existing_buyer_id,created_at desc);

create table if not exists buyer_research_events(
 id bigserial primary key, job_id uuid not null references buyer_research_jobs(id) on delete restrict,
 manufacturer_id uuid not null references manufacturers(id) on delete restrict, event_type text not null,
 organization_id uuid references retail_organizations(id) on delete restrict, result text not null default 'SUCCESS',
 detail jsonb not null default '{}'::jsonb, request_id text not null default '', created_at timestamptz not null default now()
);
create index if not exists buyer_research_events_job_idx on buyer_research_events(job_id,created_at desc);
create index if not exists buyer_research_events_tenant_idx on buyer_research_events(manufacturer_id,created_at desc);

create table if not exists buyer_research_preview_batches(
 id uuid primary key default gen_random_uuid(), job_id uuid not null references buyer_research_jobs(id) on delete restrict,
 manufacturer_id uuid not null references manufacturers(id) on delete restrict, batch_number integer not null,
 import_run_id uuid not null references buyer_intelligence_import_runs(id) on delete restrict,
 idempotency_key text not null, record_count integer not null default 0, created_at timestamptz not null default now(),
 unique(job_id,batch_number), unique(manufacturer_id,idempotency_key)
);
create index if not exists buyer_research_preview_batches_job_idx on buyer_research_preview_batches(job_id,batch_number);

create table if not exists buyer_research_preview_items(
 batch_id uuid not null references buyer_research_preview_batches(id) on delete restrict,
 candidate_id uuid not null references buyer_research_candidates(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(batch_id,candidate_id), unique(candidate_id)
);

create or replace function prevent_l36_immutable_mutation() returns trigger language plpgsql as $$
begin raise exception '% is immutable; append a new record instead',tg_table_name; end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='buyer_research_candidates_immutable') then
  create trigger buyer_research_candidates_immutable before update or delete on buyer_research_candidates for each row execute function prevent_l36_immutable_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='buyer_research_events_immutable') then
  create trigger buyer_research_events_immutable before update or delete on buyer_research_events for each row execute function prevent_l36_immutable_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='buyer_research_preview_batches_immutable') then
  create trigger buyer_research_preview_batches_immutable before update or delete on buyer_research_preview_batches for each row execute function prevent_l36_immutable_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='buyer_research_preview_items_immutable') then
  create trigger buyer_research_preview_items_immutable before update or delete on buyer_research_preview_items for each row execute function prevent_l36_immutable_mutation();
 end if;
end $$;
`;

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  try{await db().unsafe(BUYER_RESEARCH_RUNNER_SQL);return res.status(200).json({initialized:true,component:'buyer_research_runner',version:'9.8.4'})}
  catch(error){console.error('buyer research runner migration failed',{message:error?.message||String(error)});return res.status(500).json({error:'Buyer research runner migration failed'})}
}
