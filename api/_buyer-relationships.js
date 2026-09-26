const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const key=value=>clean(value,240).toLowerCase().replace(/[^a-z0-9]+/g,'');
const status=value=>clean(value,30).toUpperCase()||'UNCONFIRMED';

export const BUYER_RELATIONSHIP_STATUSES=new Set(['VERIFIED','PROBABLE','UNCONFIRMED','STALE','CONFLICTING']);

export function normalizeRelationshipStatus(value,fallback='UNCONFIRMED'){
  const normalized=status(value);
  return BUYER_RELATIONSHIP_STATUSES.has(normalized)?normalized:fallback;
}

export function detectBuyerRelationshipChange(previous={},next={}){
  if(!previous?.id)return normalizeRelationshipStatus(next.category_verification_status)==='VERIFIED'?'NEW_CATEGORY_BUYER':'OBSERVED';
  const employment=normalizeRelationshipStatus(next.employment_verification_status);
  const category=normalizeRelationshipStatus(next.category_verification_status);
  if(employment==='STALE')return 'BUYER_LEFT_ACCOUNT';
  if(employment==='CONFLICTING'||category==='CONFLICTING')return 'RELATIONSHIP_CONFLICTING';
  if(category==='STALE')return 'CATEGORY_RESPONSIBILITY_CHANGED';
  if(next.title&&key(previous.title)!==key(next.title))return 'BUYER_CHANGED_ROLE';
  if(next.department&&key(previous.department)!==key(next.department)&&!/^unconfirmed$/i.test(next.department))return 'DEPARTMENT_CHANGED';
  if(next.category_scope&&key(previous.category_scope)!==key(next.category_scope)&&!/^unconfirmed$/i.test(next.category_scope))return 'CATEGORY_RESPONSIBILITY_CHANGED';
  if(category==='UNCONFIRMED'&&normalizeRelationshipStatus(previous.category_verification_status)==='VERIFIED')return 'RELATIONSHIP_NEEDS_VERIFICATION';
  return 'REVERIFIED';
}

export function relationshipDisposition(previous={},next={}){
  const change_type=detectBuyerRelationshipChange(previous,next),incomingEmployment=normalizeRelationshipStatus(next.employment_verification_status),incomingCategory=normalizeRelationshipStatus(next.category_verification_status);
  const conflict=['BUYER_CHANGED_ROLE','DEPARTMENT_CHANGED','CATEGORY_RESPONSIBILITY_CHANGED','RELATIONSHIP_CONFLICTING'].includes(change_type)&&normalizeRelationshipStatus(previous.category_verification_status)==='VERIFIED';
  const stale=change_type==='BUYER_LEFT_ACCOUNT';
  return {
    change_type,
    employment_verification_status:stale?'STALE':conflict?'CONFLICTING':incomingEmployment,
    category_verification_status:stale?'STALE':conflict?'CONFLICTING':incomingCategory,
    replacement_search_required:stale||conflict||['CATEGORY_RESPONSIBILITY_CHANGED','RELATIONSHIP_NEEDS_VERIFICATION'].includes(change_type),
    preserve_verified_scope:conflict||stale,
    review_reason:stale?'Attributable evidence indicates the buyer left the account.':conflict?'New evidence conflicts with previously verified role or category intelligence.':change_type==='RELATIONSHIP_NEEDS_VERIFICATION'?'Previously verified category ownership could not be reverified.':''
  };
}

export async function appendBuyerRelationship(sql,{buyer,account_id,observation,disposition,previous_relationship_id=null}={}){
  const payload={...observation,disposition};
  return (await sql`insert into buyer_category_relationships(buyer_id,account_id,department,category_scope,subcategory_scope,buyer_role,employment_verification_status,category_verification_status,identity_confidence,category_confidence,identity_evidence_url,category_evidence_url,observed_at,last_verified_at,change_type,previous_relationship_id,payload) values(${buyer.id},${account_id},${clean(observation.department,180)},${clean(observation.category_scope,240)},${clean(observation.subcategory_scope,240)},${clean(observation.buyer_role,40)||'UNCONFIRMED'},${disposition.employment_verification_status},${disposition.category_verification_status},${Math.min(100,Math.max(0,Number(observation.identity_confidence)||0))},${Math.min(100,Math.max(0,Number(observation.category_confidence)||0))},${clean(observation.employment_evidence_url||observation.source_url,500)},${clean(observation.category_evidence_url,500)},${observation.evidence_date||new Date().toISOString()},${observation.category_last_verified||observation.employment_last_verified||null},${disposition.change_type},${previous_relationship_id},${sql.json(payload)} returning *`)[0];
}
