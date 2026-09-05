import { resolveTenant } from './_tenant.js';
import { db } from './_db.js';
import { normalizePublicUrl } from './_url.js';
import { responseOutputText } from './_openai-research.js';

const CATALOG_PAGE_SCHEMA={type:'object',additionalProperties:false,properties:{products:{type:'array',items:{type:'object',additionalProperties:false,properties:{brand:{type:'string'},product_name:{type:'string'},sku:{type:'string'},product_family:{type:'string'},category:{type:'string'},description:{type:'string'},msrp:{type:'number'},map:{type:'number'},wholesale:{type:'number'},upc:{type:'string'},model_number:{type:'string'},features:{type:'array',items:{type:'string'}},product_url:{type:'string'},image_url:{type:'string'},source_url:{type:'string'}},required:['brand','product_name','sku','product_family','category','description','msrp','map','wholesale','upc','model_number','features','product_url','image_url','source_url']}}},required:['products']};
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const likelyProductPage=row=>!/(contact|about|learn|support|privacy|terms|dealer|login|cart|blog|news)/i.test(`${row.title} ${row.url}`)&&/(product|shop|collection|catalog|mount|stand|desk|speaker|audio|clean|furniture|solution)/i.test(`${row.title} ${row.url} ${row.description}`);

async function extractCatalogPages({website,candidates}){
  const key=process.env.OPENAI_API_KEY;if(!key)throw new Error('OPENAI_API_KEY is not configured');
  const host=new URL(website).hostname.replace(/^www\./i,''),urls=candidates.map(x=>normalizePublicUrl(x.url||x)).filter(Boolean).filter(url=>{try{const h=new URL(url).hostname.replace(/^www\./i,'');return h===host||h.endsWith(`.${host}`)}catch{return false}}).slice(0,20);
  if(!urls.length)throw new Error('Select at least one valid product page');
  const prompt=`Extract real manufacturer catalog products from these explicitly approved pages on ${host}: ${JSON.stringify(urls)}. Use current web search and only return products directly supported by those pages or their linked official product detail pages. Exclude contact, informational, support, blog, dealer, collection-only, and navigation pages unless they contain specific product records. Each row requires an exact brand, product name, and manufacturer SKU or model number. If a SKU is not publicly supported, omit that product rather than inventing one. Preserve price, UPC, image URL, features, and category only when displayed; use zero or an empty value when unknown. product_url and source_url must be official URLs actually consulted. Never invent products, identifiers, prices, features, or images.`;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),105000);
  try{const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:controller.signal,body:JSON.stringify({model:clean(process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6',80),reasoning:{effort:'medium'},tools:[{type:'web_search',search_context_size:'high',filters:{allowed_domains:[host]}}],tool_choice:'auto',include:['web_search_call.action.sources'],input:prompt,max_output_tokens:7000,text:{format:{type:'json_schema',name:'catalog_page_extraction',strict:true,schema:CATALOG_PAGE_SCHEMA}}})});let body={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(clean(body.error?.message||`OpenAI returned ${response.status}`,300));let parsed={};try{parsed=JSON.parse(responseOutputText(body)||'{}')}catch{throw new Error('OpenAI returned invalid catalog data')}return (parsed.products||[]).map(row=>({...row,source_type:'website_discovery'})).filter(row=>row.brand&&row.product_name&&(row.sku||row.model_number)&&normalizePublicUrl(row.source_url)).slice(0,100)}finally{clearTimeout(timeout)}
}

async function firecrawl(path,payload){
  const key=process.env.FIRECRAWL_API_KEY;if(!key)throw new Error('FIRECRAWL_API_KEY is not configured');
  const r=await fetch(`https://api.firecrawl.dev/v2/${path}`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify(payload)});
  const text=await r.text();if(!r.ok)throw new Error(`Firecrawl ${path} failed (${r.status}): ${text.slice(0,300)}`);return JSON.parse(text);
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
  const t=await resolveTenant(req,res);if(!t)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const rawWebsite=String(req.body?.website||'').trim(),website=normalizePublicUrl(rawWebsite);
  if(!website)return res.status(400).json({error:'A valid vendor website is required',code:'INVALID_VENDOR_WEBSITE',received:rawWebsite});
  try{
    if(req.body?.action==='extract'){
      const rows=await extractCatalogPages({website,candidates:Array.isArray(req.body?.candidates)?req.body.candidates:[]});
      return res.status(200).json({version:'9.8.3',status:rows.length?'READY_FOR_REVIEW':'NO_PRODUCTS',rows,rows_extracted:rows.length,requires_explicit_approval:true,interpretation:rows.length?'Review the extracted product fields below. Nothing is imported until you approve.':'No products with attributable names and SKUs were found on the selected pages.'});
    }
    const host=new URL(website).hostname.replace(/^www\./i,'');
    const search=await firecrawl('search',{query:`site:${host} products OR shop OR catalog`,limit:Math.min(Math.max(Number(req.body?.limit)||40,1),75),scrapeOptions:{formats:['markdown']}});
    const allHits=normalizeFirecrawlSearch(search).filter(x=>{try{const h=new URL(x.url).hostname.replace(/^www\./i,'');return h===host||h.endsWith(`.${host}`)}catch{return false}}),hits=allHits.filter(likelyProductPage);
    let importRunId=null,tracking='UNAVAILABLE_UNTIL_V9_8_MIGRATION';
    try{
      const sql=db();const runStatus=hits.length?'review_required':'no_candidates';const run=(await sql`insert into catalog_import_runs(manufacturer_id,source_type,source_name,rows_seen,status) values(${t.tenant_id},'website_discovery',${website},${hits.length},${runStatus}) returning id`)[0];
      importRunId=run?.id||null;tracking='RECORDED';
    }catch(e){console.warn('catalog import tracking unavailable',{message:e?.message||String(e)});}
    return res.status(200).json({version:'9.8.3',status:hits.length?'REVIEW_REQUIRED':'NO_CANDIDATES',website,candidates:hits,import_run_id:importRunId,tracking,failure_is_negative_evidence:false,interpretation:hits.length?'These are discovered public product-page candidates only. Review and approve before importing products or image URLs.':'No attributable product-page candidates were discovered. This is UNKNOWN and does not prove the vendor has no products.'});
  }catch(e){
    console.error('catalog website discovery failed',{message:e?.message||String(e)});
    return res.status(502).json({version:'9.8.3',status:'DISCOVERY_FAILED',error:e?.message||'Website discovery failed',code:'CATALOG_WEBSITE_DISCOVERY_FAILED',website,candidates:[],failure_is_negative_evidence:false,interpretation:'Catalog acquisition failed. Product availability remains UNKNOWN; this failure is not evidence that the manufacturer has no products.'});
  }
}
