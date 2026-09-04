import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const STATUSES=new Set(['modeled','research_required','ready','approved','archived']);
const ASSORTMENT_ROLES=new Set(['opening','core','premium','add_on']);

function competitiveOfferings(evidenceRows=[],productRows=[]){
  const grouped=new Map(),seen=new Set();
  const add=(organizationId,item={})=>{
    const name=clean(item.name||item.product_name,220),brand=clean(item.brand,140),sourceUrl=clean(item.source_url,1000);
    if(!organizationId||!name)return;
    const key=`${organizationId}|${brand}|${name}|${sourceUrl}`.toLowerCase();if(seen.has(key))return;seen.add(key);
    const rows=grouped.get(String(organizationId))||[];
    if(rows.length<100)rows.push({name,brand,category:clean(item.category,140),price_text:clean(item.price_text,80),availability:clean(item.availability,180),source_url:sourceUrl,verification_status:clean(item.verification_status||'REVIEW_REQUIRED',40),observed_at:item.observed_at||null});
    grouped.set(String(organizationId),rows);
  };
  for(const row of evidenceRows)for(const item of Array.isArray(row.payload?.offerings)?row.payload.offerings:[])add(row.organization_id,{...item,source_url:row.source_url,verification_status:row.verification_status,observed_at:row.observed_at});
  for(const row of productRows)add(row.organization_id,row);
  return grouped;
}

async function proposedAssortment(sql,tenantId,input=[]){
  if(!Array.isArray(input)||input.length>100)throw Object.assign(new Error('Proposed assortment must contain no more than 100 products'),{status:400});
  const catalog=await sql`select p.id product_id,p.name product_name,b.name brand_name,pv.sku,pv.variant_name from products p left join brands b on b.id=p.brand_id left join product_variants pv on pv.product_id=p.id and pv.active=true where p.manufacturer_id=${tenantId} and p.active=true`;
  const byProduct=new Map();for(const row of catalog){const key=String(row.product_id),current=byProduct.get(key)||[];current.push(row);byProduct.set(key,current)}
  return input.map((item,index)=>{
    const matches=byProduct.get(String(item?.product_id))||[];if(!matches.length)throw Object.assign(new Error(`Assortment item ${index+1} is not in this tenant's catalog`),{status:400});
    const requestedSku=clean(item?.sku,160),matched=matches.find(x=>String(x.sku||x.variant_name||'')===requestedSku)||matches[0];
    return {product_id:String(matched.product_id),product_name:matched.product_name,brand_name:matched.brand_name||'',sku:requestedSku||matched.sku||matched.variant_name||'',role:ASSORTMENT_ROLES.has(item?.role)?item.role:'core',notes:clean(item?.notes,300),modeled_contribution:Number(item?.modeled_contribution)||0};
  });
}

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
            coalesce(json_agg(json_build_object('id',b.id,'name',b.name,'title',b.title,'email',b.email,'phone',b.phone,'linkedin',b.linkedin,'category',b.category,'confidence',b.confidence,'verification_status',b.verification_status,'source_url',b.source_url) order by b.updated_at desc),'[]'::json) buyers
          from accounts a join buyers b on b.account_id=a.id where a.organization_id=ow.organization_id
        ) buyer_summary on true
        where ow.manufacturer_id=${tenant.tenant_id}
        order by case ow.status when 'approved' then 1 when 'ready' then 2 when 'research_required' then 3 else 4 end,ow.updated_at desc
        limit 500`;
      let evidenceRows=[],productRows=[];
      if(rows.length){
        [evidenceRows,productRows]=await Promise.all([
          sql`select ce.organization_id,ce.payload,es.source_url,ce.verification_status,ce.observed_at from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.organization_id in (select organization_id from opportunity_workspaces where manufacturer_id=${tenant.tenant_id}) and ce.subject_type='retailer_assortment' and ce.verification_status in ('VERIFIED','REVIEW_REQUIRED') order by ce.observed_at desc limit 10000`,
          sql`select a.organization_id,cp.brand,cp.product_name,cp.category,cp.price_text,cp.availability,cp.source_url,cp.verification_status,cp.observed_at from competitive_products cp join accounts a on a.id=cp.account_id where a.organization_id in (select organization_id from opportunity_workspaces where manufacturer_id=${tenant.tenant_id}) and cp.active=true order by cp.observed_at desc nulls last limit 10000`
        ]);
      }
      const offerings=competitiveOfferings(evidenceRows,productRows);
      return res.status(200).json({version:'9.8.3',opportunities:rows.map(row=>({...row,competitive_offerings:offerings.get(String(row.organization_id))||[]}))});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const id=String(req.body?.id||'').trim();if(!id)return res.status(400).json({error:'Opportunity id is required'});
    const existing=(await sql`select * from opportunity_workspaces where id=${id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];
    if(!existing)return res.status(404).json({error:'Opportunity was not found for this tenant'});
    const requested=clean(req.body?.status||existing.status,40).toLowerCase();if(!STATUSES.has(requested))return res.status(400).json({error:'Unsupported opportunity status'});
    if(requested==='approved'&&existing.scenario?.account?.evidence_status!=='VERIFIED')return res.status(409).json({error:'Verify relevant account assortment evidence before approving this opportunity'});
    let scenario=existing.scenario||{};
    if(req.body?.proposed_assortment!==undefined){const assortment=await proposedAssortment(sql,tenant.tenant_id,req.body.proposed_assortment);scenario={...scenario,proposed_assortment:assortment,assortment_updated_at:new Date().toISOString()}}
    if(req.body?.assigned_buyer_id!==undefined){const buyerId=String(req.body.assigned_buyer_id||'').trim();let assignedBuyer=null;if(buyerId){assignedBuyer=(await sql`select b.id,b.name,b.title,b.email,b.phone,b.linkedin,b.category,b.confidence,b.verification_status,b.source_url from buyers b join accounts a on a.id=b.account_id where b.id=${buyerId} and a.organization_id=${existing.organization_id} limit 1`)[0];if(!assignedBuyer)throw Object.assign(new Error('Selected buyer does not belong to this opportunity account'),{status:400})}scenario={...scenario,assigned_buyer:assignedBuyer,buyer_assigned_at:new Date().toISOString()}}
    const row=(await sql`update opportunity_workspaces set status=${requested},priority=${clean(req.body?.priority||existing.priority,30)},owner=${clean(req.body?.owner??existing.owner,160)},next_action=${clean(req.body?.next_action??existing.next_action,500)},scenario=${sql.json(scenario)},approved_at=${requested==='approved'?new Date().toISOString():existing.approved_at},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} returning *`)[0];
    return res.status(200).json({opportunity:row});
  }catch(e){console.error('opportunity workspace failed',{message:e?.message||String(e)});return res.status(e?.status||500).json({error:e?.status?e.message:'Opportunity workspace could not be completed'});}
}
