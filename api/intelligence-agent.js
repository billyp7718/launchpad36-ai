import { db } from './_db.js';
import { requireInternal } from './_auth.js';

const MODEL=process.env.L36_AGENT_MODEL||'openai/gpt-5.6-sol';

async function gateway(messages){
  const key=process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN||'';
  if(!key) throw new Error('AI Gateway authentication is not configured');
  const r=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:MODEL,messages,temperature:0.1,response_format:{type:'json_object'}})
  });
  if(!r.ok) throw new Error(`AI Gateway ${r.status}: ${await r.text()}`);
  const j=await r.json();
  return JSON.parse((j.choices?.[0]?.message?.content||'{}').replace(/^```json\s*/i,'').replace(/```$/,'').trim());
}

function verify(record,evidence){
  const byId=new Set(evidence.map(x=>String(x.id)));
  let observed=0, grounded=0;
  const claims=(record.claims||[]).map(c=>{
    if(c.type==='observed'){
      observed++;
      const ids=(c.evidence_ids||[]).map(String).filter(id=>byId.has(id));
      const sources=(c.sources||[]).filter(Boolean);
      const ok=ids.length>0 || sources.length>0;
      if(ok) grounded++;
      return {...c,evidence_ids:ids,confidence:ok?Math.min(100,Number(c.confidence)||0):Math.min(40,Number(c.confidence)||0),
        verification:ok?'grounded':'insufficient_evidence'};
    }
    return {...c,verification:c.type==='derived'?'derived':'recommendation'};
  });
  const grounding=observed?Math.round(100*grounded/observed):100;
  return {claims,grounding_score:grounding,verified:grounding>=80};
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res)) return;
  const sql=db(); const accountId=req.body?.account_id; const manufacturerId=req.body?.manufacturer_id||null;
  if(!accountId) return res.status(400).json({error:'account_id is required'});
  let run;
  try{
    const account=(await sql`select * from accounts where id=${accountId}`)[0];
    if(!account) return res.status(404).json({error:'Account not found'});
    const [products,buyers,competitive,observations,scores,changes,evidence]=await Promise.all([
      manufacturerId?sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id and v.active=true where p.manufacturer_id=${manufacturerId} and p.active=true group by p.id`:sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id and v.active=true where p.active=true group by p.id`,
      sql`select * from buyers where account_id=${accountId} order by updated_at desc limit 100`,
      sql`select * from competitive_products where account_id=${accountId} order by updated_at desc limit 250`,
      sql`select * from retail_observations where account_id=${accountId} order by observed_at desc limit 250`,
      sql`select * from opportunity_scores where account_id=${accountId} order by scored_at desc limit 30`,
      sql`select * from change_events where account_id=${accountId} order by detected_at desc limit 100`,
      sql`select * from evidence_items where account_id=${accountId} order by observed_at desc limit 300`
    ]);
    const context={account,products,buyers,competitive,observations,scores,changes,evidence};
    run=(await sql`insert into intelligence_runs(manufacturer_id,account_id,status,model,input_snapshot) values(${manufacturerId},${accountId},'running',${MODEL},${sql.json(context)}) returning *`)[0];
    const system=`You are the L36 Retail Revenue Intelligence Agent for product manufacturers. Determine where and how the manufacturer can win retail distribution. Use only supplied evidence. Never invent products, prices, availability, buyers, emails, phones, or retailer facts. Label claims observed, derived, or recommendation. If evidence is weak say "Insufficient evidence to determine." Return strict JSON with overall_score 0-100; scores {assortment_gap,price_white_space,feature_differentiation,competitive_density,buyer_accessibility,online_fit,in_store_fit}; summary; assortment_gap; competitive_analysis; buyer_intelligence; online_strategy array; in_store_strategy array; recommended_sku; changes array; claims array containing type,claim,confidence,evidence_ids,last_verified,sources; confidence 0-100.`;
    const record=await gateway([{role:'system',content:system},{role:'user',content:JSON.stringify(context)}]);
    const verification=verify(record,evidence);
    record.claims=verification.claims;
    record.confidence=Math.min(Number(record.confidence)||0, verification.grounding_score);
    await sql`update intelligence_runs set status='completed',output=${sql.json(record)},verification=${sql.json(verification)},confidence=${record.confidence},finished_at=now() where id=${run.id}`;
    const saved=(await sql`insert into account_intelligence(manufacturer_id,account_id,run_id,overall_score,record,confidence) values(${manufacturerId},${accountId},${run.id},${Number(record.overall_score)||0},${sql.json(record)},${record.confidence}) returning *`)[0];
    return res.status(200).json({run_id:run.id,intelligence_id:saved.id,model:MODEL,verification,record});
  }catch(e){
    if(run) await sql`update intelligence_runs set status='failed',errors=${sql.json([e.message])},finished_at=now() where id=${run.id}`.catch(()=>{});
    return res.status(500).json({error:e.message});
  }
}
