import { db, upsertBuyer } from './_db.js';
import { requireInternal } from './_auth.js';
import { persistEvidence } from './_evidence.js';
import { runLivingIntelligencePipeline } from './_living-intelligence.js';
import { buyerCategorySearchTerms, searchOpenAIBuyers } from './_openai-research.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res))return;
  const tenant=await resolveTenant(req,res,{allowCron:true});if(!tenant)return;
  const sql=db(),accountId=clean(req.body?.account_id,80),manufacturerId=tenant.tenant_id||req.body?.manufacturer_id||null;
  if(!accountId)return res.status(400).json({error:'account_id is required'});
  try{
    const account=(await sql`select * from accounts where id=${accountId}`)[0];if(!account)return res.status(404).json({error:'Account not found'});
    const category=clean(req.body?.category||account.category,240),research=await searchOpenAIBuyers({account:account.name,domain:account.domain,category,allCategories:!category}),results=[];
    for(const person of research.people||[]){
      const observedAt=person.evidence_date||new Date().toISOString(),identityConfidence=Number(person.identity_confidence)||Number(person.confidence)||0,hasCategoryEvidence=Boolean(person.category_evidence_url&&person.category_evidence_quote),categoryStatus=hasCategoryEvidence?person.category_verification_status||'REVIEW_REQUIRED':'UNCONFIRMED',payload={...person,organization:account.name};
      const living=await runLivingIntelligencePipeline({account_id:account.id,source_url:person.source_url,source_type:'openai_web_search',domain:account.domain,subject_type:'buyer',subject_key:`buyer:${account.id}:${person.name}|${person.title}`,evidence_type:'buyer',payload,observed_at:observedAt,last_verified_at:null,confidence:identityConfidence,verification_status:'REVIEW_REQUIRED',acquired_by:'buyer_intelligence'});
      const record=await upsertBuyer({account_id:account.id,name:person.name,title:person.title,email:person.email||'',phone:person.phone||'',linkedin:person.linkedin||'',category:hasCategoryEvidence?person.category_scope:'',department:person.department||'',category_scope:hasCategoryEvidence?person.category_scope:'',subcategory_scope:hasCategoryEvidence?person.subcategory_scope:'',buyer_role:person.buyer_role||'UNCONFIRMED',source:person.source_label||'OpenAI web research',source_url:person.source_url,confidence:identityConfidence,identity_confidence:identityConfidence,category_confidence:hasCategoryEvidence?person.category_confidence:0,category_evidence_url:hasCategoryEvidence?person.category_evidence_url:'',category_evidence_source:hasCategoryEvidence?person.category_evidence_source:'',category_last_verified:hasCategoryEvidence?person.category_last_verified||observedAt:null,category_verification_status:categoryStatus,verified_at:null,status:'Review Required',notes:hasCategoryEvidence?'Identity and category evidence retained separately.':'Identity evidence retained; category ownership unconfirmed.',observed_at:observedAt,last_verified_at:null,evidence_type:'buyer',verification_status:'REVIEW_REQUIRED'});
      const evidence=await persistEvidence({manufacturer_id:manufacturerId,account_id:account.id,evidence_type:'buyer',entity_key:`${person.name}|${person.title}`,payload,source_url:person.source_url,source_type:'openai_web_search',observed_at:observedAt,confidence:identityConfidence});
      results.push({...record,changed_since_last_check:living.changed_since_last_check,last_verified:living.last_verified_at,evidence_id:evidence?.id||null});
    }
    const focus=buyerCategorySearchTerms(category).map(term=>term.toLowerCase()),aligned=buyer=>buyer.category_verification_status==='VERIFIED'&&(focus.length===0||focus.some(term=>`${buyer.department||''} ${buyer.category_scope||''} ${buyer.subcategory_scope||''}`.toLowerCase().includes(term)));
    results.sort((a,b)=>Number(aligned(b))-Number(aligned(a))||(Number(b.category_confidence)||0)-(Number(a.category_confidence)||0)||(Number(b.identity_confidence)||0)-(Number(a.identity_confidence)||0));
    const categoryOwnerStatus=category?research.category_owner_status||'NOT_CONFIRMED':'NOT_REQUESTED';
    return res.status(200).json({version:'9.8.3',account:{id:account.id,name:account.name,domain:account.domain},category_focus:category,category_owner_status:categoryOwnerStatus,buyer_intelligence:results,linkedin_policy:{mode:'verification_enrichment_only',bulk_scraping:false,private_contact_inference:false},interpretation:categoryOwnerStatus==='NOT_CONFIRMED'?'Category owner not yet confirmed. Identity-confirmed candidates remain saved without verified category ownership.':results.length?'Attributable candidates are ranked by verified category alignment, then category and identity confidence.':'No attributable named buyer candidate was found. This is unknown, not proof that no relevant buyer exists.'});
  }catch(e){console.error('buyer intelligence failed',{message:e?.message||String(e),account_id:accountId});return res.status(500).json({error:'Buyer intelligence could not be completed'})}
}
