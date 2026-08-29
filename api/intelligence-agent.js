import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { trustMetrics, isExternalEvidence } from './_evidence.js';
import { resolveTenant } from './_tenant.js';

const MODEL=process.env.L36_AGENT_MODEL||'openai/gpt-5.6-sol';
const MIN_EVIDENCE=Math.max(1,Number(process.env.L36_MIN_EVIDENCE_ITEMS)||3);
const MIN_COVERAGE=Math.max(0,Math.min(100,Number(process.env.L36_MIN_EVIDENCE_COVERAGE)||50));

function gatewayKey(){return process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN||''}
async function gateway(messages){
  const key=gatewayKey();
  if(!key) throw new Error('AI Gateway authentication is not configured');
  const r=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:MODEL,messages,temperature:0.1,response_format:{type:'json_object'}})
  });
  if(!r.ok) throw new Error(`AI Gateway ${r.status}: ${await r.text()}`);
  const j=await r.json();
  return JSON.parse((j.choices?.[0]?.message?.content||'{}').replace(/^```json\s*/i,'').replace(/```$/,'').trim());
}

function qaOnlyProduct(p={}){
  const variants=Array.isArray(p.variants)?p.variants:[];
  const allVariantsQa=variants.length>0 && variants.every(v=>v?.attributes?.qa_only===true);
  const text=`${p.positioning||''} ${p.differentiator||''}`.toLowerCase();
  return allVariantsQa || text.includes('qa-only') || text.includes('controlled qa');
}
function internalEvidence(account,products){
  const out=[{id:`input:account:${account.id}`,evidence_type:'account_input',source_type:'manufacturer_input',source_url:'',payload:{name:account.name,type:account.type,coverage:account.coverage,region:account.region,domain:account.domain,category:account.category},confidence:100,observed_at:account.updated_at||account.created_at||new Date().toISOString()}];
  for(const p of products){
    out.push({id:`input:product:${p.id}`,evidence_type:'product_input',source_type:'manufacturer_input',source_url:'',payload:{name:p.name,category:p.category,positioning:p.positioning,differentiator:p.differentiator},confidence:100,observed_at:p.updated_at||p.created_at||new Date().toISOString()});
    for(const v of (p.variants||[])) out.push({id:`input:variant:${v.id}`,evidence_type:'variant_input',source_type:'manufacturer_input',source_url:'',payload:{sku:v.sku,variant_name:v.variant_name,msrp:v.msrp,map:v.map,wholesale:v.wholesale,attributes:v.attributes},confidence:100,observed_at:v.updated_at||v.created_at||new Date().toISOString()});
  }
  return out;
}
function verify(record,catalog,externalEvidence,scoring){
  const byId=new Map(catalog.map(x=>[String(x.id),x]));
  let observed=0,grounded=0,externalGrounded=0;
  const claims=(record.claims||[]).map(c=>{
    const ids=(c.evidence_ids||[]).map(String).filter(id=>byId.has(id));
    if(c.type==='observed'){
      observed++;
      const ok=ids.length>0;
      const external=ids.some(id=>isExternalEvidence(byId.get(id)));
      if(ok) grounded++;
      if(external) externalGrounded++;
      return {...c,evidence_ids:ids,confidence:ok?Math.min(100,Number(c.confidence)||0):Math.min(40,Number(c.confidence)||0),verification:ok?'grounded':'insufficient_evidence',evidence_scope:external?'external':'input'};
    }
    return {...c,evidence_ids:ids,verification:c.type==='derived'?'derived':'recommendation'};
  });
  const grounding=observed?Math.round(100*grounded/observed):0;
  const externalGrounding=observed?Math.round(100*externalGrounded/observed):0;
  return {claims,grounding_score:grounding,external_grounding_score:externalGrounding,verified:Boolean(scoring.eligible && grounding>=80),score_suppression_reasons:scoring.reasons};
}
function nullScores(){return {assortment_gap:null,price_white_space:null,feature_differentiation:null,competitive_density:null,buyer_accessibility:null,online_fit:null,in_store_fit:null}}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res)) return;
  const tenant=await resolveTenant(req,res,{allowCron:true});if(!tenant)return;
  if(!gatewayKey()) return res.status(503).json({error:'AI Gateway authentication is not configured',code:'AGENT_PREFLIGHT_FAILED'});
  const sql=db(),accountId=req.body?.account_id,manufacturerId=tenant.tenant_id||req.body?.manufacturer_id||null;
  if(tenant.source==='cron'&&!manufacturerId)return res.status(400).json({error:'manufacturer_id is required for cron agent runs'});
  if(!accountId) return res.status(400).json({error:'account_id is required'});
  let run;
  try{
    const account=(await sql`select * from accounts where id=${accountId}`)[0];
    if(!account) return res.status(404).json({error:'Account not found'});
    const [products,buyers,competitive,observations,scores,changes,evidence,livingEvidence,livingChanges]=await Promise.all([
      manufacturerId?sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id and v.active=true where p.manufacturer_id=${manufacturerId} and p.active=true group by p.id`:sql`select p.*,coalesce(json_agg(v) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id and v.active=true where p.active=true group by p.id`,
      sql`select * from buyers where account_id=${accountId} order by updated_at desc limit 100`,
      sql`select * from competitive_products where account_id=${accountId} order by updated_at desc limit 250`,
      sql`select * from retail_observations where account_id=${accountId} order by observed_at desc limit 250`,
      sql`select * from opportunity_scores where account_id=${accountId} and manufacturer_id=${manufacturerId} order by scored_at desc limit 30`,
      sql`select * from change_events where account_id=${accountId} order by detected_at desc limit 100`,
      sql`select * from evidence_items where account_id=${accountId} order by observed_at desc limit 500`,
      sql`select ce.*,es.source_url,es.source_kind from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.account_id=${accountId} order by ce.observed_at desc limit 500`,
      sql`select ice.* from intelligence_change_events ice where ice.account_id=${accountId} or (${account.organization_id||null}::uuid is not null and ice.organization_id=${account.organization_id||null}) order by ice.detected_at desc limit 100`
    ]);
    const trust=trustMetrics(evidence);
    const commercialProducts=products.filter(p=>!qaOnlyProduct(p));
    const reasons=[];
    if(!commercialProducts.length) reasons.push('NO_COMMERCIAL_PRODUCT');
    if(trust.external_evidence_count<MIN_EVIDENCE) reasons.push('INSUFFICIENT_EXTERNAL_EVIDENCE');
    if(trust.evidence_coverage<MIN_COVERAGE) reasons.push('INSUFFICIENT_EVIDENCE_COVERAGE');
    const scoring={eligible:reasons.length===0,status:reasons.length?'NOT_SCORABLE':'SCORABLE',reasons,min_evidence_items:MIN_EVIDENCE,min_evidence_coverage:MIN_COVERAGE};
    const inputEvidence=internalEvidence(account,products);
    const evidenceCatalog=[...inputEvidence,...evidence.map(e=>({...e,id:String(e.id)})),...livingEvidence.map(e=>({...e,id:`living:${e.id}`,source_type:e.acquired_by||'public',source_url:e.source_url||''}))];
    const context={account,products,buyers,competitive,observations,scores,changes,evidence,living_evidence:livingEvidence,living_change_events:livingChanges,evidence_catalog:evidenceCatalog,trust,scoring,truth_write_policy:'LLM output is advisory only and cannot update current_commercial_truth'};
    run=(await sql`insert into intelligence_runs(manufacturer_id,account_id,status,model,prompt_version,input_snapshot) values(${manufacturerId},${accountId},'running',${MODEL},'v9.3',${sql.json(context)}) returning *`)[0];
    const system=`You are the L36 Retail Revenue Intelligence Agent for product manufacturers. Use only supplied evidence. Never invent products, prices, availability, buyers, emails, phones, retailer facts, source URLs, or evidence IDs. Every observed claim must cite one or more exact IDs from evidence_catalog. Source text alone never counts as evidence. Your output is advisory and must never overwrite current_commercial_truth; conflicting or insufficient evidence must remain UNKNOWN or REVIEW_REQUIRED. Distinguish certainty that data is missing from confidence in a commercial opportunity. If scoring.eligible is false, overall_score and every score must be null, scoring_status must be NOT_SCORABLE, and no SKU may be commercially recommended. QA-only products are never commercial recommendations. Return strict JSON with scoring_status; overall_score number or null; scores {assortment_gap,price_white_space,feature_differentiation,competitive_density,buyer_accessibility,online_fit,in_store_fit} numbers or null; summary; assortment_gap; competitive_analysis; buyer_intelligence; online_strategy array; in_store_strategy array; recommended_sku; changes array; next_actions array [{priority,action,owner_role,status,dependency,required_artifact,completion_criteria,due_days}]; claims array [{type,claim,confidence,evidence_ids,last_verified,sources}]; inference_confidence 0-100; recommendation_confidence 0-100. If evidence is weak say "Insufficient evidence to determine."`;
    const record=await gateway([{role:'system',content:system},{role:'user',content:JSON.stringify(context)}]);
    if(!scoring.eligible){record.scoring_status='NOT_SCORABLE';record.overall_score=null;record.scores=nullScores();record.recommended_sku=null}
    else record.scoring_status='SCORABLE';
    const verification=verify(record,evidenceCatalog,evidence,scoring);
    record.claims=verification.claims;
    const modelInference=Math.max(0,Math.min(100,Number(record.inference_confidence ?? record.confidence)||0));
    const modelRecommendation=Math.max(0,Math.min(100,Number(record.recommendation_confidence ?? record.confidence)||0));
    record.trust={
      ...trust,
      grounding_score:verification.grounding_score,
      external_grounding_score:verification.external_grounding_score,
      scoring_status:scoring.status,
      scoring_eligible:scoring.eligible,
      scoring_reasons:scoring.reasons,
      inference_confidence:modelInference,
      recommendation_confidence:scoring.eligible?Math.min(modelRecommendation,trust.evidence_coverage,trust.source_reliability||100):0
    };
    record.confidence=record.trust.recommendation_confidence;
    const verificationSummary={grounding_score:verification.grounding_score,external_grounding_score:verification.external_grounding_score,verified:verification.verified,score_suppression_reasons:verification.score_suppression_reasons,trust:record.trust};
    await sql`update intelligence_runs set status='completed',output=${sql.json(record)},verification=${sql.json(verificationSummary)},confidence=${record.confidence},finished_at=now() where id=${run.id}`;
    const overall=record.overall_score===null?null:Math.max(0,Math.min(100,Number(record.overall_score)||0));
    const saved=(await sql`insert into account_intelligence(manufacturer_id,account_id,run_id,overall_score,record,confidence) values(${manufacturerId},${accountId},${run.id},${overall},${sql.json(record)},${record.confidence}) returning *`)[0];
    let proposalId=null;if(livingChanges[0]){const proposal=(await sql`insert into intelligence_proposals(manufacturer_id,account_id,change_event_id,proposal_type,proposed_payload,model,status,deterministic_update_allowed) values(${manufacturerId},${accountId},${livingChanges[0].id},'L36_AGENT_ASSESSMENT',${sql.json({run_id:run.id,record,verification:verificationSummary})},${MODEL},'REVIEW_REQUIRED',false) returning id`)[0];proposalId=proposal?.id||null;await sql`insert into intelligence_change_event_processing(change_event_id,processor,status,attempts,last_attempt_at,processed_at,metadata,updated_at) values(${livingChanges[0].id},${`l36-agent:${manufacturerId}`},'processed',1,now(),now(),${sql.json({run_id:run.id,proposal_id:proposalId})},now()) on conflict(change_event_id,processor) do update set status='processed',attempts=intelligence_change_event_processing.attempts+1,last_attempt_at=now(),processed_at=now(),metadata=excluded.metadata,updated_at=now()`}
    return res.status(200).json({run_id:run.id,intelligence_id:saved.id,living_proposal_id:proposalId,model:MODEL,verification:verificationSummary,truth_write_policy:{llm_can_update_verified_truth:false,conflicts_remain_review_required:true},record});
  }catch(e){
    if(run) await sql`update intelligence_runs set status='failed',errors=${sql.json([{code:'AGENT_RUN_FAILED',message:String(e.message).slice(0,800)}])},finished_at=now() where id=${run.id}`.catch(()=>{});
    return res.status(500).json({error:e.message});
  }
}
