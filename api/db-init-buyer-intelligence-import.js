import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

export const BUYER_INTELLIGENCE_IMPORT_SQL=`
create table if not exists buyer_intelligence_import_runs(
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 idempotency_key text not null, mode text not null check(mode in('PREVIEW','COMMIT')), source_type text not null default 'public_research',
 source_name text not null default '', status text not null default 'PROCESSING', payload_hash text not null,
 records_seen integer not null default 0, records_added integer not null default 0, records_updated integer not null default 0,
 records_flagged integer not null default 0, duplicates_prevented integer not null default 0, records_rejected integer not null default 0,
 errors jsonb not null default '[]'::jsonb, requested_by_user_id uuid references manufacturer_members(id) on delete set null,
 request_id text not null default '', preview_run_id uuid references buyer_intelligence_import_runs(id) on delete restrict,
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(manufacturer_id,idempotency_key,mode)
);
create index if not exists buyer_intelligence_import_runs_tenant_time_idx on buyer_intelligence_import_runs(manufacturer_id,created_at desc);
create index if not exists buyer_intelligence_import_runs_status_idx on buyer_intelligence_import_runs(manufacturer_id,status,created_at desc);

create table if not exists buyer_intelligence_import_items(
 id bigserial primary key, run_id uuid not null references buyer_intelligence_import_runs(id) on delete restrict,
 organization_id uuid references retail_organizations(id) on delete restrict, account_id uuid references accounts(id) on delete restrict,
 buyer_id uuid references buyers(id) on delete restrict, record_key text not null, action text not null, result text not null,
 previous_value jsonb not null default '{}'::jsonb, proposed_value jsonb not null default '{}'::jsonb,
 reasons jsonb not null default '[]'::jsonb, source_url text not null default '', observed_at timestamptz,
 created_at timestamptz not null default now(), unique(run_id,record_key)
);
create index if not exists buyer_intelligence_import_items_run_idx on buyer_intelligence_import_items(run_id,id);
create index if not exists buyer_intelligence_import_items_buyer_idx on buyer_intelligence_import_items(buyer_id,created_at desc);

create table if not exists buyer_intelligence_audit_events(
 id bigserial primary key, manufacturer_id uuid not null references manufacturers(id) on delete restrict,
 run_id uuid references buyer_intelligence_import_runs(id) on delete restrict,
 import_item_id bigint references buyer_intelligence_import_items(id) on delete restrict,
 organization_id uuid references retail_organizations(id) on delete restrict, account_id uuid references accounts(id) on delete restrict,
 buyer_id uuid references buyers(id) on delete restrict, action_type text not null, result text not null,
 previous_value jsonb not null default '{}'::jsonb, new_value jsonb not null default '{}'::jsonb,
 reason text not null default '', source_url text not null default '', observed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists buyer_intelligence_audit_tenant_time_idx on buyer_intelligence_audit_events(manufacturer_id,created_at desc);
create index if not exists buyer_intelligence_audit_buyer_time_idx on buyer_intelligence_audit_events(buyer_id,created_at desc);

create table if not exists buyer_intelligence_rate_limits(
 manufacturer_id uuid not null references manufacturers(id) on delete cascade, actor_key text not null,
 window_started_at timestamptz not null, request_count integer not null default 0, updated_at timestamptz not null default now(),
 primary key(manufacturer_id,actor_key,window_started_at)
);

create table if not exists buyer_intelligence_report_deliveries(
 id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 report_key text not null, period_start timestamptz not null, period_end timestamptz not null,
 recipient text not null, status text not null, provider_id text not null default '', summary jsonb not null default '{}'::jsonb,
 error text not null default '', created_at timestamptz not null default now(), unique(manufacturer_id,report_key,recipient)
);
create index if not exists buyer_intelligence_report_tenant_time_idx on buyer_intelligence_report_deliveries(manufacturer_id,created_at desc);

create or replace function prevent_l36_immutable_mutation() returns trigger language plpgsql as $$
begin raise exception '% is immutable; append a new record instead',tg_table_name; end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='buyer_intelligence_import_items_immutable') then
  create trigger buyer_intelligence_import_items_immutable before update or delete on buyer_intelligence_import_items for each row execute function prevent_l36_immutable_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='buyer_intelligence_audit_events_immutable') then
  create trigger buyer_intelligence_audit_events_immutable before update or delete on buyer_intelligence_audit_events for each row execute function prevent_l36_immutable_mutation();
 end if;
end $$;
`;

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  try{await db().unsafe(BUYER_INTELLIGENCE_IMPORT_SQL);return res.status(200).json({initialized:true,component:'buyer_intelligence_ingestion'})}
  catch(error){console.error('buyer intelligence migration failed',{message:error?.message||String(error)});return res.status(500).json({error:'Buyer intelligence migration failed'})}
}
