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
export default async function handler(req,res){
  const t=await resolveTenant(req,res);if(!t)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const rawWebsite=String(req.body?.website||'').trim(),website=cleanUrl(rawWebsite);
  if(!website)return res.status(400).json({error:'A valid vendor website is required',code:'INVALID_VENDOR_WEBSITE',received:rawWebsite});
  try{
    const host=new URL(website).hostname.replace(/^www\./i,'');
    const search=await firecrawl('search',{query:`site:${host} products OR shop OR catalog`,limit:Math.min(Math.max(Number(req.body?.limit)||40,1),75),scrapeOptions:{formats:['markdown']}});
    const hits=(search.data||search.web||[]).map(x=>({url:x.url||x.link||'',title:x.title||'',description:x.description||x.markdown?.slice(0,400)||''})).filter(x=>x.url);
    let importRunId=null,tracking='UNAVAILABLE_UNTIL_V9_8_MIGRATION';
    try{
      const sql=db();const run=(await sql`insert into catalog_import_runs(manufacturer_id,source_type,source_name,rows_seen,status) values(${t.tenant_id},'website_discovery',${website},${hits.length},'review_required') returning id`)[0];
      importRunId=run?.id||null;tracking='RECORDED';
    }catch(e){console.warn('catalog import tracking unavailable',{message:e?.message||String(e)});}
    return res.status(200).json({version:'9.8.2',status:'REVIEW_REQUIRED',website,candidates:hits,import_run_id:importRunId,tracking,interpretation:hits.length?'These are discovered public product-page candidates only. Review and approve before importing products or image URLs.':'No attributable product-page candidates were discovered. This does not prove the vendor has no products.'});
  }catch(e){
    console.error('catalog website discovery failed',{message:e?.message||String(e)});
    return res.status(500).json({error:e?.message||'Website discovery failed',code:'CATALOG_WEBSITE_DISCOVERY_FAILED',website});
  }
}
