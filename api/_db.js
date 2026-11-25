
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

function normalizeBuyerIdentity(value=''){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
}
function normalizeBuyerProfile(value=''){
  return String(value||'').trim().toLowerCase().replace(/^https?:\\/\\//,'').replace(/^www\\./,'').split(/[?#]/,1)[0].replace(/\\/+$/,'');
}
export async function upsertBuyer(b={}) {
  const sql=db(),accountId=b.account_id||null,name=String(b.name||'').trim(),title=String(b.title||'').trim(),
    nameKey=normalizeBuyerIdentity(name),titleKey=normalizeBuyerIdentity(title),email=String(b.email||'').trim().toLowerCase(),
    linkedin=String(b.linkedin||'').trim(),profileKey=normalizeBuyerProfile(linkedin),identityConfidence=Number(b.identity_confidence??b.confidence)||0,
    categoryStatus=String(b.category_verification_status||'UNCONFIRMED').toUpperCase(),employmentStatus=String(b.employment_verification_status||'UNCONFIRMED').toUpperCase(),
    categoryVerified=Boolean(b.category_evidence_url&&['VERIFIED','PROBABLE'].includes(categoryStatus)),
    notes=String(b.notes||''),incoming={...b,account_id:accountId,name,title,email,linkedin,identity_confidence:identityConfidence};
  return sql.begin(async tx=>{
    if(accountId&&nameKey){
      await tx`select pg_advisory_xact_lock(hashtextextended(${`buyer-refresh:${accountId}`},0))`;
      const existingRows=await tx`select * from buyers where account_id=${accountId} order by updated_at desc for update`;
      const compatible=row=>{
        const oldProfile=normalizeBuyerProfile(row.linkedin),oldEmail=String(row.email||'').trim().toLowerCase();
        return !(profileKey&&oldProfile&&profileKey!==oldProfile)&&!(email&&oldEmail&&email!==oldEmail);
      };
      const candidates=existingRows.filter(row=>compatible(row)),profileMatch=profileKey&&candidates.find(row=>normalizeBuyerProfile(row.linkedin)===profileKey),
        emailMatch=email&&candidates.find(row=>String(row.email||'').trim().toLowerCase()===email),
        nameRows=candidates.filter(row=>normalizeBuyerIdentity(row.name)===nameKey),
        exactNameTitle=nameRows.find(row=>normalizeBuyerIdentity(row.title)===titleKey),
        existing=profileMatch||emailMatch||exactNameTitle||(nameRows.length===1?nameRows[0]:null);
      if(existing){
        const saved=(await tx`update buyers set
          title=case when ${title}<>'' and ${identityConfidence}>=coalesce(identity_confidence,0) then ${title} else title end,
          email=coalesce(nullif(${email},''),email),phone=coalesce(nullif(${String(b.phone||'').trim()},''),phone),
          linkedin=coalesce(nullif(${linkedin},''),linkedin),
          category=case when category='' or (${categoryVerified} and ${String(b.category||b.category_scope||'').trim()}<>'') then ${String(b.category||b.category_scope||'')} else category end,
          department=case when ${categoryVerified} and ${String(b.department||'').trim()}<>'' then ${String(b.department||'')} else department end,
          category_scope=case when category_scope='' or (${categoryVerified} and ${String(b.category_scope||b.category||'').trim()}<>'') then ${String(b.category_scope||b.category||'')} else category_scope end,
          subcategory_scope=case when subcategory_scope='' or (${categoryVerified} and ${String(b.subcategory_scope||'').trim()}<>'') then ${String(b.subcategory_scope||'')} else subcategory_scope end,
          buyer_role=case when ${String(b.buyer_role||'UNCONFIRMED').toUpperCase()}<>'UNCONFIRMED' and ${categoryVerified} then ${String(b.buyer_role)} else buyer_role end,
          source=coalesce(nullif(${String(b.source||'').trim()},''),source),source_url=coalesce(nullif(${String(b.source_url||'').trim()},''),source_url),
          confidence=greatest(coalesce(confidence,0),${Number(b.confidence??b.identity_confidence)||0}),
          identity_confidence=greatest(coalesce(identity_confidence,0),${identityConfidence}),
          category_confidence=case when ${categoryVerified} then greatest(coalesce(category_confidence,0),${Number(b.category_confidence)||0}) else category_confidence end,
          category_evidence_url=case when ${categoryVerified} and ${String(b.category_evidence_url||'').trim()}<>'' then ${String(b.category_evidence_url)} else category_evidence_url end,
          category_evidence_source=case when ${categoryVerified} and ${String(b.category_evidence_source||'').trim()}<>'' then ${String(b.category_evidence_source)} else category_evidence_source end,
          category_last_verified=case when ${categoryVerified} then greatest(category_last_verified,${b.category_last_verified||null}) else category_last_verified end,
          category_verification_status=case when ${categoryStatus}='VERIFIED' or category_verification_status not in ('VERIFIED','PROBABLE') then ${categoryStatus} else category_verification_status end,
          employment_verification_status=case when ${employmentStatus}='STALE' or employment_verification_status not in ('VERIFIED','PROBABLE') then ${employmentStatus} else employment_verification_status end,
          employment_evidence_url=coalesce(nullif(${String(b.employment_evidence_url||b.source_url||'').trim()},''),employment_evidence_url),
          employment_last_verified=greatest(employment_last_verified,${b.employment_last_verified||b.verified_at||null}),
          relationship_review_reason=coalesce(nullif(${String(b.relationship_review_reason||'').trim()},''),relationship_review_reason),
          replacement_search_required=replacement_search_required or ${Boolean(b.replacement_search_required)},
          verified_at=coalesce(${b.verified_at||null},verified_at),
          status=case when ${employmentStatus}='STALE' then 'Stale' when ${employmentStatus} in ('VERIFIED','PROBABLE') then coalesce(nullif(${String(b.status||'').trim()},''),'Current') else status end,
          notes=case when ${notes}='' or position(${notes} in coalesce(notes,''))>0 then notes when coalesce(notes,'')='' then ${notes} else notes||E'\\n'||${notes} end,
          observed_at=greatest(observed_at,${b.observed_at||b.verified_at||new Date().toISOString()}),
          last_verified_at=greatest(last_verified_at,${b.last_verified_at||b.verified_at||null}),
          evidence_type=coalesce(nullif(${String(b.evidence_type||'').trim()},''),evidence_type),
          verification_status=case when ${String(b.verification_status||'').toUpperCase()}='VERIFIED' or verification_status<>'VERIFIED' then ${String(b.verification_status||'UNKNOWN')} else verification_status end,
          updated_at=now()
          where id=${existing.id} returning *`)[0];
        return saved;
      }
    }
    return (await tx`
      insert into buyers (account_id, name, title, email, phone, linkedin, category, department, category_scope, subcategory_scope, buyer_role, source, source_url, confidence, identity_confidence, category_confidence, category_evidence_url, category_evidence_source, category_last_verified, category_verification_status, employment_verification_status, employment_evidence_url, employment_last_verified, relationship_review_reason, replacement_search_required, verified_at, status, notes, observed_at, last_verified_at, evidence_type, verification_status, updated_at)
      values (
        ${accountId}, ${name}, ${title}, ${email}, ${String(b.phone||'').trim()},
        ${linkedin}, ${b.category||b.category_scope||''}, ${b.department||''}, ${b.category_scope||b.category||''}, ${b.subcategory_scope||''}, ${b.buyer_role||'UNCONFIRMED'}, ${b.source||'public'}, ${b.source_url||''},
        ${Number(b.confidence??b.identity_confidence)||0}, ${identityConfidence}, ${Number(b.category_confidence)||0}, ${b.category_evidence_url||''}, ${b.category_evidence_source||''}, ${b.category_last_verified||null}, ${categoryStatus}, ${employmentStatus}, ${b.employment_evidence_url||b.source_url||''}, ${b.employment_last_verified||null}, ${b.relationship_review_reason||''}, ${Boolean(b.replacement_search_required)}, ${b.verified_at||null}, ${b.status||'Current'}, ${notes},
        ${b.observed_at||b.verified_at||new Date().toISOString()}, ${b.last_verified_at||b.verified_at||null},
        ${b.evidence_type||'buyer'}, ${b.verification_status||'UNKNOWN'}, now()
      )
      on conflict (account_id, lower(name), lower(title)) do update set
        email=coalesce(nullif(excluded.email,''),buyers.email), phone=coalesce(nullif(excluded.phone,''),buyers.phone), linkedin=coalesce(nullif(excluded.linkedin,''),buyers.linkedin),
        category=case when buyers.category='' or (excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE')) then excluded.category else buyers.category end,
        department=case when excluded.department<>'' and lower(excluded.department)<>'unconfirmed' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.department else buyers.department end,
        category_scope=case when buyers.category_scope='' or (excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE')) then excluded.category_scope else buyers.category_scope end,
        subcategory_scope=case when buyers.subcategory_scope='' or (excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE')) then excluded.subcategory_scope else buyers.subcategory_scope end,
        buyer_role=case when excluded.buyer_role<>'UNCONFIRMED' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.buyer_role else buyers.buyer_role end,
        source=coalesce(nullif(excluded.source,''),buyers.source), source_url=coalesce(nullif(excluded.source_url,''),buyers.source_url), confidence=greatest(coalesce(buyers.confidence,0),coalesce(excluded.confidence,0)),
        identity_confidence=greatest(coalesce(buyers.identity_confidence,0),coalesce(excluded.identity_confidence,0)),
        category_confidence=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then greatest(coalesce(buyers.category_confidence,0),coalesce(excluded.category_confidence,0)) else buyers.category_confidence end,
        category_evidence_url=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.category_evidence_url else buyers.category_evidence_url end,
        category_evidence_source=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then excluded.category_evidence_source else buyers.category_evidence_source end,
        category_last_verified=case when excluded.category_evidence_url<>'' and excluded.category_verification_status in ('VERIFIED','PROBABLE') then greatest(buyers.category_last_verified,excluded.category_last_verified) else buyers.category_last_verified end,
        category_verification_status=case when excluded.category_verification_status='VERIFIED' or buyers.category_verification_status not in ('VERIFIED','PROBABLE') then excluded.category_verification_status else buyers.category_verification_status end,
        employment_verification_status=case when excluded.employment_verification_status='STALE' or buyers.employment_verification_status not in ('VERIFIED','PROBABLE') then excluded.employment_verification_status else buyers.employment_verification_status end,
        employment_evidence_url=coalesce(nullif(excluded.employment_evidence_url,''),buyers.employment_evidence_url),
        employment_last_verified=greatest(buyers.employment_last_verified,excluded.employment_last_verified),
        relationship_review_reason=coalesce(nullif(excluded.relationship_review_reason,''),buyers.relationship_review_reason),
        replacement_search_required=buyers.replacement_search_required or excluded.replacement_search_required,
        verified_at=coalesce(excluded.verified_at,buyers.verified_at),
        status=case when excluded.employment_verification_status='STALE' then 'Stale' when excluded.employment_verification_status in ('VERIFIED','PROBABLE') then coalesce(nullif(excluded.status,''),'Current') else buyers.status end,
        notes=case when excluded.notes='' or position(excluded.notes in coalesce(buyers.notes,''))>0 then buyers.notes when coalesce(buyers.notes,'')='' then excluded.notes else buyers.notes||E'\\n'||excluded.notes end,
        observed_at=greatest(buyers.observed_at,excluded.observed_at),last_verified_at=greatest(buyers.last_verified_at,excluded.last_verified_at),
        evidence_type=coalesce(nullif(excluded.evidence_type,''),buyers.evidence_type),
        verification_status=case when excluded.verification_status='VERIFIED' or buyers.verification_status<>'VERIFIED' then excluded.verification_status else buyers.verification_status end,updated_at=now()
      returning *`)[0];
  });
}
export async function upsertCompetitiveProduct(p={}) {
  const sql=db();
  const rows=await sql`
    insert into competitive_products
      (account_id, brand, product_name, category, price_text, price_numeric, availability, source_url, verified_at, active, raw_text, observed_at, last_verified_at, evidence_type, verification_status, updated_at)
    values (
      ${p.account_id||null}, ${p.brand||''}, ${p.product_name||p.product||''}, ${p.category||''},
      ${p.price_text||p.price||''}, ${Number(p.price_numeric)||0}, ${p.availability||''},
      ${p.source_url||''}, ${p.verified_at||null}, true, ${p.raw_text||p.product||''},
      ${p.observed_at||p.verified_at||new Date().toISOString()}, ${p.last_verified_at||p.verified_at||null},
      ${p.evidence_type||'assortment_product'}, ${p.verification_status||'UNKNOWN'}, now()
    )
    on conflict (account_id, brand, product_name, source_url) do update set
      category=excluded.category, price_text=excluded.price_text, price_numeric=excluded.price_numeric,
      availability=excluded.availability, verified_at=excluded.verified_at, active=true,
      raw_text=excluded.raw_text, observed_at=excluded.observed_at, last_verified_at=excluded.last_verified_at,
      evidence_type=excluded.evidence_type, verification_status=excluded.verification_status, updated_at=now()
    returning *`;
  return rows[0];
}
