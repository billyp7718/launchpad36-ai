import crypto from 'node:crypto';
import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, canonicalRole, hasCapability } from './_permissions.js';
import { appendPermissionAudit } from './_permission-audit.js';
import { appendBuyerRelationship, relationshipDisposition } from './_buyer-relationships.js';
import { runLivingIntelligencePipeline } from './_living-intelligence.js';
import { authoritativeCategory, authoritativeIdentity, buyerImportPayloadHash, buyerImportRecordKey, importCounts, normalizeBuyerImportRecord, planBuyerImport } from './_buyer-intelligence-ingest.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const safeEqual=(a,b)=>{const left=Buffer.from(String(a||'')),right=Buffer.from(String(b||''));return left.length===right.length&&crypto.timingSafeEqual(left,right)};
const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
const requestId=req=>clean(req.headers['x-request-id']||req.headers['x-vercel-id']||req.headers['x-correlation-id'],160);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ingestionActor(req,res){
  const serviceSecret=process.env.BUYER_INTELLIGENCE_SERVICE_SECRET||'',serviceTenant=process.env.BUYER_INTELLIGENCE_SERVICE_TENANT_ID||'';
  if(serviceSecret&&safeEqual(bearer(req),serviceSecret)){
    if(!UUID.test(serviceTenant))return res.status(503).json({error:'Buyer intelligence service tenant is not configured'}),null;
    const exists=(await db()`select id from manufacturers where id=${serviceTenant} limit 1`)[0];
    if(!exists)return res.status(503).json({error:'Buyer intelligence service tenant is unavailable'}),null;
    return {tenant_id:serviceTenant,user_id:null,role:'ADMIN',team_ids:[],source:'buyer_intelligence_service'};
  }
  const tenant=await resolveTenant(req,res,{allowAdminBearer:false,enforceWriteCapability:false});if(!tenant)return null;
  if(!hasCapability(tenant,CAPABILITIES.BUYER_INTELLIGENCE_ADMIN))return res.status(403).json({error:'Buyer intelligence administration permission is required',code:'FORBIDDEN',required_capability:CAPABILITIES.BUYER_INTELLIGENCE_ADMIN}),null;
  return tenant;
}

async function rateLimit(sql,tenant){
  const actorKey=tenant.source==='buyer_intelligence_service'?'service':`user:${tenant.user_id||'admin'}`,limit=tenant.source==='buyer_intelligence_service'?Math.min(Math.max(Number(process.env.BUYER_INTELLIGENCE_SERVICE_RATE_LIMIT)||10,1),100):30;
  const row=(await sql`insert into buyer_intelligence_rate_limits(manufacturer_id,actor_key,window_started_at,request_count) values(${tenant.tenant_id},${actorKey},date_trunc('minute',now()),1) on conflict(manufacturer_id,actor_key,window_started_at) do update set request_count=buyer_intelligence_rate_limits.request_count+1,updated_at=now() returning request_count`)[0];
  return {allowed:Number(row?.request_count||0)<=limit,limit};
}

async function contextFor(sql,record){
  const organization=(await sql`select ro.* from retail_organizations ro where ro.active=true and ((${record.account_domain}<>'' and lower(regexp_replace(ro.domain,'^www\\.',''))=lower(${record.account_domain})) or lower(ro.name)=lower(${record.account_name})) order by case when ${record.account_domain}<>'' and lower(regexp_replace(ro.domain,'^www\\.',''))=lower(${record.account_domain}) then 0 else 1 end,ro.updated_at desc limit 1`)[0]||null;
  const account=organization?(await sql`select * from accounts where organization_id=${organization.id} or lower(name)=lower(${organization.name}) order by (organization_id=${organization.id}) desc,updated_at desc limit 1`)[0]||null:(await sql`select * from accounts where lower(name)=lower(${record.account_name}) or (${record.account_domain}<>'' and lower(regexp_replace(domain,'^www\\.',''))=lower(${record.account_domain})) order by updated_at desc limit 1`)[0]||null;
  const buyer=account?(await sql`select * from buyers where account_id=${account.id} and ((${record.public_profile_url}<>'' and lower(linkedin)=lower(${record.public_profile_url})) or lower(name)=lower(${record.name})) order by case when ${record.public_profile_url}<>'' and lower(linkedin)=lower(${record.public_profile_url}) then 0 else 1 end,updated_at desc limit 1`)[0]||null:null;
  const priorProfileBuyer=record.public_profile_url?(await sql`select b.*,a.name account_name,a.organization_id from buyers b join accounts a on a.id=b.account_id where lower(b.linkedin)=lower(${record.public_profile_url}) and (${account?.id||null}::uuid is null or b.account_id<>${account?.id||null}) order by case when b.status='Current' then 0 else 1 end,b.updated_at desc limit 1`)[0]||null:null;
  return {organization,account,buyer,priorProfileBuyer};
}

function buyerSnapshot(buyer){if(!buyer)return {};return {id:buyer.id,name:buyer.name,title:buyer.title,department:buyer.department,category_scope:buyer.category_scope,subcategory_scope:buyer.subcategory_scope,buyer_role:buyer.buyer_role,email:buyer.email,phone:buyer.phone,linkedin:buyer.linkedin,employment_verification_status:buyer.employment_verification_status,category_verification_status:buyer.category_verification_status,identity_confidence:buyer.identity_confidence,category_confidence:buyer.category_confidence,last_verified_at:buyer.last_verified_at,updated_at:buyer.updated_at}}

async function planRecords(sql,records){
  const planned=[],seen=new Set();
  for(let index=0;index<records.length;index++){
    const record=normalizeBuyerImportRecord(records[index]),dedupeKey=buyerImportRecordKey(record),duplicate=seen.has(dedupeKey);seen.add(dedupeKey);
    const context=await contextFor(sql,record),plan=duplicate?{action:'DUPLICATE_PREVENTED',result:'NO_CHANGE',reasons:['Duplicate record within this import batch']}:planBuyerImport(context.buyer,record);
    planned.push({record_key:duplicate?`${dedupeKey}:duplicate:${index}`:dedupeKey,action:plan.action,result:plan.result,reasons:plan.reasons,record,organization_id:context.organization?.id||null,account_id:context.account?.id||null,buyer_id:context.buyer?.id||null,previous_value:buyerSnapshot(context.buyer)});
  }
  return planned;
}

async function createAccount(sql,record){
  const organization=(await sql`insert into retail_organizations(name,domain,organization_type,channel_codes,categories,coverage,region,verification_status,source_url,last_verified,confidence,updated_at) values(${record.account_name},${record.account_domain},${record.account_type||'retailer'},${record.account_channels},${record.account_categories},'', '', 'VERIFIED',${record.source_url},${record.last_verified_at},${record.identity_confidence},now()) on conflict(lower(name)) do update set domain=case when retail_organizations.domain='' then excluded.domain else retail_organizations.domain end,source_url=case when retail_organizations.source_url='' then excluded.source_url else retail_organizations.source_url end,last_verified=greatest(retail_organizations.last_verified,excluded.last_verified),confidence=greatest(retail_organizations.confidence,excluded.confidence),updated_at=now() returning *`)[0];
  const account=(await sql`insert into accounts(name,type,coverage,region,domain,category,source,source_url,organization_id,observed_at,last_verified_at,confidence,evidence_type,verification_status,updated_at) values(${record.account_name},${record.account_type},'', '',${record.account_domain},${record.account_categories[0]||record.category_scope||''},'buyer_intelligence_import',${record.source_url},${organization.id},${record.observed_at},${record.last_verified_at},${record.identity_confidence},'buyer','VERIFIED',now()) on conflict(lower(name)) do update set organization_id=coalesce(accounts.organization_id,excluded.organization_id),domain=case when accounts.domain='' then excluded.domain else accounts.domain end,updated_at=now() returning *`)[0];
  return {organization,account};
}

async function insertBuyer(sql,account,record){
  return (await sql`insert into buyers(account_id,name,title,email,phone,linkedin,category,department,category_scope,subcategory_scope,buyer_role,source,source_url,confidence,identity_confidence,category_confidence,category_evidence_url,category_evidence_source,category_last_verified,category_verification_status,employment_verification_status,employment_evidence_url,employment_last_verified,verified_at,status,notes,observed_at,last_verified_at,evidence_type,verification_status,updated_at) values(${account.id},${record.name},${record.title},${record.public_email},${record.public_phone},${record.public_profile_url},${authoritativeCategory(record)?record.category_scope:''},${authoritativeCategory(record)?record.department:''},${authoritativeCategory(record)?record.category_scope:''},${authoritativeCategory(record)?record.subcategory_scope:''},${authoritativeCategory(record)?record.buyer_role:'UNCONFIRMED'},'buyer_intelligence_import',${record.source_url},${record.identity_confidence},${record.identity_confidence},${authoritativeCategory(record)?record.category_confidence:0},${authoritativeCategory(record)?record.category_evidence_url:''},${authoritativeCategory(record)?record.source_type:''},${authoritativeCategory(record)?record.last_verified_at:null},${authoritativeCategory(record)?'VERIFIED':'UNCONFIRMED'},${record.employment_verification_status},${record.source_url},${record.last_verified_at},${record.last_verified_at},${record.employment_verification_status==='STALE'?'Stale':'Current'},${record.notes},${record.observed_at},${record.last_verified_at},'buyer','VERIFIED',now()) on conflict(account_id,lower(name),lower(title)) do update set updated_at=now() returning *`)[0];
}

async function updateBuyer(sql,buyer,record,action){
  const categoryVerified=authoritativeCategory(record),stale=action==='MARK_STALE';
  return (await sql`update buyers set title=case when ${stale} then title else ${record.title} end,email=case when ${record.contact_published} then ${record.public_email} else email end,phone=case when ${record.contact_published} then ${record.public_phone} else phone end,linkedin=case when ${record.public_profile_url}<>'' then ${record.public_profile_url} else linkedin end,department=case when ${categoryVerified} then ${record.department} else department end,category=case when ${categoryVerified} then ${record.category_scope} else category end,category_scope=case when ${categoryVerified} then ${record.category_scope} else category_scope end,subcategory_scope=case when ${categoryVerified} then ${record.subcategory_scope} else subcategory_scope end,buyer_role=case when ${categoryVerified} then ${record.buyer_role} else buyer_role end,identity_confidence=${record.identity_confidence},category_confidence=case when ${categoryVerified} then ${record.category_confidence} else category_confidence end,category_evidence_url=case when ${categoryVerified} then ${record.category_evidence_url} else category_evidence_url end,category_evidence_source=case when ${categoryVerified} then ${record.source_type} else category_evidence_source end,category_last_verified=case when ${categoryVerified} then ${record.last_verified_at} else category_last_verified end,category_verification_status=case when ${stale} then 'STALE' when ${categoryVerified} then 'VERIFIED' else category_verification_status end,employment_verification_status=case when ${stale} then 'STALE' else 'VERIFIED' end,employment_evidence_url=${record.source_url},employment_last_verified=${record.last_verified_at},replacement_search_required=${stale},relationship_review_reason=case when ${stale} then 'Authoritative public evidence indicates this buyer left or changed employer.' else '' end,status=case when ${stale} then 'Stale' else 'Current' end,source='buyer_intelligence_import',source_url=${record.source_url},observed_at=${record.observed_at},last_verified_at=${record.last_verified_at},verification_status='VERIFIED',notes=case when ${record.notes}<>'' then ${record.notes} else notes end,updated_at=now() where id=${buyer.id} returning *`)[0];
}

async function applyItem(sql,tenant,run,item){
  const record=item.proposed_value||item.record,ready=item.result==='READY';let context=await contextFor(sql,record),buyer=context.buyer,action=item.action,result=item.result,reason=(item.reasons||[]).join('; ');const priorProfileBuyer=context.priorProfileBuyer;
  if(ready){
    if(!context.account){if(!authoritativeIdentity(record))throw new Error('A new account requires authoritative buyer identity evidence');context=await createAccount(sql,record)}
    await runLivingIntelligencePipeline({account_id:context.account.id,organization_id:context.organization?.id||context.account.organization_id,source_url:record.source_url,source_type:record.source_type,publisher:record.account_name,domain:record.account_domain,subject_type:'buyer',subject_key:`${context.account.id}:${record.public_profile_url||record.name}`,evidence_type:'buyer',payload:record,observed_at:record.observed_at,last_verified_at:record.last_verified_at,confidence:record.identity_confidence,verification_status:'VERIFIED',acquired_by:'buyer_intelligence_import'},{sql,manufacturer_id:tenant.tenant_id});
    if(action==='ADD_BUYER'){buyer=await insertBuyer(sql,context.account,record)}else buyer=await updateBuyer(sql,buyer,record,action);
    const observation={...record,name:record.name,title:record.title,category_verification_status:authoritativeCategory(record)?'VERIFIED':record.category_verification_status,employment_verification_status:action==='MARK_STALE'?'STALE':'VERIFIED',employment_evidence_url:record.source_url,evidence_date:record.observed_at,category_last_verified:record.last_verified_at};
    const previous=(await sql`select id from buyer_category_relationships where buyer_id=${buyer.id} order by observed_at desc limit 1`)[0]||null;
    await appendBuyerRelationship(sql,{buyer,account_id:context.account.id,observation,disposition:relationshipDisposition(item.previous_value||{},observation),previous_relationship_id:previous?.id||null});
    if(action==='ADD_BUYER'&&priorProfileBuyer&&priorProfileBuyer.account_id!==context.account.id&&authoritativeIdentity(record)&&record.employment_verification_status==='VERIFIED'){
      const priorSnapshot=buyerSnapshot(priorProfileBuyer),staleRecord={...record,name:priorProfileBuyer.name,title:priorProfileBuyer.title,department:priorProfileBuyer.department||'',category_scope:priorProfileBuyer.category_scope||priorProfileBuyer.category||'',subcategory_scope:priorProfileBuyer.subcategory_scope||'',buyer_role:priorProfileBuyer.buyer_role||'UNCONFIRMED',category_verification_status:'STALE'};
      const staleBuyer=await updateBuyer(sql,priorProfileBuyer,staleRecord,'MARK_STALE'),priorRelationship=(await sql`select id from buyer_category_relationships where buyer_id=${priorProfileBuyer.id} order by observed_at desc limit 1`)[0]||null,staleObservation={...staleRecord,employment_verification_status:'STALE',category_verification_status:'STALE',employment_evidence_url:record.source_url,evidence_date:record.observed_at,category_last_verified:priorProfileBuyer.category_last_verified};
      await appendBuyerRelationship(sql,{buyer:staleBuyer,account_id:priorProfileBuyer.account_id,observation:staleObservation,disposition:'STALE',previous_relationship_id:priorRelationship?.id||null});
      await sql`insert into buyer_intelligence_audit_events(manufacturer_id,run_id,import_item_id,organization_id,account_id,buyer_id,action_type,result,previous_value,new_value,reason,source_url,observed_at) values(${tenant.tenant_id},${run.id},${item.id||null},${priorProfileBuyer.organization_id||null},${priorProfileBuyer.account_id},${priorProfileBuyer.id},'EMPLOYER_CHANGED','SUCCESS',${sql.json(priorSnapshot)},${sql.json(buyerSnapshot(staleBuyer))},${`Authoritative evidence places this person at ${record.account_name}; the earlier employment relationship was preserved and marked stale.`},${record.source_url},${record.observed_at||null})`;
    }
    result='SUCCESS';
  }
  const audit=(await sql`insert into buyer_intelligence_audit_events(manufacturer_id,run_id,import_item_id,organization_id,account_id,buyer_id,action_type,result,previous_value,new_value,reason,source_url,observed_at) values(${tenant.tenant_id},${run.id},${item.id||null},${context.organization?.id||context.account?.organization_id||null},${context.account?.id||null},${buyer?.id||item.buyer_id||null},${action},${result},${sql.json(item.previous_value||{})},${sql.json(record)},${reason},${record.source_url||''},${record.observed_at||null}) returning *`)[0];
  return {action,result,buyer_id:buyer?.id||null,audit_id:audit.id};
}

function runResult(run,items=[]){return {run,items,counts:importCounts(items),preview_required:run.mode==='PREVIEW'}}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const tenant=await ingestionActor(req,res);if(!tenant)return;const sql=db(),attempt={idempotency_key:'',mode:'PREVIEW',source_type:'public_research',source_name:'',payload_hash:''};res.setHeader('Cache-Control','no-store, max-age=0');
  try{
    if(req.method==='GET'){
      const limit=Math.min(Math.max(Number(req.query?.limit)||50,1),250),runId=clean(req.query?.run_id,80);
      if(runId){const run=(await sql`select * from buyer_intelligence_import_runs where id=${runId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!run)return res.status(404).json({error:'Buyer intelligence import was not found'});const items=await sql`select * from buyer_intelligence_import_items where run_id=${run.id} order by id`;return res.status(200).json(runResult(run,items))}
      const [history,summary,missing,lastReport]=await Promise.all([
        sql`select * from buyer_intelligence_import_runs where manufacturer_id=${tenant.tenant_id} order by created_at desc limit ${limit}`,
        sql`select count(*) filter(where action_type='ADD_BUYER' and result='SUCCESS')::int newly_verified,count(*) filter(where action_type in('UPDATE_BUYER','MARK_STALE') and result='SUCCESS')::int updated,count(*) filter(where result='FLAGGED')::int flagged,count(*) filter(where action_type='DUPLICATE_PREVENTED')::int duplicates_prevented,count(*) filter(where result='REJECTED')::int rejected from buyer_intelligence_audit_events where manufacturer_id=${tenant.tenant_id} and created_at>=now()-interval '7 days'`,
        sql`select count(*)::int missing_category_buyers from retail_organizations ro where ro.active=true and not exists(select 1 from accounts a join buyers b on b.account_id=a.id where a.organization_id=ro.id and b.category_verification_status='VERIFIED' and b.status<>'Stale')`,
        sql`select * from buyer_intelligence_report_deliveries where manufacturer_id=${tenant.tenant_id} order by created_at desc limit 1`
      ]);
      return res.status(200).json({history,summary:summary[0]||{},missing_category_buyers:missing[0]?.missing_category_buyers||0,last_successful_sync:history.find(row=>row.mode==='COMMIT'&&row.status==='COMPLETED')?.completed_at||null,last_report:lastReport[0]||null});
    }
    const limiter=await rateLimit(sql,tenant);if(!limiter.allowed)return res.status(429).json({error:'Buyer intelligence import rate limit exceeded',retry_after_seconds:60});
    const previewRunId=clean(req.body?.preview_run_id,80),dryRun=req.body?.dry_run!==false,mode=dryRun?'PREVIEW':'COMMIT',idempotencyKey=clean(req.body?.idempotency_key,160);
    Object.assign(attempt,{idempotency_key:idempotencyKey,mode,source_type:clean(req.body?.source_type||'public_research',60),source_name:clean(req.body?.source_name,180)});
    if(!idempotencyKey)return res.status(400).json({error:'idempotency_key is required'});
    let records=Array.isArray(req.body?.records)?req.body.records:[];
    if(records.length>250)return res.status(413).json({error:'A maximum of 250 buyer records is allowed per import'});
    if(mode==='COMMIT'&&records.length>1&&!previewRunId)return res.status(409).json({error:'Bulk buyer imports require a preview_run_id from a successful dry run'});
    let preview=null,planned=[];
    if(previewRunId){
      preview=(await sql`select * from buyer_intelligence_import_runs where id=${previewRunId} and manufacturer_id=${tenant.tenant_id} and mode='PREVIEW' and status='PREVIEW_READY' limit 1`)[0];if(!preview)return res.status(404).json({error:'The requested buyer intelligence preview was not found'});
      if(mode==='COMMIT'){
        const runnerTable=(await sql`select to_regclass('public.buyer_research_preview_batches') name`)[0]?.name;
        const runnerBatch=runnerTable?(await sql`select id from buyer_research_preview_batches where manufacturer_id=${tenant.tenant_id} and import_run_id=${preview.id} limit 1`)[0]:null;
        if(runnerBatch&&canonicalRole(tenant.role)!=='ADMIN'){
          await appendPermissionAudit({sql,req,tenant,action_type:'BUYER_RESEARCH_PREVIEW_COMMIT',result:'DENIED',reason:'Large-scale buyer research previews require Administrator approval',new_value:{preview_run_id:preview.id}}).catch(()=>{});
          return res.status(403).json({error:'Administrator approval is required to commit a buyer research preview',code:'FORBIDDEN'});
        }
      }
      const rows=await sql`select * from buyer_intelligence_import_items where run_id=${preview.id} order by id`;planned=rows.map(row=>({...row,record:row.proposed_value}));records=planned.map(item=>item.record);
    }
    if(!records.length)return res.status(400).json({error:'At least one buyer record is required'});
    const normalized=records.map(normalizeBuyerImportRecord),payloadHash=buyerImportPayloadHash(normalized),existingRun=(await sql`select * from buyer_intelligence_import_runs where manufacturer_id=${tenant.tenant_id} and idempotency_key=${idempotencyKey} and mode=${mode} limit 1`)[0];attempt.payload_hash=payloadHash;
    if(existingRun){const items=await sql`select * from buyer_intelligence_import_items where run_id=${existingRun.id} order by id`;return res.status(200).json({...runResult(existingRun,items),idempotent_replay:true})}
    const output=await sql.begin(async tx=>{
      if(!planned.length)planned=await planRecords(tx,normalized);
      const counts=importCounts(planned),run=(await tx`insert into buyer_intelligence_import_runs(manufacturer_id,idempotency_key,mode,source_type,source_name,status,payload_hash,records_seen,records_added,records_updated,records_flagged,duplicates_prevented,records_rejected,requested_by_user_id,request_id,preview_run_id) values(${tenant.tenant_id},${idempotencyKey},${mode},${clean(req.body?.source_type||'public_research',60)},${clean(req.body?.source_name,180)},'PROCESSING',${payloadHash},${counts.records_seen},${counts.records_added},${counts.records_updated},${counts.records_flagged},${counts.duplicates_prevented},${counts.records_rejected},${tenant.user_id||null},${requestId(req)},${preview?.id||null}) returning *`)[0],items=[];
      for(const item of planned){const stored=(await tx`insert into buyer_intelligence_import_items(run_id,organization_id,account_id,buyer_id,record_key,action,result,previous_value,proposed_value,reasons,source_url,observed_at) values(${run.id},${item.organization_id||null},${item.account_id||null},${item.buyer_id||null},${item.record_key},${item.action},${item.result},${tx.json(item.previous_value||{})},${tx.json(item.record||item.proposed_value||{})},${tx.json(item.reasons||[])},${item.record?.source_url||item.proposed_value?.source_url||''},${item.record?.observed_at||item.proposed_value?.observed_at||null}) returning *`)[0];items.push(stored)}
      const applied=[];if(mode==='COMMIT')for(const item of items)applied.push(await applyItem(tx,tenant,run,item));
      const status=mode==='PREVIEW'?'PREVIEW_READY':'COMPLETED',completed=(await tx`update buyer_intelligence_import_runs set status=${status},completed_at=now() where id=${run.id} returning *`)[0];return {...runResult(completed,items),applied};
    });
    return res.status(mode==='PREVIEW'?201:200).json(output);
  }catch(error){
    console.error('buyer intelligence import failed',{message:error?.message||String(error)});
    if(attempt.idempotency_key)try{const failure={code:clean(error?.code||'IMPORT_FAILED',40),message:'Buyer intelligence import transaction failed; no commercial changes were committed'};await sql`insert into buyer_intelligence_import_runs(manufacturer_id,idempotency_key,mode,source_type,source_name,status,payload_hash,errors,requested_by_user_id,request_id,completed_at) values(${tenant.tenant_id},${attempt.idempotency_key},${attempt.mode},${attempt.source_type},${attempt.source_name},'FAILED',${attempt.payload_hash||'unavailable'},${sql.json([failure])},${tenant.user_id||null},${requestId(req)},now()) on conflict(manufacturer_id,idempotency_key,mode) do update set status=case when buyer_intelligence_import_runs.status in('COMPLETED','PREVIEW_READY') then buyer_intelligence_import_runs.status else 'FAILED' end,errors=case when buyer_intelligence_import_runs.status in('COMPLETED','PREVIEW_READY') then buyer_intelligence_import_runs.errors else excluded.errors end,completed_at=coalesce(buyer_intelligence_import_runs.completed_at,now())`}catch(auditError){console.error('buyer intelligence import failure ledger unavailable',{message:auditError?.message||String(auditError)})}
    return res.status(500).json({error:'Buyer intelligence import could not be completed; no partial commercial changes were committed'});
  }
}
