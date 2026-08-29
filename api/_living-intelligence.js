import { createHash } from 'node:crypto';
import { db } from './_db.js';

const STATUSES=new Set(['VERIFIED','REVIEW_REQUIRED','CONFLICTING','UNKNOWN','STALE','REJECTED']);
const TYPES=new Set(['retailer','retailer_profile','assortment_product','product_evidence','buyer','leadership']);
const TIERS=new Set(['daily','weekly','monthly']);
const clean=v=>String(v??'').trim();
const clamp=v=>Math.max(0,Math.min(100,Number(v)||0));
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export const livingHash=value=>createHash('sha256').update(JSON.stringify(stable(value||{}))).digest('hex');
export const refreshTier=value=>TIERS.has(clean(value).toLowerCase())?clean(value).toLowerCase():'weekly';

function validPublicUrl(value){try{const u=new URL(clean(value));return ['http:','https:'].includes(u.protocol)&&Boolean(u.hostname)}catch{return false}}
export function validateCommercialObservation(input={}){
  const evidenceType=TYPES.has(clean(input.evidence_type))?clean(input.evidence_type):'product_evidence';
  const requested=STATUSES.has(clean(input.verification_status).toUpperCase())?clean(input.verification_status).toUpperCase():'UNKNOWN';
  const notes=[];if(!validPublicUrl(input.source_url))notes.push('Attributable public source URL is required');if(!clean(input.subject_key))notes.push('Subject key is required');if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))notes.push('Structured payload is required');
  const confidence=clamp(input.confidence),observedAt=new Date(input.observed_at||Date.now());if(!Number.isFinite(observedAt.getTime()))notes.push('Valid observed timestamp is required');
  let status=requested;if(notes.length)status='UNKNOWN';else if(requested==='VERIFIED'&&confidence<70){status='REVIEW_REQUIRED';notes.push('Verified evidence requires confidence of at least 70')}
  else if(!['VERIFIED','REJECTED'].includes(requested))status=requested==='CONFLICTING'?'CONFLICTING':'REVIEW_REQUIRED';
  return {valid:notes.length===0,evidence_type:evidenceType,verification_status:status,confidence,observed_at:Number.isFinite(observedAt.getTime())?observedAt.toISOString():new Date().toISOString(),last_verified_at:status==='VERIFIED'?new Date(input.last_verified_at||observedAt).toISOString():null,notes};
}

export async function runLivingIntelligencePipeline(input={},options={}){
  const sql=options.sql||db(),validation=validateCommercialObservation(input),subjectType=clean(input.subject_type||validation.evidence_type),subjectKey=clean(input.subject_key),payload=input.payload&&typeof input.payload==='object'?input.payload:{},sourceUrl=clean(input.source_url),hash=livingHash(payload);
  if(!subjectKey)throw new Error('subject_key is required');
  const source=(await sql`insert into evidence_sources(source_url,source_kind,publisher,domain,refresh_tier,last_observed_at,last_verified_at,last_status,updated_at) values(${sourceUrl||'unknown://unattributed'},${clean(input.source_type)||'public_web'},${clean(input.publisher)},${clean(input.domain)},${refreshTier(input.refresh_tier)},${validation.observed_at},${validation.last_verified_at},${validation.verification_status},now()) on conflict(source_url) do update set last_observed_at=excluded.last_observed_at,last_verified_at=coalesce(excluded.last_verified_at,evidence_sources.last_verified_at),last_status=excluded.last_status,updated_at=now() returning *`)[0];
  const evidence=(await sql`insert into commercial_evidence(source_id,account_id,organization_id,subject_type,subject_key,evidence_type,payload,content_hash,observed_at,last_verified_at,confidence,verification_status,validation_notes,acquired_by) values(${source.id},${input.account_id||null},${input.organization_id||null},${subjectType},${subjectKey},${validation.evidence_type},${sql.json(payload)},${hash},${validation.observed_at},${validation.last_verified_at},${validation.confidence},${validation.verification_status},${validation.notes.join('; ')},${clean(input.acquired_by)||'public_web'}) returning *`)[0];
  const current=(await sql`select * from current_commercial_truth where subject_type=${subjectType} and subject_key=${subjectKey} limit 1`)[0]||null;
  const changed=!current||current.content_hash!==hash;
  let event=null,proposal=null,updated=false;
  if(changed){
    event=(await sql`insert into intelligence_change_events(subject_type,subject_key,event_type,previous_evidence_id,current_evidence_id,previous_hash,current_hash,previous_payload,current_payload,source_url,observed_at,meaningful,verification_status) values(${subjectType},${subjectKey},${current?'CHANGED':'FIRST_OBSERVED'},${current?.evidence_id||null},${evidence.id},${current?.content_hash||''},${hash},${current?.payload?sql.json(current.payload):null},${sql.json(payload)},${sourceUrl},${validation.observed_at},true,${validation.verification_status}) returning *`)[0];
    if(options.agent_assessment){proposal=(await sql`insert into intelligence_proposals(manufacturer_id,account_id,change_event_id,proposal_type,proposed_payload,model,status,deterministic_update_allowed) values(${options.manufacturer_id||null},${input.account_id||null},${event.id},'L36_AGENT_ASSESSMENT',${sql.json(options.agent_assessment)},${clean(options.agent_model)},'REVIEW_REQUIRED',false) returning *`)[0]}
    if(validation.verification_status==='VERIFIED'){
      await sql`insert into current_commercial_truth(subject_type,subject_key,evidence_id,payload,content_hash,source_url,observed_at,last_verified_at,confidence,evidence_type,verification_status,changed_at) values(${subjectType},${subjectKey},${evidence.id},${sql.json(payload)},${hash},${sourceUrl},${validation.observed_at},${validation.last_verified_at},${validation.confidence},${validation.evidence_type},'VERIFIED',now()) on conflict(subject_type,subject_key) do update set evidence_id=excluded.evidence_id,payload=excluded.payload,content_hash=excluded.content_hash,source_url=excluded.source_url,observed_at=excluded.observed_at,last_verified_at=excluded.last_verified_at,confidence=excluded.confidence,evidence_type=excluded.evidence_type,verification_status='VERIFIED',changed_at=now()`;updated=true;
    }
  }
  if(!changed&&validation.verification_status==='VERIFIED'){await sql`update current_commercial_truth set evidence_id=${evidence.id},source_url=${sourceUrl},observed_at=${validation.observed_at},last_verified_at=${validation.last_verified_at},confidence=${validation.confidence},verification_status='VERIFIED' where subject_type=${subjectType} and subject_key=${subjectKey}`;updated=true}
  return {stage:'DETERMINISTIC_DATABASE_UPDATE',evidence,change_event:event,agent_proposal:proposal,changed_since_last_check:changed,deterministic_update_applied:updated,verification_status:validation.verification_status,confidence:validation.confidence,last_verified_at:validation.last_verified_at,evidence_source:sourceUrl,pipeline:['EVIDENCE_ACQUISITION','CHANGE_DETECTION','EVIDENCE_VALIDATION','L36_INTELLIGENCE_AGENT','DETERMINISTIC_DATABASE_UPDATE'],llm_truth_write_allowed:false};
}

export function operationalStatus(row={}){return {last_verified:row.last_verified_at||null,confidence:Number(row.confidence)||0,evidence_source:row.source_url||'',verification_status:row.verification_status||'UNKNOWN',changed_since_last_check:Boolean(row.changed_since_last_check??row.changed_at)} }
