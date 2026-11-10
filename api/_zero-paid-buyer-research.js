import { isIP } from 'node:net';

const ROLE_PATTERN=/\b(buyer|merchant|category\s+(?:manager|director|lead|buyer)|merchandis(?:e|ing|er)|divisional\s+merchandise\s+manager|dmm|procurement|purchasing|sourcing)\b/i;
const LEADERSHIP_PATTERN=/\b(chief|president|vice president|vp|director|head|executive)\b/i;
const BLOCKED_PATTERN=/captcha|access denied|verify you are human|unusual traffic|cloudflare ray id|enable javascript and cookies/i;
const CATEGORY_TERMS=['alcohol','appliances','apparel','audio','automotive','beauty','beer','beverage','consumer electronics','electronics','furniture','grocery','hardware','headphones','health','home theater','housewares','office','outdoor','pet','pharmacy','shoes','soundbars','speakers','sporting goods','spirits','toys','video','wine'];
const COMMON_PATHS=['/','/about','/about-us','/about/leadership','/company/leadership','/leadership','/our-team','/team','/management','/merchandising','/procurement','/purchasing','/suppliers','/supplier','/vendors','/vendor','/newsroom','/news','/press-releases'];
const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalize=value=>clean(value,300).toLowerCase().replace(/[^a-z0-9]+/g,'');
const unique=values=>[...new Set(values.filter(Boolean))];

function decodeHtml(value=''){
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
    if(entity[0]==='#'){const hex=entity[1]?.toLowerCase()==='x',point=Number.parseInt(entity.slice(hex?2:1),hex?16:10);return Number.isFinite(point)?String.fromCodePoint(point):''}
    return named[entity.toLowerCase()]||'';
  });
}

function publicHost(hostname=''){
  const host=String(hostname).toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
  if(!host||host==='localhost'||host.endsWith('.local'))return false;
  const ipVersion=isIP(host);if(ipVersion){
    if(/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^::1$|^fc|^fd|^fe80/i.test(host))return false;
    const match=host.match(/^172\.(\d+)\./);if(match&&Number(match[1])>=16&&Number(match[1])<=31)return false;
    if(ipVersion===6&&/^(?:::$|::ffff:|f[cd]|fe[89ab])/i.test(host))return false;
  }
  return true;
}

export function zeroPaidAccountOrigin(domain=''){
  const raw=clean(domain,240).replace(/^https?:\/\//i,'').replace(/\/.*$/,'');
  if(!raw)return '';
  try{const url=new URL(`https://${raw}`);return publicHost(url.hostname)?url.origin:''}catch{return ''}
}

function sameAccountHost(url,origin){
  try{const candidate=new URL(url),official=new URL(origin),host=candidate.hostname.toLowerCase(),base=official.hostname.toLowerCase().replace(/^www\./,'');return candidate.protocol==='https:'&&publicHost(host)&&(host===base||host===`www.${base}`||host.endsWith(`.${base}`))}catch{return false}
}

export function parseRobotsTxt(text='',origin=''){
  const disallow=[],sitemaps=[];let applies=false;
  for(const raw of String(text).split(/\r?\n/)){const line=raw.replace(/#.*$/,'').trim();if(!line)continue;const index=line.indexOf(':');if(index<0)continue;const key=line.slice(0,index).trim().toLowerCase(),value=line.slice(index+1).trim();if(key==='user-agent'){applies=value==='*'}else if(key==='disallow'&&applies&&value)disallow.push(value);else if(key==='sitemap'&&value){try{const url=new URL(value,origin).href;if(sameAccountHost(url,origin))sitemaps.push(url)}catch{}}}
  return {disallow:unique(disallow),sitemaps:unique(sitemaps)};
}

export function robotsAllows(url,robots={}){
  try{const path=new URL(url).pathname;return !(robots.disallow||[]).some(rule=>{if(rule==='/')return true;const anchored=rule.endsWith('$'),body=(anchored?rule.slice(0,-1):rule).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*'),pattern=new RegExp(`^${body}${anchored?'$':''}`);return pattern.test(path)})}catch{return false}
}

function candidatePath(url=''){
  return /leadership|team|management|merchant|merchand|buyer|category|procurement|purchas|sourc|supplier|vendor|news|press|announcement/i.test(url);
}

function sitemapUrls(xml='',origin=''){
  const urls=[];for(const match of String(xml).matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)){const value=decodeHtml(match[1]).trim();try{const url=new URL(value,origin).href;if(sameAccountHost(url,origin)&&candidatePath(url))urls.push(url)}catch{}}
  return unique(urls).slice(0,30);
}

function metaValue(html,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),patterns=[new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`,'i')];
  for(const pattern of patterns){const match=String(html).match(pattern);if(match)return decodeHtml(match[1])}return '';
}

function evidenceDate(html,headers,now){
  const raw=metaValue(html,'article:published_time')||metaValue(html,'datePublished')||metaValue(html,'date')||headers?.get?.('last-modified')||'';
  const parsed=new Date(raw);return Number.isFinite(parsed.getTime())&&parsed<=now?parsed.toISOString():null;
}

function jsonLdObjects(value){
  if(Array.isArray(value))return value.flatMap(jsonLdObjects);if(!value||typeof value!=='object')return [];
  const nested=Object.values(value).flatMap(jsonLdObjects);return [value,...nested];
}

function jsonLdPeople(html){
  const people=[];for(const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const parsed=JSON.parse(decodeHtml(match[1]).replace(/^\s*<!--|-->\s*$/g,''));for(const item of jsonLdObjects(parsed)){const types=Array.isArray(item['@type'])?item['@type']:[item['@type']];if(types.some(type=>String(type).toLowerCase()==='person'))people.push(item)}}catch{}}
  return people;
}

function textLines(html=''){
  return decodeHtml(String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<(?:br|p|div|li|h[1-6]|section|article|tr|td|th)[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ')).split(/\n+/).map(line=>clean(line,400)).filter(line=>line.length>=3&&line.length<=400);
}

function plausibleName(value=''){
  const name=clean(value,180);if(!/^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/.test(name))return false;
  return !/^(About|Leadership|Management|News|Press|Supplier|Vendor|Category|Retail|Corporate|Executive|Merchandising|Procurement)\b/i.test(name);
}

function explicitCategory(text='',accountCategories=[]){
  const haystack=clean(text,700).toLowerCase(),terms=unique([...accountCategories.map(value=>clean(value,100).toLowerCase()),...CATEGORY_TERMS]).filter(Boolean).sort((a,b)=>b.length-a.length),found=terms.filter(term=>new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\ /g,'\\s+')}\\b`,'i').test(haystack));return unique(found).slice(0,6).map(value=>value.replace(/\b\w/g,char=>char.toUpperCase())).join(', ');
}

function buyerRole(title=''){
  if(/\bcategory\s+(?:manager|director|buyer|lead)\b/i.test(title))return 'CATEGORY_OWNER';
  if(/\b(?:buyer|purchasing|procurement)\b/i.test(title))return 'DIRECT_BUYER';
  if(/\bmerchant\b/i.test(title))return 'MERCHANT';
  if(/\b(?:director|head|vice president|vp).*\bmerchand/i.test(title)||/\bmerchand.*\b(?:director|head|vice president|vp)\b/i.test(title))return 'MERCHANDISING_LEADER';
  return LEADERSHIP_PATTERN.test(title)?'EXECUTIVE':'UNCONFIRMED';
}

function sourceType(url=''){return /news|press|announcement/i.test(url)?'company_press_release':'official_company'}

function personRecord({name,title,description='',profile='',url,evidenceDate:published,observedAt,account,categories=[]}){
  name=clean(name,180);title=clean(title,200);if(!plausibleName(name)||!ROLE_PATTERN.test(title))return null;
  const context=clean(`${title} ${description}`,700),category=explicitCategory(context,categories),role=buyerRole(title),structured=Boolean(profile||description),identityConfidence=structured?90:82,categoryConfidence=category?(structured?88:82):0;
  return {name,title,department:category||'',category_scope:category,subcategory_scope:'',buyer_role:role,linkedin:/^https:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(profile)?profile:'',source_url:url,employment_evidence_url:url,category_evidence_url:category?url:'',source_type:sourceType(url),evidence_date:published||observedAt,employment_last_verified:observedAt,category_last_verified:category?observedAt:null,identity_confidence:identityConfidence,category_confidence:categoryConfidence,employment_verification_status:'VERIFIED',category_verification_status:category?'VERIFIED':'UNCONFIRMED',rationale:`Direct zero-paid research of ${account}'s public website. ${category?'The displayed role text explicitly names category responsibility.':'The person and current role are attributable, but category ownership is not explicit.'}`};
}

export function extractPublicBuyerEvidence({html='',url,account,categories=[],observedAt=new Date().toISOString(),headers=null}){
  const now=new Date(observedAt),published=evidenceDate(html,headers,now),records=[];
  for(const person of jsonLdPeople(html)){const sameAs=Array.isArray(person.sameAs)?person.sameAs:[person.sameAs],profile=sameAs.find(value=>/^https:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(value||''))||person.url||'',record=personRecord({name:person.name,title:person.jobTitle||person.roleName,description:person.description||'',profile,url,evidenceDate:published,observedAt,account,categories});if(record)records.push(record)}
  const lines=textLines(html);for(let index=0;index<lines.length;index++){const line=lines[index];if(!ROLE_PATTERN.test(line))continue;const nearby=[lines[index-1],lines[index+1],lines[index-2],lines[index+2]].filter(Boolean),name=nearby.find(plausibleName)||'',title=line.length<=220?line:nearby.find(value=>ROLE_PATTERN.test(value))||'';const record=personRecord({name,title,description:line,url,evidenceDate:published,observedAt,account,categories});if(record)records.push(record)}
  const seen=new Set();return records.filter(record=>{const key=`${normalize(record.name)}|${normalize(record.title)}`;if(seen.has(key))return false;seen.add(key);return true}).slice(0,40);
}

async function publicFetch(url,{fetcher,origin,timeoutMs=12000,maxBytes=1_200_000}={}){
  let current=url;for(let redirect=0;redirect<4;redirect++){
    if(!sameAccountHost(current,origin))return {status:'BLOCKED',error:'Cross-domain redirect was not followed'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let response;
    try{response=await fetcher(current,{redirect:'manual',signal:controller.signal,headers:{accept:'text/html,application/xhtml+xml,application/xml,text/plain;q=0.8','user-agent':'Launchpad36BuyerResearch/1.0 (+https://launchpad36.app)'}})}catch(error){clearTimeout(timer);return {status:'ERROR',error:error?.name==='AbortError'?'Public page timed out':clean(error?.message||error,300)}}clearTimeout(timer);
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)return {status:'ERROR',error:`Redirect ${response.status} had no location`};current=new URL(location,current).href;continue}
    if([401,403,429].includes(response.status))return {status:'BLOCKED',error:`Public access returned HTTP ${response.status}`};if([404,410].includes(response.status))return {status:'MISSING',error:`Public page returned HTTP ${response.status}`};if(!response.ok)return {status:'ERROR',error:`Public access returned HTTP ${response.status}`};
    const type=(response.headers.get('content-type')||'').toLowerCase();if(!/(html|xml|text|json)/.test(type))return {status:'SKIPPED',error:'Unsupported content type'};const length=Number(response.headers.get('content-length')||0);if(length>maxBytes)return {status:'SKIPPED',error:'Public page exceeded the safe size limit'};const text=(await response.text()).slice(0,maxBytes);if(BLOCKED_PATTERN.test(text.slice(0,5000)))return {status:'BLOCKED',error:'Access challenge detected'};return {status:'SUCCESS',url:current,text,headers:response.headers};
  }return {status:'BLOCKED',error:'Too many redirects'};
}

export async function researchPublicAccountBuyers({account,domain,categories=[]},{fetcher=fetch,maxPages=10,pageDelayMs=250,now=()=>new Date()}={}){
  const origin=zeroPaidAccountOrigin(domain),observedAt=now().toISOString();if(!origin)return {status:'NO_RESULTS',people:[],sources:[],attempts:0,pages_fetched:0,robots_status:'NO_PUBLIC_DOMAIN',external_api_cost_cents:0};
  const robotsResponse=await publicFetch(`${origin}/robots.txt`,{fetcher,origin,timeoutMs:8000,maxBytes:250_000}),robots=robotsResponse.status==='SUCCESS'?parseRobotsTxt(robotsResponse.text,origin):{disallow:[],sitemaps:[]},robotsStatus=robotsResponse.status==='BLOCKED'?'BLOCKED':robotsResponse.status==='SUCCESS'?'RESPECTED':'UNAVAILABLE';
  if(robotsResponse.status==='BLOCKED')return {status:'BLOCKED',people:[],sources:[],attempts:0,pages_fetched:0,robots_status:'BLOCKED',external_api_cost_cents:0,error:robotsResponse.error};
  const discovered=[];for(const sitemap of unique([...robots.sitemaps,`${origin}/sitemap.xml`]).slice(0,3)){if(!robotsAllows(sitemap,robots))continue;const response=await publicFetch(sitemap,{fetcher,origin,timeoutMs:10000,maxBytes:1_500_000});if(response.status==='SUCCESS')discovered.push(...sitemapUrls(response.text,origin))}
  const queue=unique([...discovered,...COMMON_PATHS.map(path=>`${origin}${path}`)]).filter(url=>robotsAllows(url,robots)).slice(0,Math.max(1,Math.min(Number(maxPages)||10,20))),people=[],sources=[],failures=[];let pagesFetched=0;
  for(let index=0;index<queue.length;index++){if(index&&pageDelayMs>0)await new Promise(resolve=>setTimeout(resolve,Math.min(Number(pageDelayMs)||0,2000)));const url=queue[index],response=await publicFetch(url,{fetcher,origin});if(response.status!=='SUCCESS'){if(['BLOCKED','ERROR'].includes(response.status))failures.push({url,status:response.status,reason:response.error});continue}pagesFetched++;const records=extractPublicBuyerEvidence({html:response.text,url:response.url,account,categories,observedAt,headers:response.headers});if(records.length){people.push(...records);sources.push({url:response.url,source_type:sourceType(response.url),candidates:records.length,observed_at:observedAt})}}
  const seen=new Set(),deduped=people.filter(person=>{const key=`${normalize(person.name)}|${normalize(person.title)}`;if(seen.has(key))return false;seen.add(key);return true});
  const status=deduped.length?'SUCCESS':pagesFetched===0&&failures.some(item=>item.status==='ERROR')?'ERROR':failures.length&&failures.every(item=>item.status==='BLOCKED')?'BLOCKED':'NO_RESULTS';
  return {status,people:deduped.slice(0,50),sources,pages_fetched:pagesFetched,robots_status:robotsStatus,failures,attempts:0,external_api_cost_cents:0,research_method:'DIRECT_PUBLIC_WEB',error:status==='ERROR'?'Every permitted public page request failed transiently':''};
}
