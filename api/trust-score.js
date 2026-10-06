import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { calculateTrustScore } from './_trust-score.js';

const clean=(value,max=180)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
  try{
    if(req.method==='GET'){
      const entityType=clean(req.query?.entity_type,80),entityId=clean(req.query?.entity_id);if(!entityType||!entityId)return res.status(400).json({error:'entity_type and entity_id are required'});
      const rows=await sql`select * from l36_trust_evaluations where manufacturer_id=${tenant.tenant_id} and entity_type=${entityType} and entity_id=${entityId} order by created_at desc limit 50`;return res.status(200).json({evaluations:rows});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const entityType=clean(req.body?.entity_type,80),entityId=clean(req.body?.entity_id),result=calculateTrustScore(req.body||{});if(!entityType||!entityId)return res.status(400).json({error:'entity_type and entity_id are required'});
    let evaluation=null;if(req.body?.persist!==false)evaluation=(await sql`insert into l36_trust_evaluations(manufacturer_id,entity_type,entity_id,trust_score,trust_level,reasons,missing_evidence,conflicts,recommended_verification,factors,observation_ids,algorithm_version,created_by) values(${tenant.tenant_id},${entityType},${entityId},${result.trust_score},${result.trust_level},${sql.json(result.reasons)},${sql.json(result.missing_evidence)},${sql.json(result.conflicts)},${sql.json(result.recommended_verification)},${sql.json(result.factors)},${sql.json((req.body?.observations||[]).map(item=>item.id).filter(Boolean))},${result.algorithm_version},${tenant.user_id||null}) returning *`)[0];return res.status(201).json({evaluation:evaluation||result,result});
  }catch(error){console.error('trust score operation failed',{message:error?.message||String(error)});if(error?.code==='42P01')return res.status(409).json({error:'Intelligence foundation schema is not initialized',code:'SCHEMA_REQUIRED'});return res.status(500).json({error:'Trust Score operation failed'});}
}
