import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { domainFromWebsite, normalizePublicUrl } from './_url.js';
import { ensureCommercialAccountSchema, normalizeAccountWorkspaceSection } from './_commercial-accounts.js';
import { searchCommercialContacts } from './_commercial-contact-research.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));

export function normalizeCommercialResearchContactForSave(candidate={}){
 const name=clean(candidate.name,180),title=clean(candidate.title,180),sourceUrl=normalizePublicUrl(candidate.source_url);if(!name||!title||!sourceUrl)return null;
 const rawEmail=clean(candidate.email,200).toLowerCase(),linkedin=normalizePublicUrl(candidate.linkedin),confidence=Math.min(100,Math.max(0,Math.round(Number(candidate.identity_confidence)||0)));
 return {name,title,department:clean(candidate.department,180),category_scope:clean(candidate.responsibility_scope,240),email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)?rawEmail:'',phone:clean(candidate.phone,80),linkedin:/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(linkedin)?linkedin:'',source_url:sourceUrl,verification_status:'REVIEW_REQUIRED',confidence};
}

async function saveResearchContacts(sql,tenant,account,sectionKey,candidates=[]){
 return sql.begin(async transaction=>{
  const saved=[];
  for(const candidate of candidates){
   const record=normalizeCommercialResearchContactForSave(candidate);if(!record)throw new Error('A source-backed contact could not be prepared for saving');
   const prior=(await transaction`select id,verification_status from commercial_decision_makers where commercial_account_id=${account.id} and manufacturer_id=${tenant.tenant_id} and lower(name)=lower(${record.name}) and lower(title)=lower(${record.title}) and active=true limit 1 for update`)[0];let row;
   if(prior)row=(await transaction`update commercial_decision_makers set department=case when verification_status='VERIFIED' and department<>'' then department when ${record.department}<>'' then ${record.department} else department end,category_scope=case when verification_status='VERIFIED' and category_scope<>'' then category_scope when ${record.category_scope}<>'' then ${record.category_scope} else category_scope end,email=case when verification_status='VERIFIED' and email<>'' then email when ${record.email}<>'' then ${record.email} else email end,phone=case when verification_status='VERIFIED' and phone<>'' then phone when ${record.phone}<>'' then ${record.phone} else phone end,linkedin=case when verification_status='VERIFIED' and linkedin<>'' then linkedin when ${record.linkedin}<>'' then ${record.linkedin} else linkedin end,source_url=case when verification_status='VERIFIED' and source_url<>'' then source_url else ${record.source_url} end,verification_status=case when verification_status='VERIFIED' then verification_status else 'REVIEW_REQUIRED' end,confidence=greatest(confidence,${record.confidence}),updated_at=now() where id=${prior.id} and manufacturer_id=${tenant.tenant_id} returning *`)[0];
   else row=(await transaction`insert into commercial_decision_makers(manufacturer_id,commercial_account_id,name,title,department,category_scope,email,phone,linkedin,source_url,verification_status,confidence) values(${tenant.tenant_id},${account.id},${record.name},${record.title},${record.department},${record.category_scope},${record.email},${record.phone},${record.linkedin},${record.source_url},'REVIEW_REQUIRED',${record.confidence}) returning *`)[0];
   await transaction`insert into tenant_activity_log(manufacturer_id,user_id,action,subject_type,subject_id,metadata) values(${tenant.tenant_id},${tenant.user_id},'COMMERCIAL_DECISION_MAKER_RESEARCH_SAVED','commercial_decision_maker',${row.id},${transaction.json({application_section:sectionKey,commercial_account_id:account.id,source_url:record.source_url,automatic:true,created:!prior})})`;
   saved.push({...row,created:!prior});
  }
  return saved;
 });
}

export default async function handler(req,res){
 const sectionKey=normalizeAccountWorkspaceSection(req.body?.section_key);if(!sectionKey)return res.status(400).json({error:'Choose Commercial Goods or Services'});
 const sectionLabel=sectionKey==='services'?'Services':'Commercial Goods',tenant=await resolveTenant(req,res,{requiredSection:sectionKey});if(!tenant)return;
 if(!requireCapability(tenant,res,CAPABILITIES.DEEP_SEARCH))return;
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const accountId=clean(req.body?.commercial_account_id,80),focus=clean(req.body?.focus,240);if(!uuid(accountId))return res.status(400).json({error:`Choose a valid ${sectionLabel} account`});if(!focus)return res.status(400).json({error:'Enter the decision-maker function or responsibility to research'});
 const sql=db();await ensureCommercialAccountSchema(sql);res.setHeader('Cache-Control','private, no-store');
 try{
  const account=(await sql`select id,name,domain,website,account_category,account_subcategory from commercial_accounts where id=${accountId} and manufacturer_id=${tenant.tenant_id} and ${sectionKey}=any(application_sections) and active=true limit 1`)[0];if(!account)return res.status(404).json({error:`${sectionLabel} account was not found`});
  const domain=domainFromWebsite(account.website||account.domain);if(!domain)return res.status(400).json({error:'Add a valid website or domain before running Deep Search'});
  const research=await searchCommercialContacts({account:account.name,domain,focus});
  const saved=research.candidates?.length?await saveResearchContacts(sql,tenant,account,sectionKey,research.candidates):[],savedByIdentity=new Map(saved.map(row=>[`${row.name}|${row.title}`.toLowerCase(),row])),candidates=(research.candidates||[]).map(candidate=>{const row=savedByIdentity.get(`${candidate.name}|${candidate.title}`.toLowerCase());return {...candidate,saved_decision_maker_id:row?.id||'',saved_to_account:Boolean(row),created:Boolean(row?.created)}});
  return res.status(200).json({status:research.status,application_section:sectionKey,account:{id:account.id,name:account.name,domain,account_category:account.account_category,account_subcategory:account.account_subcategory},focus,candidates,saved_count:saved.length,search_summary:research.search_summary||'',provider:{name:'OpenAI web research',status:research.status,error:research.error||''},interpretation:saved.length?`${saved.length} source-backed contact${saved.length===1?'':'s'} found and saved to ${account.name} for review.`:'No source-backed decision-maker contacts were confirmed. This remains unknown, not proof that no contact exists.'});
 }catch(error){console.error('account decision-maker deep search failed',{application_section:sectionKey,message:error?.message||String(error)});return res.status(500).json({error:`${sectionLabel} account Deep Search could not be completed`});}
}
