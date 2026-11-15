import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { commercialAccountPreviewHash, COMMERCIAL_ACCOUNT_CATEGORIES, ensureCommercialAccountSchema, normalizeCommercialAccountRecord, normalizeCommercialCategory, normalizeCommercialSubcategory } from './_commercial-accounts.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
function prepareRows(rows=[]){
 const records=[],rejected=[],duplicates=[],seenNames=new Set(),seenDomains=new Set();
 for(let index=0;index<rows.length;index++)try{
  const record=normalizeCommercialAccountRecord(rows[index]||{}),nameKey=record.name.toLowerCase(),domainKey=record.domain.toLowerCase();
  if(seenNames.has(nameKey)||(domainKey&&seenDomains.has(domainKey))){duplicates.push({row:index+2,name:record.name,reason:'Duplicate account in import file'});continue}
  seenNames.add(nameKey);if(domainKey)seenDomains.add(domainKey);records.push(record);
 }catch(error){rejected.push({row:index+2,error:clean(error.message,300)})}
 return {records,rejected,duplicates};
}

async function existingAccounts(sql,tenantId,records){
 if(!records.length)return [];
 const names=records.map(record=>record.name.toLowerCase()),domains=records.map(record=>record.domain.toLowerCase()).filter(Boolean);
 return sql`select id,name,domain from commercial_accounts where manufacturer_id=${tenantId} and active=true and (lower(name)=any(${names}::text[]) or (${domains.length}>0 and lower(domain)=any(${domains}::text[])))`;
}

async function commitRows(sql,tenant,records,{sourceName='Commercial account import',previewHash='',rejected=[]}={}){
 return sql.begin(async transaction=>{
  const run=(await transaction`insert into commercial_account_import_runs(manufacturer_id,source_name,preview_hash,rows_seen,rows_rejected,status,errors,created_by) values(${tenant.tenant_id},${clean(sourceName,240)},${previewHash},${records.length+rejected.length},${rejected.length},'started',${transaction.json(rejected)},${tenant.user_id}) returning id`)[0];
  let accountsAdded=0,accountsUpdated=0,decisionMakersAdded=0,duplicatesPrevented=0;
  for(const record of records){
   const existing=(await transaction`select * from commercial_accounts where manufacturer_id=${tenant.tenant_id} and active=true and (lower(name)=lower(${record.name}) or (${record.domain}<>'' and lower(domain)=lower(${record.domain}))) order by case when lower(name)=lower(${record.name}) then 0 else 1 end limit 1 for update`)[0];
   let account;
   if(existing){account=(await transaction`update commercial_accounts set account_category=${record.account_category},account_subcategory=case when ${record.account_subcategory}<>'' then ${record.account_subcategory} else account_subcategory end,organization_type=${record.organization_type},domain=case when ${record.domain}<>'' then ${record.domain} else domain end,website=case when ${record.website}<>'' then ${record.website} else website end,headquarters=case when ${record.headquarters}<>'' then ${record.headquarters} else headquarters end,region=case when ${record.region}<>'' then ${record.region} else region end,location_count=case when ${record.location_count}>0 then ${record.location_count} else location_count end,notes=case when ${record.notes}<>'' then ${record.notes} else notes end,source_type='import',source_url=case when ${record.source_url}<>'' then ${record.source_url} else source_url end,verification_status=${record.verification_status},confidence=greatest(confidence,${record.confidence}),updated_at=now() where id=${existing.id} returning *`)[0];accountsUpdated++;duplicatesPrevented++}
   else{account=(await transaction`insert into commercial_accounts(manufacturer_id,name,domain,website,account_category,account_subcategory,organization_type,headquarters,region,location_count,notes,source_type,source_url,verification_status,confidence,created_by) values(${tenant.tenant_id},${record.name},${record.domain},${record.website},${record.account_category},${record.account_subcategory},${record.organization_type},${record.headquarters},${record.region},${record.location_count},${record.notes},${sourceName==='manual entry'?'manual':'import'},${record.source_url},${record.verification_status},${record.confidence},${tenant.user_id}) returning *`)[0];accountsAdded++}
   if(record.decision_maker){const maker=record.decision_maker,prior=(await transaction`select id from commercial_decision_makers where commercial_account_id=${account.id} and lower(name)=lower(${maker.name}) and lower(title)=lower(${maker.title}) limit 1`)[0];if(prior){await transaction`update commercial_decision_makers set department=case when ${maker.department}<>'' then ${maker.department} else department end,category_scope=case when ${maker.category_scope}<>'' then ${maker.category_scope} else category_scope end,email=case when ${maker.email}<>'' then ${maker.email} else email end,phone=case when ${maker.phone}<>'' then ${maker.phone} else phone end,linkedin=case when ${maker.linkedin}<>'' then ${maker.linkedin} else linkedin end,source_url=case when ${maker.source_url}<>'' then ${maker.source_url} else source_url end,verification_status=${maker.verification_status},confidence=greatest(confidence,${maker.confidence}),updated_at=now() where id=${prior.id}`;duplicatesPrevented++}else{await transaction`insert into commercial_decision_makers(manufacturer_id,commercial_account_id,name,title,department,category_scope,email,phone,linkedin,source_url,verification_status,confidence) values(${tenant.tenant_id},${account.id},${maker.name},${maker.title},${maker.department},${maker.category_scope},${maker.email},${maker.phone},${maker.linkedin},${maker.source_url},${maker.verification_status},${maker.confidence})`;decisionMakersAdded++}}
  }
  await transaction`update commercial_account_import_runs set accounts_added=${accountsAdded},accounts_updated=${accountsUpdated},decision_makers_added=${decisionMakersAdded},duplicates_prevented=${duplicatesPrevented},status='complete',finished_at=now() where id=${run.id}`;
  await transaction`insert into tenant_activity_log(manufacturer_id,user_id,action,subject_type,subject_id,metadata) values(${tenant.tenant_id},${tenant.user_id},'COMMERCIAL_ACCOUNTS_IMPORTED','commercial_account_import',${run.id},${transaction.json({source_name:sourceName,accounts_added:accountsAdded,accounts_updated:accountsUpdated,decision_makers_added:decisionMakersAdded,duplicates_prevented:duplicatesPrevented})})`;
  return {run_id:run.id,accounts_added:accountsAdded,accounts_updated:accountsUpdated,decision_makers_added:decisionMakersAdded,duplicates_prevented:duplicatesPrevented,rows_rejected:rejected.length};
 });
}

export default async function handler(req,res){
 const tenant=await resolveTenant(req,res,{requiredSection:'commercial_goods'});if(!tenant)return;
 const capability=req.method==='GET'?CAPABILITIES.APP_READ:CAPABILITIES.APP_WRITE;if(!requireCapability(tenant,res,capability))return;
 const sql=db();await ensureCommercialAccountSchema(sql);res.setHeader('Cache-Control','private, no-store');
 try{
  if(req.method==='GET'){
   const q=clean(req.query?.q,180),category=normalizeCommercialCategory(req.query?.category),subcategory=normalizeCommercialSubcategory(req.query?.subcategory,category),limit=Math.min(500,Math.max(1,Number(req.query?.limit)||250));
   if(req.query?.category&&!category)return res.status(400).json({error:'Unknown Commercial Goods account category'});
   if(req.query?.subcategory&&!subcategory)return res.status(400).json({error:'Unknown Commercial Goods account subcategory'});
   const [rows,countRows]=await Promise.all([
    sql`select ca.*,coalesce(dm.decision_makers,'[]'::json) decision_makers,coalesce(dm.decision_maker_count,0) decision_maker_count from commercial_accounts ca left join lateral(select count(*)::int decision_maker_count,json_agg(json_build_object('id',cdm.id,'name',cdm.name,'title',cdm.title,'department',cdm.department,'category_scope',cdm.category_scope,'email',cdm.email,'phone',cdm.phone,'linkedin',cdm.linkedin,'source_url',cdm.source_url,'verification_status',cdm.verification_status,'confidence',cdm.confidence) order by cdm.confidence desc,cdm.updated_at desc) decision_makers from commercial_decision_makers cdm where cdm.commercial_account_id=ca.id and cdm.manufacturer_id=${tenant.tenant_id} and cdm.active=true) dm on true where ca.manufacturer_id=${tenant.tenant_id} and ca.active=true and (${q}='' or ca.name ilike ${'%'+q+'%'} or ca.domain ilike ${'%'+q+'%'} or ca.headquarters ilike ${'%'+q+'%'}) and (${category}='' or ca.account_category=${category}) and (${subcategory}='' or ca.account_subcategory=${subcategory}) order by ca.account_category,ca.account_subcategory,ca.name limit ${limit}`,
    sql`select account_category,count(*)::int account_count from commercial_accounts where manufacturer_id=${tenant.tenant_id} and active=true group by account_category`
   ]),categoryCounts=Object.fromEntries(countRows.map(row=>[row.account_category,Number(row.account_count)||0]));
   return res.status(200).json({accounts:rows,count:rows.length,category_counts:categoryCounts,categories:COMMERCIAL_ACCOUNT_CATEGORIES,filters:{q,category,subcategory}});
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const action=clean(req.body?.action,40).toLowerCase();
  if(action==='preview'){
   const rows=Array.isArray(req.body?.rows)?req.body.rows:[];if(!rows.length||rows.length>500)return res.status(400).json({error:'Import between 1 and 500 commercial accounts per preview'});
   const prepared=prepareRows(rows),existing=await existingAccounts(sql,tenant.tenant_id,prepared.records),existingNames=new Set(existing.map(account=>String(account.name).toLowerCase())),existingDomains=new Set(existing.map(account=>String(account.domain||'').toLowerCase()).filter(Boolean)),updates=prepared.records.filter(record=>existingNames.has(record.name.toLowerCase())||(record.domain&&existingDomains.has(record.domain.toLowerCase()))).length,hash=commercialAccountPreviewHash(prepared.records);
   return res.status(200).json({preview_hash:hash,records:prepared.records,rejected:prepared.rejected,duplicates:prepared.duplicates,counts:{rows_seen:rows.length,ready:prepared.records.length,new_accounts:prepared.records.length-updates,existing_accounts:updates,decision_makers:prepared.records.filter(record=>record.decision_maker).length,duplicates_prevented:prepared.duplicates.length,rejected:prepared.rejected.length}});
  }
  if(action==='commit'){
   const rows=Array.isArray(req.body?.records)?req.body.records:[];if(!rows.length||rows.length>500)return res.status(400).json({error:'Preview between 1 and 500 commercial accounts before import'});const prepared=prepareRows(rows),expected=commercialAccountPreviewHash(prepared.records);if(!req.body?.preview_hash||req.body.preview_hash!==expected)return res.status(409).json({error:'The commercial account import changed after preview. Preview it again before approval.'});const result=await commitRows(sql,tenant,prepared.records,{sourceName:req.body?.source_name||'Commercial account import',previewHash:expected,rejected:prepared.rejected});return res.status(201).json(result);
  }
  if(action==='add'){
   const record=normalizeCommercialAccountRecord(req.body?.record||{}),result=await commitRows(sql,tenant,[record],{sourceName:'manual entry',previewHash:commercialAccountPreviewHash([record])});return res.status(201).json(result);
  }
  return res.status(400).json({error:'Unsupported commercial account action'});
 }catch(error){console.error('commercial accounts failed',{message:error?.message||String(error)});return res.status(error?.status||500).json({error:error?.status?error.message:'Commercial account operation could not be completed'});}
}
