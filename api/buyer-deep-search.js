import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

const APOLLO_MATCH='https://api.apollo.io/api/v1/people/match';
const APOLLO_SEARCH='https://api.apollo.io/api/v1/mixed_people/api_search';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const validEmail=value=>{const email=clean(value,220).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email!=='email_not_unlocked@domain.com'&&!/example\.com$/.test(email)?email:''};
const normalizeDomain=value=>{try{return new URL(/^https?:\/\//i.test(String(value||''))?String(value):`https://${value}`).hostname.replace(/^www\./,'').toLowerCase()}catch{return clean(value,180).replace(/^www\./,'').toLowerCase()}};
const nameKey=value=>clean(value,180).toLowerCase().replace(/[^a-z0-9]+/g,'');

async function apolloJson(url,key){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{method:'POST',headers:{accept:'application/json','content-type':'application/json','cache-control':'no-cache','x-api-key':key},signal:controller.signal});
    let body={};try{body=await response.json()}catch{}
    return {ok:response.ok,status:response.status,body};
  }finally{clearTimeout(timeout)}
}

function personFromMatch(body={}){return body.person||body.contact||body.match||null}
function matchResult(body={}){
  const person=personFromMatch(body)||{};
  return {
    email:validEmail(person.email||body.email),
    email_status:clean(person.email_status||body.email_status,60),
    match_confidence:clean(body.match_confidence||person.match_confidence,40),
    linkedin:clean(person.linkedin_url,500),
    title:clean(person.title,180),
    apollo_id:clean(person.id||person.person_id,100),
    organization:clean(person.organization?.name||person.organization_name,180),
    credits_used:Number(body.credits_consumed||body.credit_usage?.total_credits||0)||0
  };
}

async function matchIndividual({key,name,domain,linkedin='',id=''}){
  const url=new URL(APOLLO_MATCH);
  if(id)url.searchParams.set('id',id);else{url.searchParams.set('name',name);url.searchParams.set('domain',domain);if(linkedin)url.searchParams.set('linkedin_url',linkedin)}
  url.searchParams.set('reveal_personal_emails','false');
  url.searchParams.set('reveal_phone_number','false');
  const response=await apolloJson(url,key);
  return {...response,result:response.ok?matchResult(response.body):null};
}

async function searchExactPerson({key,name,domain,title=''}){
  const url=new URL(APOLLO_SEARCH);
  url.searchParams.append('q_organization_domains_list[]',domain);
  url.searchParams.set('q_keywords',[name,title].filter(Boolean).join(' '));
  url.searchParams.set('include_similar_titles','true');
  url.searchParams.set('page','1');url.searchParams.set('per_page','10');
  const response=await apolloJson(url,key);
  if(!response.ok)return {...response,candidate:null};
  const people=Array.isArray(response.body.people)?response.body.people:[];
  const exact=people.find(p=>nameKey(p.name||[p.first_name,p.last_name].filter(Boolean).join(' '))===nameKey(name));
  return {...response,candidate:exact||people[0]||null};
}

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const key=process.env.APOLLO_API_KEY;
  if(!key)return res.status(400).json({error:'APOLLO_API_KEY is not configured'});
  const buyerId=clean(req.body?.buyer_id,100);if(!buyerId)return res.status(400).json({error:'buyer_id is required'});
  const sql=db();
  try{
    const row=(await sql`select b.*,a.organization_id,a.domain account_domain,a.name account_name,ro.domain organization_domain,ro.source_url organization_source_url,ro.name organization_name from buyers b join accounts a on a.id=b.account_id left join retail_organizations ro on ro.id=a.organization_id where b.id=${buyerId} limit 1`)[0];
    if(!row)return res.status(404).json({error:'Buyer was not found'});
    const domain=normalizeDomain(row.organization_domain||row.account_domain||row.organization_source_url);
    if(!domain)return res.status(400).json({error:'This account needs a valid retailer domain before Apollo deep search can run'});
    const attempts=[];
    const matched=await matchIndividual({key,name:row.name,domain,linkedin:row.linkedin||''});
    attempts.push({type:'individual_match',http_status:matched.status,match_confidence:matched.result?.match_confidence||'',email_found:Boolean(matched.result?.email)});
    if(matched.status===401||matched.status===403){
      return res.status(200).json({status:'APOLLO_FORBIDDEN',buyer:row,attempts,http_status:matched.status,message:'Apollo rejected People Enrichment for the configured API key. Check that the key is valid and that the Apollo plan/API permissions include People Enrichment.'});
    }
    let result=matched.result;
    if(!matched.ok||!result?.email){
      const searched=await searchExactPerson({key,name:row.name,domain,title:row.title||''});
      attempts.push({type:'exact_people_search',http_status:searched.status,candidate_found:Boolean(searched.candidate)});
      if(searched.status===401||searched.status===403){
        return res.status(200).json({status:'APOLLO_FORBIDDEN',buyer:row,attempts,http_status:searched.status,message:'Apollo rejected People Search/Enrichment for the configured API key. Check the Apollo API key and plan permissions.'});
      }
      const apolloId=clean(searched.candidate?.id||searched.candidate?.person_id,100);
      if(apolloId){
        const byId=await matchIndividual({key,name:row.name,domain,id:apolloId});
        attempts.push({type:'apollo_id_match',http_status:byId.status,match_confidence:byId.result?.match_confidence||'',email_found:Boolean(byId.result?.email)});
        if(byId.status===401||byId.status===403){
          return res.status(200).json({status:'APOLLO_FORBIDDEN',buyer:row,attempts,http_status:byId.status,message:'Apollo found a candidate but rejected the enrichment request for the configured API key or plan.'});
        }
        if(byId.ok&&(byId.result?.email||!result))result=byId.result;
      }
    }
    if(!result)return res.status(200).json({status:'NO_MATCH',buyer:row,attempts,message:'Apollo did not return a person match for this buyer.'});
    const email=result.email||row.email||'',linkedin=result.linkedin||row.linkedin||'',title=result.title||row.title||'',confidence=result.email?Math.max(Number(row.confidence)||0,94):Number(row.confidence)||0;
    const notes=clean(`${row.notes||''}${row.notes?' | ':''}Apollo individual enrichment: ${result.match_confidence||'unknown'} match${result.email_status?`, email ${result.email_status}`:''}.`,1000);
    const updated=(await sql`update buyers set email=${email},linkedin=${linkedin},title=${title},source=${result.email?'Apollo Deep Buyer Search':row.source},source_url=${linkedin||row.source_url},confidence=${confidence},verification_status=${result.email?'REVIEW_REQUIRED':row.verification_status},notes=${notes},updated_at=now() where id=${buyerId} returning *`)[0];
    return res.status(200).json({status:result.email?'EMAIL_FOUND':'MATCH_NO_EMAIL',buyer:updated,apollo:{match_confidence:result.match_confidence,email_status:result.email_status,apollo_id:result.apollo_id,credits_used:result.credits_used},attempts,message:result.email?'Apollo returned a work email and Launchpad36 saved it.':'Apollo matched the buyer but did not return a work email.'});
  }catch(error){console.error('buyer deep search failed',{message:error?.message||String(error),buyer_id:buyerId});return res.status(500).json({error:'Deep buyer search could not be completed'})}
}
