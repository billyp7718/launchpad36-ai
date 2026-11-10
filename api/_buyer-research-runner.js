import { createHash } from 'node:crypto';
import { db } from './_db.js';
import { searchOpenAIBuyers } from './_openai-research.js';
import { authoritativeCategory, authoritativeIdentity, buyerImportRecordKey, normalizeBuyerImportRecord } from './_buyer-intelligence-ingest.js';

const TERMINAL_ACCOUNT_STATES=['SUCCEEDED','NO_RESULTS','FAILED','CANCELLED'];
const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=value=>clean(value,300).toLowerCase().replace(/[^a-z0-9]+/g,'');
const list=value=>Array.isArray(value)?value:[];
const iso=value=>{const date=new Date(value||'');return Number.isFinite(date.getTime())?date.toISOString():null};
const fresh=(value,observedAt,maxAgeDays=548)=>{const evidence=new Date(value||''),observed=new Date(observedAt||'');return Number.isFinite(evidence.getTime())&&Number.isFinite(observed.getTime())&&evidence<=observed&&observed-evidence<=maxAgeDays*86400000};
const requestId=req=>clean(req?.headers?.['x-request-id']||req?.headers?.['x-vercel-id']||req?.headers?.['x-correlation-id'],160);
const sourceTypes=new Set(['official_company','official_retailer','company_press_release','press_release','trade_publication','conference','vendor_announcement','public_professional_profile','web_search','openai_web_search']);

function host(value){try{return new URL(String(value||'')).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}}
function accountDomain(value){return clean(value,180).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'')}
function inferredSourceType(person={},organization={}){
  const requested=clean(person.source_type,60).toLowerCase();
  if(sourceTypes.has(requested)&&requested!=='openai_web_search')return requested;
  const sourceHost=host(person.employment_evidence_url||person.source_url),official=accountDomain(organization.domain);
  if(sourceHost&&official&&(sourceHost===official||sourceHost.endsWith(`.${official}`)))return 'official_retailer';
  if(/(^|\.)linkedin\.com$/i.test(sourceHost))return 'public_professional_profile';
  if(/conference|summit|expo|speaker/i.test(`${person.source_label||''} ${person.category_evidence_source||''}`))return 'conference';
  if(/press release|newswire/i.test(`${person.source_label||''} ${person.category_evidence_source||''}`))return 'press_release';
  if(/trade|retail dive|chain store age|store brands|progressive grocer/i.test(person.source_label||''))return 'trade_publication';
  return 'web_search';
}

export function buyerResearchRecord(person={},organization={},observedAt=new Date().toISOString()){
  const sourceUrl=person.employment_evidence_url||person.source_url||'',verifiedAt=iso(person.employment_last_verified||person.evidence_date),categoryVerifiedAt=iso(person.category_last_verified||person.evidence_date),identityFresh=fresh(verifiedAt,observedAt),categoryFresh=fresh(categoryVerifiedAt,observedAt),identityStatus=identityFresh?person.employment_verification_status:'UNCONFIRMED',categoryStatus=identityFresh&&categoryFresh?person.category_verification_status:'UNCONFIRMED',profile=/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(person.linkedin||'')?person.linkedin:'';
  return normalizeBuyerImportRecord({
    account_name:organization.name,account_domain:organization.domain,account_type:organization.organization_type,
    account_channels:list(organization.channel_codes),account_categories:list(organization.categories),
    name:person.name,title:person.title,department:person.department,category_scope:person.category_scope,
    subcategory_scope:person.subcategory_scope,buyer_role:person.buyer_role,public_profile_url:profile,
    source_url:sourceUrl,source_type:inferredSourceType(person,organization),source_publication_date:person.evidence_date,
    observed_at:observedAt,last_verified_at:verifiedAt,identity_confidence:person.identity_confidence,
    category_confidence:categoryFresh?person.category_confidence:0,employment_verification_status:identityStatus,
    category_verification_status:categoryStatus,category_evidence_url:person.category_evidence_url,
    notes:`Research runner candidate. ${identityFresh?'Evidence date is within the 18-month freshness window.':'Evidence is missing, future-dated, or older than the 18-month freshness window.'} ${clean(person.rationale,500)}`
  });
}

function matchingBuyer(record,existing=[]){
  const profile=clean(record.public_profile_url,500).toLowerCase(),name=normalized(record.name);
  if(profile){const matched=existing.find(item=>clean(item.linkedin,500).toLowerCase()===profile);if(matched)return matched}
  return existing.find(item=>normalized(item.name)===name)||null;
}

export function classifyBuyerResearchCandidate(record={},existing=[]){
  const buyer=matchingBuyer(record,existing),identityVerified=authoritativeIdentity(record),categoryVerified=authoritativeCategory(record),role=clean(record.buyer_role,60).toUpperCase();
  if(record.employment_verification_status==='CONFLICTING'||record.category_verification_status==='CONFLICTING')return {classification:'CONFLICTING_EVIDENCE',existingBuyer:buyer};
  if(record.employment_verification_status==='STALE')return {classification:buyer&&identityVerified?'STALE_OR_DEPARTED_BUYER':'UNVERIFIED_CANDIDATE',existingBuyer:buyer};
  if(!buyer){
    const commercialOwner=['DIRECT_BUYER','CATEGORY_OWNER','MERCHANT','MERCHANDISING_LEADER'].includes(role);
    return {classification:identityVerified&&commercialOwner?'NEW_VERIFIED_BUYER':'UNVERIFIED_CANDIDATE',existingBuyer:null};
  }
  if(record.public_profile_url&&buyer.linkedin&&clean(record.public_profile_url,500).toLowerCase()===clean(buyer.linkedin,500).toLowerCase()&&normalized(record.name)!==normalized(buyer.name))return {classification:'CONFLICTING_EVIDENCE',existingBuyer:buyer};
  const changed=[];
  for(const [recordField,buyerField=recordField] of [['title'],['department'],['category_scope'],['subcategory_scope'],['buyer_role'],['public_profile_url','linkedin']]){
    if(clean(record[recordField])&&normalized(record[recordField])!==normalized(buyer[buyerField]))changed.push(recordField);
  }
  if(!changed.length)return {classification:buyer.employment_verification_status==='VERIFIED'||buyer.verification_status==='VERIFIED'?'EXISTING_VERIFIED_RECORD_UNCHANGED':'DUPLICATE',existingBuyer:buyer};
  if(!identityVerified)return {classification:'UNVERIFIED_CANDIDATE',existingBuyer:buyer};
  if(changed.some(field=>['department','category_scope','subcategory_scope','buyer_role'].includes(field))&&!categoryVerified)return {classification:'CONFLICTING_EVIDENCE',existingBuyer:buyer};
  return {classification:'EXISTING_BUYER_REQUIRING_UPDATE',existingBuyer:buyer};
}

async function appendEvent(sql,{job,manufacturerId,eventType,organizationId=null,result='SUCCESS',detail={},req=null}){
  return (await sql`insert into buyer_research_events(job_id,manufacturer_id,event_type,organization_id,result,detail,request_id) values(${job.id},${manufacturerId},${eventType},${organizationId},${result},${sql.json(detail)},${requestId(req)}) returning *`)[0];
}

export async function createBuyerResearchJob({manufacturerId,userId=null,idempotencyKey,providerCallBudget=550,maxAttempts=2,minIntervalSeconds=60,maxConcurrency=1,limit=500,req=null},{sql=db()}={}){
  const key=clean(idempotencyKey,160);if(!key)throw Object.assign(new Error('idempotency_key is required'),{statusCode:400});
  const existing=(await sql`select * from buyer_research_jobs where manufacturer_id=${manufacturerId} and idempotency_key=${key} limit 1`)[0];if(existing)return {job:existing,idempotent_replay:true};
  return sql.begin(async tx=>{
    const active=(await tx`select id,status from buyer_research_jobs where manufacturer_id=${manufacturerId} and status in('QUEUED','RUNNING','PAUSED','CANCEL_REQUESTED','PREVIEWING') limit 1 for update`)[0];
    if(active)throw Object.assign(new Error('A buyer research job is already active'),{statusCode:409,active_job_id:active.id});
    const organizations=await tx`select ro.id organization_id,min(a.id::text)::uuid account_id,ro.name,ro.domain,ro.organization_type,ro.categories,ro.channel_codes,count(distinct b.id)::int existing_buyer_count from retail_organizations ro left join accounts a on a.organization_id=ro.id left join buyers b on b.account_id=a.id where ro.active=true group by ro.id,ro.name,ro.domain,ro.organization_type,ro.categories,ro.channel_codes order by (count(distinct b.id)=0) desc,lower(ro.name) limit ${Math.min(Math.max(Number(limit)||500,1),500)}`;
    const baseline=(await tx`select (select count(*)::int from retail_organizations where active=true) retail_organizations,(select count(*)::int from accounts) accounts,(select count(*)::int from buyers) buyers`)[0];
    const job=(await tx`insert into buyer_research_jobs(manufacturer_id,idempotency_key,status,baseline_retail_organizations,baseline_accounts,baseline_buyers,requested_accounts,provider_call_budget,max_attempts,min_interval_seconds,max_concurrency,requested_by_user_id,request_id,next_run_at) values(${manufacturerId},${key},'QUEUED',${baseline.retail_organizations},${baseline.accounts},${baseline.buyers},${organizations.length},${Math.min(Math.max(Number(providerCallBudget)||550,1),1000)},${Math.min(Math.max(Number(maxAttempts)||2,1),5)},${Math.min(Math.max(Number(minIntervalSeconds)||60,15),3600)},${Math.min(Math.max(Number(maxConcurrency)||1,1),3)},${userId},${requestId(req)},now()) returning *`)[0];
    let rank=0;for(const item of organizations){rank++;await tx`insert into buyer_research_job_accounts(job_id,organization_id,account_id,account_name,account_domain,organization_type,categories,channels,existing_buyer_count,priority_rank) values(${job.id},${item.organization_id},${item.account_id},${item.name},${item.domain||''},${item.organization_type||'retailer'},${tx.json(list(item.categories))},${tx.json(list(item.channel_codes))},${item.existing_buyer_count},${rank})`}
    await appendEvent(tx,{job,manufacturerId,eventType:'JOB_CREATED',detail:{requested_accounts:organizations.length,zero_buyer_accounts:organizations.filter(item=>Number(item.existing_buyer_count)===0).length,provider_call_budget:job.provider_call_budget},req});
    return {job,inventory:{accounts:organizations.length,zero_buyer_accounts:organizations.filter(item=>Number(item.existing_buyer_count)===0).length,accounts_with_buyers:organizations.filter(item=>Number(item.existing_buyer_count)>0).length},idempotent_replay:false};
  });
}

async function refreshJobStats(sql,jobId){
  const job=(await sql`select * from buyer_research_jobs where id=${jobId} limit 1`)[0];if(!job)return null;
  const account=(await sql`select count(*) filter(where status=any(${TERMINAL_ACCOUNT_STATES}::text[]))::int completed,count(*) filter(where status='SUCCEEDED')::int succeeded,count(*) filter(where status='NO_RESULTS')::int no_results,count(*) filter(where status='FAILED')::int failed,count(*) filter(where status in('PENDING','PROCESSING','RETRY'))::int remaining from buyer_research_job_accounts where job_id=${jobId}`)[0];
  const rows=await sql`select classification,count(*)::int count from buyer_research_candidates where job_id=${jobId} group by classification`,classes=Object.fromEntries(rows.map(row=>[row.classification,Number(row.count)])),batches=(await sql`select count(*)::int count from buyer_research_preview_batches where job_id=${jobId}`)[0]?.count||0;
  let status=job.status;if(Number(account.remaining)===0&&['QUEUED','RUNNING'].includes(status))status=Object.values(classes).reduce((sum,value)=>sum+value,0)>0?'PREVIEWING':Number(account.failed)>0?'COMPLETED_WITH_ERRORS':'COMPLETED';
  return (await sql`update buyer_research_jobs set status=${status},accounts_completed=${account.completed},accounts_succeeded=${account.succeeded},accounts_no_results=${account.no_results},accounts_failed=${account.failed},candidates_found=${Object.values(classes).reduce((sum,value)=>sum+value,0)},verified_candidates=${classes.NEW_VERIFIED_BUYER||0},update_candidates=${classes.EXISTING_BUYER_REQUIRING_UPDATE||0},unchanged_candidates=${classes.EXISTING_VERIFIED_RECORD_UNCHANGED||0},unverified_candidates=${classes.UNVERIFIED_CANDIDATE||0},stale_candidates=${classes.STALE_OR_DEPARTED_BUYER||0},conflicting_candidates=${classes.CONFLICTING_EVIDENCE||0},duplicate_candidates=${classes.DUPLICATE||0},preview_batches=${batches},checkpoint_at=now(),completed_at=case when ${status}=any(array['COMPLETED','COMPLETED_WITH_ERRORS','AWAITING_APPROVAL','CANCELLED']) then coalesce(completed_at,now()) else completed_at end,updated_at=now() where id=${jobId} returning *`)[0];
}

async function claimNextAccount(sql,manufacturerId){
  return sql.begin(async tx=>{
    const job=(await tx`select * from buyer_research_jobs where manufacturer_id=${manufacturerId} and status in('QUEUED','RUNNING','CANCEL_REQUESTED') order by created_at limit 1 for update`)[0];if(!job)return {status:'NO_ACTIVE_JOB'};
    await tx`select pg_advisory_xact_lock(hashtextextended(${job.id}::text,0))`;
    await tx`update buyer_research_job_accounts set status='RETRY',error='Worker interrupted; safely requeued from checkpoint',next_attempt_at=now(),updated_at=now() where job_id=${job.id} and status='PROCESSING' and started_at<now()-interval '12 minutes'`;
    if(job.status==='CANCEL_REQUESTED'){
      await tx`update buyer_research_job_accounts set status='CANCELLED',completed_at=now(),updated_at=now() where job_id=${job.id} and status in('PENDING','RETRY')`;
      const cancelled=(await tx`update buyer_research_jobs set status='CANCELLED',cancelled_at=now(),completed_at=now(),updated_at=now() where id=${job.id} returning *`)[0];await appendEvent(tx,{job:cancelled,manufacturerId,eventType:'JOB_CANCELLED'});return {status:'CANCELLED',job:cancelled};
    }
    if(Number(job.provider_calls_used)>=Number(job.provider_call_budget)){const paused=(await tx`update buyer_research_jobs set status='PAUSED',last_error='Provider call budget reached; administrator review required',updated_at=now() where id=${job.id} returning *`)[0];await appendEvent(tx,{job:paused,manufacturerId,eventType:'BUDGET_PAUSED',result:'DENIED',detail:{provider_calls_used:job.provider_calls_used,provider_call_budget:job.provider_call_budget}});return {status:'BUDGET_PAUSED',job:paused}}
    if(job.next_run_at&&new Date(job.next_run_at)>new Date())return {status:'RATE_LIMITED',job};
    const processing=(await tx`select count(*)::int count from buyer_research_job_accounts where job_id=${job.id} and status='PROCESSING'`)[0]?.count||0;if(Number(processing)>=Number(job.max_concurrency))return {status:'CONCURRENCY_LIMITED',job};
    const account=(await tx`select * from buyer_research_job_accounts where job_id=${job.id} and status in('PENDING','RETRY') and (next_attempt_at is null or next_attempt_at<=now()) order by priority_rank limit 1 for update skip locked`)[0];
    if(!account){const refreshed=await refreshJobStats(tx,job.id);return {status:refreshed?.status==='PREVIEWING'?'RESEARCH_COMPLETE':'NO_READY_ACCOUNT',job:refreshed||job}}
    const claimed=(await tx`update buyer_research_job_accounts set status='PROCESSING',attempts=attempts+1,started_at=now(),error='',updated_at=now() where id=${account.id} returning *`)[0],running=(await tx`update buyer_research_jobs set status='RUNNING',provider_calls_used=provider_calls_used+1,started_at=coalesce(started_at,now()),next_run_at=now()+(${Number(job.min_interval_seconds)}||' seconds')::interval,updated_at=now() where id=${job.id} returning *`)[0];
    await appendEvent(tx,{job:running,manufacturerId,eventType:'ACCOUNT_RESEARCH_STARTED',organizationId:claimed.organization_id,detail:{attempt:claimed.attempts,account_name:claimed.account_name}});return {status:'CLAIMED',job:running,account:claimed};
  });
}

async function finishAccount(sql,{job,account,research,manufacturerId}){
  return sql.begin(async tx=>{
    const additionalCalls=Math.max(0,Number(research.attempts||1)-1);if(additionalCalls)await tx`update buyer_research_jobs set provider_calls_used=provider_calls_used+${additionalCalls},updated_at=now() where id=${job.id}`;
    if(research.status==='ERROR'||research.status==='NOT_CONFIGURED'){
      const retry=Number(account.attempts)<Number(job.max_attempts)&&research.status!=='NOT_CONFIGURED',status=retry?'RETRY':'FAILED',delay=Math.min(60,5*Math.max(1,Number(account.attempts)));
      await tx`update buyer_research_job_accounts set status=${status},provider_status=${research.status},error=${clean(research.error||'Buyer research failed',500)},next_attempt_at=case when ${retry} then now()+(${delay}||' minutes')::interval else null end,completed_at=case when ${retry} then null else now() end,updated_at=now() where id=${account.id}`;
      await appendEvent(tx,{job,manufacturerId,eventType:retry?'ACCOUNT_RESEARCH_RETRY':'ACCOUNT_RESEARCH_FAILED',organizationId:account.organization_id,result:retry?'RETRY':'FAILED',detail:{attempt:account.attempts,error:clean(research.error,500),provider_status:research.status}});return refreshJobStats(tx,job.id);
    }
    const existing=await tx`select b.* from buyers b join accounts a on a.id=b.account_id where a.organization_id=${account.organization_id} or lower(a.name)=lower(${account.account_name}) order by b.updated_at desc`,organization={id:account.organization_id,name:account.account_name,domain:account.account_domain,organization_type:account.organization_type,categories:list(account.categories),channel_codes:list(account.channels)},observedAt=new Date().toISOString();let inserted=0,duplicates=0;
    for(const person of research.people||[]){const record=buyerResearchRecord(person,organization,observedAt),classification=classifyBuyerResearchCandidate(record,existing),recordKey=buyerImportRecordKey(record),urls=[...new Set([record.source_url,record.category_evidence_url,record.public_profile_url].filter(Boolean))],row=await tx`insert into buyer_research_candidates(job_id,job_account_id,manufacturer_id,organization_id,account_id,existing_buyer_id,record_key,classification,proposed_record,source_urls,evidence_date,identity_confidence,category_confidence,identity_verification_status,category_verification_status) values(${job.id},${account.id},${manufacturerId},${account.organization_id},${account.account_id},${classification.existingBuyer?.id||null},${recordKey},${classification.classification},${tx.json(record)},${tx.json(urls)},${record.last_verified_at},${record.identity_confidence},${record.category_confidence},${record.employment_verification_status},${record.category_verification_status}) on conflict(job_id,organization_id,record_key) do nothing returning id`;
      if(row.length)inserted++;else duplicates++}
    const status=inserted?'SUCCEEDED':'NO_RESULTS';await tx`update buyer_research_job_accounts set status=${status},provider_status=${research.status},candidates_found=${inserted},error='',completed_at=now(),updated_at=now() where id=${account.id}`;
    await appendEvent(tx,{job,manufacturerId,eventType:'ACCOUNT_RESEARCH_COMPLETED',organizationId:account.organization_id,detail:{account_name:account.account_name,candidates:inserted,duplicates,provider_status:research.status,sources:(research.sources||[]).length}});return refreshJobStats(tx,job.id);
  });
}

export async function processNextBuyerResearchAccount({manufacturerId},{sql=db(),researcher=searchOpenAIBuyers}={}){
  const claim=await claimNextAccount(sql,manufacturerId);if(claim.status!=='CLAIMED')return claim;
  const category=list(claim.account.categories).join(' | '),research=await researcher({account:claim.account.account_name,domain:claim.account.account_domain,category,allCategories:true});
  const job=await finishAccount(sql,{...claim,research,manufacturerId});return {status:'ACCOUNT_PROCESSED',job,account_id:claim.account.id,organization_id:claim.account.organization_id,provider_status:research.status,candidates:(research.people||[]).length};
}

function safeOrigin(req){
  const deploymentHost=clean(process.env.VERCEL_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL,240).replace(/^https?:\/\//,'').replace(/\/$/,'');
  if(/^[a-z0-9.-]+(?::\d+)?$/i.test(deploymentHost))return `https://${deploymentHost}`;
  const hostName=clean(req.headers.host,240).toLowerCase(),local=/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(hostName),launchpad=/^(?:www\.)?launchpad36\.(?:app|com)$/.test(hostName),vercel=/^[a-z0-9-]+\.vercel\.app$/.test(hostName);
  if(!local&&!launchpad&&!vercel)return '';
  return `${local?'http':'https'}://${hostName}`;
}

export async function createNextBuyerResearchPreview({manufacturerId,jobId=null,req},{sql=db(),fetcher=fetch}={}){
  const job=jobId?(await sql`select * from buyer_research_jobs where id=${jobId} and manufacturer_id=${manufacturerId} limit 1`)[0]:(await sql`select * from buyer_research_jobs where manufacturer_id=${manufacturerId} and status='PREVIEWING' order by created_at limit 1`)[0];
  if(!job)return {status:'NO_PREVIEW_JOB'};if(!['PREVIEWING','AWAITING_APPROVAL'].includes(job.status))return {status:'NOT_READY',job};
  const candidates=await sql`select c.* from buyer_research_candidates c where c.job_id=${job.id} and not exists(select 1 from buyer_research_preview_items pi where pi.candidate_id=c.id) order by c.created_at,c.id limit 250`;
  if(!candidates.length){const completed=(await sql`update buyer_research_jobs set status='AWAITING_APPROVAL',completed_at=coalesce(completed_at,now()),updated_at=now() where id=${job.id} returning *`)[0];await appendEvent(sql,{job:completed,manufacturerId,eventType:'PREVIEW_PREPARATION_COMPLETED',detail:{preview_batches:completed.preview_batches}});return {status:'AWAITING_APPROVAL',job:completed}}
  const batchNumber=Number((await sql`select coalesce(max(batch_number),0)::int value from buyer_research_preview_batches where job_id=${job.id}`)[0]?.value||0)+1,idempotencyKey=`buyer-research-${job.id}-preview-${batchNumber}`,origin=safeOrigin(req),secret=process.env.BUYER_INTELLIGENCE_SERVICE_SECRET||'';
  if(!origin||!secret)throw Object.assign(new Error('Scoped Buyer Intelligence service authentication is unavailable'),{statusCode:503});
  const response=await fetcher(`${origin}/api/buyer-intelligence-import`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','x-request-id':requestId(req)||`buyer-research-${job.id}`},body:JSON.stringify({dry_run:true,idempotency_key:idempotencyKey,source_type:'public_research',source_name:`V9.8.4 buyer research · ${job.id} · batch ${batchNumber}`,records:candidates.map(item=>item.proposed_record)})}),body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(clean(body.error||`Import preview returned ${response.status}`,500)),{statusCode:response.status});
  const batch=await sql.begin(async tx=>{let stored=(await tx`insert into buyer_research_preview_batches(job_id,manufacturer_id,batch_number,import_run_id,idempotency_key,record_count) values(${job.id},${manufacturerId},${batchNumber},${body.run.id},${idempotencyKey},${candidates.length}) on conflict do nothing returning *`)[0];if(!stored)stored=(await tx`select * from buyer_research_preview_batches where job_id=${job.id} and batch_number=${batchNumber} limit 1`)[0];for(const candidate of candidates)await tx`insert into buyer_research_preview_items(batch_id,candidate_id) values(${stored.id},${candidate.id}) on conflict do nothing`;await appendEvent(tx,{job,manufacturerId,eventType:'PREVIEW_BATCH_CREATED',detail:{batch_number:batchNumber,records:candidates.length,import_run_id:body.run.id},req});return stored});
  const refreshed=await refreshJobStats(sql,job.id);return {status:'PREVIEW_BATCH_CREATED',job:refreshed,batch,counts:body.counts};
}

export async function buyerResearchDashboard(manufacturerId,{sql=db(),jobId=null}={}){
  const job=jobId?(await sql`select * from buyer_research_jobs where id=${jobId} and manufacturer_id=${manufacturerId} limit 1`)[0]:(await sql`select * from buyer_research_jobs where manufacturer_id=${manufacturerId} order by created_at desc limit 1`)[0];
  const coverage=(await sql`select count(*)::int total_accounts,count(*) filter(where exists(select 1 from accounts a join buyers b on b.account_id=a.id where a.organization_id=ro.id and b.status<>'Stale'))::int accounts_with_buyers,count(*) filter(where exists(select 1 from accounts a join buyers b on b.account_id=a.id where a.organization_id=ro.id and b.status<>'Stale' and b.employment_verification_status='VERIFIED' and b.category_verification_status='VERIFIED'))::int verified_buyer_coverage,(select count(*)::int from accounts) current_account_rows,(select count(*)::int from buyers) current_buyer_rows from retail_organizations ro where ro.active=true`)[0];
  if(!job)return {job:null,coverage,accounts:[],preview_batches:[],failures:[],events:[]};
  const [accounts,batches,failures,events]=await Promise.all([sql`select * from buyer_research_job_accounts where job_id=${job.id} order by priority_rank limit 500`,sql`select pb.*,ir.status import_status,ir.records_added,ir.records_updated,ir.records_flagged,ir.duplicates_prevented,ir.records_rejected from buyer_research_preview_batches pb join buyer_intelligence_import_runs ir on ir.id=pb.import_run_id where pb.job_id=${job.id} order by pb.batch_number`,sql`select * from buyer_research_job_accounts where job_id=${job.id} and status in('FAILED','RETRY') order by priority_rank limit 100`,sql`select * from buyer_research_events where job_id=${job.id} order by created_at desc limit 100`]);
  return {job,coverage:{...coverage,production_totals_unchanged:Number(job.baseline_accounts)===Number(coverage.current_account_rows)&&Number(job.baseline_buyers)===Number(coverage.current_buyer_rows)},accounts,preview_batches:batches,failures,events};
}

export async function changeBuyerResearchJob({manufacturerId,jobId,action,req},{sql=db()}={}){
  const job=(await sql`select * from buyer_research_jobs where id=${jobId} and manufacturer_id=${manufacturerId} limit 1`)[0];if(!job)throw Object.assign(new Error('Buyer research job was not found'),{statusCode:404});
  const next=action==='pause'?'PAUSED':action==='resume'?'RUNNING':action==='cancel'?'CANCEL_REQUESTED':null;if(!next)throw Object.assign(new Error('Unsupported buyer research action'),{statusCode:400});
  if(action==='resume')await sql`update buyer_research_job_accounts set status='RETRY',next_attempt_at=now(),updated_at=now() where job_id=${job.id} and status='FAILED' and attempts<${job.max_attempts}`;
  const updated=(await sql`update buyer_research_jobs set status=${next},next_run_at=case when ${action}='resume' then now() else next_run_at end,last_error='',updated_at=now() where id=${job.id} returning *`)[0];await appendEvent(sql,{job:updated,manufacturerId,eventType:`JOB_${action.toUpperCase()}`,req});return updated;
}

export function researchJobIdempotency(seed=''){return createHash('sha256').update(clean(seed,300)).digest('hex')}
