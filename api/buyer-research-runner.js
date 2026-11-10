import { db } from './_db.js';
import { appendPermissionAudit } from './_permission-audit.js';
import { CAPABILITIES, hasCapability } from './_permissions.js';
import { resolveTenant } from './_tenant.js';
import {
  buyerResearchDashboard,
  changeBuyerResearchJob,
  createBuyerResearchJob,
  createNextBuyerResearchPreview,
  processNextBuyerResearchAccount,
  researchJobIdempotency
} from './_buyer-research-runner.js';

const clean=(value,max=200)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function actorFor(tenant,sql){
  if(!tenant.user_id)return {};
  return (await sql`select id,email,display_name,role from manufacturer_members where id=${tenant.user_id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0]||{};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const tenant=await resolveTenant(req,res,{allowAdminBearer:true,enforceWriteCapability:false});if(!tenant)return;
  const sql=db(),actor=await actorFor(tenant,sql),allowed=hasCapability(tenant,CAPABILITIES.BUYER_INTELLIGENCE_ADMIN);
  if(!allowed){
    await appendPermissionAudit({sql,req,tenant,actor,action_type:'BUYER_RESEARCH_RUNNER_ACCESS',result:'DENIED',reason:'Buyer intelligence administration permission is required',new_value:{method:req.method,action:clean(req.body?.action||'view',40)}}).catch(()=>{});
    return res.status(403).json({error:'Buyer intelligence administration permission is required',code:'FORBIDDEN',required_capability:CAPABILITIES.BUYER_INTELLIGENCE_ADMIN});
  }
  try{
    if(req.method==='GET'){
      const jobId=clean(req.query?.job_id,80);if(jobId&&!UUID.test(jobId))return res.status(400).json({error:'job_id must be a valid UUID'});
      return res.status(200).json(await buyerResearchDashboard(tenant.tenant_id,{sql,jobId:jobId||null}));
    }
    const action=clean(req.body?.action,40).toLowerCase();
    let result;
    if(action==='start'){
      const idempotencyKey=clean(req.body?.idempotency_key,160)||researchJobIdempotency(`${tenant.tenant_id}|${new Date().toISOString().slice(0,10)}|${req.headers['x-request-id']||Date.now()}`);
      result=await createBuyerResearchJob({manufacturerId:tenant.tenant_id,userId:tenant.user_id,idempotencyKey,providerCallBudget:req.body?.provider_call_budget,maxAttempts:req.body?.max_attempts,minIntervalSeconds:req.body?.min_interval_seconds,maxConcurrency:req.body?.max_concurrency,limit:req.body?.limit||500,req},{sql});
    }else if(action==='process_next'){
      result=await processNextBuyerResearchAccount({manufacturerId:tenant.tenant_id},{sql});
    }else if(action==='prepare_preview'){
      const jobId=clean(req.body?.job_id,80);if(jobId&&!UUID.test(jobId))return res.status(400).json({error:'job_id must be a valid UUID'});
      result=await createNextBuyerResearchPreview({manufacturerId:tenant.tenant_id,jobId:jobId||null,req},{sql});
    }else if(['pause','resume','cancel'].includes(action)){
      const jobId=clean(req.body?.job_id,80);if(!UUID.test(jobId))return res.status(400).json({error:'A valid job_id is required'});
      result={job:await changeBuyerResearchJob({manufacturerId:tenant.tenant_id,jobId,action,req},{sql})};
    }else return res.status(400).json({error:'Unsupported buyer research action'});
    await appendPermissionAudit({sql,req,tenant,actor,action_type:`BUYER_RESEARCH_${action.toUpperCase()}`,result:'SUCCESS',new_value:{job_id:result?.job?.id||result?.job_id||null,status:result?.status||result?.job?.status||''}});
    return res.status(action==='start'?201:200).json(result);
  }catch(error){
    await appendPermissionAudit({sql,req,tenant,actor,action_type:`BUYER_RESEARCH_${clean(req.body?.action||req.method,40).toUpperCase()}`,result:error.statusCode===403?'DENIED':'FAILED',reason:clean(error.message,500),new_value:{job_id:clean(req.body?.job_id,80)}}).catch(()=>{});
    console.error('buyer research runner failed',{message:error?.message||String(error),code:error?.code||'',action:clean(req.body?.action,40)});
    return res.status(Number(error.statusCode)||500).json({error:clean(error.message||'Buyer research operation failed',500),active_job_id:error.active_job_id||undefined});
  }
}
