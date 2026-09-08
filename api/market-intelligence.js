import { requireInternal } from './_auth.js';
import { evaluateRouteToMarketFit } from './_route-to-market-fit.js';

function num(v){const m=String(v||'').match(/[\d,]+(?:\.\d+)?/);return m?Number(m[0].replace(/,/g,'')):null}
function median(a){if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:Math.round(((x[m-1]+x[m])/2)*100)/100}
function cleanBrand(v){return String(v||'').trim()||'Unbranded'}
function isQa(v){let a=v?.attributes||{};try{if(typeof a==='string')a=JSON.parse(a)}catch{}return a?.qa_only===true}
export default async function handler(req,res){
 if(!requireInternal(req,res))return;
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const {account='',domain='',category='',retailer_products=[],manufacturer_products=[]}=req.body||{};
 const rawRetailer=Array.isArray(retailer_products)?retailer_products:[],rawManufacturer=Array.isArray(manufacturer_products)?manufacturer_products:[];
 const observations=rawRetailer.map(p=>({...p,price_numeric:Number(p.price_numeric)||num(p.price_text||p.price)}));
 const prices=observations.map(x=>x.price_numeric).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
 const brandMap=new Map();
 for(const o of observations){const b=cleanBrand(o.brand);if(!brandMap.has(b))brandMap.set(b,[]);brandMap.get(b).push(o)}
 const leading_brands=[...brandMap.entries()].map(([brand,items])=>({brand,count:items.length,median_price:median(items.map(x=>x.price_numeric).filter(x=>Number.isFinite(x)&&x>0))})).sort((a,b)=>b.count-a.count||a.brand.localeCompare(b.brand));
 const whitespace=[];for(let i=1;i<prices.length;i++){const gap=Math.round((prices[i]-prices[i-1])*100)/100;if(gap>=30)whitespace.push({from:prices[i-1],to:prices[i],gap})}
 const commercial=rawManufacturer.flatMap(p=>(p.variants||[]).filter(v=>!isQa(v)&&v.active!==false).map(v=>({product:p.name,category:p.category,sku:v.sku,variant:v.variant_name,msrp:Number(v.msrp||0)||null,map:Number(v.map||0)||null})));
 const commercialProductNames=new Set(commercial.map(x=>x.product));
 const routeProducts=rawManufacturer.filter(p=>commercialProductNames.has(p.name));
 const route_to_market_fit=await evaluateRouteToMarketFit({account,domain,category,retailer_products:observations,manufacturer_products:routeProducts});
 const recommended={IN_STORE:'In Store',ONLINE:'Online',BOTH:'In Store + Online',NOT_RECOMMENDED:'Not Recommended'}[route_to_market_fit?.summary?.account_recommendation]||'Unknown';
 return res.status(200).json({version:'9.8.4',account,domain,category,sample_size:observations.length,brand_count:brandMap.size,price:{min:prices[0]??null,max:prices.at(-1)??null,median:median(prices),observations:prices.length},leading_brands:leading_brands.slice(0,20),price_whitespace:whitespace.sort((a,b)=>b.gap-a.gap).slice(0,10),manufacturer_commercial_skus:commercial.length,route_to_market_fit:{...route_to_market_fit,recommended_placement_label:recommended},evidence_quality:{status:observations.length?'OBSERVED':'UNKNOWN',failure_is_negative_evidence:false},interpretation:observations.length?`Market metrics summarize attributable retailer observations. AI route-to-market fit separately evaluates whether each proposed SKU is commercially appropriate in store, online, both, or neither. The recommendation is decision support, not confirmation of retailer acceptance.`:'No attributable retailer observations were supplied. Route-to-market fit can still use product and account characteristics, but confidence should be treated as lower until competitive assortment evidence is acquired.'});
}
