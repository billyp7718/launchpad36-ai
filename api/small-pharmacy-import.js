import { createHash } from 'node:crypto';
import { db } from './_db.js';
import { appendBuyerRelationship, relationshipDisposition } from './_buyer-relationships.js';
import { runLivingIntelligencePipeline } from './_living-intelligence.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { SMALL_PHARMACY_CATALOG, SMALL_PHARMACY_CATALOG_VERSION, smallPharmacyCatalogHash, validateSmallPharmacyCatalog } from './_small-pharmacy-catalog.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=value=>clean(value,300).toLowerCase().replace(/^www\./,'');
const planHash=plan=>createHash('sha256').update(JSON.stringify({catalog:smallPharmacyCatalogHash(),actions:plan.map(row=>({name:row.name,account_action:row.account_action,buyers:row.buyers.map(buyer=>({name:buyer.name,action:buyer.action}))}))})).digest('hex');

async function currentContext(sql,row){
  const organization=(await sql`select * from retail_organizations where active=true and (lower(name)=lower(${row.name}) or lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)}) order by case when lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)} then 0 else 1 end,updated_at desc limit 1`)[0]||null;
  const account=organization?(await sql`select * from accounts where active=true and (organization_id=${organization.id} or lower(name)=lower(${row.name}) or lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)}) order by case when organization_id=${organization.id} then 0 else 1 end,updated_at desc limit 1`)[0]||null:(await sql`select * from accounts where active=true and (lower(name)=lower(${row.name}) or lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)}) order by updated_at desc limit 1`)[0]||null;
  const buyers=[];
  for(const contact of row.buyers){
    const existing=(await sql`select b.*,a.name account_name from buyers b join accounts a on a.id=b.account_id where (${contact.public_profile_url||''}<>'' and lower(b.linkedin)=lower(${contact.public_profile_url||''})) or (${account?.id||null}::uuid is not null and b.account_id=${account?.id||null} and lower(b.name)=lower(${contact.name})) order by case when b.account_id=${account?.id||null} then 0 else 1 end,b.updated_at desc limit 1`)[0]||null;
    buyers.push({name:contact.name,title:contact.title,action:existing?existing.account_id===account?.id?'DUPLICATE_PREVENTED':'CONFLICTING_ACCOUNT':'ADD_BUYER',existing_buyer_id:existing?.id||null,existing_account:existing?.account_name||''});
  }
  return {organization,account,buyers};
}

export async function buildSmallPharmacyImportPlan(sql){
  const rows=[];
  for(const row of SMALL_PHARMACY_CATALOG){const context=await currentContext(sql,row);rows.push({name:row.name,domain:row.domain,footprint:row.footprint,headquarters:row.headquarters,account_action:context.organization?'ENRICH_EXISTING':'ADD_ACCOUNT',organization_id:context.organization?.id||null,account_id:context.account?.id||null,buyers:context.buyers,source_url:row.source_url})}
  const summary={accounts_seen:rows.length,accounts_to_add:rows.filter(row=>row.account_action==='ADD_ACCOUNT').length,accounts_to_enrich:rows.filter(row=>row.account_action==='ENRICH_EXISTING').length,buyers_to_add:rows.flatMap(row=>row.buyers).filter(row=>row.action==='ADD_BUYER').length,buyer_duplicates_prevented:rows.flatMap(row=>row.buyers).filter(row=>row.action==='DUPLICATE_PREVENTED').length,buyer_conflicts:rows.flatMap(row=>row.buyers).filter(row=>row.action==='CONFLICTING_ACCOUNT').length};
  return {version:SMALL_PHARMACY_CATALOG_VERSION,channel:'independent_pharmacy',summary,rows,preview_hash:planHash(rows)};
}

async function upsertOrganization(tx,row){
  const existing=(await tx`select * from retail_organizations where active=true and (lower(name)=lower(${row.name}) or lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)}) order by case when lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)} then 0 else 1 end,updated_at desc limit 1`)[0]||null;
  if(existing)return (await tx`update retail_organizations set
    channel_codes=(select array(select distinct unnest(coalesce(channel_codes,'{}'::text[])||${row.channel_codes}))),
    categories=(select array(select distinct unnest(coalesce(categories,'{}'::text[])||${row.categories}))),
    organization_type=case when organization_type='' or organization_type='retailer' then ${row.organization_type} else organization_type end,
    domain=case when domain='' then ${row.domain} else domain end,headquarters=case when headquarters='' then ${row.headquarters} else headquarters end,
    footprint=case when coalesce(footprint,0)=0 then ${row.footprint} else footprint end,ecommerce=ecommerce or ${row.ecommerce},
    source_url=case when source_url='' then ${row.source_url} else source_url end,last_verified=greatest(last_verified,${row.last_verified_at}),
    confidence=greatest(coalesce(confidence,0),${row.confidence}),updated_at=now() where id=${existing.id} returning *`)[0];
  return (await tx`insert into retail_organizations(name,domain,organization_type,channel_codes,categories,coverage,region,headquarters,footprint,ecommerce,verification_status,source_url,last_verified,confidence,updated_at) values(${row.name},${row.domain},${row.organization_type},${row.channel_codes},${row.categories},${row.coverage},${row.region},${row.headquarters},${row.footprint},${row.ecommerce},${row.verification_status},${row.source_url},${row.last_verified_at},${row.confidence},now()) on conflict(lower(name)) do update set channel_codes=(select array(select distinct unnest(coalesce(retail_organizations.channel_codes,'{}'::text[])||excluded.channel_codes))),categories=(select array(select distinct unnest(coalesce(retail_organizations.categories,'{}'::text[])||excluded.categories))),updated_at=now() returning *`)[0];
}

async function upsertAccount(tx,row,organization){
  const existing=(await tx`select * from accounts where active=true and (organization_id=${organization.id} or lower(name)=lower(${row.name}) or lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)}) order by case when organization_id=${organization.id} then 0 else 1 end,updated_at desc limit 1`)[0]||null;
  if(existing)return (await tx`update accounts set organization_id=coalesce(organization_id,${organization.id}),type=case when type='' or type='retailer' then ${row.organization_type} else type end,domain=case when domain='' then ${row.domain} else domain end,category=case when category='' then 'Pharmacy' else category end,source_url=case when source_url='' then ${row.source_url} else source_url end,confidence=greatest(coalesce(confidence,0),${row.confidence}),last_verified_at=greatest(last_verified_at,${row.last_verified_at}),updated_at=now() where id=${existing.id} returning *`)[0];
  return (await tx`insert into accounts(name,type,coverage,region,domain,category,potential,score,notes,source,organization_id,source_url,observed_at,last_verified_at,confidence,evidence_type,verification_status,updated_at) values(${row.name},${row.organization_type},${row.coverage},${row.region},${row.domain},'Pharmacy',0,0,'Public independent and small-chain pharmacy catalog; 100 locations or fewer.','small_pharmacy_catalog',${organization.id},${row.source_url},${row.last_verified_at},${row.last_verified_at},${row.confidence},'retailer_profile','VERIFIED',now()) on conflict(lower(name)) do update set organization_id=coalesce(accounts.organization_id,excluded.organization_id),updated_at=now() returning *`)[0];
}

async function insertBuyer(tx,row,account,organization,contact){
  const duplicate=(await tx`select b.*,a.name account_name from buyers b join accounts a on a.id=b.account_id where (${contact.public_profile_url||''}<>'' and lower(b.linkedin)=lower(${contact.public_profile_url||''})) or (b.account_id=${account.id} and lower(b.name)=lower(${contact.name})) order by case when b.account_id=${account.id} then 0 else 1 end,b.updated_at desc limit 1`)[0]||null;
  if(duplicate)return {status:duplicate.account_id===account.id?'duplicate':'conflict',buyer:duplicate};
  const categoryVerified=contact.category_verification_status==='VERIFIED'&&contact.category_scope&&contact.category_evidence_url,identityVerified=contact.employment_verification_status==='VERIFIED';
  const buyerRow=(await tx`insert into buyers(account_id,name,title,email,phone,linkedin,category,department,category_scope,subcategory_scope,buyer_role,source,source_url,confidence,identity_confidence,category_confidence,category_evidence_url,category_evidence_source,category_last_verified,category_verification_status,employment_verification_status,employment_evidence_url,employment_last_verified,verified_at,status,notes,observed_at,last_verified_at,evidence_type,verification_status,updated_at) values(${account.id},${contact.name},${contact.title},'','',${contact.public_profile_url||''},${categoryVerified?contact.category_scope:''},${contact.department||''},${categoryVerified?contact.category_scope:''},${categoryVerified?contact.subcategory_scope:''},${contact.buyer_role||'UNCONFIRMED'},'small_pharmacy_catalog',${contact.source_url},${contact.identity_confidence},${contact.identity_confidence},${categoryVerified?contact.category_confidence:0},${categoryVerified?contact.category_evidence_url:''},${categoryVerified?contact.source_type:''},${categoryVerified?contact.last_verified_at:null},${categoryVerified?'VERIFIED':'UNCONFIRMED'},${contact.employment_verification_status},${contact.source_url},${identityVerified?contact.last_verified_at:null},${identityVerified?contact.last_verified_at:null},${identityVerified?'Current':'Review Required'},${categoryVerified?'Public evidence confirms category responsibility.':'Public evidence confirms the person and role; category ownership remains unconfirmed.'},${contact.observed_at},${identityVerified?contact.last_verified_at:null},'buyer',${identityVerified?'VERIFIED':'REVIEW_REQUIRED'},now()) returning *`)[0];
  const observation={...contact,employment_evidence_url:contact.source_url,category_last_verified:categoryVerified?contact.last_verified_at:null,evidence_date:contact.observed_at};
  await appendBuyerRelationship(tx,{buyer:buyerRow,account_id:account.id,observation,disposition:relationshipDisposition({},observation)});
  await runLivingIntelligencePipeline({account_id:account.id,organization_id:organization.id,source_url:contact.source_url,source_type:contact.source_type,publisher:row.name,domain:row.domain,subject_type:'buyer',subject_key:`${account.id}:${contact.public_profile_url||contact.name}`,evidence_type:'buyer',payload:{name:contact.name,title:contact.title,department:contact.department,category_scope:categoryVerified?contact.category_scope:'',buyer_role:contact.buyer_role},observed_at:contact.observed_at,last_verified_at:identityVerified?contact.last_verified_at:null,confidence:contact.identity_confidence,verification_status:identityVerified?'VERIFIED':'REVIEW_REQUIRED',acquired_by:'small_pharmacy_catalog'},{sql:tx});
  return {status:'added',buyer:buyerRow};
}

async function commitCatalog(sql,tenant){
  const result={accounts_added:0,accounts_enriched:0,buyers_added:0,buyer_duplicates_prevented:0,buyer_conflicts:0};
  return sql.begin(async tx=>{
    await tx`insert into channels(code,name,description,active) values('independent_pharmacy','Independent & Small-Chain Pharmacies','Independent pharmacies and pharmacy chains with no more than 100 locations',true) on conflict(code) do update set name=excluded.name,description=excluded.description,active=true`;
    for(const row of SMALL_PHARMACY_CATALOG){
      const before=(await tx`select id from retail_organizations where active=true and (lower(name)=lower(${row.name}) or lower(regexp_replace(domain,'^www\\.',''))=${normalized(row.domain)}) limit 1`)[0],organization=await upsertOrganization(tx,row),account=await upsertAccount(tx,row,organization);
      if(before)result.accounts_enriched++;else result.accounts_added++;
      await runLivingIntelligencePipeline({account_id:account.id,organization_id:organization.id,source_url:row.source_url,source_type:'official_company',publisher:row.name,domain:row.domain,subject_type:'retailer_profile',subject_key:`${organization.id}:small_pharmacy_profile`,evidence_type:'retailer_profile',payload:{name:row.name,domain:row.domain,headquarters:row.headquarters,footprint:row.footprint,channel_codes:row.channel_codes,categories:row.categories},observed_at:row.last_verified_at,last_verified_at:row.last_verified_at,confidence:row.confidence,verification_status:'VERIFIED',acquired_by:'small_pharmacy_catalog'},{sql:tx,manufacturer_id:tenant.tenant_id});
      for(const contact of row.buyers){const outcome=await insertBuyer(tx,row,account,organization,contact);if(outcome.status==='added')result.buyers_added++;else if(outcome.status==='duplicate')result.buyer_duplicates_prevented++;else result.buyer_conflicts++}
    }
    await tx`insert into retail_universe_import_runs(source_name,rows_seen,rows_imported,status,errors,finished_at) values(${`Small pharmacy catalog ${SMALL_PHARMACY_CATALOG_VERSION}`},${SMALL_PHARMACY_CATALOG.length},${result.accounts_added+result.accounts_enriched},'complete','[]'::jsonb,now())`;
    return result;
  });
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const tenant=await resolveTenant(req,res,{allowAdminBearer:true,enforceWriteCapability:false});if(!tenant)return;
  if(!requireCapability(tenant,res,CAPABILITIES.TENANT_SECURITY))return;
  res.setHeader('Cache-Control','no-store, max-age=0');
  const catalogErrors=validateSmallPharmacyCatalog();if(catalogErrors.length)return res.status(500).json({error:'The pharmacy catalog failed validation',details:catalogErrors});
  const sql=db();
  try{
    const plan=await buildSmallPharmacyImportPlan(sql);
    if(req.method==='GET')return res.status(200).json({...plan,commit_required:true,policy:'Preview only. No account or buyer data has been changed.'});
    const previewHash=clean(req.body?.preview_hash,100);if(!previewHash)return res.status(409).json({error:'Preview the pharmacy import before committing it'});
    if(previewHash!==plan.preview_hash)return res.status(409).json({error:'The pharmacy import preview is stale; preview it again before committing'});
    const committed=await commitCatalog(sql,tenant);return res.status(200).json({version:SMALL_PHARMACY_CATALOG_VERSION,channel:'independent_pharmacy',committed:true,...committed});
  }catch(error){console.error('small pharmacy import failed',{message:error?.message||String(error)});return res.status(500).json({error:'The pharmacy account import could not be completed; no partial batch was committed'})}
}
