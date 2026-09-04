import { db, upsertBuyer, upsertCompetitiveProduct } from './_db.js';
import { persistEvidence } from './_evidence.js';
import { runLivingIntelligencePipeline } from './_living-intelligence.js';
import { runRetailerDiscovery } from './retailer-discovery-agent.js';

function origin(req){
  const proto=req.headers['x-forwarded-proto']||'https';
  const host=req.headers['x-forwarded-host']||req.headers.host;
  return `${proto}://${host}`;
}
function priceNum(s=''){
  const m=String(s).match(/([\d,]+(?:\.\d{2})?)/);
  return m?Number(m[1].replace(/,/g,'')):0;
}
export default async function handler(req,res){
  const auth=req.headers.authorization||'';
  const secret=process.env.CRON_SECRET||'';
  if(!secret) return res.status(503).json({error:'CRON_SECRET is not configured'});
  if(auth!==`Bearer ${secret}`) return res.status(401).json({error:'Unauthorized'});
  const sql=db();
  const run=(await sql`insert into refresh_runs(job_type,status) values('weekly-buyer-product-refresh','started') returning id`)[0];
  let ap=0,bu=0,pu=0,ev=0,retailerDiscovery={status:'SKIPPED',added:0,updated:0}; const errors=[];
  try{
    const discoveryRun=(await sql`insert into refresh_runs(job_type,status) values('weekly-retailer-discovery','started') returning id`)[0];
    try{retailerDiscovery=await runRetailerDiscovery(sql,{limit:Number(process.env.WEEKLY_RETAILER_DISCOVERY_LIMIT)||12});await sql`update refresh_runs set status=${retailerDiscovery.status.startsWith('COMPLETED')?'completed':retailerDiscovery.status.toLowerCase()},accounts_processed=${retailerDiscovery.added+retailerDiscovery.updated},errors=${sql.json(retailerDiscovery.errors||[])},finished_at=now() where id=${discoveryRun.id}`;if(retailerDiscovery.errors?.length)errors.push(...retailerDiscovery.errors.map(x=>({retailer_discovery:x})))}catch(error){await sql`update refresh_runs set status='failed',errors=${sql.json([{fatal:String(error.message||error).slice(0,300)}])},finished_at=now() where id=${discoveryRun.id}`;errors.push({retailer_discovery:{error:String(error.message||error).slice(0,300)}})}
    const accounts=await sql`select * from accounts where active=true and domain<>'' order by name`;
    for(const a of accounts){
      ap++;
      try{
        const base=origin(req);
        const [br,pr]=await Promise.all([
          fetch(`${base}/api/decision-makers?domain=${encodeURIComponent(a.domain)}&account=${encodeURIComponent(a.name)}`,{headers:{authorization:`Bearer ${secret}`}}),
          fetch(`${base}/api/current-products?domain=${encodeURIComponent(a.domain)}&account=${encodeURIComponent(a.name)}&categories=${encodeURIComponent(a.category||'')}`,{headers:{authorization:`Bearer ${secret}`}})
        ]);
        if(br.ok){
          const bd=await br.json();
          for(const b of (bd.people||[])){
            if(!b.source_url)continue;const verificationStatus=Number(b.confidence)>=85?'VERIFIED':'REVIEW_REQUIRED';const living=await runLivingIntelligencePipeline({account_id:a.id,source_url:b.source_url,source_type:'corporate_page',domain:a.domain,subject_type:'buyer',subject_key:`${a.id}:${b.name}|${b.title}`,evidence_type:'buyer',payload:b,observed_at:b.verified_at||new Date().toISOString(),last_verified_at:b.verified_at||null,confidence:b.confidence||70,verification_status:verificationStatus,acquired_by:'weekly_refresh'});
            if(living.deterministic_update_applied){await upsertBuyer({account_id:a.id,name:b.name,title:b.title,email:b.email,phone:b.phone,source:b.source_label||'Public business source',source_url:b.source_url,confidence:b.confidence,verified_at:b.verified_at,status:'Current',observed_at:b.verified_at,verification_status:'VERIFIED',evidence_type:'buyer'});bu++}
            await sql`insert into retail_observations(account_id,observation_type,entity_key,payload,source_url,last_verified_at,confidence,evidence_type,verification_status) values(${a.id},'buyer',${`${b.name}|${b.title}`},${sql.json(b)},${b.source_url||''},${living.last_verified_at},${living.confidence},'buyer',${living.verification_status})`;
            await persistEvidence({account_id:a.id,evidence_type:'buyer',entity_key:`${b.name}|${b.title}`,payload:b,source_url:b.source_url||'',source_type:'corporate_page',observed_at:b.verified_at||new Date().toISOString(),confidence:b.confidence||70});
            ev++;
          }
        }
        if(pr.ok){
          const pd=await pr.json();
          for(const p of (pd.products||[])){
            if(!p.source_url)continue;
            const pn=priceNum(p.price);
            const verificationStatus=Number(p.confidence)>=85?'VERIFIED':'REVIEW_REQUIRED';const living=await runLivingIntelligencePipeline({account_id:a.id,source_url:p.source_url,source_type:p.source_type||'retailer_site',domain:a.domain,subject_type:'assortment_product',subject_key:`${a.id}:${p.brand}|${p.product}`,evidence_type:'assortment_product',payload:{...p,price_numeric:pn},observed_at:p.observed_at||new Date().toISOString(),last_verified_at:p.observed_at||null,confidence:p.confidence||75,verification_status:verificationStatus,acquired_by:'weekly_refresh'});
            if(living.deterministic_update_applied){await upsertCompetitiveProduct({account_id:a.id,brand:p.brand,product_name:p.product,price_text:p.price,price_numeric:pn,availability:p.availability,source_url:p.source_url,verified_at:p.verified_at,raw_text:p.product,observed_at:p.observed_at,verification_status:'VERIFIED',evidence_type:'assortment_product'});pu++}
            await sql`insert into retail_observations(account_id,observation_type,entity_key,payload,source_url,last_verified_at,confidence,evidence_type,verification_status) values(${a.id},'competitive_product',${`${p.brand}|${p.product}`},${sql.json(p)},${p.source_url||''},${living.last_verified_at},${living.confidence},'assortment_product',${living.verification_status})`;
            await persistEvidence({account_id:a.id,evidence_type:'competitive_product',entity_key:`${p.brand}|${p.product}`,payload:{...p,price_numeric:pn},source_url:p.source_url||'',source_type:'retailer_site',observed_at:p.verified_at||new Date().toISOString(),confidence:75});
            ev++;
          }
        }
        if((process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN) && process.env.L36_AGENT_AUTO_REFRESH!=='false'){
          const manufacturers=await sql`select id,name from manufacturers order by created_at`;
          for(const manufacturer of manufacturers){const ar=await fetch(`${base}/api/intelligence-agent`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${secret}`},body:JSON.stringify({account_id:a.id,manufacturer_id:manufacturer.id,refresh:false})});if(!ar.ok)errors.push({account:a.name,manufacturer:manufacturer.name,agent_error:`${ar.status} ${String(await ar.text()).slice(0,400)}`})}
        }
      }catch(e){errors.push({account:a.name,error:e.message})}
    }
    await sql`update refresh_runs set status='completed',accounts_processed=${ap},buyers_upserted=${bu},products_upserted=${pu},errors=${sql.json(errors)},finished_at=now() where id=${run.id}`;
    res.status(200).json({status:'completed',accounts_processed:ap,buyers_upserted:bu,products_upserted:pu,evidence_persisted:ev,retailer_discovery:retailerDiscovery,errors});
  }catch(e){
    errors.push({fatal:e.message});
    await sql`update refresh_runs set status='failed',errors=${sql.json(errors)},finished_at=now() where id=${run.id}`;
    res.status(500).json({status:'failed',error:e.message});
  }
}
