import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
export default async function handler(req,res){const t=await resolveTenant(req,res);if(!t)return;if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});const sql=db();const q=String(req.query?.q||'').trim();const channel=String(req.query?.channel||'').trim();const category=String(req.query?.category||'').trim();const limit=Math.min(Math.max(Number(req.query?.limit)||100,1),500);try{const rows=await sql`
 select ro.*,coalesce(mat.fit_score,0) fit_score,coalesce(mat.whitespace_score,0) whitespace_score,coalesce(mat.status,'') target_status
 from retail_organizations ro left join manufacturer_account_targets mat on mat.organization_id=ro.id and mat.manufacturer_id=${t.tenant_id}
 where ro.active=true and (${q}='' or ro.name ilike ${'%'+q+'%'} or ro.domain ilike ${'%'+q+'%'})
 and (${channel}='' or ${channel}=any(ro.channel_codes)) and (${category}='' or ${category}=any(ro.categories))
 order by coalesce(mat.fit_score,0) desc,ro.confidence desc,ro.name limit ${limit}`;return res.status(200).json({organizations:rows,count:rows.length,limit,filters:{q,channel,category}})}catch(e){return res.status(500).json({error:e.message})}}
