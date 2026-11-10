import { createHash } from 'node:crypto';
import { domainFromWebsite, normalizePublicUrl } from './_url.js';

const AUTHORITATIVE_SOURCES=new Set(['official_company','official_retailer','company_press_release','press_release','trade_publication','conference','vendor_announcement']);
const STATUSES=new Set(['VERIFIED','PROBABLE','UNCONFIRMED','STALE','CONFLICTING']);
const ROLES=new Set(['DIRECT_BUYER','CATEGORY_OWNER','MERCHANT','MERCHANDISING_LEADER','INFLUENCER','EXECUTIVE','UNCONFIRMED']);
const FREE_EMAIL=new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','proton.me','protonmail.com']);
const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const integer=value=>Math.min(100,Math.max(0,Number(value)||0));
const date=value=>{if(!value)return null;const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString():null};
const list=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[|;,]/)).map(item=>clean(item,180)).filter(Boolean))].slice(0,25);
const url=value=>normalizePublicUrl(value);
const normalized=value=>clean(value,300).toLowerCase().replace(/[^a-z0-9]+/g,'');

export function normalizeBuyerImportRecord(input={}){
  const sourceUrl=url(input.source_url),profileUrl=url(input.public_profile_url||input.linkedin),contactSourceUrl=url(input.contact_source_url),accountDomain=domainFromWebsite(input.account_domain||input.domain||''),email=clean(input.public_email||input.email,200).toLowerCase(),emailDomain=email.includes('@')?email.split('@').pop():'';
  const contactPublished=input.contact_published===true||String(input.contact_provenance||'').toUpperCase()==='PUBLISHED_BUSINESS';
  const allowContact=Boolean(contactPublished&&contactSourceUrl);
  return {
    account_name:clean(input.account_name||input.retailer||input.account,180),account_domain:accountDomain,
    account_type:clean(input.account_type||'retailer',60).toLowerCase(),account_channels:list(input.account_channels||input.channels),account_categories:list(input.account_categories||input.categories),
    name:clean(input.name||input.buyer_name,180),title:clean(input.title,200),department:clean(input.department,180),category_scope:clean(input.category_scope||input.category,240),subcategory_scope:clean(input.subcategory_scope,240),
    buyer_role:ROLES.has(clean(input.buyer_role||'UNCONFIRMED',40).toUpperCase())?clean(input.buyer_role||'UNCONFIRMED',40).toUpperCase():'UNCONFIRMED',
    public_profile_url:profileUrl,public_email:allowContact&&email&&!FREE_EMAIL.has(emailDomain)?email:'',public_phone:allowContact?clean(input.public_phone||input.phone,80):'',
    contact_source_url:allowContact?contactSourceUrl:'',contact_published:allowContact,
    source_url:sourceUrl,source_type:clean(input.source_type||'public_research',60).toLowerCase(),source_publication_date:date(input.source_publication_date||input.publication_date),
    observed_at:date(input.observed_at)||new Date().toISOString(),last_verified_at:date(input.last_verified_at),identity_confidence:integer(input.identity_confidence??input.confidence),category_confidence:integer(input.category_confidence),
    employment_verification_status:STATUSES.has(clean(input.employment_verification_status||input.identity_verification_status||'UNCONFIRMED',30).toUpperCase())?clean(input.employment_verification_status||input.identity_verification_status||'UNCONFIRMED',30).toUpperCase():'UNCONFIRMED',
    category_verification_status:STATUSES.has(clean(input.category_verification_status||'UNCONFIRMED',30).toUpperCase())?clean(input.category_verification_status||'UNCONFIRMED',30).toUpperCase():'UNCONFIRMED',
    category_evidence_url:url(input.category_evidence_url),notes:clean(input.notes,1000)
  };
}

export function validateBuyerImportRecord(record={}){
  const errors=[];if(!record.account_name)errors.push('Account name is required');if(!record.name)errors.push('Buyer name is required');if(!record.title)errors.push('Current title is required');if(!record.source_url)errors.push('Attributable source URL is required');if(!record.observed_at)errors.push('Observed timestamp is required');
  if(record.public_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.public_email))errors.push('Published business email is invalid');
  if((record.public_email||record.public_phone)&&!record.contact_source_url)errors.push('Published contact information requires its own source URL');
  if(record.category_verification_status==='VERIFIED'&&(!record.category_scope||!record.category_evidence_url))errors.push('Verified category ownership requires category scope and category evidence URL');
  return errors;
}

export function authoritativeIdentity(record={}){
  return Boolean(record.source_url&&AUTHORITATIVE_SOURCES.has(record.source_type)&&['VERIFIED','STALE'].includes(record.employment_verification_status)&&record.identity_confidence>=80&&record.last_verified_at);
}

export function authoritativeCategory(record={}){
  return authoritativeIdentity(record)&&record.category_verification_status==='VERIFIED'&&record.category_confidence>=80&&Boolean(record.category_scope&&record.category_evidence_url);
}

export function buyerImportRecordKey(record={}){
  return createHash('sha256').update([record.account_domain||normalized(record.account_name),record.public_profile_url||normalized(record.name)].join('|')).digest('hex');
}

export function buyerImportPayloadHash(records=[]){return createHash('sha256').update(JSON.stringify(records)).digest('hex')}

export function planBuyerImport(existing,record){
  const errors=validateBuyerImportRecord(record);if(errors.length)return {action:'REJECTED',result:'REJECTED',reasons:errors};
  const identityVerified=authoritativeIdentity(record),categoryVerified=authoritativeCategory(record);
  if(!existing)return identityVerified?{action:'ADD_BUYER',result:'READY',reasons:categoryVerified?['Authoritative identity and category evidence']:['Authoritative identity evidence; category remains unconfirmed']}:{action:'REVIEW_REQUIRED',result:'FLAGGED',reasons:['Authoritative current-employment evidence is required before creating a buyer']};
  const changed=[];
  for(const field of ['title','department','category_scope','subcategory_scope','buyer_role','public_profile_url','public_email','public_phone']){
    const previous=field==='public_profile_url'?existing.linkedin:field==='public_email'?existing.email:field==='public_phone'?existing.phone:existing[field];
    if(clean(record[field])&&normalized(previous)!==normalized(record[field]))changed.push(field);
  }
  if(record.employment_verification_status==='STALE'&&identityVerified)return {action:'MARK_STALE',result:'READY',reasons:['Authoritative evidence indicates the buyer left or changed employer']};
  if(!changed.length)return {action:'DUPLICATE_PREVENTED',result:'NO_CHANGE',reasons:['Matching account and buyer record already contains this information']};
  if(!identityVerified)return {action:'REVIEW_REQUIRED',result:'FLAGGED',reasons:['Changes require authoritative current-employment evidence',`Changed fields: ${changed.join(', ')}`]};
  const categoryFields=changed.filter(field=>['department','category_scope','subcategory_scope','buyer_role'].includes(field));
  if(categoryFields.length&&!categoryVerified)return {action:'REVIEW_REQUIRED',result:'FLAGGED',reasons:['Category responsibility changes require separate authoritative category evidence',`Changed fields: ${changed.join(', ')}`]};
  return {action:'UPDATE_BUYER',result:'READY',reasons:[`Authoritative evidence supports changes to: ${changed.join(', ')}`]};
}

export function importCounts(items=[]){
  const counts={records_seen:items.length,records_added:0,records_updated:0,records_flagged:0,duplicates_prevented:0,records_rejected:0};
  for(const item of items){if(item.action==='ADD_BUYER')counts.records_added++;else if(['UPDATE_BUYER','MARK_STALE'].includes(item.action))counts.records_updated++;else if(item.action==='REVIEW_REQUIRED')counts.records_flagged++;else if(item.action==='DUPLICATE_PREVENTED')counts.duplicates_prevented++;else if(item.action==='REJECTED')counts.records_rejected++}
  return counts;
}
