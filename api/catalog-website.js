import { resolveTenant } from './_tenant.js';
import { db } from './_db.js';

function cleanUrl(v=''){
  let value=String(v||'').trim(); if(!value)return '';
  if(value.startsWith('//'))value=`https:${value}`;
  else if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(value))value=`https://${value}`;
  try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!u.hostname||!u.hostname.includes('.'))return '';u.hash='';return u.toString();}catch{return ''}
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
  const rawWebsite=String(req.body?.website||'').trim(),website=cleanUrl(rawWebsite);
  if(!website)return res.status(400).json({error:'A valid vendor website is required',code:'INVALID_VENDOR_WEBSITE',received:rawWebsite});
  try{
    const host=new URL(website).hostname.replace(/^www\./i,'');
    const search=await firecrawl('search',{query:`site:${host} products OR shop OR catalog`,limit:Math.min(Math.max(Number(req.body?.limit)||40,1),75),scrapeOptions:{formats:['markdown']}});
    const hits=normalizeFirecrawlSearch(search).filter(x=>{try{const h=new URL(x.url).hostname.replace(/^www\./i,'');return h===host||h.endsWith(`.${host}`)}catch{return false}});
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
