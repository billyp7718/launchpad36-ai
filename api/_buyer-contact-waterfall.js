import { db, upsertBuyer } from './_db.js';
import { searchApolloBuyers } from './_buyer-enrichment.js';

const OPENAI_RESPONSES='https://api.openai.com/v1/responses';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const personKey=value=>clean(value,180).toLowerCase().replace(/[^a-z0-9]+/g,'');
const validEmail=value=>{const email=clean(value,220).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&!/(example\.com|email_not_unlocked@domain\.com)$/.test(email)?email:''};
const buyerRole=title=>/buyer|merchant|merchandis|category|procurement|sourcing|purchasing/i.test(String(title||''));
const roleScore=title=>/chief merchant|chief merchandising/i.test(title)?100:/\b(vp|vice president)\b.*(merch|category|buy|retail|procure|sourc)/i.test(title)?95:/director.*(merch|category|buy|procure|sourc|purchas)/i.test(title)?90:/senior.*(buyer|merchant|category)/i.test(title)?86:/category manager|category merchant|buyer|merchant/i.test(title)?82:/associate.*(buyer|merchant)|assistant.*(buyer|merchant)/i.test(title)?74:60;

function categoryFor(title,categories=[],fallback='General/Unknown'){
  const text=clean(title,240).toLowerCase();let best='',bestHits=0;
  for(const category of categories){const words=clean(category,120).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2),hits=words.filter(w=>text.includes(w)).length;if(hits>bestHits){bestHits=hits;best=category}}
  return best||fallback||'General/Unknown';
}

function outputText(payload={}){
  if(typeof payload.output_text==='string')return payload.output_text;
  for(const item of Array.isArray(payload.output)?payload.output:[])for(const part of Array.isArray(item.content)?item.content:[])if(part.type==='output_text'&&typeof part.text==='string')return part.text;
  return '';
}
function webSources(payload={}){
  const out=[],seen=new Set(),add=(url,title='')=>{try{const u=new URL(String(url||''));if(!/^https?:$/.test(u.protocol))return;u.hash='';const key=`${u.hostname}${u.pathname}${u.search}`.toLowerCase();if(seen.has(key))return;seen.add(key);out.push({url:u.toString(),title:clean(title,220)})}catch{}};
  for(const item of Array.isArray(payload.output)?payload.output:[]){for(const source of Array.isArray(item.action?.sources)?item.action.sources:[])add(source.url,source.title);for(const part of Array.isArray(item.content)?item.content:[])for(const annotation of Array.isArray(part.annotations)?part.annotations:[]){const c=annotation.url_citation||annotation;if(annotation.type==='url_citation'||annotation.url_citation)add(c.url,c.title)}}
  return out;
}

async function searchPublicBuyerEmails({account,domain,buyers=[]}){
  const key=process.env.OPENAI_API_KEY;if(!key||!buyers.length)return {status:key?'NO_INPUT':'NOT_CONFIGURED',matches:[],sources:[]};
  const model=clean(process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6',80);
  const targets=buyers.slice(0,12).map(b=>({name:clean(b.name,160),title:clean(b.title,180),category:clean(b.category,160)}));
  const schema={type:'object',additionalProperties:false,properties:{matches:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},title:{type:'string'},email:{type:'string'},source_url:{type:'string'},source_title:{type:'string'},evidence_quote:{type:'string'},confidence:{type:'integer'}},required:['name','title','email','source_url','source_title','evidence_quote','confidence']}}},required:['matches']};
  const prompt=`Find publicly displayed professional work email addresses for the exact current retail buying contacts below at ${account} (${domain}). Targets: ${JSON.stringify(targets)}. Search official company pages, public vendor/contact documents, trade publications, conference bios, public PDFs, press releases, and other attributable public sources. Return a match only when the source explicitly displays the email address and supports that it belongs to the named person or clearly identifies that exact buyer. Do not infer email patterns, do not generate likely addresses, and do not return personal emails. If no public work email is displayed for a person, omit them. evidence_quote must be a short exact excerpt under 20 words containing or directly supporting the email.`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),65000);
  try{
    const response=await fetch(OPENAI_RESPONSES,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model,reasoning:{effort:'low'},tools:[{type:'web_search',search_context_size:'medium',user_location:{type:'approximate',country:'US'}}],tool_choice:'auto',include:['web_search_call.action.sources'],input:prompt,max_output_tokens:2500,text:{format:{type:'json_schema',name:'buyer_public_email_lookup',strict:true,schema}}})});
    let body={};try{body=await response.json()}catch{}if(!response.ok)return {status:'ERROR',matches:[],sources:[],error:clean(body.error?.message||body.error||`OpenAI returned ${response.status}`,240)};
    let parsed={};try{parsed=JSON.parse(outputText(body)||'{}')}catch{return {status:'ERROR',matches:[],sources:webSources(body),error:'OpenAI returned invalid structured JSON during email lookup'}}
    const sources=webSources(body),sourceSet=new Set(sources.map(s=>s.url.replace(/\/$/,''))),targetMap=new Map(targets.map(t=>[personKey(t.name),t]));
    const matches=[];for(const row of Array.isArray(parsed.matches)?parsed.matches:[]){const name=clean(row.name,160),email=validEmail(row.email),source=clean(row.source_url,500).replace(/\/$/,'');if(!name||!email||!sourceSet.has(source)||!targetMap.has(personKey(name)))continue;matches.push({name,title:clean(row.title,180),email,source_url:source,source_title:clean(row.source_title,220),evidence_quote:clean(row.evidence_quote,240),confidence:Math.min(95,Math.max(70,Number(row.confidence)||80))})}
    return {status:matches.length?'SUCCESS':'NO_RESULTS',matches,sources};
  }catch(error){return {status:'ERROR',matches:[],sources:[],error:error.name==='AbortError'?'Public email lookup timed out':clean(error.message,240)}}finally{clearTimeout(timeout)}
}

export async function enrichBuyerContacts({organizationId,tenantId}){
  const sql=db();
  const org=(await sql`select * from retail_organizations where id=${organizationId} limit 1`)[0];if(!org)return {status:'NO_ACCOUNT',added:0,updated:0,emails_added:0};
  const account=(await sql`select * from accounts where organization_id=${organizationId} or lower(name)=lower(${org.name}) order by updated_at desc limit 1`)[0];if(!account)return {status:'NO_ACCOUNT_RECORD',added:0,updated:0,emails_added:0};
  const productRows=tenantId?await sql`select distinct category, product_family from products where manufacturer_id=${tenantId} and active=true limit 40`:[];
  const categories=[...new Set([...(Array.isArray(org.categories)?org.categories:[]),...productRows.flatMap(r=>[r.category,r.product_family])].map(x=>clean(x,120)).filter(Boolean))].slice(0,10);
  let existing=await sql`select * from buyers where account_id=${account.id} order by confidence desc, updated_at desc`;
  const existingByName=new Map(existing.map(b=>[personKey(b.name),b]));
  const apollo=await searchApolloBuyers({domain:org.domain||account.domain||'',categories});
  let added=0,updated=0,emailsAdded=0;
  for(const person of (apollo.people||[]).filter(p=>buyerRole(p.title)).slice(0,35)){
    const prior=existingByName.get(personKey(person.name)),email=validEmail(person.email)||validEmail(prior?.email),linkedin=clean(person.linkedin||prior?.linkedin,500),category=categoryFor(person.title,categories,prior?.category||'General/Unknown');
    const saved=await upsertBuyer({account_id:account.id,name:person.name,title:person.title,email,phone:prior?.phone||'',linkedin,category,source:person.source_label||'Apollo buyer discovery',source_url:person.source_url||linkedin||org.source_url||'',confidence:Math.max(Number(prior?.confidence)||0,Number(person.confidence)||82),verified_at:null,status:'Review Required',notes:`Buyer/contact waterfall; ${person.contact_basis||'Apollo account-domain buyer match.'}`,observed_at:new Date().toISOString(),last_verified_at:null,evidence_type:'buyer',verification_status:'REVIEW_REQUIRED'});
    if(prior){updated++;if(!prior.email&&email)emailsAdded++}else{added++;if(email)emailsAdded++}
    existingByName.set(personKey(saved.name),saved);
  }
  existing=await sql`select * from buyers where account_id=${account.id} order by confidence desc, updated_at desc`;
  const missing=existing.filter(b=>buyerRole(b.title)&&!validEmail(b.email)).sort((a,b)=>roleScore(b.title)-roleScore(a.title)).slice(0,12);
  const publicEmail=await searchPublicBuyerEmails({account:org.name,domain:org.domain||account.domain||'',buyers:missing});
  for(const match of publicEmail.matches||[]){const buyer=existing.find(b=>personKey(b.name)===personKey(match.name));if(!buyer||validEmail(buyer.email))continue;await sql`update buyers set email=${match.email}, source='Public email verification', source_url=${match.source_url}, confidence=greatest(confidence,${Number(match.confidence)||80}), notes=${`Public work email verified from ${match.source_title||'web source'}${match.evidence_quote?`; evidence: ${match.evidence_quote}`:''}`}, updated_at=now() where id=${buyer.id}`;emailsAdded++;updated++}
  const finalBuyers=await sql`select * from buyers where account_id=${account.id} order by confidence desc, updated_at desc`;
  return {status:'SUCCESS',buyers:finalBuyers,added,updated,emails_added:emailsAdded,total_buyers:finalBuyers.length,total_with_email:finalBuyers.filter(b=>validEmail(b.email)).length,categories_searched:categories,apollo:{status:apollo.status,candidates:(apollo.people||[]).length,enriched_count:Number(apollo.enriched_count)||0,credits_used:Number(apollo.credits_used)||0,error:apollo.error||''},public_email:{status:publicEmail.status,matches:(publicEmail.matches||[]).length,error:publicEmail.error||''}};
}
