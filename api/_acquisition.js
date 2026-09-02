const FIRECRAWL_BASE='https://api.firecrawl.dev/v2';

export function safeDomain(x){
  const d=String(x||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)?d:'';
}
export function sameDomain(url,domain){try{const h=new URL(url).hostname.replace(/^www\./,'').toLowerCase();return h===domain||h.endsWith('.'+domain)}catch{return false}}
function uniq(xs){return [...new Set(xs.filter(Boolean))]}
function timeoutSignal(ms){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);return {signal:c.signal,clear:()=>clearTimeout(t)}}
async function jsonFetch(url,opts,ms=45000){const x=timeoutSignal(ms);try{const r=await fetch(url,{...opts,signal:x.signal});let body={};try{body=await r.json()}catch{}return {ok:r.ok,status:r.status,body}}catch(e){return {ok:false,status:0,body:{error:e.name==='AbortError'?'timeout':e.message}}}finally{x.clear()}}

export async function firecrawlMap({domain,categories=[]}){
  const key=process.env.FIRECRAWL_API_KEY;if(!key)return {provider:'firecrawl_map',status:'NOT_CONFIGURED',urls:[],attempts:[],error:'FIRECRAWL_API_KEY is not configured'};
  const search=categories.slice(0,3).filter(Boolean).join(' '),r=await jsonFetch(`${FIRECRAWL_BASE}/map`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({url:`https://${domain}`,search,sitemap:'include',includeSubdomains:true,ignoreQueryParameters:false,ignoreCache:false,limit:100,location:{country:'US',languages:['en-US']},timeout:30000})},40000),links=Array.isArray(r.body?.links)?r.body.links:[],urls=[];
  for(const link of links){const url=typeof link==='string'?link:link?.url;if(url&&sameDomain(url,domain))urls.push(url)}
  return {provider:'firecrawl_map',status:urls.length?'SUCCESS':r.ok?'NO_RESULTS':'ERROR',urls:uniq(urls).slice(0,20),attempts:[{operation:'map',search,http_status:r.status,ok:r.ok,error:r.body?.error||''}],error:r.body?.error||''};
}

export async function firecrawlDiscover({domain,organization,categories=[]}){
  const key=process.env.FIRECRAWL_API_KEY;
  if(!key)return {provider:'firecrawl',status:'NOT_CONFIGURED',urls:[],attempts:[],error:'FIRECRAWL_API_KEY is not configured'};
  const mapped=await firecrawlMap({domain,categories});if(mapped.urls.length)return {provider:'firecrawl',status:'SUCCESS',urls:mapped.urls.slice(0,12),attempts:mapped.attempts,error:''};
  const topics=categories.length?categories.slice(0,3):['products','services','solutions'];
  const queries=uniq(topics.map(t=>`site:${domain} ${t}`)).slice(0,3);
  const urls=[],attempts=[];
  const results=await Promise.all(queries.map(async query=>{
    const r=await jsonFetch(`${FIRECRAWL_BASE}/search`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({query,limit:8,sources:['web'],includeDomains:[domain],country:'US',timeout:30000})},40000);
    return {query,r};
  }));
  for(const {query,r} of results){
    attempts.push({operation:'search',query,http_status:r.status,ok:r.ok,error:r.body?.error||''});
    const rows=r.body?.data?.web||r.body?.data||[];
    for(const row of Array.isArray(rows)?rows:[])if(sameDomain(row.url,domain))urls.push(row.url);
  }
  return {provider:'firecrawl',status:urls.length?'SUCCESS':attempts.some(a=>a.ok)?'NO_RESULTS':'ERROR',urls:uniq(urls).slice(0,12),attempts:[...(mapped.attempts||[]),...attempts],error:''};
}

const OFFERING_SCHEMA={
  type:'object',
  properties:{
    offerings:{type:'array',items:{type:'object',properties:{
      name:{type:'string'},brand:{type:'string'},price_text:{type:'string'},availability:{type:'string'},category:{type:'string'},evidence_quote:{type:'string'}
    },required:['name']}}
  },required:['offerings']
};

export async function firecrawlExtract({domain,urls=[]}){
  const key=process.env.FIRECRAWL_API_KEY;
  if(!key)return {provider:'firecrawl',status:'NOT_CONFIGURED',observations:[],attempts:[]};
  const observations=[],attempts=[];
  const eligible=urls.slice(0,8).filter(url=>sameDomain(url,domain));
  const results=await Promise.all(eligible.map(async url=>{
    const r=await jsonFetch(`${FIRECRAWL_BASE}/scrape`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({url,onlyMainContent:true,proxy:'auto',timeout:45000,formats:[{type:'json',schema:OFFERING_SCHEMA,prompt:'Extract only commercial offerings explicitly present on this page. Do not infer missing products, brands, prices, availability, or categories. evidence_quote must be a short exact supporting phrase from the page when available.'}]})},55000);
    return {url,r};
  }));
  for(const {url,r} of results){
    attempts.push({operation:'scrape_extract',url,http_status:r.status,ok:r.ok,error:r.body?.error||''});
    const data=r.body?.data?.json||r.body?.data?.extract||r.body?.data||{};
    for(const o of (Array.isArray(data?.offerings)?data.offerings:[])){
      const name=String(o.name||'').trim(); if(!name)continue;
      const quote=String(o.evidence_quote||'').trim().slice(0,240);
      observations.push({
        offering_name:name.slice(0,300),brand:String(o.brand||'').trim().slice(0,120),price_text:String(o.price_text||'').trim().slice(0,80),availability:String(o.availability||'').trim().slice(0,120),category:String(o.category||'').trim().slice(0,120),evidence_quote:quote,
        source_url:url,source_type:'organization_web_page',acquisition_method:'firecrawl_search_and_extract',observed_at:new Date().toISOString(),confidence:quote?88:76
      });
    }
  }
  const seen=new Set(),dedup=[];
  for(const o of observations){const k=[o.source_url,o.brand,o.offering_name,o.price_text].join('|').toLowerCase();if(!seen.has(k)){seen.add(k);dedup.push(o)}}
  return {provider:'firecrawl',status:dedup.length?'SUCCESS':attempts.some(a=>a.ok)?'NO_RESULTS':'ERROR',observations:dedup.slice(0,100),attempts};
}

export async function universalAcquire(input){
  const domain=safeDomain(input.domain); if(!domain)return {status:'ERROR',observations:[],providers:[],error:'Valid organization domain required'};
  const discovery=await firecrawlDiscover({...input,domain});
  const extraction=discovery.urls.length?await firecrawlExtract({domain,urls:discovery.urls}):{provider:'firecrawl',status:discovery.status,observations:[],attempts:[]};
  const status=extraction.observations.length?'SUCCESS':discovery.status==='NOT_CONFIGURED'?'NOT_CONFIGURED':(discovery.status==='ERROR'&&extraction.status==='ERROR')?'ERROR':'NO_RESULTS';
  return {status,observations:extraction.observations||[],providers:[{name:'firecrawl',discovery_status:discovery.status,extraction_status:extraction.status,attempts:[...(discovery.attempts||[]),...(extraction.attempts||[])]}],failure_is_negative_evidence:false,interpretation:status==='SUCCESS'?'Attributable organization-page observations were acquired and normalized.':status==='NOT_CONFIGURED'?'Universal discovery provider is not configured. No commercial conclusion may be drawn.':'No attributable offering observations were acquired. This is UNKNOWN, not evidence of absence.'};
}
