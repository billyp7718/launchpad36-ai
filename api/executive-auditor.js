import { db } from './_db.js';
import { requireAdmin } from './_auth.js';
const MODEL=process.env.L36_AUDITOR_MODEL||process.env.L36_AGENT_MODEL||'openai/gpt-5.6-sol';
async function gateway(messages){
 const key=process.env.AI_GATEWAY_API_KEY||''; if(!key) throw new Error('AI_GATEWAY_API_KEY is not configured');
 const r=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,messages,temperature:.15,response_format:{type:'json_object'}})});
 if(!r.ok) throw new Error(`AI Gateway ${r.status}: ${await r.text()}`); const j=await r.json();
 return JSON.parse((j.choices?.[0]?.message?.content||'{}').replace(/^```json\s*/i,'').replace(/```$/,'').trim());
}
export default async function handler(req,res){
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 if(!requireAdmin(req,res)) return;
 try{
  const sql=db(), manufacturerId=req.body?.manufacturer_id||null, accountId=req.body?.account_id||null;
  const [accounts,products,buyers,intelligence,changes,runs]=await Promise.all([
   accountId?sql`select * from accounts where id=${accountId}`:sql`select * from accounts where active=true order by score desc limit 250`,
   manufacturerId?sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id where p.manufacturer_id=${manufacturerId} group by p.id`:sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id group by p.id limit 250`,
   accountId?sql`select * from buyers where account_id=${accountId} order by updated_at desc limit 100`:sql`select * from buyers order by updated_at desc limit 250`,
   accountId?sql`select * from account_intelligence where account_id=${accountId} order by generated_at desc limit 10`:sql`select * from account_intelligence order by generated_at desc limit 100`,
   accountId?sql`select * from change_events where account_id=${accountId} order by detected_at desc limit 100`:sql`select * from change_events order by detected_at desc limit 200`,
   sql`select * from intelligence_runs order by started_at desc limit 100`
  ]);
  const snapshot={accounts,products,buyers,intelligence,changes,runs};
  const system=`You are the L36 Executive Product Auditor. Act as a skeptical CEO/CRO/CSO/CFO/COO/CIO evaluating a retail revenue intelligence SaaS platform for manufacturers. FIND FLAWS rather than validate assumptions. Evaluate Revenue Value, Data Confidence, Actionability, Workflow Friction, Differentiation, Executive Trust. Flag misleading precision, stale/weak evidence, unqualified accounts, bad recommendations, missing next actions, tenant/security risk, and unnecessary workflow. Never invent facts. Return strict JSON: overall_health 0-100, dimension_scores with the six dimensions 0-100, critical_count, high_count, findings array [{severity,area,flaw,business_consequence,recommended_correction,expected_impact,evidence,confidence}], release_recommendation GO|GO_WITH_FIXES|NO_GO, executive_summary.`;
  const audit=await gateway([{role:'system',content:system},{role:'user',content:JSON.stringify(snapshot)}]);
  const saved=(await sql`insert into executive_audits(manufacturer_id,account_id,model,audit,overall_health,release_recommendation) values(${manufacturerId},${accountId},${MODEL},${sql.json(audit)},${Number(audit.overall_health)||0},${audit.release_recommendation||'NO_GO'}) returning *`)[0];
  return res.status(200).json({audit_id:saved.id,model:MODEL,audit});
 }catch(e){return res.status(500).json({error:e.message})}
}
