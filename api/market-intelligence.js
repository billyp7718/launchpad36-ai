import { requireInternal } from './_auth.js';

function num(v){const m=String(v||'').match(/[\d,]+(?:\.\d+)?/);return m?Number(m[0].replace(/,/g,'')):null}
function median(a){if(!a.length)return null;const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);return x.length%2?x[m]:Math.round(((x[m-1]+x[m])/2)*100)/100}
function cleanBrand(v){return String(v||'').trim()||'Unbranded'}
function isQa(v){let a=v?.attributes||{};try{if(typeof a==='string')a=JSON.parse(a)}catch{}return a?.qa_only===true}
export default async function handler(req,res){
 if(!requireInternal(req,res))return;
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const {account='',domain='',category='',retailer_products=[],manufacturer_products=[]}=req.body||{};
 const observations=(Array.isArray(retailer_products)?retailer_products:[]).map(p=>({...p,price_numeric:num(p.price)}));
 const prices=observations.map(x=>x.price_numeric).filter(x=>Number.isFinite(x)&&x>0).sort((a,b)=>a-b);
 const brandMap=new Map();
 for(const o of observations){const b=cleanBrand(o.brand);if(!brandMap.has(b))brandMap.set(b,[]);brandMap.get(b).push(o)}
 const leading_brands=[...brandMap.entries()].map(([brand,items])=>({brand,count:items.length,median_price:median(items.map(x=>x.price_numeric).filter(x=>Number.isFinite(x)&&x>0))})).sort((a,b)=>b.count-a.count||a.brand.localeCompare(b.brand));
 const whitespace=[];for(let i=1;i<prices.length;i++){const gap=Math.round((prices[i]-prices[i-1])*100)/100;if(gap>=30)whitespace.push({from:prices[i-1],to:prices[i],gap})}
 const commercial=(Array.isArray(manufacturer_products)?manufacturer_products:[]).flatMap(p=>(p.variants||[]).filter(v=>!isQa(v)).map(v=>({product:p.name,category:p.category,sku:v.sku,variant:v.variant_name,msrp:Number(v.msrp||0)||null,map:Number(v.map||0)||null})));
 return res.status(200).json({version:'9.7',account,domain,category,sample_size:observations.length,brand_count:brandMap.size,price:{min:prices[0]??null,max:prices.at(-1)??null,median:median(prices),observations:prices.length},leading_brands:leading_brands.slice(0,20),price_whitespace:whitespace.sort((a,b)=>b.gap-a.gap).slice(0,10),manufacturer_commercial_skus:commercial.length,evidence_quality:{status:observations.length?'OBSERVED':'UNKNOWN',failure_is_negative_evidence:false},interpretation:observations.length?'Market metrics summarize attributable retailer observations only. They are not estimates of total market share or national physical distribution.':'No attributable retailer observations were supplied. Market state remains UNKNOWN; absence of acquired evidence is not evidence of absence.'});
}
