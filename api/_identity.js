import crypto from 'crypto';
import { db } from './_db.js';

let schemaReady;
export function normalizeRole(value='member'){const role=String(value||'member').toLowerCase();return ['owner','admin','manager','member','viewer'].includes(role)?role:'member'}
export function hashPassword(password=''){const value=String(password);if(value.length<8)throw Object.assign(new Error('Password must be at least 8 characters'),{status:400});const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(value,salt,64).toString('hex');return `scrypt$${salt}$${hash}`}
export function verifyPassword(password='',encoded=''){try{const [type,salt,expected]=String(encoded).split('$');if(type!=='scrypt'||!salt||!expected)return false;const actual=crypto.scryptSync(String(password),salt,64);const target=Buffer.from(expected,'hex');return actual.length===target.length&&crypto.timingSafeEqual(actual,target)}catch{return false}}

export async function ensureIdentitySchema(sql=db()){
 if(schemaReady)return schemaReady;
 schemaReady=(async()=>{
  await sql`create table if not exists manufacturer_teams(
    id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
    name text not null, description text default '', active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`;
  await sql`create unique index if not exists manufacturer_teams_name_uq on manufacturer_teams(manufacturer_id,lower(name))`;
  await sql`alter table manufacturer_members add column if not exists password_hash text default ''`;
  await sql`alter table manufacturer_members add column if not exists last_login_at timestamptz`;
  await sql`alter table manufacturer_members add column if not exists invited_at timestamptz default now()`;
  await sql`alter table manufacturer_members add column if not exists created_by uuid references manufacturer_members(id) on delete set null`;
  await sql`alter table manufacturer_members add column if not exists default_team_id uuid references manufacturer_teams(id) on delete set null`;
  await sql`create table if not exists manufacturer_team_members(team_id uuid not null references manufacturer_teams(id) on delete cascade,member_id uuid not null references manufacturer_members(id) on delete cascade,role text not null default 'member',created_at timestamptz not null default now(),primary key(team_id,member_id))`;
  await sql`alter table products add column if not exists owner_user_id uuid references manufacturer_members(id) on delete set null`;
  await sql`alter table products add column if not exists team_id uuid references manufacturer_teams(id) on delete set null`;
  await sql`alter table products add column if not exists visibility text not null default 'tenant'`;
  await sql`create index if not exists products_scope_idx on products(manufacturer_id,visibility,team_id,owner_user_id)`;
  await sql`create table if not exists tenant_account_overlays(id uuid primary key default gen_random_uuid(),manufacturer_id uuid not null references manufacturers(id) on delete cascade,organization_id uuid not null references retail_organizations(id) on delete cascade,owner_user_id uuid references manufacturer_members(id) on delete set null,team_id uuid references manufacturer_teams(id) on delete set null,visibility text not null default 'tenant',relationship_status text default '',account_owner text default '',notes text default '',strategy jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now())`;
  await sql`alter table tenant_account_overlays add column if not exists visibility text not null default 'tenant'`;
  await sql`create index if not exists tenant_account_overlay_scope_idx on tenant_account_overlays(manufacturer_id,organization_id,visibility,team_id,owner_user_id,updated_at desc)`;
  await sql`create table if not exists tenant_activity_log(id bigserial primary key,manufacturer_id uuid not null references manufacturers(id) on delete cascade,user_id uuid references manufacturer_members(id) on delete set null,action text not null,subject_type text not null,subject_id text default '',metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now())`;
  await sql`create index if not exists tenant_activity_log_idx on tenant_activity_log(manufacturer_id,created_at desc)`;
  await sql`create table if not exists crm_connections(id uuid primary key default gen_random_uuid(),manufacturer_id uuid not null references manufacturers(id) on delete cascade,provider text not null,encrypted_token text not null default '',settings jsonb not null default '{}'::jsonb,active boolean not null default true,created_by uuid references manufacturer_members(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(manufacturer_id,provider))`;
  await sql`create table if not exists crm_sync_mappings(id bigserial primary key,manufacturer_id uuid not null references manufacturers(id) on delete cascade,provider text not null,opportunity_id uuid not null references opportunity_workspaces(id) on delete cascade,external_company_id text default '',external_contact_id text default '',external_deal_id text default '',last_synced_at timestamptz,last_status text default '',last_error text default '',unique(manufacturer_id,provider,opportunity_id))`;
  await sql`create index if not exists crm_sync_mapping_idx on crm_sync_mappings(manufacturer_id,provider,last_synced_at desc)`;
 })().catch(e=>{schemaReady=null;throw e});
 return schemaReady;
}

export async function memberTeams(memberId,sql=db()){
 if(!memberId)return [];
 await ensureIdentitySchema(sql);
 return await sql`select t.id,t.name,tm.role from manufacturer_team_members tm join manufacturer_teams t on t.id=tm.team_id where tm.member_id=${memberId} and t.active=true order by t.name`;
}
