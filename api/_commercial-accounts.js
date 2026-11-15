import crypto from 'node:crypto';
import { db } from './_db.js';
import { domainFromWebsite, normalizePublicUrl } from './_url.js';

export const COMMERCIAL_ACCOUNT_CATEGORIES=Object.freeze([
 {key:'healthcare',label:'Healthcare'},
 {key:'government',label:'Government'},
 {key:'small_business',label:'Small Business'},
 {key:'hospitality',label:'Hospitality'},
 {key:'large_corporations',label:'Large Corporations'}
]);
const CATEGORY_KEYS=new Set(COMMERCIAL_ACCOUNT_CATEGORIES.map(category=>category.key));
let schemaReady;

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const value=(row,...keys)=>{for(const key of keys)if(row?.[key]!==undefined&&row?.[key]!==null&&String(row[key]).trim()!=='')return row[key];return ''};
const number=value=>{const parsed=Number(String(value??'').replace(/,/g,''));return Number.isFinite(parsed)?parsed:0};
export function normalizeCommercialCategory(value=''){
 const key=clean(value,80).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
 const aliases={health_care:'healthcare',public_sector:'government',small_businesses:'small_business',smb:'small_business',large_corporation:'large_corporations',enterprise:'large_corporations',corporate:'large_corporations'};
 const normalized=aliases[key]||key;return CATEGORY_KEYS.has(normalized)?normalized:'';
}
export function normalizeCommercialSubcategory(value='',accountCategory=''){
 const key=clean(value,80).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
 if(!key)return '';
 const normalized={gym:'fitness',gyms:'fitness',fitness_center:'fitness',fitness_centers:'fitness',health_club:'fitness',health_clubs:'fitness',hotel:'hotels',hotel_chain:'hotels',hotel_chains:'hotels',lodging:'hotels'}[key]||key;
 if(accountCategory==='healthcare'&&normalized==='fitness')return 'fitness';
 if(accountCategory==='hospitality'&&normalized==='hotels')return 'hotels';
 return '';
}
export function normalizeCommercialAccountRecord(row={}){
 const name=clean(value(row,'name','Account Name','Account','Organization','Company'),180),accountCategory=normalizeCommercialCategory(value(row,'account_category','Account Category','Category','Commercial Category'));
 if(!name)throw new Error('Account Name is required');
 if(!accountCategory)throw new Error('Account Category must be Healthcare, Government, Small Business, Hospitality, or Large Corporations');
 const requestedSubcategory=value(row,'account_subcategory','Account Subcategory','Subcategory'),accountSubcategory=normalizeCommercialSubcategory(requestedSubcategory,accountCategory);
 if(requestedSubcategory&&!accountSubcategory)throw new Error('Account Subcategory must be Fitness under Healthcare or Hotels under Hospitality');
 const website=normalizePublicUrl(value(row,'website','Website','domain','Domain','account_source_url','Source URL')),domain=domainFromWebsite(value(row,'domain','Domain')||website);
 const nestedDecisionMaker=row?.decision_maker&&typeof row.decision_maker==='object'?row.decision_maker:{},decisionMakerName=clean(value(row,'decision_maker_name','Decision Maker','Decision Maker Name','Buyer','Buyer Name')||nestedDecisionMaker.name,180),decisionMakerTitle=clean(value(row,'decision_maker_title','Decision Maker Title','Buyer Title')||nestedDecisionMaker.title,180),decisionMakerEmail=clean(value(row,'decision_maker_email','Decision Maker Email','Buyer Email')||nestedDecisionMaker.email,200),decisionMakerLinkedin=normalizePublicUrl(value(row,'decision_maker_linkedin','Decision Maker LinkedIn','Buyer LinkedIn')||nestedDecisionMaker.linkedin);
 if(Boolean(decisionMakerName)!==Boolean(decisionMakerTitle))throw new Error('Decision Maker and Decision Maker Title must be supplied together');
 if(decisionMakerEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decisionMakerEmail))throw new Error('Decision Maker Email is invalid');
 if(decisionMakerLinkedin&&!/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(decisionMakerLinkedin))throw new Error('Decision Maker LinkedIn must be a public LinkedIn URL');
 return {
  name,domain,website,account_category:accountCategory,account_subcategory:accountSubcategory,organization_type:clean(value(row,'organization_type','Organization Type','Type')||'commercial_account',80),headquarters:clean(value(row,'headquarters','Headquarters','Head Office'),180),region:clean(value(row,'region','Region'),120),location_count:Math.max(0,Math.round(number(value(row,'location_count','Locations','Location Count')))),notes:clean(value(row,'notes','Notes'),1000),source_url:normalizePublicUrl(value(row,'account_source_url','Account Source URL','Source URL','Source')||website),confidence:Math.min(100,Math.max(0,Math.round(number(value(row,'confidence','Confidence'))))),verification_status:clean(value(row,'verification_status','Verification Status')||'UNCONFIRMED',40).toUpperCase(),
  decision_maker:decisionMakerName?{name:decisionMakerName,title:decisionMakerTitle,department:clean(value(row,'decision_maker_department','Decision Maker Department')||nestedDecisionMaker.department,180),category_scope:clean(value(row,'decision_maker_category','Decision Maker Category','Decision Maker Category Scope','Buyer Category')||nestedDecisionMaker.category_scope,240),email:decisionMakerEmail,phone:clean(value(row,'decision_maker_phone','Decision Maker Phone','Buyer Phone')||nestedDecisionMaker.phone,80),linkedin:decisionMakerLinkedin,source_url:normalizePublicUrl(value(row,'decision_maker_source_url','Decision Maker Source URL')||nestedDecisionMaker.source_url),confidence:Math.min(100,Math.max(0,Math.round(number(value(row,'decision_maker_confidence','Decision Maker Confidence','Confidence')||nestedDecisionMaker.confidence)))),verification_status:clean(value(row,'decision_maker_verification_status','Decision Maker Verification Status')||nestedDecisionMaker.verification_status||'UNCONFIRMED',40).toUpperCase()}:null
 };
}
export function commercialAccountPreviewHash(records=[]){return crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex')}

export async function ensureCommercialAccountSchema(sql=db()){
 if(schemaReady)return schemaReady;
 schemaReady=(async()=>sql.begin(async transaction=>{
  await transaction`select pg_advisory_xact_lock(hashtextextended('launchpad36_commercial_accounts_schema',0))`;
  await transaction`create table if not exists commercial_accounts(
    id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
    name text not null, domain text not null default '', website text not null default '',
    account_category text not null check(account_category in('healthcare','government','small_business','hospitality','large_corporations')), account_subcategory text not null default '',
    organization_type text not null default 'commercial_account', headquarters text not null default '', region text not null default '',
    location_count integer not null default 0, notes text not null default '', source_type text not null default 'manual', source_url text not null default '',
    verification_status text not null default 'UNCONFIRMED', confidence integer not null default 0,
    active boolean not null default true, created_by uuid references manufacturer_members(id) on delete set null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`;
  await transaction`alter table commercial_accounts add column if not exists account_subcategory text not null default ''`;
  await transaction`create unique index if not exists commercial_accounts_tenant_name_uq on commercial_accounts(manufacturer_id,lower(name))`;
  await transaction`create index if not exists commercial_accounts_tenant_category_idx on commercial_accounts(manufacturer_id,account_category,active,name)`;
  await transaction`create index if not exists commercial_accounts_tenant_subcategory_idx on commercial_accounts(manufacturer_id,account_category,account_subcategory,active,name)`;
  await transaction`create index if not exists commercial_accounts_tenant_domain_idx on commercial_accounts(manufacturer_id,lower(domain)) where domain<>''`;
  await transaction`create table if not exists commercial_decision_makers(
    id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
    commercial_account_id uuid not null references commercial_accounts(id) on delete cascade,
    name text not null, title text not null, department text not null default '', category_scope text not null default '',
    email text not null default '', phone text not null default '', linkedin text not null default '', source_url text not null default '',
    verification_status text not null default 'UNCONFIRMED', confidence integer not null default 0, active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`;
  await transaction`create unique index if not exists commercial_decision_makers_account_identity_uq on commercial_decision_makers(commercial_account_id,lower(name),lower(title))`;
  await transaction`create index if not exists commercial_decision_makers_tenant_account_idx on commercial_decision_makers(manufacturer_id,commercial_account_id,active,updated_at desc)`;
  await transaction`create table if not exists commercial_account_import_runs(
    id uuid primary key default gen_random_uuid(), manufacturer_id uuid not null references manufacturers(id) on delete cascade,
    source_name text not null default '', preview_hash text not null default '', rows_seen integer not null default 0,
    accounts_added integer not null default 0, accounts_updated integer not null default 0, decision_makers_added integer not null default 0,
    duplicates_prevented integer not null default 0, rows_rejected integer not null default 0, status text not null default 'started',
    errors jsonb not null default '[]'::jsonb, created_by uuid references manufacturer_members(id) on delete set null,
    created_at timestamptz not null default now(), finished_at timestamptz
  )`;
  await transaction`create index if not exists commercial_account_import_runs_tenant_idx on commercial_account_import_runs(manufacturer_id,created_at desc)`;
 }))().catch(error=>{schemaReady=null;throw error});
 return schemaReady;
}
