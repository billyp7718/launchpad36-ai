import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { ensureCommercialAccountSchema, normalizeCommercialCategory } from './_commercial-accounts.js';
import { searchCommercialContacts } from './_commercial-contact-research.js';
import { domainFromWebsite, normalizePublicUrl } from './_url.js';
import { discover } from './_lead-discovery.js';

const clean = (value, size=180) => String(value || '').trim().slice(0,size);
const invalid = message => Object.assign(new Error(message), {status:400});
async function mailingTable(sql) {
  await sql`create table if not exists lead_generation_recipients (
    manufacturer_id uuid not null references manufacturers(id) on delete cascade,
    section_key text not null, email text not null, name text not null, title text not null,
    account text not null, source_url text not null, primary key(manufacturer_id,section_key,email))`;
}
function readContacts(rows) {
  if (!Array.isArray(rows) || rows.length > 20) throw invalid('Select up to 20 contacts per account.');
  return rows.map(row=>{
    const name=clean(row.name), title=clean(row.title), source=normalizePublicUrl(row.source_url);
    if (!name || !title || !source) throw invalid('A contact needs a name, title and public source.');
    const email=clean(row.email,250).toLowerCase(), contactSource=normalizePublicUrl(row.contact_source_url);
    return {name,title,source,email:contactSource && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',contactSource,phone:clean(row.phone,80),scope:clean(row.responsibility_scope,240)};
  });
}
async function saveAccount(tx, tenant, section, target, contacts) {
  const name=clean(target.name), domain=domainFromWebsite(target.website), website=normalizePublicUrl(target.website),
    source=normalizePublicUrl(target.source_url), region=clean(target.region), category=normalizeCommercialCategory(target.account_category);
  if (!name || !source || !category) throw invalid('An account needs a name, category and source.');
  if (section==='consumer_goods') {
    const [org]=await tx`insert into retail_organizations(name,domain,organization_type,categories,region,source_url)
      values(${name},${domain},${clean(target.channel)||'prospect'},array[${category}]::text[],${region},${source})
      on conflict(lower(name)) do update set name=retail_organizations.name where retail_organizations.active returning id`;
    if (!org) throw invalid('This account is archived.');
    const [account]=await tx`insert into accounts(name,organization_id,domain,source,source_url) values(${name},${org.id},${domain},'lead_generation',${source})
      on conflict(lower(name)) do update set organization_id=coalesce(accounts.organization_id,excluded.organization_id)
      where accounts.active and (accounts.organization_id is null or accounts.organization_id=excluded.organization_id) returning id`;
    if (!account) throw invalid('This account needs an identity review before saving.');
    for (const c of contacts) await tx`insert into buyers(account_id,name,title,email,phone,category_scope,source,source_url,verification_status)
      values(${account.id},${c.name},${c.title},${c.email},${c.phone},${c.scope},'lead_generation',${c.source},'REVIEW_REQUIRED')
      on conflict(account_id,lower(name),lower(title)) do nothing`;
    return;
  }
  const [account]=await tx`insert into commercial_accounts(manufacturer_id,application_sections,name,domain,website,account_category,organization_type,region,source_url,source_type,created_by)
    values(${tenant.tenant_id},array[${section}]::text[],${name},${domain},${website},${category},${clean(target.channel)||'prospect'},${region},${source},'lead_generation',${tenant.user_id})
    on conflict(manufacturer_id,lower(name)) do update set application_sections=case when ${section}=any(commercial_accounts.application_sections)
    then commercial_accounts.application_sections else array_append(commercial_accounts.application_sections,${section}) end where commercial_accounts.active returning id`;
  if (!account) throw invalid('This account is archived.');
  for (const c of contacts) await tx`insert into commercial_decision_makers(manufacturer_id,commercial_account_id,name,title,email,phone,category_scope,source_url,verification_status)
    values(${tenant.tenant_id},${account.id},${c.name},${c.title},${c.email},${c.phone},${c.scope},${c.source},'REVIEW_REQUIRED')
    on conflict(commercial_account_id,lower(name),lower(title)) do nothing`;
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const section=req.body?.section_key || req.query?.section_key;
  if (!['commercial_goods','services','consumer_goods'].includes(section)) return res.status(400).json({error:'Choose an application section.'});
  const tenant=await resolveTenant(req,res,{requiredSection:section});
  if (!tenant) return;
  try {
    if (req.method==='GET') {
      const sql=db(); await mailingTable(sql);
      const recipients=await sql`select account,name,title,email,source_url from lead_generation_recipients where manufacturer_id=${tenant.tenant_id} and section_key=${section} order by account,name`;
      return res.json({recipients});
    }
    if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
    const {action,target={},contacts=[],exclude=[]}=req.body;
    if (action==='discover' || action==='research') {
      if (!requireCapability(tenant,res,CAPABILITIES.DEEP_SEARCH)) return;
      if (action==='discover') {
        const query=clean(req.body.query,500);
        if (!query || !Array.isArray(exclude) || exclude.length>4000) throw invalid('Enter search criteria or narrow the geography.');
        return res.json(await discover(query,exclude.map(n=>clean(n))));
      }
      const focus=clean(req.body.focus,240), account=clean(target.name);
      if (!account || !focus) throw invalid('Choose a target and enter a responsibility.');
      const research=await searchCommercialContacts({account,domain:domainFromWebsite(target.website),focus:clean(focus+' (target location: '+clean(target.region)+')',240)});
      if (research.error) throw new Error(research.error);
      return res.json({contacts:research.candidates});
    }
    if (!['accounts','recipients'].includes(action) || !clean(target.name)) throw invalid('Choose a target.');
    const selected=readContacts(contacts), sql=db();
    if (action==='accounts') {
      if (section==='consumer_goods' && !requireCapability(tenant,res,CAPABILITIES.BUYER_INTELLIGENCE_ADMIN)) return;
      if (section!=='consumer_goods') await ensureCommercialAccountSchema(sql);
      await sql.begin(tx=>saveAccount(tx,tenant,section,target,selected));
    } else {
      await mailingTable(sql);
      await sql.begin(async tx=>{
        for (const c of selected.filter(c=>c.email)) await tx`insert into lead_generation_recipients(manufacturer_id,section_key,email,name,title,account,source_url)
          values(${tenant.tenant_id},${section},${c.email},${c.name},${c.title},${clean(target.name)},${c.contactSource}) on conflict do nothing`;
      });
    }
    return res.json({ok:true});
  } catch(error) {
    return res.status(error.status || 502).json({error:error.status ? error.message : ['research','discover'].includes(req.body?.action) ? 'Research failed. '+clean(error.message,220) : 'The list could not be updated or loaded.'});
  }
}
