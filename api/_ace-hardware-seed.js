import { db, upsertBuyer } from './_db.js';

const NOW=()=>new Date().toISOString();

export async function seedAceHardware(sql=db()){
  const sourceUrl='https://www.acehardware.com/';
  const organization=(await sql`
    insert into retail_organizations
      (name,domain,organization_type,channel_codes,categories,coverage,region,headquarters,footprint,ecommerce,verification_status,source_url,last_verified,confidence,active,updated_at)
    values
      ('Ace Hardware','acehardware.com','retailer',${['home_improvement','ecommerce']},${['Hardware','Home Improvement','Outdoor Living','Tools','Electrical','Plumbing','Paint','Lawn & Garden']},'National','United States','Oak Brook, IL',0,true,'VERIFIED',${sourceUrl},now(),95,true,now())
    on conflict (lower(name)) do update set
      domain=excluded.domain,organization_type=excluded.organization_type,channel_codes=excluded.channel_codes,categories=excluded.categories,
      coverage=excluded.coverage,region=excluded.region,headquarters=excluded.headquarters,ecommerce=excluded.ecommerce,
      verification_status=excluded.verification_status,source_url=excluded.source_url,last_verified=excluded.last_verified,
      confidence=excluded.confidence,active=true,updated_at=now()
    returning *
  `)[0];

  const account=(await sql`
    insert into accounts
      (name,type,coverage,region,domain,category,potential,score,notes,source,organization_id,source_url,observed_at,last_verified_at,confidence,evidence_type,verification_status,updated_at)
    values
      ('Ace Hardware','Retailer','National','United States','acehardware.com','Home Improvement / Hardware',0,0,
       'Ace Hardware Corporation corporate account. Independent retailer cooperative with centralized merchandising and category-management functions.',
       'curated_public',${organization.id},${sourceUrl},now(),now(),95,'account','VERIFIED',now())
    on conflict (lower(name)) do update set
      type=excluded.type,coverage=excluded.coverage,region=excluded.region,domain=excluded.domain,category=excluded.category,
      notes=excluded.notes,source=excluded.source,organization_id=excluded.organization_id,source_url=excluded.source_url,
      observed_at=excluded.observed_at,last_verified_at=excluded.last_verified_at,confidence=excluded.confidence,
      evidence_type=excluded.evidence_type,verification_status=excluded.verification_status,updated_at=now()
    returning *
  `)[0];

  const verifiedAt=NOW();
  await upsertBuyer({
    account_id:account.id,
    name:'Brian Wiborg',
    title:'Senior Vice President of Merchandising',
    category:'Merchandising / Category Management',
    source:'Ace Hardware Newsroom',
    source_url:'https://newsroom.acehardware.com/brian-wiborg/',
    confidence:95,
    verified_at:verifiedAt,
    last_verified_at:verifiedAt,
    evidence_type:'official_company_bio',
    verification_status:'VERIFIED',
    status:'Current',
    notes:'Senior merchandising decision-maker. Official Ace biography states responsibility for merchandising and profitable growth for Ace retailers.'
  });

  await upsertBuyer({
    account_id:account.id,
    name:'John Surane',
    title:'Executive Vice President, Chief Growth Officer',
    category:'Executive Merchandising / Growth',
    source:'Ace Hardware Newsroom',
    source_url:'https://newsroom.acehardware.com/officer-bios?item=29942',
    confidence:90,
    verified_at:verifiedAt,
    last_verified_at:verifiedAt,
    evidence_type:'official_company_bio',
    verification_status:'VERIFIED',
    status:'Current',
    notes:'Executive decision-maker with documented Ace merchandising leadership background and oversight of product selection/growth initiatives.'
  });

  return {organization,account,buyers:2};
}
