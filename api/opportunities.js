import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const STATUSES=new Set(['modeled','research_required','ready','approved','archived']);

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const sql=db();
  try{
    if(req.method==='GET'){
      const rows=await sql`
        select ow.*,ro.name account_name,ro.domain,ro.categories,ro.channel_codes,ro.footprint,
          coalesce(buyer_summary.buyer_count,0) buyer_count,coalesce(buyer_summary.buyers,'[]'::json) buyers
        from opportunity_workspaces ow
        join retail_organizations ro on ro.id=ow.organization_id
        left join lateral (
          select count(*)::int buyer_count,
            coalesce(json_agg(json_build_object('id',b.id,'name',b.name,'title',b.title,'category',b.category,'confidence',b.confidence,'verification_status',b.verification_status,'source_url',b.source_url) order by b.updated_at desc),'[]'::json) buyers
          from accounts a join buyers b on b.account_id=a.id where a.organization_id=ow.organization_id
        ) buyer_summary on true
        where ow.manufacturer_id=${tenant.tenant_id}
        order by case ow.status when 'approved' then 1 when 'ready' then 2 when 'research_required' then 3 else 4 end,ow.updated_at desc
        limit 500`;
      return res.status(200).json({version:'9.8.3',opportunities:rows});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const id=String(req.body?.id||'').trim();if(!id)return res.status(400).json({error:'Opportunity id is required'});
    const existing=(await sql`select * from opportunity_workspaces where id=${id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];
    if(!existing)return res.status(404).json({error:'Opportunity was not found for this tenant'});
    const requested=clean(req.body?.status||existing.status,40).toLowerCase();if(!STATUSES.has(requested))return res.status(400).json({error:'Unsupported opportunity status'});
    if(requested==='approved'&&existing.scenario?.account?.evidence_status!=='VERIFIED')return res.status(409).json({error:'Verify relevant account assortment evidence before approving this opportunity'});
    const row=(await sql`update opportunity_workspaces set status=${requested},priority=${clean(req.body?.priority||existing.priority,30)},owner=${clean(req.body?.owner??existing.owner,160)},next_action=${clean(req.body?.next_action??existing.next_action,500)},approved_at=${requested==='approved'?new Date().toISOString():existing.approved_at},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} returning *`)[0];
    return res.status(200).json({opportunity:row});
  }catch(e){console.error('opportunity workspace failed',{message:e?.message||String(e)});return res.status(500).json({error:'Opportunity workspace could not be completed'});}
}
