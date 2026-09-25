import { db, upsertBuyer } from './_db.js';
import { requireAdmin } from './_auth.js';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
export default async function handler(req,res){
 try{
  if(!requireAdmin(req,res)) return;
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method==='GET'){
    const sql=db(),account=req.query.account_id||null,organization=req.query.organization_id||null;
    const rows=organization?await sql`select b.* from buyers b join accounts a on a.id=b.account_id where a.organization_id=${organization} order by (b.category_verification_status='VERIFIED') desc,b.category_confidence desc,b.identity_confidence desc,b.updated_at desc`
                       :account ? await sql`select * from buyers where account_id=${account} order by (category_verification_status='VERIFIED') desc,category_confidence desc,identity_confidence desc,updated_at desc`
                       : await sql`select * from buyers order by (category_verification_status='VERIFIED') desc,category_confidence desc,identity_confidence desc,updated_at desc limit 1000`;
    return res.status(200).json({buyers:rows});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const b of body) out.push(await upsertBuyer(b||{}));
    return res.status(200).json({buyers:out});
  }
  if(req.method==='PATCH'){
    const sql=db(),id=String(req.body?.id||'').trim(),name=clean(req.body?.name,160),title=clean(req.body?.title,180),email=clean(req.body?.email,200),linkedin=clean(req.body?.linkedin,500),hasCategoryEdit=req.body?.category_scope!==undefined||req.body?.category!==undefined,categoryScope=hasCategoryEdit?clean(req.body?.category_scope||req.body?.category,240):null,categoryEvidenceUrl=req.body?.category_evidence_url===undefined?null:clean(req.body?.category_evidence_url,500),categoryStatus=categoryEvidenceUrl&&['VERIFIED','REVIEW_REQUIRED'].includes(req.body?.category_verification_status)?req.body.category_verification_status:hasCategoryEdit?'UNCONFIRMED':null,identityConfidence=req.body?.identity_confidence===undefined?null:Math.min(100,Math.max(0,Number(req.body.identity_confidence)||0));
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
