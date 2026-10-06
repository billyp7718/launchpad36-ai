import { db } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { buyerProfiles, categoryConcepts, evaluateProductAccountFit, evidenceProfiles } from './_account-fit.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';

const ROUTES=new Set(['retail','direct_b2b','distributor_dealer','mixed']);
const RETAIL_CHANNELS=new Set(['mass','ce','ecommerce','specialty_av','office','furniture','club','warehouse','home_improvement','automotive','department','grocery','supermarket','drug','pharmacy','value','dollar']);
const PARTNER_CHANNELS=new Set(['distribution','dealer']);
const ACCOUNT_SCOPE_MODES=new Set(['recommended','custom_only','recommended_plus_custom']);
const ACCOUNT_LIMITS=new Set([25,50,100,150,200]);
const clean=x=>String(x??'').trim().toLowerCase();
const money=x=>Math.round((Number(x)||0)*100)/100;
const pct=(x,fallback)=>Math.min(1,Math.max(0,(Number.isFinite(Number(x))?Number(x):fallback)/100));
export { categoryConcepts, evaluateProductAccountFit } from './_account-fit.js';

function routeEligible(org,route){
  if(route==='mixed')return true;
  const type=clean(org.organization_type),channels=(org.channel_codes||[]).map(clean);
  if(route==='retail')return type==='retailer'||channels.some(x=>RETAIL_CHANNELS.has(x));
  if(route==='distributor_dealer')return ['distributor','dealer','reseller','integrator'].includes(type)||channels.some(x=>PARTNER_CHANNELS.has(x));
  return !['retailer','distributor','dealer'].includes(type)||channels.some(x=>['enterprise','corporate','hospitality','healthcare','education','government','integrator'].includes(x));
}

export function calculateMarketOpportunity({products=[],organizations=[],route='retail',assumptions={},evidenceByOrganization=new Map(),buyersByOrganization=new Map(),forcedOrganizationIds=[]}={}){
  if(!ROUTES.has(route))throw new Error('Unsupported route to market');
  const units=Math.max(0,Number(route==='retail'?assumptions.annual_units_per_location:assumptions.units_per_account)||0);
  const probability=pct(route==='retail'?assumptions.distribution_probability:assumptions.win_probability,25);
  const overlapDiscount=products.length>1?pct(assumptions.portfolio_overlap_discount,10):0;
  const lowMultiplier=Math.max(0,Number(assumptions.low_multiplier)||0.65),highMultiplier=Math.max(1,Number(assumptions.high_multiplier)||1.35);
  const skus=products.flatMap(p=>(p.variants||[]).filter(v=>v.active!==false).map(v=>{
    const msrp=Math.max(0,Number(v.msrp)||0),explicitWholesale=Math.max(0,Number(v.wholesale)||0);
    return {product_id:p.id,product_name:p.name,product_family:p.product_family||'',product_category:p.category||'',product_categories:p.categories||[],brand_name:p.brand_name||'',sku:v.sku||v.variant_name||'Unspecified SKU',msrp,wholesale:explicitWholesale||(msrp?money(msrp*.6):0),wholesale_source:explicitWholesale?'catalog_wholesale':msrp?'modeled_60_percent_of_msrp':'missing'};
  })).filter(x=>x.wholesale>0);
  const forced=new Set(forcedOrganizationIds.map(String)),candidates=organizations.filter(o=>routeEligible(o,route)||forced.has(String(o.id))).map(o=>{
    const profile=evidenceByOrganization.get(String(o.id))||null,productFits=new Map(products.map(p=>[String(p.id),evaluateProductAccountFit(p,o,profile)])),qualifiedSkus=skus.filter(s=>productFits.get(String(s.product_id))?.qualified);
    const scale=route==='retail'?Math.max(1,Number(o.footprint)||1):1;
    const factor=1-overlapDiscount,contributions=qualifiedSkus.map(s=>{
      const base=money(scale*units*probability*s.wholesale*factor),retailValue=money(scale*units*probability*(s.msrp||s.wholesale)*factor);
      const fit=productFits.get(String(s.product_id));return {...s,fit_score:fit.score,fit_tier:fit.tier,fit_reason:fit.reason,evidence_status:fit.evidence_status,evidence_count:fit.evidence_count||0,evidence_sources:fit.evidence_sources||[],last_verified_at:fit.last_verified_at||null,last_observed_at:fit.last_observed_at||null,base_manufacturer_revenue:base,evidence_backed_manufacturer_revenue:fit.evidence_status==='VERIFIED'?base:0,base_retail_value:retailValue};
    });
    const base=money(contributions.reduce((n,x)=>n+x.base_manufacturer_revenue,0)),retailValue=money(contributions.reduce((n,x)=>n+x.base_retail_value,0));
    const evidenceBacked=money(contributions.reduce((n,x)=>n+x.evidence_backed_manufacturer_revenue,0)),bestFit=Math.max(0,...contributions.map(x=>x.fit_score)),best=contributions.find(x=>x.fit_score===bestFit),buyers=buyersByOrganization.get(String(o.id))||[],recommendationEligible=routeEligible(o,route)&&contributions.length>0;return {organization_id:o.id,name:o.name,domain:o.domain||'',organization_type:o.organization_type||'',channels:o.channel_codes||[],categories:o.categories||[],footprint:Number(o.footprint)||0,confidence:Number(o.confidence)||0,verification_status:o.verification_status||'UNKNOWN',fit_score:bestFit,fit_tier:best?.fit_tier||'NO_CATEGORY_FIT',fit_reason:best?.fit_reason||'No selected product fits this account',evidence_status:best?.evidence_status||'INSUFFICIENT',evidence_count:Math.max(0,...contributions.map(x=>x.evidence_count||0)),last_verified_at:best?.last_verified_at||null,last_observed_at:best?.last_observed_at||null,buyers,buyer_count:buyers.length,recommendation_eligible:recommendationEligible,low_manufacturer_revenue:money(base*lowMultiplier),base_manufacturer_revenue:base,high_manufacturer_revenue:money(base*highMultiplier),evidence_backed_manufacturer_revenue:evidenceBacked,base_retail_value:retailValue,product_contributions:contributions};
  }).filter(o=>o.product_contributions.length>0||forced.has(String(o.organization_id))).sort(compareAccountRank);
  const base=candidates.reduce((n,x)=>n+x.base_manufacturer_revenue,0),evidenceBacked=candidates.reduce((n,x)=>n+x.evidence_backed_manufacturer_revenue,0),retailValue=candidates.reduce((n,x)=>n+x.base_retail_value,0);
  const categoryTotals={};
  for(const account of candidates)for(const item of account.product_contributions){const key=products.find(p=>p.id===item.product_id)?.category||'Uncategorized';categoryTotals[key]=(categoryTotals[key]||0)+item.base_manufacturer_revenue}
  const missingPrices=products.filter(p=>!(p.variants||[]).some(v=>Number(v.wholesale)>0||Number(v.msrp)>0)).map(p=>p.name);
  const fallbackPrices=skus.filter(x=>x.wholesale_source==='modeled_60_percent_of_msrp').length;
  const verifiedAccounts=candidates.filter(x=>x.evidence_status==='VERIFIED').length;
  const warnings=['This is a modeled addressable opportunity, not verified market size or a revenue forecast.'];
  if(fallbackPrices)warnings.push(`${fallbackPrices} SKU price(s) use a modeled wholesale value equal to 60% of MSRP.`);
  if(missingPrices.length)warnings.push(`${missingPrices.length} selected product(s) were excluded because no MSRP or wholesale price is stored.`);
  warnings.push('Account ranking reflects category and channel fit, not certainty that an account will purchase. Verified assortment evidence and sales outcomes should raise or lower confidence.');
  return {summary:{selected_product_count:products.length,priced_sku_count:skus.length,target_account_count:candidates.length,verified_account_count:verifiedAccounts,low_manufacturer_revenue:money(base*lowMultiplier),base_manufacturer_revenue:money(base),high_manufacturer_revenue:money(base*highMultiplier),evidence_backed_manufacturer_revenue:money(evidenceBacked),base_retail_value:money(retailValue),account_category_coverage:candidates.length?Math.round(verifiedAccounts/candidates.length*100):0},assumptions:{route_to_market:route,annual_units_per_location:route==='retail'?units:null,units_per_account:route==='retail'?null:units,distribution_probability:route==='retail'?money(probability*100):null,win_probability:route==='retail'?null:money(probability*100),portfolio_overlap_discount:money(overlapDiscount*100),low_multiplier:lowMultiplier,high_multiplier:highMultiplier,provenance:'USER_PROVIDED'},account_opportunities:candidates,category_totals:Object.entries(categoryTotals).map(([category,value])=>({category,base_manufacturer_revenue:money(value)})).sort((a,b)=>b.base_manufacturer_revenue-a.base_manufacturer_revenue),warnings};
}

export function compareAccountRank(a,b){return (Number(b.fit_score)||0)-(Number(a.fit_score)||0)||(Number(b.base_manufacturer_revenue)||0)-(Number(a.base_manufacturer_revenue)||0)||String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base',numeric:true})||String(a.organization_id||'').localeCompare(String(b.organization_id||''))}

function scopedTotals(result,accounts,accountScope){
  const base=accounts.reduce((sum,x)=>sum+(Number(x.base_manufacturer_revenue)||0),0),low=accounts.reduce((sum,x)=>sum+(Number(x.low_manufacturer_revenue)||0),0),high=accounts.reduce((sum,x)=>sum+(Number(x.high_manufacturer_revenue)||0),0),evidenceBacked=accounts.reduce((sum,x)=>sum+(Number(x.evidence_backed_manufacturer_revenue)||0),0),retailValue=accounts.reduce((sum,x)=>sum+(Number(x.base_retail_value)||0),0),verified=accounts.filter(x=>x.evidence_status==='VERIFIED').length,categoryTotals={};
  for(const account of accounts)for(const item of account.product_contributions||[]){const category=item.product_category||'Uncategorized';categoryTotals[category]=(categoryTotals[category]||0)+(Number(item.base_manufacturer_revenue)||0)}
  return {...result,summary:{...result.summary,target_account_count:accounts.length,verified_account_count:verified,low_manufacturer_revenue:money(low),base_manufacturer_revenue:money(base),high_manufacturer_revenue:money(high),evidence_backed_manufacturer_revenue:money(evidenceBacked),base_retail_value:money(retailValue),account_category_coverage:accounts.length?Math.round(verified/accounts.length*100):0},assumptions:{...result.assumptions,account_scope:accountScope},account_scope:accountScope,account_opportunities:accounts,category_totals:Object.entries(categoryTotals).map(([category,value])=>({category,base_manufacturer_revenue:money(value)})).sort((a,b)=>b.base_manufacturer_revenue-a.base_manufacturer_revenue)};
}

export function normalizeAccountScope(input={}){
  const mode=ACCOUNT_SCOPE_MODES.has(clean(input.mode))?clean(input.mode):'recommended',rawLimit=input.maximum_relevant_accounts,limit=rawLimit===null||rawLimit===undefined||String(rawLimit).toLowerCase()==='all'?null:Number(rawLimit),custom_account_ids=[...new Set((Array.isArray(input.custom_account_ids)?input.custom_account_ids:[]).map(String).filter(Boolean))].slice(0,500);
  if(limit!==null&&!ACCOUNT_LIMITS.has(limit))throw new Error('Maximum Relevant Accounts must be 25, 50, 100, 150, 200, or All Relevant');
  if(mode!=='recommended'&&!custom_account_ids.length)throw new Error('Select at least one custom account for this Account Scope mode');
  return {mode,maximum_relevant_accounts:limit,custom_account_ids};
}

export function applyAccountScope(result,rawScope={}){
  const scope=normalizeAccountScope(rawScope),ranked=[...(result.account_opportunities||[])].sort(compareAccountRank),recommendedPool=ranked.filter(account=>account.recommendation_eligible!==false),customIds=new Set(scope.custom_account_ids),recommendedLimit=scope.maximum_relevant_accounts===null?recommendedPool.length:scope.maximum_relevant_accounts,recommended=scope.mode==='custom_only'?[]:recommendedPool.slice(0,recommendedLimit),recommendedIds=new Set(recommended.map(account=>String(account.organization_id))),custom=scope.mode==='recommended'?[]:ranked.filter(account=>customIds.has(String(account.organization_id))&&!recommendedIds.has(String(account.organization_id))),selected=scope.mode==='custom_only'?ranked.filter(account=>customIds.has(String(account.organization_id))):[...recommended,...custom],accounts=selected.sort(compareAccountRank).map(account=>{const manuallyIncluded=customIds.has(String(account.organization_id)),systemRecommended=recommendedIds.has(String(account.organization_id));return {...account,scope_source:systemRecommended&&manuallyIncluded?'RECOMMENDED_AND_CUSTOM':systemRecommended?'RECOMMENDED':'CUSTOM',system_recommended:systemRecommended,manually_included:manuallyIncluded}}),accountScope={...scope,recommended_count:recommended.length,custom_count:custom.length,total_count:accounts.length,display_summary:`${recommended.length} recommended + ${custom.length} custom = ${accounts.length} accounts analyzed`};
  return scopedTotals(result,accounts,accountScope);
}

export function calculateMultiRouteMarketOpportunity({products=[],organizations=[],routes=['retail'],assumptions={},evidenceByOrganization=new Map(),buyersByOrganization=new Map(),accountScope={}}={}){
  const selected=[...new Set((Array.isArray(routes)?routes:[routes]).map(clean).filter(route=>ROUTES.has(route)))];
  if(!selected.length)throw new Error('Choose at least one supported route to market');
  const normalizedScope=normalizeAccountScope(accountScope),forcedOrganizationIds=normalizedScope.mode==='recommended'?[]:normalizedScope.custom_account_ids,effective=selected.includes('mixed')?['mixed']:selected,results=effective.map(route=>({route,result:calculateMarketOpportunity({products,organizations,route,assumptions,evidenceByOrganization,buyersByOrganization,forcedOrganizationIds})}));
  const accounts=new Map();for(const {route,result} of results)for(const account of result.account_opportunities){const key=String(account.organization_id),existing=accounts.get(key),routesForAccount=[...new Set([...(existing?.routes_to_market||[]),route])],candidate={...account,route_to_market:route,routes_to_market:routesForAccount,recommendation_eligible:Boolean(account.recommendation_eligible||existing?.recommendation_eligible)};if(!existing||candidate.base_manufacturer_revenue>existing.base_manufacturer_revenue)accounts.set(key,candidate);else accounts.set(key,{...existing,routes_to_market:routesForAccount,recommendation_eligible:candidate.recommendation_eligible})}
  const accountOpportunities=[...accounts.values()].sort(compareAccountRank),base=accountOpportunities.reduce((sum,x)=>sum+x.base_manufacturer_revenue,0),low=accountOpportunities.reduce((sum,x)=>sum+x.low_manufacturer_revenue,0),high=accountOpportunities.reduce((sum,x)=>sum+x.high_manufacturer_revenue,0),evidenceBacked=accountOpportunities.reduce((sum,x)=>sum+x.evidence_backed_manufacturer_revenue,0),retailValue=accountOpportunities.reduce((sum,x)=>sum+x.base_retail_value,0),verified=accountOpportunities.filter(x=>x.evidence_status==='VERIFIED').length,categoryTotals={};
  for(const account of accountOpportunities)for(const item of account.product_contributions||[]){const category=item.product_category||'Uncategorized';categoryTotals[category]=(categoryTotals[category]||0)+(Number(item.base_manufacturer_revenue)||0)}
  const storageRoute=effective.length===1?effective[0]:'mixed',warnings=[...new Set(results.flatMap(x=>x.result.warnings))];if(effective.length>1)warnings.push('Accounts eligible through multiple selected routes are counted once using the strongest modeled route opportunity.');
  return applyAccountScope({summary:{selected_product_count:products.length,priced_sku_count:Math.max(0,...results.map(x=>x.result.summary.priced_sku_count)),target_account_count:accountOpportunities.length,verified_account_count:verified,low_manufacturer_revenue:money(low),base_manufacturer_revenue:money(base),high_manufacturer_revenue:money(high),evidence_backed_manufacturer_revenue:money(evidenceBacked),base_retail_value:money(retailValue),account_category_coverage:accountOpportunities.length?Math.round(verified/accountOpportunities.length*100):0},assumptions:{...assumptions,route_to_market:storageRoute,routes_to_market:selected,annual_units_per_location:Number(assumptions.annual_units_per_location)||0,units_per_account:Number(assumptions.units_per_account)||0,distribution_probability:Number(assumptions.distribution_probability)||0,win_probability:Number(assumptions.win_probability)||0,provenance:'USER_PROVIDED'},account_opportunities:accountOpportunities,category_totals:Object.entries(categoryTotals).map(([category,value])=>({category,base_manufacturer_revenue:money(value)})).sort((a,b)=>b.base_manufacturer_revenue-a.base_manufacturer_revenue),warnings},normalizedScope);
}

function retainAccountEdits(nextScenario,previousScenario={}){
  const proposed=Array.isArray(previousScenario.proposed_assortment)?previousScenario.proposed_assortment:null,previousAdjustment=previousScenario.account_adjustment||null;
  if(!proposed&&!previousAdjustment&&!previousScenario.assigned_buyer&&!previousScenario.comparison_status&&!previousScenario.competitive_channel_status)return nextScenario;
  const detailedRevenue=proposed?money(proposed.reduce((sum,item)=>sum+(Number(item?.annual_revenue)||0),0)):null;
  const modelGenerated=detailedRevenue??nextScenario.account.base_manufacturer_revenue;
  const adjustment=previousAdjustment?{...previousAdjustment,model_generated_annual_revenue:modelGenerated}:null;
  const appliedRevenue=adjustment?.manual_annual_revenue??modelGenerated,low=Number(nextScenario.assumptions?.low_multiplier)||.65,high=Number(nextScenario.assumptions?.high_multiplier)||1.35;
  const account={...nextScenario.account,...(proposed?{product_contributions:proposed}:{}),base_manufacturer_revenue:money(appliedRevenue),low_manufacturer_revenue:money(appliedRevenue*low),high_manufacturer_revenue:money(appliedRevenue*high),evidence_backed_manufacturer_revenue:nextScenario.account.evidence_status==='VERIFIED'?money(appliedRevenue):0};
  return {...nextScenario,account,...(proposed?{proposed_assortment:proposed,volume_model:previousScenario.volume_model||{basis:'account_sku_monthly_units_x_dealer_cost',annual_manufacturer_revenue:detailedRevenue}}:{}),...(adjustment?{account_adjustment:adjustment}:{}),...(previousScenario.assigned_buyer?{assigned_buyer:previousScenario.assigned_buyer,buyer_assigned_at:previousScenario.buyer_assigned_at}:{}),...(previousScenario.comparison_status?{comparison_status:previousScenario.comparison_status,comparison_status_updated_at:previousScenario.comparison_status_updated_at}:{}),...(previousScenario.competitive_channel_status?{competitive_channel_status:previousScenario.competitive_channel_status,competitive_channel_status_updated_at:previousScenario.competitive_channel_status_updated_at}:{}),assortment_updated_at:previousScenario.assortment_updated_at||undefined};
}

async function persistWorkspaces(sql,{tenant,productIds,route,result}){
  const manufacturerId=tenant.tenant_id,routeScope=[...(result?.assumptions?.routes_to_market||[route])].map(String).sort().join('+'),accountScope=result.account_scope||{},accountScopeKey=`${accountScope.mode||'recommended'}:${accountScope.maximum_relevant_accounts??'all'}:${[...(accountScope.custom_account_ids||[])].map(String).sort().join(',')}`,scopeKey=tenant.user_id?`user:${tenant.user_id}`:'platform',key=`${[...productIds].map(String).sort().join('|')}::routes=${routeScope}::accounts=${accountScopeKey}::scope=${scopeKey}`,saved=[];
  const existingRows=await sql`select organization_id,scenario from opportunity_workspaces where manufacturer_id=${manufacturerId} and route_to_market=${route} and product_set_key=${key}`;
  const existingByOrganization=new Map(existingRows.map(row=>[String(row.organization_id),row.scenario||{}]));
  await sql.begin(async tx=>{
    for(const account of result.account_opportunities.slice(0,250)){
      const evidenceReady=account.evidence_status==='VERIFIED',recommended=account.product_contributions.slice().sort((a,b)=>b.base_manufacturer_revenue-a.base_manufacturer_revenue)[0]||null;
      const calculatedScenario={model:'MODELED_ADDRESSABLE_OPPORTUNITY',account,summary:result.summary,assumptions:result.assumptions,recommended_sku:recommended?{product_id:recommended.product_id,product_name:recommended.product_name,brand_name:recommended.brand_name,sku:recommended.sku,wholesale:recommended.wholesale,fit_reason:recommended.fit_reason}:null,generated_at:new Date().toISOString()};
      const scenario=retainAccountEdits(calculatedScenario,existingByOrganization.get(String(account.organization_id)));
      const nextAction=evidenceReady?'Review the evidence, buyer coverage, and recommended SKU for approval':'Run product research and approve relevant assortment evidence';
      const row=(await tx`insert into opportunity_workspaces(manufacturer_id,organization_id,account_id,route_to_market,product_set_key,product_ids,status,priority,next_action,scenario,owner_user_id,visibility,updated_at) values(${manufacturerId},${account.organization_id},(select id from accounts where organization_id=${account.organization_id} limit 1),${route},${key},${tx.json(productIds)},${evidenceReady?'ready':'research_required'},${evidenceReady?'high':'medium'},${nextAction},${tx.json(scenario)},${tenant.user_id},'private',now()) on conflict(manufacturer_id,organization_id,route_to_market,product_set_key) do update set account_id=excluded.account_id,product_ids=excluded.product_ids,status=case when opportunity_workspaces.status='approved' then 'approved' else excluded.status end,priority=case when opportunity_workspaces.status='approved' then opportunity_workspaces.priority else excluded.priority end,next_action=case when opportunity_workspaces.status='approved' then opportunity_workspaces.next_action else excluded.next_action end,scenario=excluded.scenario,updated_at=now() returning id,organization_id,status`)[0];
      saved.push(row);
    }
  });
  return saved;
}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.body?.analysis_mode==='deep_market'&&!requireCapability(tenant,res,CAPABILITIES.DEEP_MARKET_ANALYSIS))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const productIds=[...new Set((req.body?.product_ids||[]).map(String).filter(Boolean))];
  if(!productIds.length||productIds.length>100)return res.status(400).json({error:'Select between 1 and 100 products'});
  const requestedRoutes=Array.isArray(req.body?.routes_to_market)?req.body.routes_to_market:[req.body?.route_to_market||'retail'],routes=[...new Set(requestedRoutes.map(clean).filter(Boolean))];if(!routes.length||routes.some(route=>!ROUTES.has(route)))return res.status(400).json({error:'Choose one or more supported routes to market'});const route=routes.length===1?routes[0]:'mixed';
  let accountScope;try{accountScope=normalizeAccountScope(req.body?.account_scope||{})}catch(error){return res.status(400).json({error:error.message})}
  try{
    const sql=db();
    const teamIds=tenant.team_ids||[],admin=canSeeAllTenantData(tenant),productRows=admin?await sql`select p.*,b.name brand_name,coalesce((select array_agg(category) from product_categories pc where pc.product_id=p.id),'{}') categories,coalesce((select array_agg(c.code) from product_channels pc join channels c on c.id=pc.channel_id where pc.product_id=p.id),'{}') channels from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true`:await sql`select p.*,b.name brand_name,coalesce((select array_agg(category) from product_categories pc where pc.product_id=p.id),'{}') categories,coalesce((select array_agg(c.code) from product_channels pc join channels c on c.id=pc.channel_id where pc.product_id=p.id),'{}') channels from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true and (p.owner_user_id=${tenant.user_id} or (p.visibility='team' and p.team_id=any(${teamIds}::uuid[])) or (p.visibility='tenant' and p.owner_user_id is null and p.team_id is null))`;
    const selected=productRows.filter(p=>productIds.includes(String(p.id)));
    if(selected.length!==productIds.length)return res.status(404).json({error:'One or more products were not found for this tenant'});
    const variants=await sql`select pv.* from product_variants pv join products p on p.id=pv.product_id where p.manufacturer_id=${tenant.tenant_id} and p.active=true and pv.active=true`;
    const hydrated=selected.map(p=>({...p,variants:variants.filter(v=>String(v.product_id)===String(p.id))}));
    const [organizations,evidenceRows,buyerRows]=await Promise.all([sql`select * from retail_organizations where active=true order by confidence desc,name limit 5000`,sql`with latest as(select distinct on(ce.subject_type,ce.subject_key) ce.*,es.source_url from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.organization_id is not null and ce.subject_type='retailer_assortment' and ce.observed_at>=now()-interval '365 days' order by ce.subject_type,ce.subject_key,ce.observed_at desc) select organization_id,payload,source_url,observed_at,last_verified_at,confidence,verification_status from latest where verification_status in ('VERIFIED','REVIEW_REQUIRED') order by observed_at desc limit 10000`,sql`select a.organization_id,b.id,b.name,b.title,b.email,b.phone,b.linkedin,b.category,b.source_url,b.confidence,b.verification_status,b.status,b.updated_at from accounts a join buyers b on b.account_id=a.id where a.organization_id is not null order by b.confidence desc,b.updated_at desc limit 10000`]);
    const availableIds=new Set(organizations.map(row=>String(row.id))),missingCustomIds=accountScope.custom_account_ids.filter(id=>!availableIds.has(id));if(missingCustomIds.length)return res.status(404).json({error:'One or more custom accounts are not available in the authenticated Account Universe'});
    const result=calculateMultiRouteMarketOpportunity({products:hydrated,organizations,routes,assumptions:req.body?.assumptions||{},evidenceByOrganization:evidenceProfiles(evidenceRows),buyersByOrganization:buyerProfiles(buyerRows),accountScope});
    let workspaces=[],persistence_status='SAVED';try{workspaces=await persistWorkspaces(sql,{tenant,productIds,route,result})}catch(error){if(error?.code==='42P01'){persistence_status='SCHEMA_REQUIRED';result.warnings.push('The scenario was calculated, but workspaces were not saved. Open System Status and initialize the missing schema.')}else throw error}
    console.log('[market-opportunity] completed',{products:productIds.length,routes,storage_route:route,accounts:result.summary.target_account_count,verified:result.summary.verified_account_count,with_buyers:result.account_opportunities.filter(x=>x.buyer_count>0).length,persistence_status});
    const selected_products=hydrated.map(p=>({id:p.id,brand_name:p.brand_name||'',name:p.name,product_family:p.product_family||'',category:p.category||'',categories:p.categories||[],skus:(p.variants||[]).map(v=>({sku:v.sku||v.variant_name||'',msrp:Number(v.msrp)||0,wholesale:Number(v.wholesale)||0}))}));
    return res.status(200).json({version:'9.8.3',model:'MODELED_ADDRESSABLE_OPPORTUNITY',selected_products,...result,workspaces,persistence_status});
  }catch(e){console.error('market opportunity failed',{message:e?.message||String(e)});return res.status(500).json({error:'Market opportunity could not be calculated',code:'MARKET_OPPORTUNITY_FAILED'});}
}
