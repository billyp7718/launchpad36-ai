import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { evaluateRouteToMarketFit } from './_route-to-market-fit.js';

const clean=(v,max=300)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const organizationId=clean(req.body?.organization_id,100),productIds=[...new Set((Array.isArray(req.body?.product_ids)?req.body.product_ids:[]).map(String).filter(Boolean))].slice(0,30),workspaceId=clean(req.body?.workspace_id,100);
  if(!organizationId||!productIds.length)return res.status(400).json({error:'organization_id and at least one product_id are required'});
  const sql=db();
  try{
    const org=(await sql`select * from retail_organizations where id=${organizationId} and active=true limit 1`)[0];if(!org)return res.status(404).json({error:'Account was not found'});
    const products=await sql`select p.*,b.name brand_name,coalesce((select json_agg(json_build_object('sku',pv.sku,'variant_name',pv.variant_name,'msrp',pv.msrp,'map',pv.map,'wholesale',pv.wholesale,'attributes',pv.attributes,'active',pv.active) order by pv.created_at) from product_variants pv where pv.product_id=p.id and pv.active=true),'[]'::json) variants from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true and p.id=any(${productIds})`;
    if(!products.length)return res.status(404).json({error:'Selected products were not found in the active portfolio'});
    const retailerProducts=await sql`select cp.brand,cp.product_name,cp.category,cp.price_text,cp.price_numeric,cp.availability,cp.source_url,cp.verification_status,cp.observed_at,cp.raw_text from competitive_products cp join accounts a on a.id=cp.account_id where a.organization_id=${organizationId} and cp.active=true order by cp.observed_at desc nulls last limit 150`;
    const normalized=retailerProducts.map(row=>{let meta={};try{meta=JSON.parse(row.raw_text||'{}')}catch{}return {...row,name:row.product_name,purchase_channel:meta.purchase_channel||'UNKNOWN',store_verification:meta.store_verification||'NOT_REQUESTED'}});
    const fit=await evaluateRouteToMarketFit({account:org.name,domain:org.domain||org.source_url||'',category:(org.categories||[]).join(' | '),retailer_products:normalized,manufacturer_products:products});
    const result={...fit,organization_id:org.id,account:org.name,product_ids:productIds,evaluated_at:new Date().toISOString(),evidence_observation_count:normalized.length};
    let saved=false;
    if(workspaceId){const row=(await sql`select id,scenario from opportunity_workspaces where id=${workspaceId} and manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} limit 1`)[0];if(row){const scenario={...(row.scenario||{}),route_to_market_fit:result,route_to_market_fit_updated_at:result.evaluated_at};await sql`update opportunity_workspaces set scenario=${sql.json(scenario)},updated_at=now() where id=${row.id} and manufacturer_id=${tenant.tenant_id}`;saved=true}}
    console.log('[route-to-market-fit] completed',{organization_id:organizationId,products:products.length,skus:result.sku_recommendations?.length||0,source:result.source,saved});
    return res.status(200).json({version:'9.8.4',route_to_market_fit:result,saved_to_workspace:saved});
  }catch(error){console.error('[route-to-market-fit] failed',{message:error?.message||String(error)});return res.status(500).json({error:'AI route-to-market fit could not be completed'})}
}
