import { db } from './_db.js';
import { requireInternal } from './_auth.js';
const MODEL=process.env.L36_AUDITOR_MODEL||process.env.L36_AGENT_MODEL||'openai/gpt-5.6-sol';
function gatewayKey(){return process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN||''}
async function gateway(messages){
 const key=gatewayKey(); if(!key) throw new Error('AI Gateway authentication is not configured');
 const r=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,messages,temperature:.15,response_format:{type:'json_object'}})});
 if(!r.ok) throw new Error(`AI Gateway ${r.status}: ${await r.text()}`); const j=await r.json();
 return JSON.parse((j.choices?.[0]?.message?.content||'{}').replace(/^```json\s*/i,'').replace(/```$/,'').trim());
}
function deterministicFindings(intelligence=[]){
 const findings=[];
 for(const i of intelligence){
  const r=i.record||{}; const t=r.trust||{};
  if(r.scoring_status==='NOT_SCORABLE' && (r.overall_score!==null || Object.values(r.scores||{}).some(v=>v!==null))){
   findings.push({severity:'critical',area:'Executive Trust',flaw:'A NOT_SCORABLE intelligence record still contains numerical opportunity scores.',business_consequence:'Executives can mistake missing evidence for measured commercial weakness.',recommended_correction:'Suppress all opportunity scores until evidence gates pass.',expected_impact:'Eliminates fabricated precision.',evidence:[`intelligence_id=${i.id}`],confidence:100,deterministic:true});
  }
  if((t.evidence_coverage??0)<50 && (t.recommendation_confidence??0)>50){
   findings.push({severity:'critical',area:'Data Confidence',flaw:'Recommendation confidence exceeds evidence coverage.',business_consequence:'Commercial confidence is overstated relative to source support.',recommended_correction:'Cap recommendation confidence by evidence coverage and source reliability.',expected_impact:'Makes confidence interpretable and defensible.',evidence:[`intelligence_id=${i.id}`,`evidence_coverage=${t.evidence_coverage}`,`recommendation_confidence=${t.recommendation_confidence}`],confidence:100,deterministic:true});
  }
  if(t.external_evidence_count===0 && t.grounding_score===100){
   findings.push({severity:'high',area:'Executive Trust',flaw:'A 100 grounding score is based entirely on internal/input evidence with no external retail evidence.',business_consequence:'Users may misread grounding as independent market verification.',recommended_correction:'Display external grounding separately from total grounding and gate commercial verification on external evidence.',expected_impact:'Clarifies provenance and prevents false market validation.',evidence:[`intelligence_id=${i.id}`],confidence:100,deterministic:true});
  }
 }
 return findings;
}
function mergeFindings(a=[],b=[]){
 const out=[...a]; const keys=new Set(out.map(x=>`${x.severity}|${x.area}|${x.flaw}`));
 for(const x of b){const k=`${x.severity}|${x.area}|${x.flaw}`;if(!keys.has(k)){keys.add(k);out.push(x)}}
 return out;
}
export default async function handler(req,res){
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 if(!requireInternal(req,res)) return;
 if(!gatewayKey()) return res.status(503).json({error:'AI Gateway authentication is not configured',code:'AUDITOR_PREFLIGHT_FAILED'});
 try{
  const sql=db(),manufacturerId=req.body?.manufacturer_id||null,accountId=req.body?.account_id||null;
  const [accounts,products,buyers,intelligence,changes,runs]=await Promise.all([
   accountId?sql`select * from accounts where id=${accountId}`:sql`select * from accounts where active=true order by score desc limit 250`,
   manufacturerId?sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id where p.manufacturer_id=${manufacturerId} group by p.id`:sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id group by p.id limit 250`,
   accountId?sql`select * from buyers where account_id=${accountId} order by updated_at desc limit 100`:sql`select * from buyers order by updated_at desc limit 250`,
   accountId?sql`select * from account_intelligence where account_id=${accountId} order by generated_at desc limit 10`:sql`select * from account_intelligence order by generated_at desc limit 100`,
   accountId?sql`select * from change_events where account_id=${accountId} order by detected_at desc limit 100`:sql`select * from change_events order by detected_at desc limit 200`,
   sql`select id,manufacturer_id,account_id,status,model,prompt_version,confidence,errors,started_at,finished_at from intelligence_runs order by started_at desc limit 100`
  ]);
  const deterministic=deterministicFindings(intelligence);
  const snapshot={accounts,products,buyers,intelligence,changes,runs,deterministic_findings:deterministic};
  const system=`You are the L36 Executive Product Auditor. Act as a skeptical CEO/CRO/CSO/CFO/COO/CIO evaluating a retail revenue intelligence SaaS platform for manufacturers. FIND FLAWS rather than validate assumptions. Evaluate Revenue Value, Data Confidence, Actionability, Workflow Friction, Differentiation, Executive Trust. Treat deterministic_findings as mandatory control findings and do not contradict them. Flag misleading precision, stale/weak evidence, unqualified accounts, bad recommendations, missing next actions, tenant/security risk, QA contamination, and unnecessary workflow. Never invent facts. Return strict JSON: overall_health 0-100, dimension_scores with the six dimensions 0-100, critical_count, high_count, findings array [{severity,area,flaw,business_consequence,recommended_correction,expected_impact,evidence,confidence}], release_recommendation GO|GO_WITH_FIXES|NO_GO, executive_summary.`;
  const audit=await gateway([{role:'system',content:system},{role:'user',content:JSON.stringify(snapshot)}]);
  audit.findings=mergeFindings(deterministic,audit.findings||[]);
  audit.critical_count=audit.findings.filter(x=>x.severity==='critical').length;
  audit.high_count=audit.findings.filter(x=>x.severity==='high').length;
  if(audit.critical_count>0) audit.release_recommendation='NO_GO';
  const saved=(await sql`insert into executive_audits(manufacturer_id,account_id,model,audit,overall_health,release_recommendation) values(${manufacturerId},${accountId},${MODEL},${sql.json(audit)},${Number(audit.overall_health)||0},${audit.release_recommendation||'NO_GO'}) returning *`)[0];
  return res.status(200).json({audit_id:saved.id,model:MODEL,audit});
 }catch(e){return res.status(500).json({error:e.message})}
}
