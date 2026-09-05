import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const STATUSES=new Set(['modeled','research_required','ready','approved','archived']);
const ASSORTMENT_ROLES=new Set(['opening','core','premium','add_on']);
const ROUTES=new Set(['retail','direct_b2b','distributor_dealer','mixed']);
const money=value=>Math.round((Number(value)||0)*100)/100;
const monthlyUnits=value=>Math.min(1000000,Math.max(0,Math.round(Number(value)||0)));
const boundedMoney=value=>Math.min(1000000000000,Math.max(0,money(value)));

function revenueValues(scenario,base){
  const low=Math.max(0,Number(scenario?.assumptions?.low_multiplier)||.65),high=Math.max(1,Number(scenario?.assumptions?.high_multiplier)||1.35),evidence=scenario?.account?.evidence_status==='VERIFIED';
  return {base_manufacturer_revenue:base,low_manufacturer_revenue:money(base*low),high_manufacturer_revenue:money(base*high),evidence_backed_manufacturer_revenue:evidence?base:0};
}

function accountAdjustment(input={},scenario={}){
  const previous=scenario.account_adjustment||{},raw=input.manual_annual_revenue,hasManual=raw!==null&&raw!==undefined&&String(raw).trim()!=='';
  const modelGenerated=boundedMoney(scenario?.volume_model?.annual_manufacturer_revenue??previous.model_generated_annual_revenue??scenario?.account?.base_manufacturer_revenue);
  return {include_in_report:input.include_in_report!==false,manual_annual_revenue:hasManual?boundedMoney(raw):null,model_generated_annual_revenue:modelGenerated,rationale:clean(input.rationale,800),notes:clean(input.notes,1200),updated_at:new Date().toISOString()};
}

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
  const catalog=await sql`select p.id product_id,p.name product_name,b.name brand_name,pv.sku,pv.variant_name,pv.wholesale from products p left join brands b on b.id=p.brand_id left join product_variants pv on pv.product_id=p.id and pv.active=true where p.manufacturer_id=${tenantId} and p.active=true`;
  const byProduct=new Map();for(const row of catalog){const key=String(row.product_id),current=byProduct.get(key)||[];current.push(row);byProduct.set(key,current)}
  return input.map((item,index)=>{
    const matches=byProduct.get(String(item?.product_id))||[];if(!matches.length)throw Object.assign(new Error(`Assortment item ${index+1} is not in this tenant's catalog`),{status:400});
    const requestedSku=clean(item?.sku,160),matched=requestedSku?matches.find(x=>String(x.sku||x.variant_name||'')===requestedSku):matches[0];if(!matched)throw Object.assign(new Error(`SKU ${requestedSku} is not active in this tenant's catalog`),{status:400});
    const dealerCost=money(matched.wholesale),volume=monthlyUnits(item?.monthly_sales_volume),annualRevenue=money(dealerCost*volume*12);
    return {product_id:String(matched.product_id),product_name:matched.product_name,brand_name:matched.brand_name||'',sku:requestedSku||matched.sku||matched.variant_name||'',role:ASSORTMENT_ROLES.has(item?.role)?item.role:'core',monthly_sales_volume:volume,dealer_cost:dealerCost,annual_revenue:annualRevenue,notes:clean(item?.notes,300),modeled_contribution:dealerCost};
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
    if(req.method==='DELETE'){
      const id=String(req.query?.id||req.body?.id||'').trim();if(!id)return res.status(400).json({error:'Opportunity id is required'});
      const removed=(await sql`delete from opportunity_workspaces where id=${id} and manufacturer_id=${tenant.tenant_id} returning id`)[0];if(!removed)return res.status(404).json({error:'Opportunity was not found for this tenant'});
      return res.status(200).json({removed:true,id:removed.id,account_and_evidence_preserved:true});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    if(req.body?.action==='create'){
      const organizationId=String(req.body?.organization_id||'').trim(),route=clean(req.body?.route_to_market||'retail',40).toLowerCase(),productIds=[...new Set((req.body?.product_ids||[]).map(String).filter(Boolean))];
      if(!organizationId)return res.status(400).json({error:'Choose a target account'});if(!ROUTES.has(route))return res.status(400).json({error:'Choose a supported route to market'});if(!productIds.length||productIds.length>100)return res.status(400).json({error:'Select between 1 and 100 portfolio products'});
      const organization=(await sql`select * from retail_organizations where id=${organizationId} and active=true limit 1`)[0];if(!organization)return res.status(404).json({error:'Target account was not found'});
      const [catalog,variants]=await Promise.all([sql`select p.id,p.name product_name,p.product_family,p.category,b.name brand_name from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true`,sql`select pv.* from product_variants pv join products p on p.id=pv.product_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true and pv.active=true`]);
      const selected=catalog.filter(p=>productIds.includes(String(p.id)));if(selected.length!==productIds.length)return res.status(404).json({error:'One or more portfolio products were not found'});
      const assortment=selected.map(p=>{const variant=variants.find(v=>String(v.product_id)===String(p.id))||{},dealerCost=money(variant.wholesale);return {product_id:String(p.id),product_name:p.product_name,brand_name:p.brand_name||'',sku:variant.sku||variant.variant_name||'',role:'core',monthly_sales_volume:0,dealer_cost:dealerCost,annual_revenue:0,notes:'',modeled_contribution:dealerCost}}),key=[...productIds].sort().join('|'),scenario={model:'MANUAL_TARGET_ACCOUNT',account:{organization_id:organization.id,name:organization.name,domain:organization.domain||'',organization_type:organization.organization_type||'',categories:organization.categories||[],channels:organization.channel_codes||[],fit_score:0,fit_reason:'Manually added target account; research is required before qualification',evidence_status:'INSUFFICIENT',evidence_count:0,base_manufacturer_revenue:0,evidence_backed_manufacturer_revenue:0,product_contributions:assortment},proposed_assortment:assortment,recommended_sku:assortment[0]||null,generated_at:new Date().toISOString()};
      const row=(await sql`insert into opportunity_workspaces(manufacturer_id,organization_id,account_id,route_to_market,product_set_key,product_ids,status,priority,next_action,scenario,updated_at) values(${tenant.tenant_id},${organization.id},(select id from accounts where organization_id=${organization.id} limit 1),${route},${key},${sql.json(productIds)},'research_required','medium','Research the account assortment and buyers',${sql.json(scenario)},now()) on conflict(manufacturer_id,organization_id,route_to_market,product_set_key) do update set updated_at=now() returning *`)[0];
      return res.status(201).json({opportunity:row,created_or_reused:true});
    }
    const id=String(req.body?.id||'').trim();if(!id)return res.status(400).json({error:'Opportunity id is required'});
    const existing=(await sql`select * from opportunity_workspaces where id=${id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];
    if(!existing)return res.status(404).json({error:'Opportunity was not found for this tenant'});
    const requested=clean(req.body?.status||existing.status,40).toLowerCase();if(!STATUSES.has(requested))return res.status(400).json({error:'Unsupported opportunity status'});
    if(requested==='approved'&&existing.scenario?.account?.evidence_status!=='VERIFIED')return res.status(409).json({error:'Verify relevant account assortment evidence before approving this opportunity'});
    let scenario=existing.scenario||{};
    if(req.body?.proposed_assortment!==undefined){const assortment=await proposedAssortment(sql,tenant.tenant_id,req.body.proposed_assortment),annualRevenue=money(assortment.reduce((sum,item)=>sum+item.annual_revenue,0)),priorAdjustment=scenario.account_adjustment||null,adjustment=priorAdjustment?{...priorAdjustment,model_generated_annual_revenue:annualRevenue}:null,appliedRevenue=adjustment?.manual_annual_revenue??annualRevenue,account={...(scenario.account||{}),...revenueValues(scenario,appliedRevenue),product_contributions:assortment};scenario={...scenario,account,proposed_assortment:assortment,recommended_sku:assortment[0]||null,volume_model:{basis:'account_sku_monthly_units_x_dealer_cost',annual_manufacturer_revenue:annualRevenue},...(adjustment?{account_adjustment:adjustment}:{}),assortment_updated_at:new Date().toISOString()}}
    if(req.body?.account_adjustment!==undefined){const adjustment=accountAdjustment(req.body.account_adjustment,scenario),appliedRevenue=adjustment.manual_annual_revenue??adjustment.model_generated_annual_revenue,account={...(scenario.account||{}),...revenueValues(scenario,appliedRevenue)};scenario={...scenario,account,account_adjustment:adjustment}}
    if(req.body?.assigned_buyer_id!==undefined){const buyerId=String(req.body.assigned_buyer_id||'').trim();let assignedBuyer=null;if(buyerId){assignedBuyer=(await sql`select b.id,b.name,b.title,b.email,b.phone,b.linkedin,b.category,b.confidence,b.verification_status,b.source_url from buyers b join accounts a on a.id=b.account_id where b.id=${buyerId} and a.organization_id=${existing.organization_id} limit 1`)[0];if(!assignedBuyer)throw Object.assign(new Error('Selected buyer does not belong to this opportunity account'),{status:400})}scenario={...scenario,assigned_buyer:assignedBuyer,buyer_assigned_at:new Date().toISOString()}}
    const row=(await sql`update opportunity_workspaces set status=${requested},priority=${clean(req.body?.priority||existing.priority,30)},owner=${clean(req.body?.owner??existing.owner,160)},next_action=${clean(req.body?.next_action??existing.next_action,500)},scenario=${sql.json(scenario)},approved_at=${requested==='approved'?new Date().toISOString():existing.approved_at},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} returning *`)[0];
    return res.status(200).json({opportunity:row});
  }catch(e){console.error('opportunity workspace failed',{message:e?.message||String(e)});return res.status(e?.status||500).json({error:e?.status?e.message:'Opportunity workspace could not be completed'});}
}
