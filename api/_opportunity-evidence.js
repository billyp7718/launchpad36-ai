import { evaluateProductAccountFit, evidenceProfiles } from './_account-fit.js';

const money=value=>Math.round((Number(value)||0)*100)/100;

export async function reconcileOpportunityEvidenceForOrganization(sql,organizationId){
  if(!organizationId)return {updated:0,verified:0};
  const workspaces=await sql`select * from opportunity_workspaces where organization_id=${organizationId}`;
  if(!workspaces.length)return {updated:0,verified:0};
  const organization=(await sql`select * from retail_organizations where id=${organizationId} and active=true limit 1`)[0];
  if(!organization)return {updated:0,verified:0};
  const evidenceRows=await sql`with latest as(select distinct on(ce.subject_type,ce.subject_key) ce.*,es.source_url from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.organization_id=${organizationId} and ce.subject_type='retailer_assortment' and ce.observed_at>=now()-interval '365 days' order by ce.subject_type,ce.subject_key,ce.observed_at desc) select organization_id,payload,source_url,observed_at,last_verified_at,confidence,verification_status from latest where verification_status in ('VERIFIED','REVIEW_REQUIRED') order by observed_at desc limit 10000`;
  const evidenceProfile=evidenceProfiles(evidenceRows).get(String(organizationId))||null;
  let updated=0,verified=0;
  for(const workspace of workspaces){
    const productIds=Array.isArray(workspace.product_ids)?workspace.product_ids.map(String):[];
    const products=productIds.length?await sql`select p.*,coalesce((select array_agg(category) from product_categories pc where pc.product_id=p.id),'{}') categories,coalesce((select array_agg(c.code) from product_channels pc join channels c on c.id=pc.channel_id where pc.product_id=p.id),'{}') channels from products p where p.manufacturer_id=${workspace.manufacturer_id} and p.id in ${sql(productIds)} and p.active=true`:[];
    const fits=products.map(product=>evaluateProductAccountFit(product,organization,evidenceProfile)).filter(fit=>fit.qualified);
    const best=fits.sort((a,b)=>b.score-a.score)[0]||{score:0,reason:'No relevant verified assortment evidence matches the selected products',evidence_status:'INSUFFICIENT',evidence_count:evidenceProfile?.evidence_count||0,evidence_sources:evidenceProfile?.sources||[]};
    const isVerified=best.evidence_status==='VERIFIED',scenario=workspace.scenario||{},account=scenario.account||{},base=money(account.base_manufacturer_revenue);
    const nextScenario={...scenario,account:{...account,fit_score:best.score,fit_reason:best.reason,evidence_status:best.evidence_status,evidence_count:best.evidence_count||0,evidence_sources:best.evidence_sources||[],last_verified_at:best.last_verified_at||null,last_observed_at:best.last_observed_at||null,evidence_backed_manufacturer_revenue:isVerified?base:0},evidence_reconciled_at:new Date().toISOString()};
    const nextStatus=workspace.status==='archived'?'archived':isVerified&&workspace.status==='approved'?'approved':isVerified?'ready':'research_required',automaticActions=new Set(['','Review the evidence, buyer coverage, and recommended SKU for approval','Run product research and approve relevant assortment evidence']),suggestedAction=isVerified?'Review the evidence, buyer coverage, and recommended SKU for approval':'Run product research and approve relevant assortment evidence',nextAction=automaticActions.has(String(workspace.next_action||''))?suggestedAction:workspace.next_action;
    await sql`update opportunity_workspaces set scenario=${sql.json(nextScenario)},status=${nextStatus},next_action=${nextAction},approved_at=${nextStatus==='approved'?workspace.approved_at:null},updated_at=now() where id=${workspace.id}`;
    updated++;if(isVerified)verified++;
  }
  return {updated,verified};
}

export async function syncCompetitiveOfferingVerification(sql,row,status){
  const offerings=Array.isArray(row?.payload?.offerings)?row.payload.offerings:[];
  if(!offerings.length||(!row.account_id&&!row.organization_id))return 0;
  let updated=0;
  for(const offering of offerings){
    const name=String(offering?.name||offering?.product_name||'').trim();if(!name)continue;
    const brand=String(offering?.brand||'').trim();
    const rows=row.organization_id
      ?await sql`update competitive_products cp set verification_status=${status},last_verified_at=${status==='VERIFIED'?new Date().toISOString():null},updated_at=now() from accounts a where cp.account_id=a.id and a.organization_id=${row.organization_id} and lower(cp.product_name)=lower(${name}) and (${brand}='' or lower(cp.brand)=lower(${brand})) returning cp.id`
      :await sql`update competitive_products set verification_status=${status},last_verified_at=${status==='VERIFIED'?new Date().toISOString():null},updated_at=now() where account_id=${row.account_id} and lower(product_name)=lower(${name}) and (${brand}='' or lower(brand)=lower(${brand})) returning id`;
    updated+=rows.length;
  }
  return updated;
}
