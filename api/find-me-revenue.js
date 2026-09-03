import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { buyerProfiles, evaluateProductAccountFit, evidenceProfiles } from './_account-fit.js';

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const sql=db();
  try{
    const productId=req.body?.product_id||null;
    if(!productId)return res.status(400).json({error:'A tenant-owned product is required'});
    const product=(await sql`select p.*,coalesce((select array_agg(category) from product_categories pc where pc.product_id=p.id),'{}') categories,coalesce((select array_agg(c.code) from product_channels pc join channels c on c.id=pc.channel_id where pc.product_id=p.id),'{}') channels from products p where p.id=${productId} and p.manufacturer_id=${tenant.tenant_id} limit 1`)[0];
    if(!product)return res.status(404).json({error:'Product not found for this tenant'});
    const [organizations,evidenceRows,buyerRows]=await Promise.all([
      sql`select * from retail_organizations where active=true limit 5000`,
      sql`select ce.organization_id,ce.payload,es.source_url,ce.observed_at,ce.last_verified_at,ce.confidence,ce.verification_status from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.organization_id is not null and ce.subject_type='retailer_assortment' and ce.verification_status in ('VERIFIED','REVIEW_REQUIRED') and ce.observed_at>=now()-interval '365 days' order by ce.observed_at desc limit 10000`,
      sql`select a.organization_id,b.id,b.name,b.title,b.email,b.phone,b.linkedin,b.category,b.source_url,b.confidence,b.verification_status,b.status,b.updated_at from accounts a join buyers b on b.account_id=a.id where a.organization_id is not null order by b.confidence desc,b.updated_at desc limit 10000`
    ]);
    const evidence=evidenceProfiles(evidenceRows),buyers=buyerProfiles(buyerRows),limit=Math.min(Number(req.body?.limit)||100,250);
    const ranked=organizations.map(org=>{
      const fit=evaluateProductAccountFit(product,org,evidence.get(String(org.id))||null);if(!fit.qualified)return null;
      const contacts=buyers.get(String(org.id))||[];
      return {organization_id:org.id,name:org.name,domain:org.domain,channels:org.channel_codes,categories:org.categories,coverage:org.coverage,verification_status:org.verification_status,confidence:Number(org.confidence)||0,fit_score:fit.score,fit_tier:fit.tier,fit_reason:fit.reason,evidence_status:fit.evidence_status,evidence_count:fit.evidence_count||0,last_verified_at:fit.last_verified_at||null,last_observed_at:fit.last_observed_at||null,buyers:contacts,buyer_count:contacts.length};
    }).filter(Boolean).sort((a,b)=>{
      const order={VERIFIED:5,OBSERVED_REVIEW_REQUIRED:4,PROFILE_ONLY:3,RESEARCH_REQUIRED:2};
      return (order[b.evidence_status]||0)-(order[a.evidence_status]||0)||b.fit_score-a.fit_score||b.buyer_count-a.buyer_count;
    }).slice(0,limit);
    console.log('[find-me-revenue] completed',{product_id:product.id,organizations_checked:organizations.length,results:ranked.length,verified:ranked.filter(x=>x.evidence_status==='VERIFIED').length,observed:ranked.filter(x=>x.evidence_status==='OBSERVED_REVIEW_REQUIRED').length,research_required:ranked.filter(x=>x.evidence_status==='RESEARCH_REQUIRED').length,with_buyers:ranked.filter(x=>x.buyer_count>0).length});
    return res.status(200).json({version:'9.8.3',product:{id:product.id,name:product.name},criteria:{categories:product.categories||[],channels:product.channels||[]},opportunities:ranked,excluded_unqualified_count:organizations.length-ranked.length,interpretation:'Results are ordered by verified assortment, observed product evidence, account category profile, then category-specific channel suitability. Each result exposes its evidence tier; general company size and confidence cannot qualify an unrelated account.'});
  }catch(error){console.error('find revenue failed',{message:error?.message||String(error)});return res.status(500).json({error:'Account ranking could not be completed'});}
}
