import { createHash } from 'node:crypto';
import { db } from './_db.js';

export function evidenceHash(value){
  return createHash('sha256').update(JSON.stringify(value||{})).digest('hex');
}

export function isExternalEvidence(e={}){
  return Boolean(String(e.source_url||'').trim()) && !['manufacturer_input','qa_seed','internal'].includes(String(e.source_type||'').toLowerCase());
}

export async function persistEvidence({manufacturer_id=null,account_id,evidence_type,entity_key='',payload={},source_url='',source_type='public',observed_at=null,confidence=70}){
  if(!account_id || !evidence_type) return null;
  const sql=db();
  const hash=evidenceHash({evidence_type,entity_key,payload,source_url});
  const existing=await sql`
    select * from evidence_items
    where account_id=${account_id}
      and evidence_type=${evidence_type}
      and entity_key=${entity_key}
      and source_url=${source_url||''}
      and content_hash=${hash}
    order by observed_at desc
    limit 1`;
  if(existing[0]) return existing[0];
  const rows=await sql`
    insert into evidence_items
      (manufacturer_id,account_id,evidence_type,entity_key,payload,source_url,source_type,observed_at,confidence,content_hash)
    values(
      ${manufacturer_id},${account_id},${evidence_type},${entity_key},${sql.json(payload||{})},
      ${source_url||''},${source_type||'public'},${observed_at||new Date().toISOString()},${Math.max(0,Math.min(100,Number(confidence)||0))},${hash}
    ) returning *`;
  return rows[0];
}

export function trustMetrics(evidence=[]){
  const external=evidence.filter(isExternalEvidence);
  const now=Date.now();
  const recent=external.filter(e=>{
    const t=Date.parse(e.observed_at||'');
    return Number.isFinite(t) && now-t <= 90*86400000;
  });
  const hasAssortment=external.some(e=>['competitive_product','retailer_product','assortment'].includes(String(e.evidence_type)));
  const hasCompetitive=external.some(e=>['competitive_product','competitor'].includes(String(e.evidence_type)));
  const hasBuyer=external.some(e=>['buyer','decision_maker'].includes(String(e.evidence_type)));
  const hasPricing=external.some(e=>{
    if(['price','pricing'].includes(String(e.evidence_type))) return true;
    const p=e.payload||{};
    return Boolean(p.price||p.price_text||Number(p.price_numeric)>0);
  });
  const dimensions={assortment:hasAssortment,competitive:hasCompetitive,buyer:hasBuyer,pricing:hasPricing};
  const evidenceCoverage=Math.round(100*Object.values(dimensions).filter(Boolean).length/4);
  const sourceReliability=external.length?Math.round(external.reduce((s,e)=>s+(Number(e.confidence)||0),0)/external.length):0;
  const freshness=external.length?Math.round(100*recent.length/external.length):0;
  return {
    external_evidence_count:external.length,
    recent_external_evidence_count:recent.length,
    evidence_coverage:evidenceCoverage,
    source_reliability:sourceReliability,
    freshness,
    dimensions
  };
}
