import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

export const REVENUE_MISSION_SQL=`
create table if not exists revenue_missions(
 id uuid primary key default gen_random_uuid(),
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 brand_id uuid references brands(id) on delete set null,
 name text not null,
 target_revenue numeric(14,2) not null check(target_revenue>0),
 target_date date not null,
 product_ids jsonb not null default '[]'::jsonb,
 status text not null default 'ACTIVE' check(status in('ACTIVE','AT_RISK','ACHIEVED','PAUSED','ARCHIVED')),
 priority text not null default 'HIGH' check(priority in('LOW','MEDIUM','HIGH','CRITICAL')),
 identified_revenue numeric(14,2) not null default 0,
 qualified_pipeline numeric(14,2) not null default 0,
 buyer_confirmed_pipeline numeric(14,2) not null default 0,
 committed_revenue numeric(14,2) not null default 0,
 won_revenue numeric(14,2) not null default 0,
 remaining_gap numeric(14,2) not null default 0,
 confidence_adjusted_pipeline numeric(14,2) not null default 0,
 owner_user_id uuid references manufacturer_members(id) on delete set null,
 team_id uuid references manufacturer_teams(id) on delete set null,
 visibility text not null default 'private' check(visibility in('private','team','tenant')),
 created_by uuid references manufacturer_members(id) on delete set null,
 last_evaluated_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists revenue_missions_scope_idx on revenue_missions(manufacturer_id,visibility,team_id,owner_user_id,status,updated_at desc);
create index if not exists revenue_missions_target_idx on revenue_missions(manufacturer_id,target_date,status);

create table if not exists revenue_mission_opportunities(
 mission_id uuid not null references revenue_missions(id) on delete cascade,
 opportunity_id uuid not null references opportunity_workspaces(id) on delete restrict,
 pipeline_stage text not null default 'IDENTIFIED' check(pipeline_stage in('IDENTIFIED','QUALIFIED','BUYER_CONFIRMED','COMMITTED','WON','LOST')),
 linked_by uuid references manufacturer_members(id) on delete set null,
 linked_at timestamptz not null default now(),
 stage_updated_at timestamptz not null default now(),
 primary key(mission_id,opportunity_id)
);
create index if not exists revenue_mission_opportunity_idx on revenue_mission_opportunities(opportunity_id,mission_id);

create table if not exists revenue_mission_events(
 id bigserial primary key,
 mission_id uuid not null references revenue_missions(id) on delete restrict,
 manufacturer_id uuid not null references manufacturers(id) on delete restrict,
 actor_user_id uuid references manufacturer_members(id) on delete restrict,
 event_type text not null,
 previous_value jsonb not null default '{}'::jsonb,
 new_value jsonb not null default '{}'::jsonb,
 summary text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists revenue_mission_events_tenant_idx on revenue_mission_events(manufacturer_id,mission_id,created_at desc);
create or replace function prevent_revenue_mission_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'revenue_mission_events is append-only; create a new event instead'; end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='revenue_mission_events_immutable' and tgrelid='revenue_mission_events'::regclass) then
  create trigger revenue_mission_events_immutable before update or delete on revenue_mission_events for each row execute function prevent_revenue_mission_event_mutation();
 end if;
end $$;
`;

export default async function handler(req,res){if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});if(!requireAdmin(req,res))return;try{await db().unsafe(REVENUE_MISSION_SQL);return res.status(200).json({initialized:true,feature:'revenue_missions',additive:true});}catch(error){console.error('revenue mission migration failed',{message:error?.message||String(error)});return res.status(500).json({error:'Revenue Mission migration failed'});}}
