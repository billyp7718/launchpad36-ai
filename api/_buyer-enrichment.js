const APOLLO_SEARCH='https://api.apollo.io/api/v1/mixed_people/api_search';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);

export function buyerTitles(category=''){
  const focus=clean(category,80);
  return [...new Set([focus&&`${focus} buyer`,focus&&`${focus} category manager`,'buyer','senior buyer','category manager','merchant','merchandising director','vice president merchandising','chief merchandising officer'].filter(Boolean))];
}

export function normalizeApolloPeople(payload={}){
  const rows=Array.isArray(payload.people)?payload.people:Array.isArray(payload.contacts)?payload.contacts:[];
  const seen=new Set(),people=[];
  for(const row of rows){
    const name=clean(row.name||[row.first_name,row.last_name].filter(Boolean).join(' '),160),title=clean(row.title,180),id=clean(row.id||row.person_id,100),linkedin=clean(row.linkedin_url,500);
    if(!name||!title||!id)continue;
    const key=`${name}|${title}`.toLowerCase();if(seen.has(key))continue;seen.add(key);
    people.push({id,name,title,organization:clean(row.organization?.name||row.organization_name,180),linkedin,source_url:linkedin||`https://app.apollo.io/#/people/${encodeURIComponent(id)}`,source_label:'Apollo People Search',source_type:'apollo_people_search',confidence:82,verification_status:'REVIEW_REQUIRED',contact_basis:'Current-employer and title match returned by Apollo People Search; contact details were not revealed or charged.'});
  }
  return people.slice(0,20);
}

export async function searchApolloBuyers({domain,category=''}){
  const key=process.env.APOLLO_API_KEY;if(!key)return {provider:'apollo',status:'NOT_CONFIGURED',people:[],error:'APOLLO_API_KEY is not configured',credits_used:0};
  const url=new URL(APOLLO_SEARCH);url.searchParams.append('q_organization_domains_list[]',domain);for(const title of buyerTitles(category))url.searchParams.append('person_titles[]',title);for(const seniority of ['c_suite','vp','head','director','manager','senior'])url.searchParams.append('person_seniorities[]',seniority);url.searchParams.set('include_similar_titles','true');url.searchParams.set('page','1');url.searchParams.set('per_page','20');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{const response=await fetch(url,{method:'POST',headers:{accept:'application/json','content-type':'application/json','x-api-key':key},signal:controller.signal});let body={};try{body=await response.json()}catch{}if(!response.ok){const authenticationFailed=response.status===401||response.status===403;return {provider:'apollo',status:authenticationFailed?'OPTIONAL_UNAVAILABLE':'ERROR',people:[],error:authenticationFailed?'':clean(body.error||body.message||`Apollo returned ${response.status}`,240),detail:authenticationFailed?'Apollo API key was rejected; optional enrichment was skipped while OpenAI research continued.':'',http_status:response.status,credits_used:0}}const people=normalizeApolloPeople(body);return {provider:'apollo',status:people.length?'SUCCESS':'NO_RESULTS',people,total_entries:Number(body.pagination?.total_entries)||people.length,credits_used:0};}
  catch(error){return {provider:'apollo',status:'ERROR',people:[],error:error.name==='AbortError'?'Apollo search timed out':clean(error.message,240),credits_used:0};}finally{clearTimeout(timeout)}
}
