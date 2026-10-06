import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

export const INTELLIGENCE_FOUNDATION_SQL=`
alter table product_variants add column if not exists manufacturer_sku text not null default '';
alter table product_variants add column if not exists gtin text not null default '';
alter table product_variants add column if not exists ean text not null default '';
alter table product_variants add column if not exists mpn text not null default '';

create table if not exists entity_field_observations(
 id bigserial primary key,
 manufacturer_id uuid references manufacturers(id) on delete restrict,
 entity_type text not null,
 entity_id text not null,
 field_name text not null,
 value jsonb not null,
 source_id uuid references evidence_sources(id) on delete restrict,
 source_url text not null default '',
 source_name text not null default '',
 provider text not null default 'user',
 observed_at timestamptz not null,
 confidence integer not null default 0 check(confidence between 0 and 100),
 verification_status text not null default 'NEEDS_RESEARCH' check(verification_status in('VERIFIED','MODELED','USER_ENTERED','NEEDS_RESEARCH','STALE','CONFLICTING')),
 evidence_type text not null default '',
 raw_excerpt text not null default '',
 superseded_by bigint references entity_field_observations(id) on delete restrict,
 created_by uuid references manufacturer_members(id) on delete set null,
 user_verified boolean not null default false,
 notes text not null default '',
 created_at timestamptz not null default now()
);
create index if not exists field_observations_entity_idx on entity_field_observations(manufacturer_id,entity_type,entity_id,field_name,observed_at desc);
create index if not exists field_observations_source_idx on entity_field_observations(source_id,observed_at desc);

create table if not exists current_entity_field_values(
 scope_key text not null,
 manufacturer_id uuid references manufacturers(id) on delete cascade,
 entity_type text not null,
 entity_id text not null,
 field_name text not null,
 observation_id bigint not null references entity_field_observations(id) on delete restrict,
 value jsonb not null,
 confidence integer not null,
 verification_status text not null,
 source_url text not null default '',
 observed_at timestamptz not null,
 updated_at timestamptz not null default now(),
 primary key(scope_key,entity_type,entity_id,field_name)
);
create index if not exists current_field_values_tenant_idx on current_entity_field_values(manufacturer_id,entity_type,entity_id);

create table if not exists canonical_products(
 id uuid primary key default gen_random_uuid(),
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 primary_product_id uuid references products(id) on delete set null,
 brand_id uuid references brands(id) on delete set null,
 name text not null,
 brand_name text not null default '',
 model text not null default '',
 category text not null default '',
 subcategory text not null default '',
 variant text not null default '',
 status text not null default 'ACTIVE',
 created_by uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists canonical_products_tenant_idx on canonical_products(manufacturer_id,brand_id,category,name);
create unique index if not exists canonical_products_primary_product_uq on canonical_products(manufacturer_id,primary_product_id) where primary_product_id is not null;

create table if not exists canonical_product_identifiers(
 id bigserial primary key,
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 canonical_product_id uuid not null references canonical_products(id) on delete cascade,
 identifier_type text not null check(identifier_type in('MANUFACTURER_SKU','RETAILER_SKU','UPC','GTIN','EAN','MPN','MODEL')),
 identifier_value text not null,
 normalized_value text not null,
 source_url text not null default '',
 verification_status text not null default 'USER_ENTERED',
 verified_at timestamptz,
 created_at timestamptz not null default now(),
 unique(manufacturer_id,identifier_type,normalized_value)
);
create index if not exists canonical_identifiers_product_idx on canonical_product_identifiers(canonical_product_id,identifier_type);

create table if not exists retailer_product_listings(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references retail_organizations(id) on delete cascade,
 retailer_listing_id text not null default '',
 retailer_sku text not null default '',
 listing_url text not null,
 product_name text not null,
 brand_name text not null default '',
 model text not null default '',
 category text not null default '',
 subcategory text not null default '',
 variant text not null default '',
 first_seen_at timestamptz not null,
 last_seen_at timestamptz not null,
 created_at timestamptz not null default now()
);
create unique index if not exists retailer_listing_url_uq on retailer_product_listings(organization_id,listing_url);
create index if not exists retailer_listing_identity_idx on retailer_product_listings(organization_id,retailer_sku,retailer_listing_id);

create table if not exists retailer_listing_observations(
 id bigserial primary key,
 listing_id uuid not null references retailer_product_listings(id) on delete restrict,
 submitted_by_manufacturer_id uuid references manufacturers(id) on delete set null,
 submitted_by_user_id uuid references manufacturer_members(id) on delete set null,
 source_id uuid references evidence_sources(id) on delete restrict,
 price numeric(12,2),
 currency text not null default 'USD',
 availability text not null default '',
 online_status text not null default 'UNKNOWN',
 store_status text not null default 'DISTRIBUTION_UNKNOWN',
 identifiers jsonb not null default '{}'::jsonb,
 attributes jsonb not null default '{}'::jsonb,
 source_url text not null,
 observed_at timestamptz not null,
 last_verified_at timestamptz,
 confidence integer not null default 0 check(confidence between 0 and 100),
 verification_status text not null default 'NEEDS_RESEARCH',
 evidence_type text not null default 'retailer_listing',
 created_at timestamptz not null default now()
);
alter table retailer_listing_observations add column if not exists submitted_by_manufacturer_id uuid references manufacturers(id) on delete set null;
alter table retailer_listing_observations add column if not exists submitted_by_user_id uuid references manufacturer_members(id) on delete set null;
create index if not exists retailer_listing_observations_time_idx on retailer_listing_observations(listing_id,observed_at desc);

create table if not exists product_identity_matches(
 id bigserial primary key,
 manufacturer_id uuid not null references manufacturers(id) on delete cascade,
 listing_id uuid not null references retailer_product_listings(id) on delete restrict,
 canonical_product_id uuid not null references canonical_products(id) on delete restrict,
 product_match_confidence integer not null check(product_match_confidence between 0 and 100),
 product_match_method text not null,
 reasons jsonb not null default '[]'::jsonb,
 conflicts jsonb not null default '[]'::jsonb,
 verification_status text not null default 'NEEDS_RESEARCH',
 user_verified boolean not null default false,
 verified_at timestamptz,
 created_by uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists product_identity_matches_listing_idx on product_identity_matches(manufacturer_id,listing_id,created_at desc);
create index if not exists product_identity_matches_product_idx on product_identity_matches(manufacturer_id,canonical_product_id,created_at desc);

create table if not exists l36_trust_evaluations(
 id bigserial primary key,
 manufacturer_id uuid references manufacturers(id) on delete cascade,
 entity_type text not null,
 entity_id text not null,
 trust_score integer not null check(trust_score between 0 and 100),
 trust_level text not null,
 reasons jsonb not null default '[]'::jsonb,
 missing_evidence jsonb not null default '[]'::jsonb,
 conflicts jsonb not null default '[]'::jsonb,
 recommended_verification jsonb not null default '[]'::jsonb,
 factors jsonb not null default '{}'::jsonb,
 observation_ids jsonb not null default '[]'::jsonb,
 algorithm_version text not null,
 created_by uuid references manufacturer_members(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists trust_evaluations_entity_idx on l36_trust_evaluations(manufacturer_id,entity_type,entity_id,created_at desc);

create or replace function prevent_intelligence_foundation_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only; create a new observation instead',tg_table_name; end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='entity_field_observations_immutable' and tgrelid='entity_field_observations'::regclass) then
  create trigger entity_field_observations_immutable before update or delete on entity_field_observations for each row execute function prevent_intelligence_foundation_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='retailer_listing_observations_immutable' and tgrelid='retailer_listing_observations'::regclass) then
  create trigger retailer_listing_observations_immutable before update or delete on retailer_listing_observations for each row execute function prevent_intelligence_foundation_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='product_identity_matches_immutable' and tgrelid='product_identity_matches'::regclass) then
  create trigger product_identity_matches_immutable before update or delete on product_identity_matches for each row execute function prevent_intelligence_foundation_mutation();
 end if;
 if not exists(select 1 from pg_trigger where tgname='l36_trust_evaluations_immutable' and tgrelid='l36_trust_evaluations'::regclass) then
  create trigger l36_trust_evaluations_immutable before update or delete on l36_trust_evaluations for each row execute function prevent_intelligence_foundation_mutation();
 end if;
end $$;
`;

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  try{await db().unsafe(INTELLIGENCE_FOUNDATION_SQL);return res.status(200).json({initialized:true,foundation:'evidence_trust_product_identity',additive:true});}
  catch(error){console.error('intelligence foundation migration failed',{message:error?.message||String(error)});return res.status(500).json({error:'Intelligence foundation migration failed'});}
}
