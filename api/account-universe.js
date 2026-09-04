import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { domainFromWebsite, normalizePublicUrl } from './_url.js';

const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const list=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[,;|]/)).map(x=>clean(x,100)).filter(Boolean))].slice(0,30);

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
  if(req.method==='PATCH'){
    const id=clean(req.body?.id,80),name=clean(req.body?.name,180);if(!id||!name)return res.status(400).json({error:'Account id and organization name are required'});
    const website=normalizePublicUrl(req.body?.source_url||req.body?.domain),domain=domainFromWebsite(req.body?.domain||website);
    try{const row=(await sql`update retail_organizations set name=${name},domain=${domain},organization_type=${clean(req.body?.organization_type||'retailer',60)},channel_codes=${list(req.body?.channels)},categories=${list(req.body?.categories)},coverage=${clean(req.body?.coverage,120)},region=${clean(req.body?.region,120)},headquarters=${clean(req.body?.headquarters,180)},footprint=${Math.max(0,Number(req.body?.footprint)||0)},ecommerce=${Boolean(req.body?.ecommerce)},source_url=${website},updated_at=now() where id=${id} and active=true returning *`)[0];if(!row)return res.status(404).json({error:'Account not found'});return res.status(200).json({account:row})}catch(e){return res.status(500).json({error:e.message})}
  }
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const q=clean(req.query?.q,180),channel=clean(req.query?.channel,100),category=clean(req.query?.category,100),limit=Math.min(Math.max(Number(req.query?.limit)||100,1),500);
  try{const rows=await sql`
    select ro.*,coalesce(mat.fit_score,0) fit_score,coalesce(mat.whitespace_score,0) whitespace_score,coalesce(mat.status,'') target_status,
    coalesce(buyer_summary.buyer_count,0) buyer_count,buyer_summary.buyer_data_updated_at,coalesce(buyer_summary.buyers,'[]'::json) buyers
    from retail_organizations ro left join manufacturer_account_targets mat on mat.organization_id=ro.id and mat.manufacturer_id=${tenant.tenant_id}
    left join lateral (select count(*)::int buyer_count,max(b.updated_at) buyer_data_updated_at,json_agg(json_build_object('name',b.name,'title',b.title,'category',b.category,'email',b.email,'phone',b.phone,'linkedin',b.linkedin,'source_url',b.source_url,'confidence',b.confidence) order by b.confidence desc,b.updated_at desc) buyers from accounts a join buyers b on b.account_id=a.id where a.organization_id=ro.id) buyer_summary on true
    where ro.active=true and (${q}='' or ro.name ilike ${'%'+q+'%'} or ro.domain ilike ${'%'+q+'%'})
    and (${channel}='' or ${channel}=any(ro.channel_codes)) and (${category}='' or ${category}=any(ro.categories))
    order by coalesce(mat.fit_score,0) desc,ro.confidence desc,ro.name limit ${limit}`;
    return res.status(200).json({organizations:rows,count:rows.length,limit,filters:{q,channel,category}})
  }catch(e){return res.status(500).json({error:e.message})}
}
