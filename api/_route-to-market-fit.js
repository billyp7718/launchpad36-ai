const OPENAI_RESPONSES='https://api.openai.com/v1/responses';
const clean=(v,max=500)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const clamp=n=>Math.max(0,Math.min(100,Math.round(Number(n)||0)));
const skuKey=x=>clean(x?.sku||x?.variant||x?.variant_name||x?.product||x?.name,180);

const SCHEMA={type:'object',additionalProperties:false,properties:{summary:{type:'object',additionalProperties:false,properties:{account_recommendation:{type:'string',enum:['IN_STORE','ONLINE','BOTH','NOT_RECOMMENDED']},account_in_store_fit:{type:'integer'},account_online_fit:{type:'integer'},rationale:{type:'string'}},required:['account_recommendation','account_in_store_fit','account_online_fit','rationale']},sku_recommendations:{type:'array',items:{type:'object',additionalProperties:false,properties:{sku:{type:'string'},product:{type:'string'},recommendation:{type:'string',enum:['IN_STORE','ONLINE','BOTH','NOT_RECOMMENDED']},in_store_fit:{type:'integer'},online_fit:{type:'integer'},confidence:{type:'integer'},rationale:{type:'string'},evidence_signals:{type:'array',items:{type:'string'}}},required:['sku','product','recommendation','in_store_fit','online_fit','confidence','rationale','evidence_signals']}}},required:['summary','sku_recommendations']};

function observedChannelCounts(products=[]){
  let online=0,inStore=0,both=0,unknown=0;
  for(const p of products){const t=`${p.purchase_channel||''} ${p.availability||''} ${p.store_verification||''}`.toUpperCase();if(/OMNICHANNEL|BOTH/.test(t))both++;else if(/IN_STORE|PICKUP|STORE/.test(t))inStore++;else if(/ONLINE|DELIVERY|SHIP|ADD TO CART/.test(t))online++;else unknown++}
  return {online,in_store:inStore,both,unknown,total:products.length};
}

function fallback({account='',retailer_products=[],manufacturer_products=[]}){
  const counts=observedChannelCounts(retailer_products),hasStore=counts.in_store+counts.both>0,hasOnline=counts.online+counts.both>0;
  const recs=(manufacturer_products||[]).flatMap(p=>(p.variants||[]).length?(p.variants||[]).filter(v=>v.active!==false).map(v=>({p,v})):[{p,v:{sku:p.sku||p.name,msrp:p.msrp,map:p.map}}]).map(({p,v})=>{
    const price=Number(v.msrp||v.map||0),category=clean(p.category||p.product_family,120).toLowerCase(),bulky=/desk|furniture|floorstanding|large|commercial|rack/.test(`${category} ${p.name||''}`.toLowerCase());
    let online=hasOnline?82:68,inStore=hasStore?78:55;if(price>500)inStore-=8;if(price>1200)inStore-=10;if(bulky)inStore-=12,online+=5;if(counts.total===0)online-=8,inStore-=10;
    online=clamp(online);inStore=clamp(inStore);const recommendation=inStore>=70&&online>=70?'BOTH':online>=70?'ONLINE':inStore>=70?'IN_STORE':'NOT_RECOMMENDED';
    return {sku:skuKey(v),product:clean(p.name,180),recommendation,in_store_fit:inStore,online_fit:online,confidence:counts.total?65:45,rationale:`Fallback scoring based on observed retailer channel signals${counts.total?` from ${counts.total} comparable product observation(s)`:''}, product price, category, and physical merchandising characteristics.`,evidence_signals:[`Observed online signals: ${counts.online+counts.both}`,`Observed in-store signals: ${counts.in_store+counts.both}`]};
  });
  const avg=k=>recs.length?Math.round(recs.reduce((s,x)=>s+x[k],0)/recs.length):0,ins=avg('in_store_fit'),on=avg('online_fit'),recommendation=ins>=70&&on>=70?'BOTH':on>=70?'ONLINE':ins>=70?'IN_STORE':'NOT_RECOMMENDED';
  return {source:'HEURISTIC_FALLBACK',model:null,summary:{account_recommendation:recommendation,account_in_store_fit:ins,account_online_fit:on,rationale:`AI service was unavailable, so Launchpad36 used an evidence-based fallback for ${account||'this account'}.`},sku_recommendations:recs,observed_channel_signals:counts};
}

export async function evaluateRouteToMarketFit(input={}){
  const account=clean(input.account,180),domain=clean(input.domain,180),category=clean(input.category,180),retailerProducts=Array.isArray(input.retailer_products)?input.retailer_products.slice(0,60):[],manufacturerProducts=Array.isArray(input.manufacturer_products)?input.manufacturer_products.slice(0,30):[],counts=observedChannelCounts(retailerProducts);
  if(!manufacturerProducts.length)return {...fallback({account,retailer_products:retailerProducts,manufacturer_products:manufacturerProducts}),source:'NO_PRODUCTS'};
  const key=process.env.OPENAI_API_KEY;if(!key)return fallback({account,retailer_products:retailerProducts,manufacturer_products:manufacturerProducts});
  const model=clean(process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6',80);
  const manufacturer=manufacturerProducts.map(p=>({name:clean(p.name,180),category:clean(p.category||p.product_family,140),positioning:clean(p.positioning,300),differentiator:clean(p.differentiator,300),variants:(p.variants||[]).filter(v=>v.active!==false).slice(0,12).map(v=>({sku:skuKey(v),variant:clean(v.variant_name,120),msrp:Number(v.msrp)||null,map:Number(v.map)||null,wholesale:Number(v.wholesale)||null,attributes:v.attributes||{}}))}));
  const observations=retailerProducts.map(p=>({brand:clean(p.brand,120),name:clean(p.product_name||p.name,180),category:clean(p.category,140),price:Number(p.price_numeric||p.price)||null,availability:clean(p.availability,120),purchase_channel:clean(p.purchase_channel||p.research_context?.purchase_channel,80),store_verification:clean(p.store_verification||p.research_context?.store_verification,80)}));
  const prompt=`Act as a retail channel-strategy analyst. Decide whether each proposed manufacturer SKU fits this retailer IN STORE, ONLINE, BOTH, or NOT RECOMMENDED. Use only the supplied retailer/account profile and observed comparable assortment evidence. Do not assume a product is in-store merely because it is listed online. Score in-store fit and online fit independently from 0-100. Consider retailer format, observed channel behavior, category relevance, price architecture, assortment breadth, physical size/complexity, demonstration value, shelf-space burden, impulse vs considered purchase, ecommerce suitability, and whether the product would logically be a core-store SKU or long-tail online SKU. A high score means the route is commercially appropriate, not that placement is guaranteed. Confidence should reflect evidence strength. Keep rationales concise and commercially specific.\n\nAccount: ${JSON.stringify({account,domain,category,observed_channel_counts:counts})}\nManufacturer products: ${JSON.stringify(manufacturer)}\nObserved retailer products: ${JSON.stringify(observations)}`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),50000);
  try{
    const response=await fetch(OPENAI_RESPONSES,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model,reasoning:{effort:'low'},input:prompt,max_output_tokens:5000,text:{format:{type:'json_schema',name:'route_to_market_fit',strict:true,schema:SCHEMA}}})});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok)throw new Error(clean(body.error?.message||`OpenAI returned ${response.status}`,300));
    let text=body.output_text||'';if(!text)for(const item of body.output||[])for(const part of item.content||[])if(part.type==='output_text')text+=part.text||'';
    const parsed=JSON.parse(text||'{}'),known=new Map();for(const p of manufacturer)for(const v of p.variants||[])known.set(clean(v.sku,180).toLowerCase(),{product:p.name,sku:v.sku});
    const skuRecommendations=(parsed.sku_recommendations||[]).filter(x=>known.has(clean(x.sku,180).toLowerCase())).map(x=>({...x,in_store_fit:clamp(x.in_store_fit),online_fit:clamp(x.online_fit),confidence:clamp(x.confidence),rationale:clean(x.rationale,500),evidence_signals:(x.evidence_signals||[]).map(s=>clean(s,220)).slice(0,6)}));
    return {source:'AI_EVIDENCE_SYNTHESIS',model,response_id:clean(body.id,120),summary:{account_recommendation:parsed.summary.account_recommendation,account_in_store_fit:clamp(parsed.summary.account_in_store_fit),account_online_fit:clamp(parsed.summary.account_online_fit),rationale:clean(parsed.summary.rationale,600)},sku_recommendations:skuRecommendations,observed_channel_signals:counts};
  }catch(error){console.error('[route-to-market-fit] AI evaluation failed',{message:error?.message||String(error)});return {...fallback({account,retailer_products:retailerProducts,manufacturer_products:manufacturerProducts}),ai_error:clean(error?.message||String(error),300)}
  finally{clearTimeout(timeout)}
}
