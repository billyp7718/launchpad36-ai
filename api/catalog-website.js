import { resolveTenant } from './_tenant.js';
import { db } from './_db.js';
import { normalizePublicUrl } from './_url.js';
import { responseOutputText } from './_openai-research.js';

const CATALOG_PAGE_SCHEMA={type:'object',additionalProperties:false,properties:{products:{type:'array',items:{type:'object',additionalProperties:false,properties:{brand:{type:'string'},product_name:{type:'string'},sku:{type:'string'},product_family:{type:'string'},category:{type:'string'},description:{type:'string'},msrp:{type:'number'},map:{type:'number'},wholesale:{type:'number'},upc:{type:'string'},model_number:{type:'string'},features:{type:'array',items:{type:'string'}},product_url:{type:'string'},image_url:{type:'string'},source_url:{type:'string'}},required:['brand','product_name','sku','product_family','category','description','msrp','map','wholesale','upc','model_number','features','product_url','image_url','source_url']}}},required:['products']};
const CATALOG_BATCH_SIZE=4;
const CATALOG_BATCH_TIMEOUT_MS=55000;
const NOISE_PATH=/(^|\/)(forums?|discussion|community|support|help|faq|knowledge(?:-|_)base|news|blog|articles?|press|media|events?|dealer(?:s)?|dealer-locator|where-to-buy|store-locator|login|account|cart|checkout|privacy|terms|contact|about|careers?)(\/|$)/i;
const PRODUCT_PATH=/(^|\/)(products?|shop|catalog|collections?|categories?|series|models?)(\/|$)/i;
const PRODUCT_WORDS=/(product|shop|catalog|collection|series|model|speaker|audio|mount|stand|desk|cleaner|furniture|solution)/i;
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);

export function catalogCandidateScore(row={}){
  const url=normalizePublicUrl(row.url);if(!url)return -100;
  const parsed=new URL(url),path=decodeURIComponent(parsed.pathname).toLowerCase().replace(/\/+$/,'')||'/';
  const text=`${row.title||''} ${row.description||''}`;
  if(NOISE_PATH.test(path)||/\.(pdf|docx?|xlsx?|zip)$/i.test(path))return -100;
  let score=0;
  if(PRODUCT_PATH.test(path))score+=5;
  if(PRODUCT_WORDS.test(`${path} ${text}`))score+=2;
  if(path.split('/').filter(Boolean).length>=2)score+=1;
  if(/\b(buy|price|specifications?|features?|sku|model)\b/i.test(text))score+=2;
  if(path==='/'||/sitemap|search|tag|author|feed/i.test(path))score-=4;
  return score;
}

export const likelyProductPage=row=>catalogCandidateScore(row)>0;

export function filterCatalogCandidates(rows=[]){
  return rows.map((row,index)=>({row,index,score:catalogCandidateScore(row)})).filter(x=>likelyProductPage(x.row)).sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.row);
}

function sameSiteUrls(website,candidates){
  const host=new URL(website).hostname.replace(/^www\./i,'');
  const seen=new Set();return candidates.map(x=>normalizePublicUrl(x.url||x)).filter(Boolean).filter(url=>{try{const h=new URL(url).hostname.replace(/^www\./i,'');if(h!==host&&!h.endsWith(`.${host}`))return false;if(seen.has(url))return false;seen.add(url);return true}catch{return false}});
}

function chunks(values,size=CATALOG_BATCH_SIZE){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out}
function transientExtractionError(error){return error?.name==='AbortError'||Number(error?.httpStatus)>=500||/abort|timeout|timed out|network|fetch failed|socket|econnreset|temporar/i.test(String(error?.message||error))}

async function extractCatalogBatch({host,urls,fetcher=fetch,timeoutMs=CATALOG_BATCH_TIMEOUT_MS}){
  const key=process.env.OPENAI_API_KEY;if(!key)throw Object.assign(new Error('OPENAI_API_KEY is not configured'),{code:'OPENAI_NOT_CONFIGURED'});
  const prompt=`Extract real manufacturer catalog products from these explicitly approved pages on ${host}: ${JSON.stringify(urls)}. Use current web search and only return products directly supported by those pages or their linked official product detail pages. Exclude contact, informational, support, blog, dealer, collection-only, and navigation pages unless they contain specific product records. Each row requires an exact brand, product name, and manufacturer SKU or model number. If a SKU is not publicly supported, omit that product rather than inventing one. Preserve price, UPC, image URL, features, and category only when displayed; use zero or an empty value when unknown. product_url and source_url must be official URLs actually consulted. Never invent products, identifiers, prices, features, or images.`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model:clean(process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6',80),reasoning:{effort:'medium'},tools:[{type:'web_search',search_context_size:'high',filters:{allowed_domains:[host]}}],tool_choice:'auto',include:['web_search_call.action.sources'],input:prompt,max_output_tokens:5000,text:{format:{type:'json_schema',name:'catalog_page_extraction',strict:true,schema:CATALOG_PAGE_SCHEMA}}})});
    let body={};try{body=await response.json()}catch{}
    if(!response.ok){const error=new Error(clean(body.error?.message||`OpenAI returned ${response.status}`,300));error.httpStatus=response.status;throw error}
    let parsed={};try{parsed=JSON.parse(responseOutputText(body)||'{}')}catch{throw new Error('OpenAI returned invalid catalog data')}
    return (parsed.products||[]).map(row=>({...row,source_type:'website_discovery'})).filter(row=>row.brand&&row.product_name&&(row.sku||row.model_number)&&normalizePublicUrl(row.source_url)).slice(0,100);
  }catch(error){
    if(controller.signal.aborted){const timeoutError=new Error('Catalog extraction batch timed out');timeoutError.name='AbortError';timeoutError.code='CATALOG_EXTRACTION_TIMEOUT';throw timeoutError}
    throw error;
  }finally{clearTimeout(timeout)}
}

async function extractBatchWithRetry(details){
  let lastError;
  for(let attempt=1;attempt<=2;attempt++)try{return {rows:await extractCatalogBatch(details),attempts:attempt}}catch(error){lastError=error;if(attempt===2||!transientExtractionError(error))break}
  throw Object.assign(lastError||new Error('Catalog extraction batch failed'),{attempts:2});
}

export async function extractCatalogPages({website,candidates,fetcher=fetch,timeoutMs=CATALOG_BATCH_TIMEOUT_MS}){
  if(candidates.length>20)throw Object.assign(new Error('Select no more than 20 product pages per extraction'),{status:400,code:'CATALOG_PAGE_LIMIT'});
  const host=new URL(website).hostname.replace(/^www\./i,''),urls=sameSiteUrls(website,candidates);
  if(!urls.length)throw Object.assign(new Error('Select at least one valid product page'),{status:400,code:'NO_VALID_PRODUCT_PAGES'});
  const batches=chunks(urls),settled=await Promise.all(batches.map((batch,index)=>extractBatchWithRetry({host,urls:batch,fetcher,timeoutMs}).then(result=>({ok:true,index,urls:batch,...result})).catch(error=>({ok:false,index,urls:batch,attempts:error?.attempts||1,code:error?.code||'CATALOG_BATCH_FAILED'}))));
  const successful=settled.filter(x=>x.ok),failed=settled.filter(x=>!x.ok),seen=new Set(),rows=[];
  for(const result of successful)for(const row of result.rows){const key=`${normalizePublicUrl(row.source_url)}|${clean(row.sku||row.model_number,180).toLowerCase()}`;if(!seen.has(key)){seen.add(key);rows.push(row)}}
  return {rows:rows.slice(0,100),selectedPageCount:urls.length,extractedPageCount:successful.reduce((n,x)=>n+x.urls.length,0),failedPages:failed.flatMap(x=>x.urls),batchCount:batches.length,failedBatchCount:failed.length,retriedBatchCount:settled.filter(x=>x.attempts>1).length};
}

async function firecrawl(path,payload){
  const key=process.env.FIRECRAWL_API_KEY;if(!key)throw new Error('FIRECRAWL_API_KEY is not configured');
  let lastError;
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try{const response=await fetch(`https://api.firecrawl.dev/v2/${path}`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},signal:controller.signal,body:JSON.stringify(payload)});const text=await response.text();if(!response.ok){const error=new Error(`Firecrawl ${path} failed (${response.status})`);error.httpStatus=response.status;throw error}return JSON.parse(text)}
    catch(error){lastError=controller.signal.aborted?Object.assign(new Error(`Firecrawl ${path} timed out`),{name:'AbortError',code:'FIRECRAWL_TIMEOUT'}):error;if(attempt===2||!transientExtractionError(lastError))break}
    finally{clearTimeout(timeout)}
  }
  throw lastError;
}

export function normalizeFirecrawlSearch(payload){
  const found=[],seenObjects=new Set();
  function visit(value,depth=0){
    if(value==null||depth>8)return;
    if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return}
    if(typeof value!=='object'||seenObjects.has(value))return;seenObjects.add(value);
    const rawUrl=value.url||value.link||value.href||value.metadata?.sourceURL||value.metadata?.url||'';
    if(typeof rawUrl==='string'&&rawUrl.trim())found.push({url:rawUrl.trim(),title:String(value.title||value.name||value.metadata?.title||''),description:String(value.description||value.snippet||value.markdown||value.content||'').slice(0,400)});
    for(const key of ['data','web','results','items','pages','documents','searchResults','result'])if(value[key]!==undefined)visit(value[key],depth+1);
  }
  visit(payload);
  const seen=new Set();return found.filter(x=>{if(seen.has(x.url))return false;seen.add(x.url);return true});
}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const rawWebsite=String(req.body?.website||'').trim(),website=normalizePublicUrl(rawWebsite);
  if(!website)return res.status(400).json({error:'A valid vendor website is required',code:'INVALID_VENDOR_WEBSITE',received:rawWebsite});
  try{
    if(req.body?.action==='extract'){
      const extraction=await extractCatalogPages({website,candidates:Array.isArray(req.body?.candidates)?req.body.candidates:[]});
      const partial=extraction.failedPages.length>0,status=partial?(extraction.extractedPageCount?'PARTIAL_SUCCESS':'EXTRACTION_FAILED'):extraction.rows.length?'READY_FOR_REVIEW':'NO_PRODUCTS';
      return res.status(200).json({version:'9.8.3',status,rows:extraction.rows,rows_extracted:extraction.rows.length,selected_page_count:extraction.selectedPageCount,pages_extracted:extraction.extractedPageCount,pages_failed:extraction.failedPages.length,failed_pages:extraction.failedPages,batch_count:extraction.batchCount,failed_batch_count:extraction.failedBatchCount,retried_batch_count:extraction.retriedBatchCount,retry_available:partial,requires_explicit_approval:true,interpretation:partial?`Extracted ${extraction.extractedPageCount} of ${extraction.selectedPageCount} selected pages. ${extraction.failedPages.length} page(s) failed and can be retried; successful product rows were preserved for review.`:extraction.rows.length?'Review and edit the extracted product fields below. Nothing is imported until you approve.':'No products with attributable names and SKUs were found on the selected pages.'});
    }
    const host=new URL(website).hostname.replace(/^www\./i,'');
    const search=await firecrawl('search',{query:`site:${host} products OR shop OR catalog`,limit:Math.min(Math.max(Number(req.body?.limit)||40,1),75),scrapeOptions:{formats:['markdown']}});
    const allHits=normalizeFirecrawlSearch(search).filter(x=>{try{const h=new URL(x.url).hostname.replace(/^www\./i,'');return h===host||h.endsWith(`.${host}`)}catch{return false}}),hits=filterCatalogCandidates(allHits);
    let importRunId=null,tracking='UNAVAILABLE_UNTIL_V9_8_MIGRATION';
    try{const sql=db();const runStatus=hits.length?'review_required':'no_candidates';const run=(await sql`insert into catalog_import_runs(manufacturer_id,source_type,source_name,rows_seen,status) values(${tenant.tenant_id},'website_discovery',${website},${hits.length},${runStatus}) returning id`)[0];importRunId=run?.id||null;tracking='RECORDED'}catch(error){console.warn('catalog import tracking unavailable',{message:error?.message||String(error)})}
    return res.status(200).json({version:'9.8.3',status:hits.length?'REVIEW_REQUIRED':'NO_CANDIDATES',website,candidates:hits,import_run_id:importRunId,tracking,failure_is_negative_evidence:false,interpretation:hits.length?'These are discovered public product-page candidates only. Review and approve before importing products or image URLs.':'No attributable product-page candidates were discovered. This is UNKNOWN and does not prove the vendor has no products.'});
  }catch(error){
    console.error('catalog website discovery failed',{code:error?.code||'CATALOG_WEBSITE_DISCOVERY_FAILED'});
    const status=error?.status||502;return res.status(status).json({version:'9.8.3',status:'DISCOVERY_FAILED',error:status===400?error.message:'Website discovery could not be completed',code:error?.code||'CATALOG_WEBSITE_DISCOVERY_FAILED',website,candidates:[],failure_is_negative_evidence:false,interpretation:'Catalog acquisition failed. Product availability remains UNKNOWN; this failure is not evidence that the manufacturer has no products.'});
  }
}
