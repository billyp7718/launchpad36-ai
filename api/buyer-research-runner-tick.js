import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { createNextBuyerResearchPreview, ensureScheduledBuyerResearchJob, processNextBuyerResearchAccount } from './_buyer-research-runner.js';
import { BUYER_RESEARCH_RUNNER_SQL } from './db-init-buyer-research-runner.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ensureResearchSchema(sql){
  const required=[
    ['buyer_research_settings','automatic_refresh_enabled'],
    ['buyer_research_settings','refresh_interval_days'],
    ['buyer_research_jobs','research_mode'],
    ['buyer_research_jobs','zero_paid_runs'],
    ['buyer_research_jobs','zero_paid_authorized'],
    ['buyer_research_job_accounts','research_method'],
    ['buyer_research_job_accounts','robots_status'],
    ['buyer_research_candidates','research_method'],
    ['buyer_research_candidates','external_api_cost_cents']
  ],tables=[...new Set(required.map(item=>item[0]))],columns=required.map(item=>item[1]);
  const rows=await sql`select table_name,column_name from information_schema.columns where table_schema='public' and table_name=any(${tables}::text[]) and column_name=any(${columns}::text[])`,present=new Set(rows.map(row=>`${row.table_name}.${row.column_name}`));
  if(required.every(([table,column])=>present.has(`${table}.${column}`)))return false;
  await sql.unsafe(BUYER_RESEARCH_RUNNER_SQL);
  return true;
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res))return;
  const manufacturerId=String(process.env.BUYER_INTELLIGENCE_SERVICE_TENANT_ID||'').trim();
  if(!UUID.test(manufacturerId))return res.status(503).json({error:'Buyer intelligence service tenant is not configured'});
  try{
    const sql=db(),schemaInitialized=await ensureResearchSchema(sql),scheduled=await ensureScheduledBuyerResearchJob({manufacturerId,req},{sql});
    if(scheduled.status==='SCHEDULED')return res.status(200).json({scheduled});
    const research=await processNextBuyerResearchAccount({manufacturerId},{sql});
    if(research.status==='RESEARCH_COMPLETE'||research.status==='NO_ACTIVE_JOB'){
      const preview=await createNextBuyerResearchPreview({manufacturerId,req},{sql});
      return res.status(200).json({research,preview,scheduled,schema_initialized:schemaInitialized});
    }
    return res.status(200).json({research,scheduled,schema_initialized:schemaInitialized});
  }catch(error){
    console.error('buyer research runner tick failed',{message:error?.message||String(error),code:error?.code||''});
    return res.status(Number(error.statusCode)||500).json({error:'Buyer research runner tick failed'});
  }
}
