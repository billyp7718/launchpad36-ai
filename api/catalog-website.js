import { resolveTenant } from './_tenant.js';
import { db } from './_db.js';
function cleanUrl(v=''){try{const u=new URL(v);return u.toString()}catch{return ''}}
async function firecrawl(path,payload){const key=process.env.FIRECRAWL_API_KEY;if(!key)throw new Error('FIRECRAWL_API_KEY is not configured');const r=await fetch(`https://api.firecrawl.dev/v2/${path}`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify(payload)});const text=await r.text();if(!r.ok)throw new Error(`Firecrawl ${path} failed (${r.status}): ${text.slice(0,300)}`);return JSON.parse(text)}
export default async function handler(req,res){const t=await resolveTenant(req,res);if(!t)return;if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});const website=cleanUrl(req.body?.website||'');if(!website)return res.status(400).json({error:'A valid vendor website URL is required'});try{
 const host=new URL(website).hostname;const q=`site:${host} products OR shop OR catalog`;
 const search=await firecrawl('search',{query:q,limit:Math.min(Number(req.body?.limit)||40,75),scrapeOptions:{formats:['markdown']}});
 const hits=(search.data||search.web||[]).map(x=>({url:x.url||x.link||'',title:x.title||'',description:x.description||x.markdown?.slice(0,400)||''})).filter(x=>x.url);
 const sql=db();const run=(await sql`insert into catalog_import_runs(manufacturer_id,source_type,source_name,rows_seen,status) values(${t.tenant_id},'website_discovery',${website},${hits.length},'review_required') returning id`)[0];
 return res.status(200).json({version:'9.8',status:'REVIEW_REQUIRED',website,candidates:hits,import_run_id:run.id,interpretation:'These are discovered public product-page candidates only. Review and approve before importing products or image URLs.'});
 }catch(e){return res.status(500).json({error:e.message})}}
