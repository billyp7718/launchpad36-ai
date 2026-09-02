import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

const ROUTES=new Set(['retail','direct_b2b','distributor_dealer','mixed']);
const RETAIL_CHANNELS=new Set(['mass','ce','ecommerce','specialty_av','office','furniture','club','home_improvement','automotive','department']);
const PARTNER_CHANNELS=new Set(['distribution','dealer']);
const clean=x=>String(x??'').trim().toLowerCase();
const money=x=>Math.round((Number(x)||0)*100)/100;
const pct=(x,fallback)=>Math.min(1,Math.max(0,(Number.isFinite(Number(x))?Number(x):fallback)/100));
const overlap=(a=[],b=[])=>{const set=new Set(a.map(clean).filter(Boolean));return b.filter(x=>set.has(clean(x))).length};

function routeEligible(org,route){
  if(route==='mixed')return true;
  const type=clean(org.organization_type),channels=(org.channel_codes||[]).map(clean);
  if(route==='retail')return type==='retailer'||channels.some(x=>RETAIL_CHANNELS.has(x));
  if(route==='distributor_dealer')return ['distributor','dealer','reseller','integrator'].includes(type)||channels.some(x=>PARTNER_CHANNELS.has(x));
  return !['retailer','distributor','dealer'].includes(type)||channels.some(x=>['enterprise','corporate','hospitality','healthcare','education','government','integrator'].includes(x));
}

export function calculateMarketOpportunity({products=[],organizations=[],route='retail',assumptions={}}={}){
  if(!ROUTES.has(route))throw new Error('Unsupported route to market');
  const units=Math.max(0,Number(route==='retail'?assumptions.annual_units_per_location:assumptions.units_per_account)||0);
  const probability=pct(route==='retail'?assumptions.distribution_probability:assumptions.win_probability,25);
  const overlapDiscount=products.length>1?pct(assumptions.portfolio_overlap_discount,10):0;
  const lowMultiplier=Math.max(0,Number(assumptions.low_multiplier)||0.65),highMultiplier=Math.max(1,Number(assumptions.high_multiplier)||1.35);
  const productCategories=[...new Set(products.flatMap(p=>[p.category,...(p.categories||[])].map(clean).filter(Boolean)))];
  const skus=products.flatMap(p=>(p.variants||[]).filter(v=>v.active!==false).map(v=>{
    const msrp=Math.max(0,Number(v.msrp)||0),explicitWholesale=Math.max(0,Number(v.wholesale)||0);
    return {product_id:p.id,product_name:p.name,brand_name:p.brand_name||'',sku:v.sku||v.variant_name||'Unspecified SKU',msrp,wholesale:explicitWholesale||(msrp?money(msrp*.6):0),wholesale_source:explicitWholesale?'catalog_wholesale':msrp?'modeled_60_percent_of_msrp':'missing'};
  })).filter(x=>x.wholesale>0);
  const candidates=organizations.filter(o=>routeEligible(o,route)).map(o=>{
    const categoryMatches=overlap(productCategories,o.categories||[]),categoryKnown=(o.categories||[]).length>0;
    const scale=route==='retail'?Math.max(1,Number(o.footprint)||1):1;
    const factor=1-overlapDiscount,contributions=skus.map(s=>{
      const base=money(scale*units*probability*s.wholesale*factor),retailValue=money(scale*units*probability*(s.msrp||s.wholesale)*factor);
      return {...s,base_manufacturer_revenue:base,base_retail_value:retailValue};
    });
    const base=money(contributions.reduce((n,x)=>n+x.base_manufacturer_revenue,0)),retailValue=money(contributions.reduce((n,x)=>n+x.base_retail_value,0));
    return {organization_id:o.id,name:o.name,domain:o.domain||'',organization_type:o.organization_type||'',channels:o.channel_codes||[],categories:o.categories||[],footprint:Number(o.footprint)||0,confidence:Number(o.confidence)||0,verification_status:o.verification_status||'UNKNOWN',category_match_count:categoryMatches,category_fit:categoryKnown?(categoryMatches?'MATCH':'NO_MATCH'):'UNKNOWN',low_manufacturer_revenue:money(base*lowMultiplier),base_manufacturer_revenue:base,high_manufacturer_revenue:money(base*highMultiplier),base_retail_value:retailValue,product_contributions:contributions};
  }).filter(o=>o.category_fit!=='NO_MATCH').sort((a,b)=>b.base_manufacturer_revenue-a.base_manufacturer_revenue);
  const base=candidates.reduce((n,x)=>n+x.base_manufacturer_revenue,0),retailValue=candidates.reduce((n,x)=>n+x.base_retail_value,0);
  const categoryTotals={};
  for(const account of candidates)for(const item of account.product_contributions){const key=products.find(p=>p.id===item.product_id)?.category||'Uncategorized';categoryTotals[key]=(categoryTotals[key]||0)+item.base_manufacturer_revenue}
  const missingPrices=products.filter(p=>!(p.variants||[]).some(v=>Number(v.wholesale)>0||Number(v.msrp)>0)).map(p=>p.name);
  const fallbackPrices=skus.filter(x=>x.wholesale_source==='modeled_60_percent_of_msrp').length;
  const knownCategory=candidates.filter(x=>x.category_fit==='MATCH').length;
  const warnings=['This is a modeled addressable opportunity, not verified market size or a revenue forecast.'];
  if(fallbackPrices)warnings.push(`${fallbackPrices} SKU price(s) use a modeled wholesale value equal to 60% of MSRP.`);
  if(missingPrices.length)warnings.push(`${missingPrices.length} selected product(s) were excluded because no MSRP or wholesale price is stored.`);
  if(candidates.some(x=>x.category_fit==='UNKNOWN'))warnings.push('Accounts without category tags are included with UNKNOWN category fit.');
  return {summary:{selected_product_count:products.length,priced_sku_count:skus.length,target_account_count:candidates.length,category_matched_account_count:knownCategory,low_manufacturer_revenue:money(base*lowMultiplier),base_manufacturer_revenue:money(base),high_manufacturer_revenue:money(base*highMultiplier),base_retail_value:money(retailValue),account_category_coverage:candidates.length?Math.round(knownCategory/candidates.length*100):0},assumptions:{route_to_market:route,annual_units_per_location:route==='retail'?units:null,units_per_account:route==='retail'?null:units,distribution_probability:route==='retail'?money(probability*100):null,win_probability:route==='retail'?null:money(probability*100),portfolio_overlap_discount:money(overlapDiscount*100),low_multiplier:lowMultiplier,high_multiplier:highMultiplier,provenance:'USER_PROVIDED'},account_opportunities:candidates,category_totals:Object.entries(categoryTotals).map(([category,value])=>({category,base_manufacturer_revenue:money(value)})).sort((a,b)=>b.base_manufacturer_revenue-a.base_manufacturer_revenue),warnings};
}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const productIds=[...new Set((req.body?.product_ids||[]).map(String).filter(Boolean))];
  if(!productIds.length||productIds.length>100)return res.status(400).json({error:'Select between 1 and 100 products'});
  const route=clean(req.body?.route_to_market||'retail');if(!ROUTES.has(route))return res.status(400).json({error:'Choose a supported route to market'});
  try{
    const sql=db();
    const productRows=await sql`select p.*,b.name brand_name,coalesce((select array_agg(category) from product_categories pc where pc.product_id=p.id),'{}') categories from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true`;
    const selected=productRows.filter(p=>productIds.includes(String(p.id)));
    if(selected.length!==productIds.length)return res.status(404).json({error:'One or more products were not found for this tenant'});
    const variants=await sql`select pv.* from product_variants pv join products p on p.id=pv.product_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true and pv.active=true`;
    const hydrated=selected.map(p=>({...p,variants:variants.filter(v=>String(v.product_id)===String(p.id))}));
    const organizations=await sql`select * from retail_organizations where active=true order by confidence desc,name limit 5000`;
    return res.status(200).json({version:'9.8.3',model:'MODELED_ADDRESSABLE_OPPORTUNITY',...calculateMarketOpportunity({products:hydrated,organizations,route,assumptions:req.body?.assumptions||{}})});
  }catch(e){console.error('market opportunity failed',{message:e?.message||String(e)});return res.status(500).json({error:'Market opportunity could not be calculated',code:'MARKET_OPPORTUNITY_FAILED'});}
}
