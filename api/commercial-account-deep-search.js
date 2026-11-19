import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { domainFromWebsite } from './_url.js';
import { ensureCommercialAccountSchema, normalizeAccountWorkspaceSection } from './_commercial-accounts.js';
import { searchCommercialContacts } from './_commercial-contact-research.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));

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
  return res.status(200).json({status:research.status,application_section:sectionKey,account:{id:account.id,name:account.name,domain,account_category:account.account_category,account_subcategory:account.account_subcategory},focus,candidates:research.candidates||[],search_summary:research.search_summary||'',provider:{name:'OpenAI web research',status:research.status,error:research.error||''},interpretation:research.candidates?.length?`${research.candidates.length} source-backed candidate${research.candidates.length===1?'':'s'} found for review.`:'No source-backed decision-maker contacts were confirmed. This remains unknown, not proof that no contact exists.'});
 }catch(error){console.error('account decision-maker deep search failed',{application_section:sectionKey,message:error?.message||String(error)});return res.status(500).json({error:`${sectionLabel} account Deep Search could not be completed`});}
}
