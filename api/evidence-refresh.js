import { db, upsertBuyer, upsertCompetitiveProduct } from './_db.js';
import { requireInternal } from './_auth.js';
import { persistEvidence, trustMetrics } from './_evidence.js';

function origin(req){const proto=req.headers['x-forwarded-proto']||'https';const host=req.headers['x-forwarded-host']||req.headers.host;return `${proto}://${host}`}
function priceNum(s=''){const m=String(s).match(/([\d,]+(?:\.\d{2})?)/);return m?Number(m[1].replace(/,/g,'')):0}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res))return;
  const sql=db(),accountId=req.body?.account_id,manufacturerId=req.body?.manufacturer_id||null;
  if(!accountId)return res.status(400).json({error:'account_id is required'});
  try{
    const account=(await sql`select * from accounts where id=${accountId}`)[0];
    if(!account)return res.status(404).json({error:'Account not found'});
    if(!account.domain)return res.status(422).json({error:'Account domain is required for evidence refresh'});
    const auth=req.headers.authorization||'',base=origin(req);
    const [br,pr]=await Promise.all([
      fetch(`${base}/api/decision-makers?domain=${encodeURIComponent(account.domain)}&account=${encodeURIComponent(account.name)}`,{headers:{authorization:auth}}),
      fetch(`${base}/api/current-products?domain=${encodeURIComponent(account.domain)}&account=${encodeURIComponent(account.name)}&categories=${encodeURIComponent(account.category||'')}`,{headers:{authorization:auth}})
    ]);
    let buyers=0,products=0,evidenceAdded=0;const errors=[];let productCollector={collector_status:'ERROR',acquisition:{}};
    if(br.ok){
      const bd=await br.json();
      for(const b of (bd.people||[])){
        if(!b.source_url)continue;
        await upsertBuyer({account_id:account.id,name:b.name,title:b.title,email:b.email,phone:b.phone,source:b.source_label||'Public business source',source_url:b.source_url,confidence:b.confidence,verified_at:b.verified_at,status:'Current'});
        const e=await persistEvidence({manufacturer_id:manufacturerId,account_id:account.id,evidence_type:'buyer',entity_key:`${b.name}|${b.title}`,payload:b,source_url:b.source_url,source_type:'corporate_page',observed_at:b.verified_at||new Date().toISOString(),confidence:b.confidence||70});
        if(e)evidenceAdded++;buyers++;
      }
    }else errors.push({source:'decision-makers',status:br.status,message:String(await br.text()).slice(0,300)});
    if(pr.ok){
      const pd=await pr.json(); productCollector={collector_status:pd.collector_status||'UNKNOWN',acquisition:pd.acquisition||{}};
      for(const p of (pd.products||[])){
        if(!p.source_url)continue;
        const pn=priceNum(p.price);
        await upsertCompetitiveProduct({account_id:account.id,brand:p.brand,product_name:p.product,price_text:p.price,price_numeric:pn,availability:p.availability,source_url:p.source_url,verified_at:p.observed_at||p.verified_at,raw_text:p.product});
        const payload={...p,price_numeric:pn,collector_status:pd.collector_status};
        const e=await persistEvidence({manufacturer_id:manufacturerId,account_id:account.id,evidence_type:'competitive_product',entity_key:`${p.brand}|${p.product}`,payload,source_url:p.source_url,source_type:p.source_type||'retailer_site',observed_at:p.observed_at||new Date().toISOString(),confidence:p.confidence||80});
        if(e)evidenceAdded++;products++;
      }
      if(['BLOCKED','ERROR','NO_RESULTS'].includes(pd.collector_status)){
        errors.push({source:'current-products',collector_status:pd.collector_status,negative_assortment_inference_allowed:false,detail:pd.acquisition?.interpretation||''});
      }
    }else errors.push({source:'current-products',status:pr.status,message:String(await pr.text()).slice(0,300),negative_assortment_inference_allowed:false});
    const evidence=await sql`select * from evidence_items where account_id=${accountId} order by observed_at desc limit 500`;
    return res.status(200).json({version:'9.4',account_id:accountId,account:account.name,buyers_upserted:buyers,products_upserted:products,evidence_seen:evidenceAdded,product_collector:productCollector,trust:trustMetrics(evidence),errors});
  }catch(e){return res.status(500).json({error:e.message})}
}
