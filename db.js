
import postgres from 'postgres';

let client;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!client) {
    client = postgres(process.env.DATABASE_URL, {
      ssl: 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false
    });
  }
  return client;
}

export async function upsertAccount(a={}) {
  const sql=db();
  const rows=await sql`
    insert into accounts (name, type, coverage, region, domain, category, potential, score, notes, source, updated_at)
    values (
      ${a.name||''}, ${a.type||''}, ${a.coverage||''}, ${a.region||''}, ${a.domain||''},
      ${a.category||''}, ${Number(a.potential)||0}, ${Number(a.score)||0}, ${a.notes||''},
      ${a.source||'app'}, now()
    )
    on conflict (lower(name)) do update set
      type=excluded.type, coverage=excluded.coverage, region=excluded.region, domain=excluded.domain,
      category=excluded.category, potential=excluded.potential, score=excluded.score,
      notes=excluded.notes, source=excluded.source, updated_at=now()
    returning *`;
  return rows[0];
}

export async function upsertBuyer(b={}) {
  const sql=db();
  const rows=await sql`
    insert into buyers (account_id, name, title, email, phone, linkedin, category, department, category_scope, subcategory_scope, buyer_role, source, source_url, confidence, identity_confidence, category_confidence, category_evidence_url, category_evidence_source, category_last_verified, category_verification_status, employment_verification_status, employment_evidence_url, employment_last_verified, relationship_review_reason, replacement_search_required, verified_at, status, notes, updated_at)
    values (
      ${b.account_id||null}, ${b.name||''}, ${b.title||''}, ${b.email||''}, ${b.phone||''},
      ${b.linkedin||''}, ${b.category||b.category_scope||''}, ${b.department||''}, ${b.category_scope||b.category||''}, ${b.subcategory_scope||''}, ${b.buyer_role||'UNCONFIRMED'}, ${b.source||'public'}, ${b.source_url||''},
      ${Number(b.confidence??b.identity_confidence)||0}, ${Number(b.identity_confidence??b.confidence)||0}, ${Number(b.category_confidence)||0}, ${b.category_evidence_url||''}, ${b.category_evidence_source||''}, ${b.category_last_verified||null}, ${b.category_verification_status||'UNCONFIRMED'}, ${b.employment_verification_status||'UNCONFIRMED'}, ${b.employment_evidence_url||b.source_url||''}, ${b.employment_last_verified||null}, ${b.relationship_review_reason||''}, ${Boolean(b.replacement_search_required)}, ${b.verified_at||null}, ${b.status||'Current'}, ${b.notes||''}, now()
    )
    on conflict (account_id, lower(name), lower(title)) do update set
      email=excluded.email, phone=excluded.phone, linkedin=excluded.linkedin,
      category=case when buyers.category='' or (excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE')) then excluded.category else buyers.category end,
      department=case when excluded.department<>'' and lower(excluded.department)<>'unconfirmed' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.department else buyers.department end,
      category_scope=case when buyers.category_scope='' or (excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE')) then excluded.category_scope else buyers.category_scope end,
      subcategory_scope=case when buyers.subcategory_scope='' or (excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE')) then excluded.subcategory_scope else buyers.subcategory_scope end,
      buyer_role=case when excluded.buyer_role<>'UNCONFIRMED' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.buyer_role else buyers.buyer_role end,
      source=excluded.source, source_url=excluded.source_url, confidence=excluded.confidence,
      identity_confidence=excluded.identity_confidence,
      category_confidence=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.category_confidence else buyers.category_confidence end,
      category_evidence_url=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.category_evidence_url else buyers.category_evidence_url end,
      category_evidence_source=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.category_evidence_source else buyers.category_evidence_source end,
      category_last_verified=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.category_last_verified else buyers.category_last_verified end,
      category_verification_status=excluded.category_verification_status,
      employment_verification_status=excluded.employment_verification_status,
      employment_evidence_url=case when excluded.employment_evidence_url<>'' then excluded.employment_evidence_url else buyers.employment_evidence_url end,
      employment_last_verified=coalesce(excluded.employment_last_verified,buyers.employment_last_verified),
      relationship_review_reason=excluded.relationship_review_reason,replacement_search_required=excluded.replacement_search_required,
      verified_at=excluded.verified_at, status=excluded.status, notes=excluded.notes, updated_at=now()
    returning *`;
  return rows[0];
}

export async function upsertCompetitiveProduct(p={}) {
  const sql=db();
  const rows=await sql`
    insert into competitive_products
      (account_id, brand, product_name, category, price_text, price_numeric, availability, source_url, verified_at, active, raw_text, updated_at)
    values (
      ${p.account_id||null}, ${p.brand||''}, ${p.product_name||p.product||''}, ${p.category||''},
      ${p.price_text||p.price||''}, ${Number(p.price_numeric)||0}, ${p.availability||''},
      ${p.source_url||''}, ${p.verified_at||null}, true, ${p.raw_text||p.product||''}, now()
    )
    on conflict (account_id, brand, product_name, source_url) do update set
      category=excluded.category, price_text=excluded.price_text, price_numeric=excluded.price_numeric,
      availability=excluded.availability, verified_at=excluded.verified_at, active=true,
      raw_text=excluded.raw_text, updated_at=now()
    returning *`;
  return rows[0];
}
