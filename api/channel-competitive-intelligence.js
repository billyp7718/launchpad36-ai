import { requireInternal } from './_auth.js';

function num(v){const m=String(v||'').match(/[\d,]+(?:\.\d+)?/);return m?Number(m[0].replace(/,/g,'')):null}
function attrs(v){try{return typeof v==='string'?JSON.parse(v||'{}'):(v||{})}catch{return {}}}
function words(s){return new Set(String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>2))}
function sim(a,b){const A=words(a),B=words(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size)}
function channel(p){
 const a=String(p.availability||'').toLowerCase(), q=String(p.evidence_quote||p.product||'').toLowerCase();
 const pickup=/pick up|pickup|ready today|ready in|store pickup/.test(a+' '+q);
 const ship=/ship|get it|delivery|add to cart|online/.test(a+' '+q);
 if(pickup&&ship)return 'OMNICHANNEL_SIGNAL';
 if(pickup)return 'IN_STORE_SIGNAL';
 if(ship)return 'ONLINE_CONFIRMED';
 return 'ONLINE_DETECTED_IN_STORE_UNKNOWN';
}
function featureScore(ours, theirs){
 const oa=attrs(ours.attributes), ta=attrs(theirs.attributes);
 const keys=[...new Set([...Object.keys(oa),...Object.keys(ta)])];
 let compared=0,wins=0,losses=0,ties=0,deltas=[];
 for(const k of keys){
  if(oa[k]==null||ta[k]==null)continue; compared++;
  const ov=oa[k],tv=ta[k];
  if(typeof ov==='number'&&typeof tv==='number'){if(ov>tv){wins++;deltas.push(`${k}: advantage`)}else if(ov<tv){losses++;deltas.push(`${k}: competitor advantage`)}else ties++}
  else if(String(ov).toLowerCase()===String(tv).toLowerCase())ties++;
 }
 return {compared,wins,losses,ties,deltas:deltas.slice(0,6)};
}
export default async function handler(req,res){
 if(!requireInternal(req,res))return;
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const {account,retailer_products=[],manufacturer_products=[]}=req.body||{};
 const retail=retailer_products.map(p=>({...p,channel_status:channel(p),price_numeric:num(p.price)}));
 const comparisons=[];
 for(const prod of manufacturer_products){
  for(const v of (prod.variants||[])){
   const vp=Number(v.msrp||v.map||0)||null;
   const ranked=retail.map(r=>{
    const s=sim(`${prod.category} ${prod.name} ${v.variant_name||''}`,`${r.brand} ${r.product}`);
    const pd=vp&&r.price_numeric?Math.round((vp-r.price_numeric)*100)/100:null;
    return {...r,similarity:s,price_delta:pd};
   }).filter(x=>x.similarity>.04).sort((a,b)=>b.similarity-a.similarity).slice(0,5);
   comparisons.push({product:prod.name,sku:v.sku,variant:v.variant_name,our_price:vp,attributes:attrs(v.attributes),closest_competitors:ranked.map(r=>({...r,feature_comparison:featureScore(v,r)}))});
  }
 }
 const prices=retail.map(x=>x.price_numeric).filter(Boolean).sort((a,b)=>a-b);
 const bands=[];for(let i=1;i<prices.length;i++){if(prices[i]-prices[i-1]>=30)bands.push({from:prices[i-1],to:prices[i],gap:prices[i]-prices[i-1]})}
 return res.status(200).json({version:'9.6',account:account||'',channel_summary:{
  online_confirmed:retail.filter(x=>x.channel_status==='ONLINE_CONFIRMED').length,
  in_store_signals:retail.filter(x=>x.channel_status==='IN_STORE_SIGNAL').length,
  omnichannel_signals:retail.filter(x=>x.channel_status==='OMNICHANNEL_SIGNAL').length,
  in_store_unknown:retail.filter(x=>x.channel_status==='ONLINE_DETECTED_IN_STORE_UNKNOWN').length,
  warning:'Pickup is a store-level signal, not proof of national in-store assortment. Store/ZIP evidence is required for confirmed physical distribution.'
 },retailer_products:retail,comparisons,price_whitespace:bands.slice(-10),
 interpretation:'Comparison is evidence-backed where fields exist. Missing attributes remain unknown; the engine does not invent feature advantages.'});
}
