const STATUSES=new Set(['VERIFIED','MODELED','USER_ENTERED','NEEDS_RESEARCH','STALE','CONFLICTING']);
const ENTITY_TYPES=new Set(['brand','product','sku','retail_organization','retailer_listing','buyer','buyer_category_relationship','opportunity','revenue_estimate','sell_in_scenario']);
const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const date=value=>{const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?new Date(parsed).toISOString():new Date().toISOString()};
const bounded=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
const globalTypes=new Set(['retail_organization','retailer_listing','buyer','buyer_category_relationship']);
export function evidencePresentation(status='NEEDS_RESEARCH'){const normalized=STATUSES.has(String(status).toUpperCase())?String(status).toUpperCase():'NEEDS_RESEARCH';return {status:normalized,label:normalized.replaceAll('_',' '),kind:normalized==='VERIFIED'?'verified':normalized==='MODELED'?'modeled':normalized==='USER_ENTERED'?'user':normalized==='STALE'?'stale':'review'}}
export function normalizeFieldObservation(input={},tenant={}){
  const entity_type=clean(input.entity_type,80).toLowerCase(),entity_id=clean(input.entity_id,180),field_name=clean(input.field_name,120),verification_status=clean(input.verification_status||'USER_ENTERED',40).toUpperCase();
  if(!ENTITY_TYPES.has(entity_type))throw Object.assign(new Error('Unsupported evidence entity type'),{status:400});
  if(!entity_id||!field_name)throw Object.assign(new Error('entity_id and field_name are required'),{status:400});
  if(!STATUSES.has(verification_status))throw Object.assign(new Error('Unsupported verification status'),{status:400});
  if(input.value===undefined)throw Object.assign(new Error('Evidence value is required'),{status:400});
  const publicScope=input.scope==='global'&&globalTypes.has(entity_type)&&tenant.source!=='session';
  return {manufacturer_id:publicScope?null:tenant.tenant_id,scope_key:publicScope?'global':String(tenant.tenant_id),entity_type,entity_id,field_name,value:input.value,source_id:input.source_id||null,source_url:clean(input.source_url,1200),source_name:clean(input.source_name,240),provider:clean(input.provider||'user',80),observed_at:date(input.observed_at),confidence:bounded(input.confidence),verification_status,evidence_type:clean(input.evidence_type,100),raw_excerpt:clean(input.raw_excerpt,1000),superseded_by:input.superseded_by||null,created_by:tenant.user_id||null,user_verified:input.user_verified===true,notes:clean(input.notes,1000)};
}
const rank=status=>({VERIFIED:6,USER_ENTERED:5,MODELED:4,NEEDS_RESEARCH:3,STALE:2,CONFLICTING:1}[status]||0);
export function shouldPromoteObservation(current,next){if(!current)return true;if(current.verification_status==='VERIFIED'&&next.verification_status!=='VERIFIED')return false;if(next.user_verified&&next.verification_status==='VERIFIED')return true;return rank(next.verification_status)>rank(current.verification_status)||(rank(next.verification_status)===rank(current.verification_status)&&next.confidence>=Number(current.confidence||0));}

export async function appendFieldObservation(sql,tenant,input){
  const item=normalizeFieldObservation(input,tenant),row=(await sql`insert into entity_field_observations(manufacturer_id,entity_type,entity_id,field_name,value,source_id,source_url,source_name,provider,observed_at,confidence,verification_status,evidence_type,raw_excerpt,superseded_by,created_by,user_verified,notes) values(${item.manufacturer_id},${item.entity_type},${item.entity_id},${item.field_name},${sql.json(item.value)},${item.source_id},${item.source_url},${item.source_name},${item.provider},${item.observed_at},${item.confidence},${item.verification_status},${item.evidence_type},${item.raw_excerpt},${item.superseded_by},${item.created_by},${item.user_verified},${item.notes}) returning *`)[0];
  const current=(await sql`select * from current_entity_field_values where scope_key=${item.scope_key} and entity_type=${item.entity_type} and entity_id=${item.entity_id} and field_name=${item.field_name} limit 1`)[0];
  const promoted=shouldPromoteObservation(current,{...item,id:row.id});
  if(promoted)await sql`insert into current_entity_field_values(scope_key,manufacturer_id,entity_type,entity_id,field_name,observation_id,value,confidence,verification_status,source_url,observed_at,updated_at) values(${item.scope_key},${item.manufacturer_id},${item.entity_type},${item.entity_id},${item.field_name},${row.id},${sql.json(item.value)},${item.confidence},${item.verification_status},${item.source_url},${item.observed_at},now()) on conflict(scope_key,entity_type,entity_id,field_name) do update set observation_id=excluded.observation_id,value=excluded.value,confidence=excluded.confidence,verification_status=excluded.verification_status,source_url=excluded.source_url,observed_at=excluded.observed_at,updated_at=now()`;
  return {observation:row,promoted_to_current:promoted,presentation:evidencePresentation(item.verification_status)};
}
