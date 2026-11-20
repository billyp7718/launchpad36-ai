import { db, upsertBuyer } from './_db.js';
import { searchApolloBuyers } from './_buyer-enrichment.js';

const OPENAI_RESPONSES='https://api.openai.com/v1/responses';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const personKey=value=>clean(value,180).toLowerCase().replace(/[^a-z0-9]+/g,'');
const validPhone=value=>{const p=clean(value,80),d=p.replace(/\D/g,'');return d.length>=10&&d.length<=15?p:''};
const providerVerified=value=>/^(verified|valid|deliverable)$/i.test(clean(value,60));

export function validPublishedEmail(value){
  const email=clean(value,220).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&!/(example\.(com|org|net)|email_not_unlocked@domain\.com)$/.test(email)?email:'';
}

export function buyerContactRole(title=''){
  return /buyer|merchant|merchandis|category|procurement|sourcing|purchasing|divisional merchandise|\bdmm\b|general merchandise manager|\bgmm\b|commercial director|product director|\b(vp|vice president|director)\b.*(audio|home|electronics|appliance|beauty|grocery|food|beverage|pharmacy|hardware|sport|outdoor|furniture|seasonal|automotive|pet|toy|apparel|footwear)/i.test(String(title));
}

function roleScore(title=''){
  return /chief merchant|chief merchandising|general merchandise manager|\bgmm\b/i.test(title)?100
    :/\b(vp|vice president)\b.*(merch|category|buy|retail|procure|sourc|commercial|product)/i.test(title)?95
    :/(divisional merchandise manager|\bdmm\b)|director.*(merch|category|buy|procure|sourc|purchas|commercial|product)/i.test(title)?90
    :/senior.*(buyer|merchant|category)/i.test(title)?86
    :/category manager|category merchant|buyer|merchant/i.test(title)?82
    :/associate.*(buyer|merchant)|assistant.*(buyer|merchant)/i.test(title)?74:60;
}

export function canonicalContactUrl(value=''){
  try{
    const url=new URL(String(value));
    if(!/^https?:$/.test(url.protocol))return '';
    url.hash='';url.hostname=url.hostname.toLowerCase().replace(/^www\./,'');
    for(const key of [...url.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname=(url.pathname.replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/');
    return url.toString().replace(/\/$/,'');
  }catch{return ''}
}

export function extractPublishedEmails(value=''){
  const text=String(value||'').replace(/&commat;|&#64;/gi,'@');
  const decoded=text
    .replace(/\s*(?:\[at\]|\(at\)|\{at\}|\sat\s)\s*/gi,'@')
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s)\s*/gi,'.');
  const matches=decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi)||[];
  return [...new Set(matches.map(validPublishedEmail).filter(Boolean))];
}

export async function ensureBuyerEmailEvidenceSchema(sql=db()){
  await sql`alter table buyers add column if not exists email_source_url text not null default ''`;
  await sql`alter table buyers add column if not exists email_evidence_quote text not null default ''`;
  await sql`alter table buyers add column if not exists email_source_type text not null default ''`;
  await sql`alter table buyers add column if not exists email_verification_status text not null default 'NOT_FOUND'`;
  await sql`alter table buyers add column if not exists email_last_verified timestamptz`;
}

function outputText(payload={}){
  if(typeof payload.output_text==='string')return payload.output_text;
  for(const item of Array.isArray(payload.output)?payload.output:[])for(const part of Array.isArray(item.content)?item.content:[])if(part.type==='output_text'&&typeof part.text==='string')return part.text;
  return '';
}

function webSources(payload={}){
  const out=[],seen=new Set(),add=(url,title='')=>{const canonical=canonicalContactUrl(url);if(!canonical||seen.has(canonical))return;seen.add(canonical);out.push({url:clean(url,800),canonical_url:canonical,title:clean(title,220)})};
  for(const item of Array.isArray(payload.output)?payload.output:[]){
    for(const source of Array.isArray(item.action?.sources)?item.action.sources:[])add(source.url,source.title);
    for(const part of Array.isArray(item.content)?item.content:[])for(const annotation of Array.isArray(part.annotations)?part.annotations:[]){const citation=annotation.url_citation||annotation;if(annotation.type==='url_citation'||annotation.url_citation)add(citation.url,citation.title)}
  }
  return out;
}

function providerFailure(response,body={}){
  const code=clean(body.error?.code||body.code,80),message=clean(body.error?.message||body.error||body.message,240);
  if(response.status===402||(response.status===429&&/quota|credit|billing/i.test(`${code} ${message}`)))return {status:'CREDITS_EXHAUSTED',error:message||'Research credits are unavailable'};
  if(response.status===401||response.status===403)return {status:'PROVIDER_UNAVAILABLE',error:'Public email research provider is unavailable'};
  return {status:'ERROR',error:message||`OpenAI returned ${response.status}`};
}

async function webStructured({prompt,schema,name,maxOutput=1800},{fetcher=fetch,timeoutMs=25000}={}){
  const key=process.env.OPENAI_API_KEY;if(!key)return {status:'PROVIDER_UNAVAILABLE',error:'OpenAI web research is not configured',sources:[]};
  const model=clean(process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6',80);
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetcher(OPENAI_RESPONSES,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model,reasoning:{effort:attempt===1?'low':'minimal'},tools:[{type:'web_search',search_context_size:attempt===1?'medium':'low',user_location:{type:'approximate',country:'US'}}],tool_choice:'auto',include:['web_search_call.action.sources'],input:prompt,max_output_tokens:maxOutput,text:{format:{type:'json_schema',name,strict:true,schema}}})});
      let body={};try{body=await response.json()}catch{}
      if(!response.ok){const failure=providerFailure(response,body);if(attempt===1&&(response.status===408||response.status===429||response.status>=500))continue;return {...failure,sources:[],attempts:attempt}}
      let parsed={};try{parsed=JSON.parse(outputText(body)||'{}')}catch{return {status:'ERROR',error:'OpenAI returned invalid structured JSON',sources:webSources(body),attempts:attempt}}
      return {status:'SUCCESS',parsed,sources:webSources(body),attempts:attempt};
    }catch(error){if(attempt===1&&(error?.name==='AbortError'||/timeout|aborted|fetch failed/i.test(String(error?.message))))continue;return {status:'ERROR',error:error?.name==='AbortError'?'Public email lookup timed out':clean(error?.message,240),sources:[],attempts:attempt}}
    finally{clearTimeout(timeout)}
  }
  return {status:'ERROR',error:'Public email lookup failed',sources:[],attempts:2};
}

const EMAIL_SCHEMA={type:'object',additionalProperties:false,properties:{matches:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},title:{type:'string'},email:{type:'string'},source_url:{type:'string'},source_title:{type:'string'},evidence_quote:{type:'string'},confidence:{type:'integer'}},required:['name','title','email','source_url','source_title','evidence_quote','confidence']}}},required:['matches']};

function validateEmailMatch(row,target,sources){
  const name=clean(row?.name,160),email=validPublishedEmail(row?.email),sourceUrl=clean(row?.source_url,800),canonical=canonicalContactUrl(sourceUrl),evidenceQuote=clean(row?.evidence_quote,500);
  const cited=sources.some(source=>source.canonical_url===canonical),quoted=extractPublishedEmails(evidenceQuote).includes(email);
  if(!name||personKey(name)!==personKey(target.name))return {status:'EVIDENCE_REJECTED',reason:'The result did not match the requested buyer'};
  if(!email)return {status:'EVIDENCE_REJECTED',reason:'The source did not contain a valid professional email'};
  if(!canonical||!cited)return {status:'EVIDENCE_REJECTED',reason:'The email source was not present in the provider citations'};
  if(!quoted)return {status:'EVIDENCE_REJECTED',reason:'The evidence excerpt did not display the exact email address'};
  return {status:'PUBLICLY_VERIFIED',match:{name,title:clean(row.title,180),email,source_url:sourceUrl,source_title:clean(row.source_title,220),evidence_quote:evidenceQuote,source_type:'public_web',verification_status:'PUBLICLY_VERIFIED',last_verified_at:new Date().toISOString(),confidence:Math.min(96,Math.max(75,Number(row.confidence)||85))}};
}

async function researchOneBuyer({account,domain,target},options={}){
  const passes=[
    'Prioritize the employer official website, public staff/contact pages, supplier documents, downloadable PDFs and official press releases.',
    'Search attributable trade publications, conference speaker bios, retail associations, vendor announcements and public professional pages.'
  ];
  let rejected=0,lastStatus='NO_RESULTS',lastError='',attempts=0;
  for(let pass=0;pass<passes.length;pass++){
    const prompt=`Find a publicly displayed professional work email address for this exact current retail contact: ${JSON.stringify(target)} at ${account} (${domain}). ${passes[pass]} Return a result only when the exact email is visibly published for this named person. evidence_quote must contain the exact displayed email address (or its explicit [at]/[dot] rendering) and source_url must be the exact cited page. Never infer, predict, construct, or generate an address from a name or corporate pattern. Do not return personal emails or people-search guesses.`;
    const result=await webStructured({prompt,schema:EMAIL_SCHEMA,name:`buyer_public_email_pass_${pass+1}`},options);attempts+=Number(result.attempts)||1;
    if(result.status!=='SUCCESS'){lastStatus=result.status;lastError=result.error||'';if(['PROVIDER_UNAVAILABLE','CREDITS_EXHAUSTED'].includes(result.status))break;continue}
    const rows=Array.isArray(result.parsed.matches)?result.parsed.matches:[];
    for(const row of rows){const validation=validateEmailMatch(row,target,result.sources||[]);if(validation.match)return {status:'PUBLICLY_VERIFIED',match:validation.match,attempts,rejected,error:''};rejected++}
    lastStatus=rows.length?'EVIDENCE_REJECTED':'NO_RESULTS';
  }
  return {status:rejected?'EVIDENCE_REJECTED':lastStatus,error:lastError,attempts,rejected};
}

export async function searchPublicBuyerEmails({account,domain,buyers=[]},options={}){
  const maxBuyers=Math.max(1,Math.min(12,Number(options.maxBuyers||process.env.PUBLIC_EMAIL_LOOKUP_LIMIT||6)||6));
  const targets=buyers.filter(buyer=>buyer?.name).slice(0,maxBuyers).map(buyer=>({name:clean(buyer.name,160),title:clean(buyer.title,180),department:clean(buyer.department,160),category:clean(buyer.category_scope||buyer.category,180)}));
  if(!targets.length)return {status:'NO_INPUT',matches:[],outcomes:[],attempted:0,rejected:0};
  const outcomes=[],concurrency=Math.max(1,Math.min(3,Number(options.concurrency)||2));let cursor=0;
  async function worker(){while(cursor<targets.length){const target=targets[cursor++],result=await researchOneBuyer({account,domain,target},options);outcomes.push({name:target.name,...result})}}
  await Promise.all(Array.from({length:Math.min(concurrency,targets.length)},worker));
  outcomes.sort((a,b)=>targets.findIndex(target=>personKey(target.name)===personKey(a.name))-targets.findIndex(target=>personKey(target.name)===personKey(b.name)));
  const matches=outcomes.flatMap(item=>item.match?[item.match]:[]),rejected=outcomes.reduce((sum,item)=>sum+(Number(item.rejected)||0),0),statuses=outcomes.map(item=>item.status);
  const status=matches.length?'SUCCESS':statuses.includes('CREDITS_EXHAUSTED')?'CREDITS_EXHAUSTED':statuses.every(value=>value==='PROVIDER_UNAVAILABLE')?'PROVIDER_UNAVAILABLE':rejected?'EVIDENCE_REJECTED':'NO_RESULTS';
  return {status,matches,outcomes,attempted:targets.length,rejected,error:outcomes.find(item=>item.error)?.error||''};
}

async function searchPublicBuyerPhones({account,domain,buyers=[]}){
  if(!buyers.length)return {status:'NO_INPUT',matches:[],sources:[]};
  const targets=buyers.slice(0,8).map(buyer=>({name:clean(buyer.name,160),title:clean(buyer.title,180),category:clean(buyer.category_scope||buyer.category,160)}));
  const schema={type:'object',additionalProperties:false,properties:{matches:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},phone:{type:'string'},phone_type:{type:'string',enum:['DIRECT_WORK','CORPORATE_MAIN']},source_url:{type:'string'},source_title:{type:'string'},evidence_quote:{type:'string'},confidence:{type:'integer'}},required:['name','phone','phone_type','source_url','source_title','evidence_quote','confidence']}}},required:['matches']};
  const result=await webStructured({prompt:`Find publicly displayed professional phone numbers for these exact retail contacts at ${account} (${domain}): ${JSON.stringify(targets)}. Prefer a direct/work number explicitly tied to the person. Otherwise return only the official corporate/head-office main number as CORPORATE_MAIN. Never infer a personal or mobile number.`,schema,name:'buyer_public_phone_lookup',maxOutput:2200});
  if(result.status!=='SUCCESS')return {...result,matches:[]};
  const targetMap=new Map(targets.map(target=>[personKey(target.name),target])),matches=[];
  for(const row of Array.isArray(result.parsed.matches)?result.parsed.matches:[]){const name=clean(row.name,160),number=validPhone(row.phone),canonical=canonicalContactUrl(row.source_url);if(name&&number&&targetMap.has(personKey(name))&&(result.sources||[]).some(source=>source.canonical_url===canonical))matches.push({name,phone:number,phone_type:row.phone_type,source_url:clean(row.source_url,800),source_title:clean(row.source_title,220),evidence_quote:clean(row.evidence_quote,240),confidence:Math.min(96,Math.max(70,Number(row.confidence)||80))})}
  return {status:matches.length?'SUCCESS':'NO_RESULTS',matches,sources:result.sources};
}

export async function enrichBuyerContacts({organizationId,tenantId}){
  const sql=db();await ensureBuyerEmailEvidenceSchema(sql);
  const org=(await sql`select * from retail_organizations where id=${organizationId} limit 1`)[0];
  if(!org)return {status:'NO_ACCOUNT',added:0,updated:0,emails_added:0,phones_added:0};
  const account=(await sql`select * from accounts where organization_id=${organizationId} or lower(name)=lower(${org.name}) order by updated_at desc limit 1`)[0];
  if(!account)return {status:'NO_ACCOUNT_RECORD',added:0,updated:0,emails_added:0,phones_added:0};
  const productRows=tenantId?await sql`select distinct category, product_family from products where manufacturer_id=${tenantId} and active=true limit 40`:[];
  const categories=[...new Set([...(Array.isArray(org.categories)?org.categories:[]),...productRows.flatMap(row=>[row.category,row.product_family])].map(value=>clean(value,120)).filter(Boolean))].slice(0,10);
  let existing=await sql`select * from buyers where account_id=${account.id} order by confidence desc, updated_at desc`,existingByName=new Map(existing.map(buyer=>[personKey(buyer.name),buyer]));
  const apollo=await searchApolloBuyers({domain:org.domain||account.domain||'',categories});let added=0,updated=0,emailsAdded=0,phonesAdded=0,providerVerifiedCount=0;
  for(const person of (apollo.people||[]).filter(person=>buyerContactRole(person.title)).slice(0,35)){
    const prior=existingByName.get(personKey(person.name)),verifiedProviderEmail=providerVerified(person.email_status)?validPublishedEmail(person.email):'',savedEmail=verifiedProviderEmail||validPublishedEmail(prior?.email),linkedin=clean(person.linkedin||prior?.linkedin,500),identityConfidence=Math.max(Number(prior?.identity_confidence||prior?.confidence)||0,Number(person.confidence)||82);
    const saved=await upsertBuyer({account_id:account.id,name:person.name,title:person.title,email:savedEmail,phone:prior?.phone||'',linkedin,category:prior?.category_scope||prior?.category||'',department:prior?.department||'',category_scope:prior?.category_scope||prior?.category||'',subcategory_scope:prior?.subcategory_scope||'',buyer_role:prior?.buyer_role||'UNCONFIRMED',identity_confidence:identityConfidence,category_confidence:Number(prior?.category_confidence)||0,category_evidence_url:prior?.category_evidence_url||'',category_evidence_source:prior?.category_evidence_source||'',category_last_verified:prior?.category_last_verified||null,category_verification_status:prior?.category_verification_status||'UNCONFIRMED',source:person.source_label||'Apollo buyer discovery',source_url:person.source_url||linkedin||org.source_url||'',confidence:identityConfidence,verified_at:null,status:'Review Required',notes:`Buyer/contact waterfall; identity evidence only; category ownership is not inferred from title. ${person.contact_basis||'Apollo account-domain buyer match.'}`,observed_at:new Date().toISOString(),last_verified_at:null,evidence_type:'buyer',verification_status:'REVIEW_REQUIRED'});
    if(verifiedProviderEmail){await sql`update buyers set email_source_url=${person.source_url||linkedin||''},email_evidence_quote=${`Apollo returned a provider-verified work address with status ${clean(person.email_status,60)}.`},email_source_type='apollo',email_verification_status='PROVIDER_VERIFIED',email_last_verified=now() where id=${saved.id}`;providerVerifiedCount++}
    if(prior){updated++;if(!validPublishedEmail(prior.email)&&verifiedProviderEmail)emailsAdded++}else{added++;if(verifiedProviderEmail)emailsAdded++}
    existingByName.set(personKey(saved.name),saved);
  }
  existing=await sql`select * from buyers where account_id=${account.id} order by confidence desc, updated_at desc`;
  const missingEmail=existing.filter(buyer=>buyerContactRole(buyer.title)&&!validPublishedEmail(buyer.email)).sort((a,b)=>roleScore(b.title)-roleScore(a.title)),missingPhone=existing.filter(buyer=>buyerContactRole(buyer.title)&&!validPhone(buyer.phone)).sort((a,b)=>roleScore(b.title)-roleScore(a.title)).slice(0,8);
  const [publicEmail,publicPhone]=await Promise.all([searchPublicBuyerEmails({account:org.name,domain:org.domain||account.domain||'',buyers:missingEmail}),searchPublicBuyerPhones({account:org.name,domain:org.domain||account.domain||'',buyers:missingPhone})]);
  for(const outcome of publicEmail.outcomes||[]){const buyer=existing.find(item=>personKey(item.name)===personKey(outcome.name));if(!buyer||validPublishedEmail(buyer.email)||outcome.match)continue;await sql`update buyers set email_verification_status=${outcome.status||'NOT_FOUND'},updated_at=now() where id=${buyer.id}`}
  for(const match of publicEmail.matches||[]){const buyer=existing.find(item=>personKey(item.name)===personKey(match.name));if(!buyer||validPublishedEmail(buyer.email))continue;await sql`update buyers set email=${match.email},email_source_url=${match.source_url},email_evidence_quote=${match.evidence_quote},email_source_type=${match.source_type},email_verification_status='PUBLICLY_VERIFIED',email_last_verified=${match.last_verified_at},confidence=greatest(confidence,${Number(match.confidence)||85}),updated_at=now() where id=${buyer.id}`;emailsAdded++;updated++}
  for(const match of publicPhone.matches||[]){const buyer=existing.find(item=>personKey(item.name)===personKey(match.name));if(!buyer||validPhone(buyer.phone))continue;const label=match.phone_type==='DIRECT_WORK'?'Public direct-work phone':'Corporate main line';await sql`update buyers set phone=${match.phone},confidence=greatest(confidence,${match.phone_type==='DIRECT_WORK'?Number(match.confidence)||85:Math.min(85,Number(match.confidence)||75)}),notes=${`${buyer.notes||''}${buyer.notes?' | ':''}${label} from ${match.source_title||'web source'}${match.evidence_quote?`; evidence: ${match.evidence_quote}`:''}; ${match.source_url}`},updated_at=now() where id=${buyer.id}`;phonesAdded++;updated++}
  const finalBuyers=await sql`select * from buyers where account_id=${account.id} order by confidence desc, updated_at desc`;
  return {status:'SUCCESS',buyers:finalBuyers,added,updated,emails_added:emailsAdded,phones_added:phonesAdded,total_buyers:finalBuyers.length,total_with_email:finalBuyers.filter(buyer=>validPublishedEmail(buyer.email)).length,total_with_phone:finalBuyers.filter(buyer=>validPhone(buyer.phone)).length,categories_searched:categories,apollo:{status:apollo.status,candidates:(apollo.people||[]).length,enriched_count:Number(apollo.enriched_count)||0,verified_email_count:providerVerifiedCount,credits_used:Number(apollo.credits_used)||0,error:apollo.error||''},public_email:{status:publicEmail.status,matches:(publicEmail.matches||[]).length,attempted:publicEmail.attempted||0,rejected:publicEmail.rejected||0,outcomes:publicEmail.outcomes||[],error:publicEmail.error||''},public_phone:{status:publicPhone.status,matches:(publicPhone.matches||[]).length,error:publicPhone.error||''}};
}
