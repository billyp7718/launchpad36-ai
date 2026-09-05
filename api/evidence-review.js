import { db } from './_db.js';
import { requireAdmin } from './_auth.js';
import { runLivingIntelligencePipeline } from './_living-intelligence.js';
import { reconcileOpportunityEvidenceForOrganization, syncCompetitiveOfferingVerification } from './_opportunity-evidence.js';

const numericId=value=>/^\d+$/.test(String(value||''))?Number(value):0;
const cleanReason=value=>String(value||'Rejected during human category review').replace(/\s+/g,' ').trim().slice(0,300);

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  const sql=db(),id=numericId(req.query?.id||req.body?.evidence_id);
  if(!id)return res.status(400).json({error:'Valid evidence_id is required'});
  try{
    const row=(await sql`select ce.*,es.source_url,es.source_kind,es.domain from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.id=${id} limit 1`)[0];
    if(!row)return res.status(404).json({error:'Evidence not found'});
    const offerings=Array.isArray(row.payload?.offerings)?row.payload.offerings:[];
    if(req.method==='GET')return res.status(200).json({evidence:{id:row.id,subject_type:row.subject_type,subject_key:row.subject_key,evidence_type:row.evidence_type,source_url:row.source_url,observed_at:row.observed_at,confidence:row.confidence,verification_status:row.verification_status,validation_notes:row.validation_notes,offerings}});
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    if(!['approve','reject'].includes(req.body?.action))return res.status(400).json({error:'Supported actions are approve and reject'});
    if(req.body.action==='reject'){const rejected=await runLivingIntelligencePipeline({account_id:row.account_id,organization_id:row.organization_id,source_url:row.source_url,source_type:row.source_kind,domain:row.domain,subject_type:row.subject_type,subject_key:row.subject_key,evidence_type:row.evidence_type,payload:{...row.payload,rejection_reason:cleanReason(req.body?.reason)},observed_at:new Date().toISOString(),confidence:Number(row.confidence)||0,verification_status:'REJECTED',refresh_tier:row.payload?.refresh_tier||'weekly',acquired_by:'admin_human_rejection'});await sql`delete from current_commercial_truth where subject_type=${row.subject_type} and subject_key=${row.subject_key}`;const competitive_products_updated=await syncCompetitiveOfferingVerification(sql,row,'REJECTED'),opportunities=await reconcileOpportunityEvidenceForOrganization(sql,row.organization_id);return res.status(200).json({rejected:true,evidence_id:rejected.evidence.id,verification_status:rejected.verification_status,competitive_products_updated,opportunities})}
    if(!offerings.length)return res.status(409).json({error:'Evidence has no structured products to approve'});
    const current=(await sql`select evidence_id from current_commercial_truth where subject_type=${row.subject_type} and subject_key=${row.subject_key} and content_hash=${row.content_hash} limit 1`)[0];
    if(current){const competitive_products_updated=await syncCompetitiveOfferingVerification(sql,row,'VERIFIED'),opportunities=await reconcileOpportunityEvidenceForOrganization(sql,row.organization_id);return res.status(200).json({approved:true,already_verified:true,evidence_id:current.evidence_id,competitive_products_updated,opportunities})}
    const result=await runLivingIntelligencePipeline({account_id:row.account_id,organization_id:row.organization_id,source_url:row.source_url,source_type:row.source_kind,domain:row.domain,subject_type:row.subject_type,subject_key:row.subject_key,evidence_type:row.evidence_type,payload:row.payload,observed_at:new Date().toISOString(),last_verified_at:new Date().toISOString(),confidence:Math.max(70,Number(row.confidence)||0),verification_status:'VERIFIED',refresh_tier:row.payload?.refresh_tier||'weekly',acquired_by:'admin_human_review'});
    const competitive_products_updated=await syncCompetitiveOfferingVerification(sql,row,'VERIFIED'),opportunities=await reconcileOpportunityEvidenceForOrganization(sql,row.organization_id);
    return res.status(200).json({approved:true,already_verified:false,evidence_id:result.evidence.id,verification_status:result.verification_status,deterministic_update_applied:result.deterministic_update_applied,competitive_products_updated,opportunities});
  }catch(e){console.error('evidence review failed',{message:e?.message||String(e)});return res.status(500).json({error:'Evidence review could not be completed'})}
}
