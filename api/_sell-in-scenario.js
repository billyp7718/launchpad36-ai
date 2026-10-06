const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const bounded=(value,min,max,fallback=0)=>{const number=Number(value);return Number.isFinite(number)?Math.min(max,Math.max(min,number)):fallback};
const money=value=>Math.round(bounded(value,0,1000000000000)*100)/100;
const integer=(value,min,max,fallback=0)=>Math.round(bounded(value,min,max,fallback));
const TYPES=new Set(['conservative','regional_pilot','recommended','national_rollout','custom']);
const DEPLOYMENTS=new Set(['online_only','pilot','regional','national']);

const skuKey=item=>`${String(item?.product_id||'')}::${String(item?.sku||'')}`;

export function buildSellInScenario({input={},assortment=[],accountFootprint=1}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Scenario details are required'),{status:400});
  const name=clean(input.name,180);if(!name)throw Object.assign(new Error('Scenario name is required'),{status:400});
  const scenarioType=input.scenario_type===undefined?'custom':input.scenario_type,deploymentType=input.deployment_type===undefined?'pilot':input.deployment_type;
  if(!TYPES.has(scenarioType))throw Object.assign(new Error('Choose a supported scenario type'),{status:400});if(!DEPLOYMENTS.has(deploymentType))throw Object.assign(new Error('Choose a supported deployment type'),{status:400});
  const available=new Map((Array.isArray(assortment)?assortment:[]).map(item=>[skuKey(item),item])),requested=Array.isArray(input.selected_skus)?input.selected_skus:[];
  if(!requested.length)throw Object.assign(new Error('Select at least one opportunity SKU'),{status:400});
  if(requested.length>100)throw Object.assign(new Error('A sell-in scenario can contain no more than 100 SKUs'),{status:400});
  const storeCount=deploymentType==='online_only'?1:integer(input.store_count,1,100000,Math.max(1,Number(accountFootprint)||1));
  const seen=new Set();for(const item of requested){const key=skuKey(item);if(seen.has(key))throw Object.assign(new Error('Each opportunity SKU can appear only once in a scenario'),{status:400});seen.add(key)}
  const lineItems=requested.map((item,index)=>{
    const baseline=available.get(skuKey(item));if(!baseline)throw Object.assign(new Error(`Scenario SKU ${index+1} is not part of this opportunity`),{status:400});
    const dealerCost=money(Object.prototype.hasOwnProperty.call(item,'dealer_cost')?item.dealer_cost:(baseline.dealer_cost??baseline.wholesale));
    const msrp=money(Object.prototype.hasOwnProperty.call(item,'msrp')?item.msrp:(baseline.retail_price??baseline.msrp));
    const promotionalRetailPrice=money(item.promotional_retail_price),effectiveRetailPrice=promotionalRetailPrice||msrp,monthlyUnitsPerStore=integer(item.monthly_units_per_store??item.monthly_sales_volume,0,1000000),monthlyUnits=monthlyUnitsPerStore*storeCount,monthlyWholesaleRevenue=money(dealerCost*monthlyUnits),annualWholesaleRevenue=money(monthlyWholesaleRevenue*12),annualRetailSellThrough=money(effectiveRetailPrice*monthlyUnits*12),retailerMargin=effectiveRetailPrice>0?Math.round(((effectiveRetailPrice-dealerCost)/effectiveRetailPrice)*10000)/100:null;
    return {product_id:String(baseline.product_id),product_name:clean(baseline.product_name||baseline.name,220),brand_name:clean(baseline.brand_name||baseline.brand,180),sku:clean(baseline.sku,160),msrp,dealer_cost:dealerCost,promotional_retail_price:promotionalRetailPrice||null,effective_retail_price:effectiveRetailPrice,retailer_margin_percent:retailerMargin,monthly_units_per_store:monthlyUnitsPerStore,store_count:storeCount,expected_monthly_units:monthlyUnits,expected_monthly_wholesale_revenue:monthlyWholesaleRevenue,expected_annual_wholesale_revenue:annualWholesaleRevenue,modeled_annual_retail_sell_through:annualRetailSellThrough,notes:clean(item.notes,500)};
  });
  const total=(field)=>money(lineItems.reduce((sum,item)=>sum+(Number(item[field])||0),0)),confidence=integer(input.confidence,0,100,0),warnings=[];
  if(lineItems.some(item=>!item.dealer_cost))warnings.push('One or more SKUs have no retailer/dealer cost, so wholesale revenue is incomplete.');
  if(lineItems.some(item=>!item.msrp))warnings.push('One or more SKUs have no MSRP, so margin and retail sell-through are incomplete.');
  if(lineItems.some(item=>!item.monthly_units_per_store))warnings.push('One or more SKUs have zero monthly units per store.');
  const launchDate=clean(input.launch_date,20);if(launchDate&&!/^\d{4}-\d{2}-\d{2}$/.test(launchDate))throw Object.assign(new Error('Launch date must use YYYY-MM-DD'),{status:400});
  const assumptions={store_count:storeCount,online_only:deploymentType==='online_only',in_store:deploymentType!=='online_only',pilot_markets:clean(input.pilot_markets,500),regional_rollout:deploymentType==='regional',national_rollout:deploymentType==='national',promotional_period:clean(input.promotional_period,180),launch_date:launchDate,launch_quarter:clean(input.launch_quarter,40),display_assumptions:clean(input.display_assumptions,1000),marketing_assumptions:clean(input.marketing_assumptions,1000),provenance:'USER_ENTERED'};
  return {name,scenario_type:scenarioType,deployment_type:deploymentType,confidence,confidence_status:'USER_ENTERED',notes:clean(input.notes,2000),selected_skus:lineItems,assumptions,totals:{sku_count:lineItems.length,store_count:storeCount,expected_monthly_units:Math.round(lineItems.reduce((sum,item)=>sum+item.expected_monthly_units,0)),expected_monthly_wholesale_revenue:total('expected_monthly_wholesale_revenue'),expected_annual_wholesale_revenue:total('expected_annual_wholesale_revenue'),modeled_annual_retail_sell_through:total('modeled_annual_retail_sell_through')},calculation:{formula:'dealer cost × monthly units per store × store count × 12',revenue_type:'MODELED_MANUFACTURER_WHOLESALE_REVENUE',retail_sell_through_type:'MODELED_NOT_VERIFIED_RETAILER_SALES'},warnings};
}
