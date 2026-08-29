import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { refreshTier } from './_living-intelligence.js';

function cleanUrl(value){try{const u=new URL(String(value||''));return ['http:','https:'].includes(u.protocol)?u.toString():''}catch{return ''}}
export default async function handler(req,res){if(!requireInternal(req,res))return;const sql=db();
 try{
  if(req.method==='GET'){const rows=await sql`select mt.*,es.source_url,es.source_kind,es.last_verified_at,es.last_status from monitor_targets mt join evidence_sources es on es.id=mt.source_id order by mt.next_check_at nulls first,es.source_url`;return res.status(200).json({version:'9.8.3',monitor_targets:rows,credentials_configured:Boolean(process.env.FIRECRAWL_API_KEY),webhook_configured:Boolean(process.env.FIRECRAWL_MONITOR_WEBHOOK_URL&&process.env.FIRECRAWL_WEBHOOK_SECRET)})}
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const sourceUrl=cleanUrl(req.body?.source_url),targetType=String(req.body?.target_type||'retailer_assortment').trim(),tier=refreshTier(req.body?.refresh_tier);if(!sourceUrl)return res.status(400).json({error:'Valid public source_url is required'});
  const host=new URL(sourceUrl).hostname.replace(/^www\./,'');const source=(await sql`insert into evidence_sources(source_url,source_kind,publisher,domain,refresh_tier,last_status,updated_at) values(${sourceUrl},${targetType},${req.body?.publisher||''},${host},${tier},'MONITOR_PENDING',now()) on conflict(source_url) do update set source_kind=excluded.source_kind,refresh_tier=excluded.refresh_tier,updated_at=now() returning *`)[0];
  const target=(await sql`insert into monitor_targets(source_id,target_type,refresh_tier,provider,provider_monitor_id,state,next_check_at,updated_at) values(${source.id},${targetType},${tier},'firecrawl',${req.body?.provider_monitor_id||''},'active',now(),now()) on conflict(source_id,target_type) do update set refresh_tier=excluded.refresh_tier,provider_monitor_id=case when excluded.provider_monitor_id<>'' then excluded.provider_monitor_id else monitor_targets.provider_monitor_id end,state='active',updated_at=now() returning *`)[0];
  return res.status(200).json({version:'9.8.3',status:target.provider_monitor_id?'MONITOR_LINKED':'PROVIDER_PROVISIONING_REQUIRED',target,source,firecrawl:{mode:'page',schedule:tier,webhook_url_env:'FIRECRAWL_MONITOR_WEBHOOK_URL',webhook_events:['monitor.page','monitor.check.completed'],credentials_env:'FIRECRAWL_API_KEY'},interpretation:'The local target is saved. If provider_monitor_id is empty, provision the Firecrawl page monitor externally and update this target with its ID.'});
 }catch(e){return res.status(500).json({error:e.message})}}
