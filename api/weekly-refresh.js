
import { db, upsertBuyer, upsertCompetitiveProduct } from './_db.js';

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
  let ap=0,bu=0,pu=0; const errors=[];
  try{
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
            await upsertBuyer({account_id:a.id,name:b.name,title:b.title,email:b.email,phone:b.phone,source:b.source_label||'Public business source',source_url:b.source_url,confidence:b.confidence,verified_at:b.verified_at,status:'Current'});
            await sql`insert into retail_observations(account_id,observation_type,entity_key,payload,source_url) values(${a.id},'buyer',${`${b.name}|${b.title}`},${sql.json(b)},${b.source_url||''})`;
            bu++;
          }
        }
        if(pr.ok){
          const pd=await pr.json();
          for(const p of (pd.products||[])){
            await upsertCompetitiveProduct({account_id:a.id,brand:p.brand,product_name:p.product,price_text:p.price,price_numeric:priceNum(p.price),availability:p.availability,source_url:p.source_url,verified_at:p.verified_at,raw_text:p.product});
            await sql`insert into retail_observations(account_id,observation_type,entity_key,payload,source_url) values(${a.id},'competitive_product',${`${p.brand}|${p.product}`},${sql.json(p)},${p.source_url||''})`;
            pu++;
          }
        }
        if(process.env.AI_GATEWAY_API_KEY && process.env.L36_AGENT_AUTO_REFRESH!=='false'){
          const ar=await fetch(`${base}/api/intelligence-agent`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${secret}`},body:JSON.stringify({account_id:a.id,refresh:false})});
          if(!ar.ok) errors.push({account:a.name,agent_error:`${ar.status} ${String(await ar.text()).slice(0,400)}`});
        }
      }catch(e){errors.push({account:a.name,error:e.message})}
    }
    await sql`update refresh_runs set status='completed',accounts_processed=${ap},buyers_upserted=${bu},products_upserted=${pu},errors=${sql.json(errors)},finished_at=now() where id=${run.id}`;
    res.status(200).json({status:'completed',accounts_processed:ap,buyers_upserted:bu,products_upserted:pu,errors});
  }catch(e){
    errors.push({fatal:e.message});
    await sql`update refresh_runs set status='failed',errors=${sql.json(errors)},finished_at=now() where id=${run.id}`;
    res.status(500).json({status:'failed',error:e.message});
  }
}
