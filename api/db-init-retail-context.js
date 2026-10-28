import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

export const RETAIL_CONTEXT_SQL=`
create table if not exists retail_context_relationships(
 id bigserial primary key,
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 organization_id uuid references retail_organizations(id) on delete cascade,
 subject_type text not null,
 subject_id text not null,
 relationship_type text not null,
 object_type text not null,
 object_id text not null,
 category_scope text not null default '',
 valid_from timestamptz,
 valid_to timestamptz,
 confidence integer not null default 0 check(confidence between 0 and 100),
 verification_status text not null default 'NEEDS_RESEARCH',
 source_url text not null default '',
 notes text not null default '',
 active boolean not null default true,
 created_by uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists retail_context_relationships_tenant_idx on retail_context_relationships(manufacturer_id,organization_id,active,updated_at desc);
create index if not exists retail_context_relationships_subject_idx on retail_context_relationships(manufacturer_id,subject_type,subject_id,active);
create index if not exists retail_context_relationships_object_idx on retail_context_relationships(manufacturer_id,object_type,object_id,active);

create table if not exists buyer_meeting_feedback(
 id uuid primary key default gen_random_uuid(),
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 organization_id uuid not null references retail_organizations(id) on delete cascade,
 account_id uuid references accounts(id) on delete set null,
 opportunity_id uuid references opportunity_workspaces(id) on delete set null,
 buyer_id uuid references buyers(id) on delete set null,
 meeting_at timestamptz not null default now(),
 meeting_type text not null default 'buyer_meeting',
 notes text not null default '',
 buyer_feedback text not null default '',
 objections jsonb not null default '[]'::jsonb,
 accepted_skus jsonb not null default '[]'::jsonb,
 rejected_skus jsonb not null default '[]'::jsonb,
 requested_changes jsonb not null default '[]'::jsonb,
 rollout_scope text not null default '',
 follow_up_date date,
 next_action text not null default '',
 status text not null default 'RECORDED',
 created_by uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists buyer_meeting_feedback_tenant_org_idx on buyer_meeting_feedback(manufacturer_id,organization_id,meeting_at desc);
create index if not exists buyer_meeting_feedback_opportunity_idx on buyer_meeting_feedback(manufacturer_id,opportunity_id,meeting_at desc);

create table if not exists retail_context_events(
 id bigserial primary key,
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 organization_id uuid references retail_organizations(id) on delete cascade,
 account_id uuid references accounts(id) on delete set null,
 opportunity_id uuid references opportunity_workspaces(id) on delete set null,
 buyer_id uuid references buyers(id) on delete set null,
 event_type text not null,
 source_type text not null default 'user',
 source_url text not null default '',
 payload jsonb not null default '{}'::jsonb,
 happened_at timestamptz not null default now(),
 created_by uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists retail_context_events_tenant_org_idx on retail_context_events(manufacturer_id,organization_id,happened_at desc);
create index if not exists retail_context_events_tenant_opportunity_idx on retail_context_events(manufacturer_id,opportunity_id,happened_at desc);

create table if not exists intelligence_tool_access_events(
 id bigserial primary key,
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 actor_user_id uuid references manufacturer_members(id) on delete set null,
 tool_name text not null,
 organization_id uuid references retail_organizations(id) on delete set null,
 opportunity_id uuid references opportunity_workspaces(id) on delete set null,
 request_summary jsonb not null default '{}'::jsonb,
 result_count integer not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists intelligence_tool_access_events_tenant_idx on intelligence_tool_access_events(manufacturer_id,created_at desc);

create or replace function prevent_retail_context_event_mutation() returns trigger language plpgsql as $$
begin
 raise exception 'Retail context events are append-only';
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='retail_context_events_immutable' and tgrelid='retail_context_events'::regclass) then
  create trigger retail_context_events_immutable before update or delete on retail_context_events for each row execute function prevent_retail_context_event_mutation();
 end if;
end $$;
`;

export async function ensureRetailContextSchema(sql=db()){
  await sql.unsafe(RETAIL_CONTEXT_SQL);
  return true;
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  try{
    await ensureRetailContextSchema(db());
    return res.status(200).json({initialized:true,foundation:'retail_context_buyer_meeting_readonly_tools',additive:true});
  }catch(error){
    console.error('retail context migration failed',{message:error?.message||String(error)});
    return res.status(500).json({error:'Retail context migration failed'});
  }
}
