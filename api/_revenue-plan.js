import { categoryConcepts } from './_account-fit.js';

const clean=(value,max=400)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const status=value=>clean(value,60).toUpperCase().replaceAll(' ','_')||'UNKNOWN';
const bounded=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
const round=value=>Math.round((Number(value)||0)*100)/100;
const dateValue=value=>{const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?parsed:0};
const verified=value=>['VERIFIED','PROBABLE'].includes(status(value));
const activeBuyer=buyer=>!['STALE','CONFLICTING'].includes(status(buyer?.employment_verification_status||buyer?.verification_status));
const concepts=values=>new Set(categoryConcepts(values.filter(Boolean)));
const overlap=(left,right)=>[...left].some(value=>right.has(value));
const TOKENS_TO_IGNORE=new Set(['and','the','for','with','from','your','product','products','series','system','model','retail','consumer','professional','home']);
const tokens=values=>new Set(values.flatMap(value=>clean(value,400).toLowerCase().split(/[^a-z0-9]+/)).filter(value=>value.length>2&&!TOKENS_TO_IGNORE.has(value)));

function parseContext(value){
  if(value&&typeof value==='object')return value;
  try{return JSON.parse(String(value||'{}'))||{}}catch{return {}}
}

function accountProductTerms(account={}){
  return (account.product_contributions||[]).flatMap(item=>[item.product_name,item.product_family,item.product_category,...(item.product_categories||[])]).filter(Boolean);
}

export function selectRevenuePlanBuyer(buyers=[],productTerms=[]){
  const desiredConcepts=concepts(productTerms),desiredTokens=tokens(productTerms);
  const ranked=(buyers||[]).filter(buyer=>buyer?.name&&activeBuyer(buyer)).map((buyer,index)=>{
    const buyerTerms=[buyer.department,buyer.category_scope,buyer.category,buyer.subcategory_scope].filter(Boolean),buyerConcepts=concepts(buyerTerms),buyerTokens=tokens(buyerTerms),aligned=overlap(desiredConcepts,buyerConcepts)||[...desiredTokens].some(token=>buyerTokens.has(token)),categoryVerified=verified(buyer.category_verification_status)&&Number(buyer.category_confidence)>=60,identityVerified=verified(buyer.employment_verification_status||buyer.verification_status)&&Number(buyer.identity_confidence??buyer.confidence)>=60,role=/DIRECT_BUYER|CATEGORY_OWNER|MERCHANT|MERCHANDISING_LEADER/.test(status(buyer.buyer_role)),score=(aligned?300:0)+(categoryVerified?180:0)+(identityVerified?80:0)+(role?40:0)+bounded(buyer.category_confidence)+bounded(buyer.identity_confidence??buyer.confidence);
    return {buyer,index,score,aligned,categoryVerified,identityVerified};
  }).sort((a,b)=>b.score-a.score||a.index-b.index||String(a.buyer.name).localeCompare(String(b.buyer.name)));
  const selected=ranked[0];
  if(!selected)return null;
  const buyer=selected.buyer,ownershipConfirmed=selected.aligned&&selected.categoryVerified&&selected.identityVerified;
  return {id:buyer.id||null,name:clean(buyer.name,180),title:clean(buyer.title,220),email:clean(buyer.email,220),phone:clean(buyer.phone,80),linkedin:clean(buyer.linkedin,700),department:clean(buyer.department,180),category_scope:ownershipConfirmed?clean(buyer.category_scope||buyer.category,240):'',subcategory_scope:ownershipConfirmed?clean(buyer.subcategory_scope,240):'',buyer_role:clean(buyer.buyer_role,80)||'UNCONFIRMED',identity_confidence:bounded(buyer.identity_confidence??buyer.confidence),category_confidence:ownershipConfirmed?bounded(buyer.category_confidence):0,identity_verification_status:status(buyer.employment_verification_status||buyer.verification_status),category_verification_status:ownershipConfirmed?status(buyer.category_verification_status):'UNCONFIRMED',category_aligned:selected.aligned,ownership_confirmed:ownershipConfirmed,source_url:clean(buyer.employment_evidence_url||buyer.source_url,700),category_evidence_url:ownershipConfirmed?clean(buyer.category_evidence_url,700):''};
}

export function estimateRetailerMargin(contributions=[]){
  const estimates=(contributions||[]).map(item=>{
    const wholesale=Math.max(0,Number(item.wholesale??item.dealer_cost)||0),map=Math.max(0,Number(item.map)||0),msrp=Math.max(0,Number(item.msrp??item.retail_price)||0),retailPrice=map||msrp;
    if(!wholesale||!retailPrice||wholesale>retailPrice)return null;
    return {product_id:item.product_id||null,product_name:clean(item.product_name,220),brand_name:clean(item.brand_name,160),sku:clean(item.sku,160),wholesale:round(wholesale),retail_price:round(retailPrice),retail_price_basis:map?'MAP':'MSRP',estimated_margin_dollars:round(retailPrice-wholesale),estimated_margin_percent:round((retailPrice-wholesale)/retailPrice*100),confidence:item.wholesale_source==='catalog_wholesale'?'CATALOG_PRICING':'MODELED_LOW_CONFIDENCE'};
  }).filter(Boolean),percents=estimates.map(item=>item.estimated_margin_percent);
  if(!estimates.length)return {status:'UNAVAILABLE',classification:'MODELED_ESTIMATE',basis:'Catalog MAP or MSRP less wholesale cost',average_percent:null,min_percent:null,max_percent:null,sku_estimates:[]};
  return {status:'AVAILABLE',classification:'MODELED_ESTIMATE',basis:'Catalog MAP or MSRP less wholesale cost; not a negotiated or verified retailer margin',average_percent:round(percents.reduce((sum,value)=>sum+value,0)/percents.length),min_percent:Math.min(...percents),max_percent:Math.max(...percents),sku_estimates:estimates};
}

function competitiveRelevant(row,account){
  const context=parseContext(row.raw_text||row.research_context),selectedIds=new Set((account.product_contributions||[]).map(item=>String(item.product_id||'')).filter(Boolean)),linked=(context.comparison_product_ids||row.comparison_product_ids||[]).map(String);
  if(linked.some(id=>selectedIds.has(id)))return true;
  const selectedTerms=accountProductTerms(account),offeringTerms=[row.product_name||row.name,row.category].filter(Boolean);
  if(!selectedTerms.length||!offeringTerms.length)return false;
  const selectedConcepts=concepts(selectedTerms),offeringConcepts=concepts(offeringTerms);
  if(overlap(selectedConcepts,offeringConcepts))return true;
  const selectedTokens=tokens(selectedTerms),offeringTokens=tokens(offeringTerms);
  return [...selectedTokens].some(token=>offeringTokens.has(token));
}

export function buildCompetitiveLandscape(rows=[],account={}){
  const products=(rows||[]).filter(row=>competitiveRelevant(row,account)).map(row=>{
    const context=parseContext(row.raw_text||row.research_context),purchaseChannel=status(context.purchase_channel||row.purchase_channel),storeVerification=status(context.store_verification||row.store_verification),online=context.online===true||/ONLINE|OMNICHANNEL/.test(purchaseChannel),inStore=context.in_store===true||/CONFIRMED_AT_LOCATION|IN_STORE_CONFIRMED|OMNICHANNEL_CONFIRMED/.test(`${storeVerification} ${purchaseChannel}`);
    return {id:row.id||null,brand:clean(row.brand,160),name:clean(row.product_name||row.name,240),sku:clean(context.sku||row.sku,160),category:clean(row.category,180),price_text:clean(row.price_text,80),price_numeric:round(row.price_numeric),availability:clean(row.availability,180),online,in_store:inStore,store_count:Math.max(0,Number(context.store_count)||0),purchase_channel:purchaseChannel,store_verification:storeVerification,source_url:clean(row.source_url,900),verification_status:status(row.verification_status),observed_at:row.observed_at||null,last_verified_at:row.last_verified_at||null};
  }).sort((a,b)=>Number(b.verification_status==='VERIFIED')-Number(a.verification_status==='VERIFIED')||dateValue(b.last_verified_at||b.observed_at)-dateValue(a.last_verified_at||a.observed_at)||`${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`,undefined,{sensitivity:'base',numeric:true})).slice(0,20);
  return {products,total_count:products.length,verified_count:products.filter(product=>product.verification_status==='VERIFIED').length,online_count:products.filter(product=>product.online).length,in_store_count:products.filter(product=>product.in_store).length,channel_unknown_count:products.filter(product=>!product.online&&!product.in_store).length};
}

export function buildExecutiveActions(account={}){
  const buyer=account.primary_buyer,competition=account.competitive_landscape||{},margin=account.estimated_retailer_margin||{},actions=[];
  if(!competition.total_count)actions.push({priority:'HIGH',action:'Refresh the category-relevant competitive assortment',reason:'No attributable comparable products are saved for this account',owner:'Sales intelligence'});
  if(!buyer?.ownership_confirmed)actions.push({priority:'HIGH',action:'Confirm the current category buyer or merchant',reason:buyer?'A buyer is known, but category ownership is not verified':'No category-aligned buyer is saved',owner:'Account owner'});
  if(competition.total_count&&!competition.in_store_count)actions.push({priority:'MEDIUM',action:'Verify in-store placement and local availability',reason:'Competitive products are saved, but physical placement is not confirmed',owner:'Sales intelligence'});
  if(margin.status!=='AVAILABLE')actions.push({priority:'MEDIUM',action:'Complete MAP/MSRP and wholesale pricing',reason:'A retailer-margin estimate cannot be calculated from the current catalog',owner:'Sales operations'});
  else actions.push({priority:'MEDIUM',action:`Validate the modeled ${margin.min_percent===margin.max_percent?`${margin.average_percent}%`:`${margin.min_percent}%–${margin.max_percent}%`} retailer-margin range`,reason:'Catalog pricing is planning guidance and must be confirmed against account terms',owner:'Account owner'});
  actions.push({priority:'FINAL',action:'Review the account plan and approve outreach',reason:'Commercial outreach remains a human decision after buyer, assortment and margin review',owner:'Sales leader',approval_required:true});
  return {objective:`Advance ${clean(account.name,220)} with the selected SKU portfolio`,next_action:actions[0]?.action||'Review account plan',actions};
}

export function assembleRevenuePlan(result={},competitiveRows=[]){
  const byOrganization=new Map();
  for(const row of competitiveRows||[]){const key=String(row.organization_id||'');if(!key)continue;const current=byOrganization.get(key)||[];current.push(row);byOrganization.set(key,current)}
  const accounts=(result.account_opportunities||[]).map(account=>{
    const primaryBuyer=selectRevenuePlanBuyer(account.buyers||[],accountProductTerms(account)),competitiveLandscape=buildCompetitiveLandscape(byOrganization.get(String(account.organization_id))||[],account),estimatedRetailerMargin=estimateRetailerMargin(account.product_contributions||[]),enriched={...account,primary_buyer:primaryBuyer,competitive_landscape:competitiveLandscape,estimated_retailer_margin:estimatedRetailerMargin};
    return {...enriched,executive_action_plan:buildExecutiveActions(enriched)};
  });
  const priorityAccounts=accounts.slice(0,10).map(account=>({organization_id:account.organization_id,name:account.name,fit_score:account.fit_score,annual_opportunity:account.base_manufacturer_revenue,buyer:account.primary_buyer?.ownership_confirmed?account.primary_buyer.name:'',competitive_products:account.competitive_landscape.total_count,estimated_retailer_margin_percent:account.estimated_retailer_margin.average_percent,next_action:account.executive_action_plan.next_action}));
  return {...result,account_opportunities:accounts,executive_plan:{classification:'DETERMINISTIC_COMMERCIAL_PLAN',generated_at:new Date().toISOString(),target_account_count:accounts.length,accounts_with_confirmed_category_buyer:accounts.filter(account=>account.primary_buyer?.ownership_confirmed).length,accounts_with_competitive_landscape:accounts.filter(account=>account.competitive_landscape.total_count>0).length,accounts_with_margin_estimate:accounts.filter(account=>account.estimated_retailer_margin.status==='AVAILABLE').length,priority_accounts:priorityAccounts,sequence:['Confirm target-account fit','Verify competitive assortment and channel placement','Confirm the category owner','Validate retailer margin and volume assumptions','Approve executive outreach plan'],research_policy:'Existing tenant and public intelligence is returned immediately. Paid or slow research is never run by the standard plan request.'}};
}
