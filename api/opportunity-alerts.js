import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { ensureOpportunityAlerts,scanOpportunityAlerts } from './_opportunity-alerts.js';

export default async function handler(req,res){
 const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
 try{await ensureOpportunityAlerts(sql);
  if(req.method==='GET'){
   const status=String(req.query?.status||'').trim().toUpperCase(),organizationId=String(req.query?.organization_id||'').trim();
   const rows=organizationId?await sql`select oa.*,ro.name organization_name from opportunity_alerts oa left join retail_organizations ro on ro.id=oa.organization_id where oa.manufacturer_id=${tenant.tenant_id} and oa.organization_id=${organizationId} and (${status}='' or oa.status=${status}) order by oa.impact_score desc,oa.created_at desc limit 250`:await sql`select oa.*,ro.name organization_name from opportunity_alerts oa left join retail_organizations ro on ro.id=oa.organization_id where oa.manufacturer_id=${tenant.tenant_id} and (${status}='' or oa.status=${status}) order by case oa.status when 'NEW' then 1 when 'ACKNOWLEDGED' then 2 else 3 end,oa.impact_score desc,oa.created_at desc limit 250`;
   const counts=(await sql`select count(*) filter(where status='NEW')::int new_count,count(*) filter(where severity='critical' and status='NEW')::int critical_count,count(*) filter(where severity='high' and status='NEW')::int high_count from opportunity_alerts where manufacturer_id=${tenant.tenant_id}`)[0];return res.status(200).json({alerts:rows,counts});
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const action=String(req.body?.action||'scan').toLowerCase();
  if(action==='scan'){const result=await scanOpportunityAlerts({manufacturerId:tenant.tenant_id,limit:req.body?.limit||150,sql});return res.status(200).json(result)}
  const id=String(req.body?.id||'').trim();if(!id)return res.status(400).json({error:'Alert id is required'});
  if(action==='acknowledge'||action==='dismiss'||action==='reopen'){const next=action==='acknowledge'?'ACKNOWLEDGED':action==='dismiss'?'DISMISSED':'NEW';const row=(await sql`update opportunity_alerts set status=${next},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} returning *`)[0];if(!row)return res.status(404).json({error:'Alert not found'});return res.status(200).json({alert:row})}
  return res.status(400).json({error:'Unsupported action'});
 }catch(e){console.error('opportunity alerts failed',{message:e?.message||String(e)});return res.status(500).json({error:'Opportunity alerts could not be processed'})}
}
