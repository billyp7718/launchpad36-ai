import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { refreshTier } from './_living-intelligence.js';
import { normalizePublicUrl } from './_url.js';

const FIRECRAWL_MONITOR_ENDPOINT='https://api.firecrawl.dev/v2/monitor';
const WEBHOOK_EVENTS=['monitor.page','monitor.check.completed'];

export function monitorScheduleText(tier){
  return ({daily:'every day',weekly:'every week',monthly:'every month'})[refreshTier(tier)];
}

export function buildFirecrawlMonitorPayload({sourceUrl,targetType,tier,categoryFocus='',webhookUrl}){
  const host=new URL(sourceUrl).hostname.replace(/^www\./,'');
  const subject=targetType==='retailer_assortment'&&categoryFocus?`${categoryFocus} assortment at ${host}`:`${targetType.replace(/_/g,' ')} at ${host}`;
  return {
    name:`Launchpad36: ${subject}`.slice(0,120),schedule:{text:monitorScheduleText(tier)},
    targets:[{type:'scrape',urls:[sourceUrl]}],goal:`Detect meaningful public commercial changes for ${subject}.`,judgeEnabled:true,
    webhook:{url:webhookUrl,events:WEBHOOK_EVENTS}
  };
}

function monitorEnvironment(){
  const apiKey=String(process.env.FIRECRAWL_API_KEY||'').trim();
  const webhookUrl=normalizePublicUrl(process.env.FIRECRAWL_MONITOR_WEBHOOK_URL);
  // Firecrawl uses this account secret to sign webhook deliveries. It must be
  // configured server-side before provisioning, but is never sent in the request.
  const webhookSecret=String(process.env.FIRECRAWL_WEBHOOK_SECRET||'').trim();
  const missing=[];
  if(!apiKey)missing.push('FIRECRAWL_API_KEY');
  if(!webhookUrl)missing.push('FIRECRAWL_MONITOR_WEBHOOK_URL');
  if(!webhookSecret)missing.push('FIRECRAWL_WEBHOOK_SECRET');
  return {apiKey,webhookUrl,missing};
}

async function provisionFirecrawlMonitor(details){
  const config=monitorEnvironment();
  if(config.missing.length){const error=new Error('Firecrawl monitor provisioning is not configured');error.statusCode=503;error.code='MONITOR_CONFIGURATION_REQUIRED';error.missing=config.missing;throw error;}
  const response=await fetch(FIRECRAWL_MONITOR_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(buildFirecrawlMonitorPayload({...details,webhookUrl:config.webhookUrl})),signal:AbortSignal.timeout(20000)});
  let result={};try{result=await response.json()}catch{}
  if(!response.ok){const error=new Error('Firecrawl monitor provisioning failed');error.statusCode=502;error.code='FIRECRAWL_MONITOR_ERROR';error.providerStatus=response.status;throw error;}
  const monitorId=String(result?.id||result?.monitorId||result?.data?.id||result?.data?.monitorId||'').trim();
  if(!monitorId){const error=new Error('Firecrawl did not return a monitor ID');error.statusCode=502;error.code='FIRECRAWL_MONITOR_ID_MISSING';throw error;}
  return monitorId;
}

export default async function handler(req,res){
  if(!requireInternal(req,res))return;
  const sql=db();
  try{
    if(req.method==='GET'){const rows=await sql`select mt.*,es.source_url,es.source_kind,es.last_verified_at,es.last_status from monitor_targets mt join evidence_sources es on es.id=mt.source_id order by mt.next_check_at nulls first,es.source_url`;return res.status(200).json({version:'9.8.3',monitor_targets:rows,credentials_configured:Boolean(process.env.FIRECRAWL_API_KEY),webhook_configured:Boolean(process.env.FIRECRAWL_MONITOR_WEBHOOK_URL&&process.env.FIRECRAWL_WEBHOOK_SECRET)})}
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const sourceUrl=normalizePublicUrl(req.body?.source_url),targetType=String(req.body?.target_type||'retailer_assortment').trim(),tier=refreshTier(req.body?.refresh_tier),accountId=req.body?.account_id||null,organizationId=req.body?.organization_id||null,replaceTargetId=String(req.body?.replace_target_id||'').trim(),categoryFocus=String(req.body?.category_focus||'').replace(/\s+/g,' ').trim().slice(0,160),existingMonitorId=String(req.body?.provider_monitor_id||'').trim();
    if(!sourceUrl)return res.status(400).json({error:'Valid public source_url is required'});
    if(targetType==='retailer_assortment'&&!categoryFocus)return res.status(400).json({error:'Category is required for retailer assortment targets'});
    if(replaceTargetId){if(!/^[0-9a-f-]{36}$/i.test(replaceTargetId))return res.status(400).json({error:'Valid replace_target_id is required'});if(!(await sql`select id from monitor_targets where id=${replaceTargetId} and state='active' limit 1`)[0])return res.status(404).json({error:'Active monitoring target to replace was not found'})}
    if(accountId&&!(await sql`select id from accounts where id=${accountId} limit 1`)[0])return res.status(400).json({error:'account_id does not exist'});
    if(organizationId&&!(await sql`select id from retail_organizations where id=${organizationId} limit 1`)[0])return res.status(400).json({error:'organization_id does not exist'});
    const providerMonitorId=existingMonitorId||await provisionFirecrawlMonitor({sourceUrl,targetType,tier,categoryFocus});
    if(replaceTargetId)await sql`update monitor_targets set state='inactive',updated_at=now() where id=${replaceTargetId} and state='active'`;
    const host=new URL(sourceUrl).hostname.replace(/^www\./,'');const source=(await sql`insert into evidence_sources(source_url,source_kind,publisher,domain,refresh_tier,last_status,updated_at) values(${sourceUrl},${targetType},${req.body?.publisher||''},${host},${tier},'MONITOR_PENDING',now()) on conflict(source_url) do update set source_kind=excluded.source_kind,refresh_tier=excluded.refresh_tier,updated_at=now() returning *`)[0];
    const target=(await sql`insert into monitor_targets(source_id,account_id,organization_id,target_type,category_focus,refresh_tier,provider,provider_monitor_id,state,next_check_at,updated_at) values(${source.id},${accountId},${organizationId},${targetType},${categoryFocus},${tier},'firecrawl',${providerMonitorId},'active',now(),now()) on conflict(source_id,target_type) do update set account_id=excluded.account_id,organization_id=excluded.organization_id,category_focus=excluded.category_focus,refresh_tier=excluded.refresh_tier,provider_monitor_id=excluded.provider_monitor_id,state='active',updated_at=now() returning *`)[0];
    return res.status(200).json({version:'9.8.3',status:existingMonitorId?'MONITOR_LINKED':'MONITOR_PROVISIONED',target,source,firecrawl:{mode:'page',schedule:tier,webhook_events:WEBHOOK_EVENTS,webhook_configured:true,webhook_authentication:'X-Firecrawl-Signature HMAC-SHA256'},interpretation:'The Firecrawl monitor is active and its provider ID is linked to this target.'});
  }catch(e){return res.status(e.statusCode||500).json({error:e.message,code:e.code||'MONITOR_TARGET_ERROR',...(e.missing?{missing:e.missing}:{}),...(e.providerStatus?{provider_status:e.providerStatus}:{})})}
}
