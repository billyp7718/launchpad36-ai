import { db } from './_db.js';

const SQL = `
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references manufacturers(id) on delete cascade,
  name text not null,
  website text default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(manufacturer_id, name)
);

alter table products add column if not exists brand_id uuid references brands(id) on delete set null;

create table if not exists intelligence_runs (
  id bigserial primary key,
  manufacturer_id uuid references manufacturers(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  status text not null default 'started',
  model text default '',
  prompt_version text default 'v9.1',
  input_snapshot jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  confidence integer default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists intelligence_runs_account_idx on intelligence_runs(account_id, started_at desc);

create table if not exists evidence_items (
  id bigserial primary key,
  manufacturer_id uuid references manufacturers(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  evidence_type text not null,
  entity_key text default '',
  payload jsonb not null default '{}'::jsonb,
  source_url text default '',
  source_type text default 'public',
  observed_at timestamptz not null default now(),
  confidence integer default 0,
  content_hash text default ''
);
create index if not exists evidence_items_account_idx on evidence_items(account_id, observed_at desc);

create table if not exists account_intelligence (
  id bigserial primary key,
  manufacturer_id uuid references manufacturers(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  run_id bigint references intelligence_runs(id) on delete set null,
  overall_score integer default 0,
  record jsonb not null default '{}'::jsonb,
  confidence integer default 0,
  generated_at timestamptz not null default now(),
  active boolean not null default true
);
create index if not exists account_intelligence_account_idx on account_intelligence(account_id, generated_at desc);

create table if not exists executive_audits (
  id bigserial primary key,
  manufacturer_id uuid references manufacturers(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  model text default '',
  audit jsonb not null default '{}'::jsonb,
  overall_health integer default 0,
  release_recommendation text not null default 'NO_GO',
  created_at timestamptz not null default now()
);
create index if not exists executive_audits_time_idx on executive_audits(created_at desc);
`;

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const secret=process.env.ADMIN_SECRET||'';
  if(!secret || req.headers.authorization!==`Bearer ${secret}`) return res.status(401).json({error:'Unauthorized'});
  try { const sql=db(); await sql.unsafe(SQL); return res.status(200).json({initialized:true,version:'9.1'}); }
  catch(e){ return res.status(500).json({error:e.message}); }
}
