import { db } from './_db.js';
import { SMALL_PHARMACY_CATALOG_VERSION } from './_small-pharmacy-catalog.js';
import { commitSmallPharmacyCatalog } from './small-pharmacy-import.js';

const SEED_KEY=`small_pharmacy_catalog_${SMALL_PHARMACY_CATALOG_VERSION}`;

export async function seedSmallPharmacyCatalog(sql=db()){
  await sql`create table if not exists intelligence_seed_runs(seed_key text primary key,completed_at timestamptz,metadata jsonb not null default '{}'::jsonb)`;
  const completed=(await sql`select metadata from intelligence_seed_runs where seed_key=${SEED_KEY} limit 1`)[0];
  if(completed)return {status:'already_seeded',...(completed.metadata||{})};
  const result=await commitSmallPharmacyCatalog(sql);
  const metadata={...result,channel:'independent_pharmacy',catalog_version:SMALL_PHARMACY_CATALOG_VERSION};
  await sql`insert into intelligence_seed_runs(seed_key,completed_at,metadata) values(${SEED_KEY},now(),${sql.json(metadata)}) on conflict(seed_key) do nothing`;
  return {status:'seeded',...metadata};
}
