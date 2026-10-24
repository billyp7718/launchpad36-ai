import { db, upsertBuyer } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { appendBuyerRelationship,relationshipDisposition } from './_buyer-relationships.js';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const BUYER_ROLES=new Set(['DIRECT_BUYER','CATEGORY_OWNER','MERCHANT','MERCHANDISING_LEADER','INFLUENCER','EXECUTIVE','UNCONFIRMED']);
const canAccess=(row,tenant)=>canSeeAllTenantData(tenant)||String(row.owner_user_id||'')===String(tenant.user_id||'')||(row.visibility==='team'&&(tenant.team_ids||[]).includes(String(row.team_id||'')))||(row.visibility==='tenant'&&!row.owner_user_id&&!row.team_id);
export default async function handler(req,res){
 try{
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(!requireCapability(tenant,res,req.method==='GET'?CAPABILITIES.APP_READ:CAPABILITIES.APP_WRITE))return;
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method==='GET'){
    const sql=db(),account=req.query.account_id||null,organization=req.query.organization_id||null;
    const rows=organization?await sql`select b.* from buyers b join accounts a on a.id=b.account_id where a.organization_id=${organization} order by (b.category_verification_status='VERIFIED') desc,b.category_confidence desc,b.identity_confidence desc,b.updated_at desc`
                       :account ? await sql`select * from buyers where account_id=${account} order by (category_verification_status='VERIFIED') desc,category_confidence desc,identity_confidence desc,updated_at desc`
                       : await sql`select * from buyers order by (category_verification_status='VERIFIED') desc,category_confidence desc,identity_confidence desc,updated_at desc limit 1000`;
    return res.status(200).json({buyers:rows});
  }
  if(req.method==='POST'){
    if(!Array.isArray(req.body)&&req.body?.workspace_id){
      const workspaceId=clean(req.body.workspace_id,100),name=clean(req.body.name,160),title=clean(req.body.title,180),email=clean(req.body.email,200),linkedin=clean(req.body.linkedin,500),sourceUrl=clean(req.body.source_url,500),categoryEvidenceUrl=clean(req.body.category_evidence_url,500),buyerRole=clean(req.body.buyer_role||'UNCONFIRMED',40).toUpperCase();
      if(!workspaceId||!name||!title)return res.status(400).json({error:'Opportunity workspace, buyer name, and title are required'});
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid professional email address'});
      if(linkedin&&!/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(linkedin))return res.status(400).json({error:'Enter a valid LinkedIn URL'});
      if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))return res.status(400).json({error:'Identity evidence must be a public http(s) URL'});
      if(categoryEvidenceUrl&&!/^https?:\/\//i.test(categoryEvidenceUrl))return res.status(400).json({error:'Category evidence must be a public http(s) URL'});
      if(!BUYER_ROLES.has(buyerRole))return res.status(400).json({error:'Choose a supported buyer role'});
      const workspace=(await sql`select id,organization_id,owner_user_id,team_id,visibility from opportunity_workspaces where id=${workspaceId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];
      if(!workspace||!canAccess(workspace,tenant))return res.status(404).json({error:'Opportunity workspace was not found in your private or team scope'});
      const organization=(await sql`select * from retail_organizations where id=${workspace.organization_id} and active=true limit 1`)[0];if(!organization)return res.status(404).json({error:'Opportunity account was not found'});
      const account=(await sql`insert into accounts(name,type,coverage,region,domain,category,source,source_url,organization_id,confidence,verification_status,updated_at) values(${organization.name},${organization.organization_type||''},${organization.coverage||''},${organization.region||''},${organization.domain||''},${(organization.categories||[]).join(' | ')},'manual_opportunity_buyer',${sourceUrl},${organization.id},0,'REVIEW_REQUIRED',now()) on conflict(lower(name)) do update set organization_id=coalesce(accounts.organization_id,excluded.organization_id),updated_at=now() returning *`)[0];
      if(String(account.organization_id||'')!==String(workspace.organization_id))return res.status(409).json({error:'The account identity conflicts with this opportunity organization; review the account record before adding a buyer'});
      const duplicate=(await sql`select id from buyers where account_id=${account.id} and lower(name)=lower(${name}) and lower(title)=lower(${title}) limit 1`)[0];if(duplicate)return res.status(409).json({error:'That buyer and title already exist for this account'});
      const categoryScope=clean(req.body.category_scope||req.body.category,240),department=clean(req.body.department,180),subcategoryScope=clean(req.body.subcategory_scope,240),categoryStatus=categoryEvidenceUrl?'PROBABLE':'UNCONFIRMED',identityStatus=sourceUrl?'PROBABLE':'UNCONFIRMED',observedAt=new Date().toISOString(),observation={name,title,department,category_scope:categoryScope,subcategory_scope:subcategoryScope,buyer_role:buyerRole,identity_confidence:sourceUrl?60:0,category_confidence:categoryEvidenceUrl?60:0,employment_verification_status:identityStatus,category_verification_status:categoryStatus,employment_evidence_url:sourceUrl,category_evidence_url:categoryEvidenceUrl,evidence_date:observedAt,source_url:sourceUrl};
      const buyer=await upsertBuyer({account_id:account.id,name,title,email,phone:clean(req.body.phone,80),linkedin,category:categoryScope,department,category_scope:categoryScope,subcategory_scope:subcategoryScope,buyer_role:buyerRole,source:'manual_entry',source_url:sourceUrl,confidence:sourceUrl?60:0,identity_confidence:sourceUrl?60:0,category_confidence:categoryEvidenceUrl?60:0,category_evidence_url:categoryEvidenceUrl,category_evidence_source:categoryEvidenceUrl?'manual_public_source':'',category_last_verified:null,category_verification_status:categoryStatus,employment_verification_status:identityStatus,employment_evidence_url:sourceUrl,employment_last_verified:null,verified_at:null,status:'Review Required',notes:'Manually added in an account opportunity workspace. Identity and category ownership require separate verification.',observed_at:observedAt,last_verified_at:null,evidence_type:'buyer_manual_entry',verification_status:'REVIEW_REQUIRED'});
      const disposition=relationshipDisposition({},observation);await appendBuyerRelationship(sql,{buyer,account_id:account.id,observation,disposition});
      return res.status(201).json({buyer,relationship_status:categoryStatus,manual_entry:true});
    }
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const b of body) out.push(await upsertBuyer(b||{}));
    return res.status(200).json({buyers:out});
  }
  if(req.method==='PATCH'){
    const sql=db(),id=String(req.body?.id||'').trim(),name=clean(req.body?.name,160),title=clean(req.body?.title,180),email=clean(req.body?.email,200),linkedin=clean(req.body?.linkedin,500),hasCategoryEdit=req.body?.category_scope!==undefined||req.body?.category!==undefined,categoryScope=hasCategoryEdit?clean(req.body?.category_scope||req.body?.category,240):null,categoryEvidenceUrl=req.body?.category_evidence_url===undefined?null:clean(req.body?.category_evidence_url,500),requestedCategoryStatus=req.body?.category_verification_status==='REVIEW_REQUIRED'?'PROBABLE':req.body?.category_verification_status,categoryStatus=categoryEvidenceUrl&&['VERIFIED','PROBABLE','STALE','CONFLICTING'].includes(requestedCategoryStatus)?requestedCategoryStatus:hasCategoryEdit?'UNCONFIRMED':null,identityConfidence=req.body?.identity_confidence===undefined?null:Math.min(100,Math.max(0,Number(req.body.identity_confidence)||0));
    if(!id||!name||!title)return res.status(400).json({error:'Buyer id, name, and title are required'});
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid buyer email address'});
    if(linkedin&&!/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(linkedin))return res.status(400).json({error:'Enter a valid LinkedIn URL'});
    const buyer=(await sql`update buyers set name=${name},title=${title},category=coalesce(${categoryScope},category),department=coalesce(${req.body?.department===undefined?null:clean(req.body.department,180)},department),category_scope=coalesce(${categoryScope},category_scope),subcategory_scope=coalesce(${req.body?.subcategory_scope===undefined?null:clean(req.body.subcategory_scope,240)},subcategory_scope),buyer_role=coalesce(${req.body?.buyer_role===undefined?null:clean(req.body.buyer_role,40)},buyer_role),identity_confidence=coalesce(${identityConfidence},identity_confidence),category_confidence=case when ${categoryEvidenceUrl} is not null then ${categoryEvidenceUrl?Math.min(100,Math.max(0,Number(req.body?.category_confidence)||0)):0} when ${hasCategoryEdit} then 0 else category_confidence end,category_evidence_url=case when ${categoryEvidenceUrl} is not null then ${categoryEvidenceUrl||''} when ${hasCategoryEdit} then '' else category_evidence_url end,category_evidence_source=case when ${categoryEvidenceUrl} is not null then ${categoryEvidenceUrl?clean(req.body?.category_evidence_source,180):''} when ${hasCategoryEdit} then '' else category_evidence_source end,category_last_verified=case when ${categoryEvidenceUrl} is not null then ${categoryEvidenceUrl?req.body?.category_last_verified||null:null} when ${hasCategoryEdit} then null else category_last_verified end,category_verification_status=coalesce(${categoryStatus},category_verification_status),email=${email},phone=${clean(req.body?.phone,80)},linkedin=${linkedin},updated_at=now() where id=${id} returning *`)[0];
    if(!buyer)return res.status(404).json({error:'Buyer was not found'});
    return res.status(200).json({buyer});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error('buyer operation failed',{message:e?.message||String(e)});return res.status(500).json({error:'Buyer operation could not be completed'})}
}
