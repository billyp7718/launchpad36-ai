const bounded=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
const average=values=>values.length?values.reduce((sum,value)=>sum+bounded(value),0)/values.length:0;
const ageDays=value=>{const timestamp=Date.parse(String(value||''));return Number.isFinite(timestamp)?Math.max(0,(Date.now()-timestamp)/86400000):Infinity};
const sourceAuthority=source=>{const kind=String(source?.source_kind||source?.provider||source?.evidence_type||'').toLowerCase();if(/official|retailer|manufacturer/.test(kind))return 95;if(/government|regulatory|trade_publication/.test(kind))return 88;if(/professional|conference|press_release/.test(kind))return 78;if(/user_entered/.test(kind))return 72;if(/public_web|openai|firecrawl/.test(kind))return 62;return 45};
const freshness=value=>{const days=ageDays(value);return days<=30?100:days<=90?88:days<=180?72:days<=365?52:Number.isFinite(days)?25:0};
const agreementScore=observations=>{const values=observations.map(item=>JSON.stringify(item.value)).filter(Boolean);if(!values.length)return 0;const counts=new Map();for(const value of values)counts.set(value,(counts.get(value)||0)+1);return bounded(Math.max(...counts.values())/values.length*100)};
const factor=(input,key,fallback=0)=>bounded(input?.[key]??fallback);
export const TRUST_ALGORITHM_VERSION='l36-trust-v1';
export function trustLevel(score){return score>=90?'VERIFIED_HIGH_CONFIDENCE':score>=75?'STRONG':score>=50?'NEEDS_REVIEW':'INSUFFICIENT_EVIDENCE'}

export function calculateTrustScore(input={}){
  const observations=Array.isArray(input.observations)?input.observations:[],conflicts=[...(Array.isArray(input.conflicts)?input.conflicts:[])],unsupported=[...(Array.isArray(input.unsupported_claims)?input.unsupported_claims:[])],missing=[];
  const authority=observations.length?average(observations.map(sourceAuthority)):factor(input,'source_authority');
  const fresh=observations.length?average(observations.map(item=>freshness(item.last_verified_at||item.observed_at))):factor(input,'evidence_freshness');
  const agreement=observations.length?agreementScore(observations):factor(input,'source_agreement');
  const factors={source_authority:authority,evidence_freshness:fresh,source_agreement:agreement,product_match_confidence:factor(input,'product_match_confidence'),account_match_confidence:factor(input,'account_match_confidence'),buyer_role_confidence:factor(input,'buyer_role_confidence'),category_ownership_confidence:factor(input,'category_ownership_confidence'),in_store_evidence_strength:factor(input,'in_store_evidence_strength'),revenue_assumption_completeness:factor(input,'revenue_assumption_completeness')};
  for(const [key,value] of Object.entries(factors))if(value===0)missing.push(key);
  const weighted=factors.source_authority*.18+factors.evidence_freshness*.12+factors.source_agreement*.15+factors.product_match_confidence*.12+factors.account_match_confidence*.08+factors.buyer_role_confidence*.08+factors.category_ownership_confidence*.08+factors.in_store_evidence_strength*.08+factors.revenue_assumption_completeness*.11;
  const score=bounded(weighted-conflicts.length*8-unsupported.length*12),reasons=[];
  if(factors.source_authority>=80)reasons.push('Authoritative sources support the finding');
  if(factors.source_agreement>=75)reasons.push('Independent observations materially agree');
  if(factors.evidence_freshness<50)reasons.push('Evidence is stale or has no verified timestamp');
  if(conflicts.length)reasons.push(`${conflicts.length} evidence conflict${conflicts.length===1?'':'s'} reduced confidence`);
  if(unsupported.length)reasons.push(`${unsupported.length} unsupported claim${unsupported.length===1?'':'s'} reduced confidence`);
  const recommended=[];if(missing.includes('source_authority'))recommended.push('Add an attributable authoritative source');if(missing.includes('source_agreement'))recommended.push('Cross-check the claim with another independent source');if(factors.evidence_freshness<50)recommended.push('Refresh or reverify the supporting evidence');if(conflicts.length)recommended.push('Resolve conflicting observations through human review');if(unsupported.length)recommended.push('Remove or source unsupported AI claims');
  return {trust_score:score,trust_level:trustLevel(score),reasons,missing_evidence:missing,conflicts,recommended_verification:[...new Set(recommended)],factors:Object.fromEntries(Object.entries(factors).map(([key,value])=>[key,bounded(value)])),algorithm_version:TRUST_ALGORITHM_VERSION};
}
