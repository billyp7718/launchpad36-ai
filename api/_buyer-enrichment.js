const APOLLO_SEARCH='https://api.apollo.io/api/v1/mixed_people/api_search';
const APOLLO_BULK_MATCH='https://api.apollo.io/api/v1/people/bulk_match';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const validEmail=value=>{const email=clean(value,220).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email!=='email_not_unlocked@domain.com'&&!/example\.com$/.test(email)?email:''};
const words=value=>clean(value,240).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
const rolePriority=title=>/chief merchant|chief merchandising/i.test(title)?100:/\b(vp|vice president)\b.*(merch|category|buy|retail|procure|sourc)/i.test(title)?95:/director.*(merch|category|buy|procure|sourc|purchas)/i.test(title)?90:/senior.*(buyer|merchant|category)/i.test(title)?86:/category manager|category merchant|buyer|merchant/i.test(title)?82:/associate.*(buyer|merchant)|assistant.*(buyer|merchant)/i.test(title)?74:60;

export function buyerTitles(category='',categories=[]){
  const focuses=[clean(category,80),...(Array.isArray(categories)?categories:[])].map(x=>clean(x,80)).filter(Boolean).slice(0,8);
  const focused=focuses.flatMap(focus=>[
    `${focus} buyer`,`${focus} senior buyer`,`${focus} category manager`,`${focus} category director`,`${focus} merchant`,`${focus} category merchant`,`${focus} associate merchant`,`${focus} assistant merchant`,`${focus} sourcing`,`${focus} procurement`
  ]);
  return [...new Set([
    ...focused,'buyer','senior buyer','associate buyer','assistant buyer','category manager','category director','merchant','senior merchant','associate merchant','assistant merchant','merchandising manager','merchandising director','vice president merchandising','chief merchandising officer','procurement manager','procurement director','strategic sourcing manager','sourcing director','purchasing manager','purchasing director'
  ].filter(Boolean))];
}

export function normalizeApolloPeople(payload={}){
  const rows=Array.isArray(payload.people)?payload.people:Array.isArray(payload.contacts)?payload.contacts:[];
  const seen=new Set(),people=[];
  for(const row of rows){
    const name=clean(row.name||[row.first_name,row.last_name].filter(Boolean).join(' '),160),title=clean(row.title,180),id=clean(row.id||row.person_id,100),linkedin=clean(row.linkedin_url,500);
    if(!name||!title||!id)continue;
    const key=`${name}|${title}`.toLowerCase();if(seen.has(key))continue;seen.add(key);
    people.push({id,name,title,organization:clean(row.organization?.name||row.organization_name,180),linkedin,source_url:linkedin||`https://app.apollo.io/#/people/${encodeURIComponent(id)}`,source_label:'Apollo People Search',source_type:'apollo_people_search',confidence:82,verification_status:'REVIEW_REQUIRED',email:'',email_status:'',match_confidence:'',contact_basis:'Current-employer and title match returned by Apollo People Search.'});
  }
  return people.slice(0,50);
}

function mergeApolloEnrichment(people=[],payload={}){
  const matches=Array.isArray(payload.matches)?payload.matches:[];
  const byId=new Map();
  for(const row of matches){if(!row)continue;const id=clean(row.id||row.person_id,100);if(id)byId.set(id,row)}
  return people.map(person=>{
    const row=byId.get(person.id);if(!row)return person;
    const email=validEmail(row.email),status=clean(row.email_status,60),matchConfidence=clean(row.match_confidence,40),linkedin=clean(row.linkedin_url||person.linkedin,500);
    return {...person,email,email_status:status,match_confidence:matchConfidence,linkedin,source_url:linkedin||person.source_url,source_label:email?'Apollo People Search + Email Enrichment':person.source_label,source_type:email?'apollo_people_enrichment':person.source_type,confidence:email&&/verified|valid|deliverable/i.test(status)?94:email?89:person.confidence,contact_basis:email?`Apollo matched the buyer to the employer and returned a work email${status?` with status ${status}`:''}. Human review is required before outreach.`:person.contact_basis};
  });
}

function rankPeople(people=[],categories=[]){
  const focusWords=[...new Set((categories||[]).flatMap(words))];
  return [...people].sort((a,b)=>{
    const score=p=>{const title=clean(p.title,180),text=title.toLowerCase(),categoryHits=focusWords.filter(w=>text.includes(w)).length;return rolePriority(title)+(categoryHits*12)+(p.linkedin?2:0)};
    return score(b)-score(a);
  });
}

async function enrichApolloWorkEmails({key,domain,people=[],categories=[]}){
  const limit=Math.max(0,Math.min(20,Number(process.env.APOLLO_EMAIL_ENRICH_LIMIT||10)||10));
  const ranked=rankPeople(people,categories),candidates=ranked.filter(p=>p.id).slice(0,limit);if(!candidates.length||limit===0)return {people:ranked,credits_used:0,enriched_count:0,status:'SKIPPED'};
  let merged=[...ranked],credits=0,enriched=0;
  for(let i=0;i<candidates.length;i+=10){
    const batch=candidates.slice(i,i+10),url=new URL(APOLLO_BULK_MATCH);url.searchParams.set('reveal_personal_emails','false');url.searchParams.set('reveal_phone_number','false');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(url,{method:'POST',headers:{accept:'application/json','content-type':'application/json','cache-control':'no-cache','x-api-key':key},signal:controller.signal,body:JSON.stringify({details:batch.map(p=>({id:p.id,domain}))})});
      let body={};try{body=await response.json()}catch{}
      if(!response.ok)continue;
      credits+=Number(body.credits_consumed)||0;merged=mergeApolloEnrichment(merged,body);enriched+=Array.isArray(body.matches)?body.matches.filter(Boolean).length:0;
    }catch{}finally{clearTimeout(timeout)}
  }
  return {people:rankPeople(merged,categories),credits_used:credits,enriched_count:enriched,status:enriched?'SUCCESS':'NO_RESULTS'};
}

export async function searchApolloBuyers({domain,category='',categories=[]}){
  const key=process.env.APOLLO_API_KEY;if(!key)return {provider:'apollo',status:'NOT_CONFIGURED',people:[],error:'APOLLO_API_KEY is not configured',credits_used:0};
  const priorityCategories=[clean(category,80),...(Array.isArray(categories)?categories:[])].filter(Boolean).slice(0,8);
  const url=new URL(APOLLO_SEARCH);url.searchParams.append('q_organization_domains_list[]',domain);for(const title of buyerTitles(category,priorityCategories))url.searchParams.append('person_titles[]',title);url.searchParams.set('include_similar_titles','true');url.searchParams.set('page','1');url.searchParams.set('per_page','50');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{method:'POST',headers:{accept:'application/json','content-type':'application/json','x-api-key':key},signal:controller.signal});let body={};try{body=await response.json()}catch{}
    if(!response.ok){const authenticationFailed=response.status===401||response.status===403;return {provider:'apollo',status:authenticationFailed?'OPTIONAL_UNAVAILABLE':'ERROR',people:[],error:authenticationFailed?'':clean(body.error||body.message||`Apollo returned ${response.status}`,240),detail:authenticationFailed?'Apollo API key was rejected; optional enrichment was skipped while OpenAI research continued.':'',http_status:response.status,credits_used:0}}
    const searched=rankPeople(normalizeApolloPeople(body),priorityCategories);if(!searched.length)return {provider:'apollo',status:'NO_RESULTS',people:[],total_entries:Number(body.pagination?.total_entries)||0,credits_used:0,enriched_count:0};
    const enriched=await enrichApolloWorkEmails({key,domain,people:searched,categories:priorityCategories});
    return {provider:'apollo',status:'SUCCESS',people:enriched.people,total_entries:Number(body.pagination?.total_entries)||searched.length,credits_used:enriched.credits_used,enriched_count:enriched.enriched_count,enrichment_status:enriched.status};
  }catch(error){return {provider:'apollo',status:'ERROR',people:[],error:error.name==='AbortError'?'Apollo search timed out':clean(error.message,240),credits_used:0};}finally{clearTimeout(timeout)}
}
