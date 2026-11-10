import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { createNextBuyerResearchPreview, ensureScheduledBuyerResearchJob, processNextBuyerResearchAccount } from './_buyer-research-runner.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res))return;
  const manufacturerId=String(process.env.BUYER_INTELLIGENCE_SERVICE_TENANT_ID||'').trim();
  if(!UUID.test(manufacturerId))return res.status(503).json({error:'Buyer intelligence service tenant is not configured'});
  try{
    const sql=db(),scheduled=await ensureScheduledBuyerResearchJob({manufacturerId,req},{sql});
    if(scheduled.status==='SCHEDULED')return res.status(200).json({scheduled});
    const research=await processNextBuyerResearchAccount({manufacturerId},{sql});
    if(research.status==='RESEARCH_COMPLETE'||research.status==='NO_ACTIVE_JOB'){
      const preview=await createNextBuyerResearchPreview({manufacturerId,req},{sql});
      return res.status(200).json({research,preview,scheduled});
    }
    return res.status(200).json({research,scheduled});
  }catch(error){
    console.error('buyer research runner tick failed',{message:error?.message||String(error),code:error?.code||''});
    return res.status(Number(error.statusCode)||500).json({error:'Buyer research runner tick failed'});
  }
}
