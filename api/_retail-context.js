const clean=(value,max=800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const list=value=>Array.isArray(value)?value.map(item=>clean(item,180)).filter(Boolean).slice(0,50):[];
const num=value=>Math.max(0,Number(value)||0);

export function buildBuyerMeetingBrief({organization={},summary={},buyers=[],products=[],workspace=null,feedback=[]}={}){
  const buyer=summary?.buyer?.identified?summary.buyer:(buyers[0]||null);
  const scenario=workspace?.scenario||workspace?.result_snapshot||{};
  const proposed=Array.isArray(scenario.proposed_assortment)?scenario.proposed_assortment:[];
  const recent=feedback[0]||null;
  const objections=feedback.flatMap(row=>Array.isArray(row.objections)?row.objections:[]).map(x=>clean(x,180)).filter(Boolean).slice(0,8);
  const requested=feedback.flatMap(row=>Array.isArray(row.requested_changes)?row.requested_changes:[]).map(x=>clean(x,180)).filter(Boolean).slice(0,8);
  const questions=[
    proposed.length?'Which proposed SKUs best fit your current assortment priorities?':'Which product gaps are you actively trying to fill in this category?',
    'Is the preferred launch online-only, a store pilot, regional, or national?',
    'What retail price points and margin requirements matter most for this category?',
    'What would need to be true for this opportunity to advance to account setup?'
  ];
  if(objections.length)questions.unshift('Have the previously discussed concerns been addressed sufficiently to move forward?');
  return {
    organization:{id:organization.id||null,name:clean(organization.name,220),footprint:num(organization.footprint),channels:organization.channel_codes||[]},
    buyer:buyer?{id:buyer.id||null,name:clean(buyer.name,180),title:clean(buyer.title,220),category_scope:clean(buyer.category_scope||buyer.category,220),confidence:num(buyer.category_confidence??buyer.confidence),verified:summary?.buyer?.ownership_confirmed===true}:null,
    opportunity:{id:workspace?.id||null,status:clean(workspace?.status,60),next_action:clean(workspace?.next_action,300),modeled_revenue:num(summary?.opportunity?.value||scenario?.account?.base_manufacturer_revenue)},
    proposed_assortment:proposed.slice(0,20).map(item=>({product_id:item.product_id||null,brand:clean(item.brand_name||item.brand,160),product:clean(item.product_name||item.name,220),sku:clean(item.sku,120),dealer_cost:num(item.dealer_cost),annual_revenue:num(item.annual_revenue??item.base_manufacturer_revenue)})),
    competitive_context:(products||[]).slice(0,12).map(item=>({brand:clean(item.brand||item.brand_name,160),product:clean(item.product_name||item.name,220),model:clean(item.model,160),price:num(item.price),online:item.online===true||String(item.purchase_channel||'').toLowerCase().includes('online'),store_status:clean(item.store_verification||item.research_context?.store_verification,80)})),
    prior_objections:[...new Set(objections)],
    prior_requested_changes:[...new Set(requested)],
    latest_feedback:recent?{meeting_at:recent.meeting_at,buyer_feedback:clean(recent.buyer_feedback,800),rollout_scope:clean(recent.rollout_scope,100),next_action:clean(recent.next_action,300)}:null,
    recommended_questions:questions.slice(0,6),
    evidence_posture:{trust_score:num(summary?.trust_score),trust_level:clean(summary?.trust_level,80),last_verified_at:summary?.last_verified_at||null,missing_evidence:summary?.missing_evidence||[]},
    human_approval_required:true
  };
}

export function feedbackRecommendations(input={}){
  const accepted=list(input.accepted_skus),rejected=list(input.rejected_skus),changes=list(input.requested_changes),objections=list(input.objections),rollout=clean(input.rollout_scope,100),next=clean(input.next_action,300);
  const recommendations=[];
  if(accepted.length)recommendations.push({type:'ASSORTMENT',action:'Update the proposed assortment to reflect buyer-accepted SKUs',skus:accepted,approval_required:true});
  if(rejected.length)recommendations.push({type:'ASSORTMENT',action:'Review rejected SKUs and revise the sell-in scenario before the next buyer touch',skus:rejected,approval_required:true});
  if(changes.length)recommendations.push({type:'SCENARIO',action:'Revise pricing, assortment, or rollout assumptions based on requested changes',details:changes,approval_required:true});
  if(rollout)recommendations.push({type:'ROLLOUT',action:`Evaluate a ${rollout} sell-in scenario`,approval_required:true});
  if(objections.length)recommendations.push({type:'PLAYBOOK',action:'Carry buyer objections into the account knowledge record and next meeting brief',details:objections,approval_required:false});
  if(next)recommendations.push({type:'CRM_TASK',action:next,approval_required:true});
  if(!recommendations.length)recommendations.push({type:'REVIEW',action:'Review meeting notes and choose the next commercial action',approval_required:true});
  return recommendations;
}
