import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './_db.js';
import { runLivingIntelligencePipeline } from './_living-intelligence.js';

export const config={api:{bodyParser:false}};

function hexBuffer(value){if(!/^[a-f0-9]{64}$/i.test(String(value||'')))return null;return Buffer.from(value,'hex')}
export function verifyFirecrawlSignature(rawBody,signature,secret){
  if(!secret||!Buffer.isBuffer(rawBody))return false;
  const [algorithm,hash]=String(signature||'').split('=',2);if(algorithm!=='sha256')return false;
  const provided=hexBuffer(hash),expected=hexBuffer(createHmac('sha256',secret).update(rawBody).digest('hex'));
  return Boolean(provided&&expected&&provided.length===expected.length&&timingSafeEqual(provided,expected));
}
async function readRawBody(req){
  if(Buffer.isBuffer(req.rawBody))return req.rawBody;if(typeof req.rawBody==='string')return Buffer.from(req.rawBody);
  if(Buffer.isBuffer(req.body))return req.body;if(typeof req.body==='string')return Buffer.from(req.body);
  if(req&&typeof req[Symbol.asyncIterator]==='function'){const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks)}
  return null;
}
export function monitorJudgmentMeaningful(body={},page={}){const judgment=page?.judgment||page?.data?.judgment||body?.data?.judgment||body?.judgment;return judgment?.meaningful!==false}
export function monitorPages(body={}){const candidates=[body?.data?.pages,body?.data,body?.pages,body?.page,body?.result],out=[];for(const x of candidates){if(Array.isArray(x))out.push(...x);else if(x&&typeof x==='object'&&(x.url||x.metadata?.sourceURL||x.markdown||x.content))out.push(x)}return out}
export function shouldProcessMonitorPage(body={},page={}){const status=String(page.status||page.changeStatus||page.change_status||'').toLowerCase();return (!status||['new','changed','removed'].includes(status))&&monitorJudgmentMeaningful(body,page)}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const secret=process.env.FIRECRAWL_WEBHOOK_SECRET||'';if(!secret)return res.status(503).json({error:'FIRECRAWL_WEBHOOK_SECRET is not configured'});
  const rawBody=await readRawBody(req),signature=String(req.headers['x-firecrawl-signature']||'');
  if(!verifyFirecrawlSignature(rawBody,signature,secret))return res.status(401).json({error:'Invalid Firecrawl webhook signature'});
  let body;try{body=JSON.parse(rawBody.toString('utf8'))}catch{return res.status(400).json({error:'Invalid JSON webhook body'})}
  const sql=db(),eventType=String(body.type||body.event||'monitor.unknown'),monitorId=String(body.monitorId||body.monitor_id||body.data?.monitorId||body.metadata?.monitorId||''),eventId=String(body.webhookId||body.id||body.eventId||body.data?.id||createHash('sha256').update(rawBody).digest('hex'));
  try{
    const delivery=(await sql`insert into monitor_webhook_events(provider,provider_event_id,provider_monitor_id,event_type,payload) values('firecrawl',${eventId},${monitorId},${eventType},${sql.json(body)}) on conflict(provider,provider_event_id) do nothing returning *`)[0];
    if(!delivery)return res.status(200).json({status:'DUPLICATE_IGNORED'});
    const target=monitorId?(await sql`select mt.*,es.source_url from monitor_targets mt join evidence_sources es on es.id=mt.source_id where mt.provider_monitor_id=${monitorId} limit 1`)[0]:null;
    let processed=0,review=0,nonMeaningful=0;
    for(const page of monitorPages(body)){
      const status=String(page.status||page.changeStatus||page.change_status||'').toLowerCase();if(!shouldProcessMonitorPage(body,page)){if(!monitorJudgmentMeaningful(body,page))nonMeaningful++;continue}
      const sourceUrl=String(page.url||page.metadata?.sourceURL||target?.source_url||'');if(!sourceUrl)continue;
      const payload={monitor_status:status||'changed',title:page.title||page.metadata?.title||'',markdown:page.markdown||page.content||'',diff:page.diff||page.change||null,judgment:page.judgment||body.data?.judgment||body.judgment||null,provider_event_type:eventType};
      const result=await runLivingIntelligencePipeline({account_id:target?.account_id||null,organization_id:target?.organization_id||null,source_url:sourceUrl,source_type:'firecrawl_monitor',subject_type:target?.target_type||'product_evidence',subject_key:`${target?.target_type||'page'}:${sourceUrl}`,evidence_type:target?.target_type==='buyer_leadership'?'leadership':target?.target_type==='retailer_company'?'retailer_profile':'assortment_product',payload,observed_at:body.timestamp||new Date().toISOString(),confidence:status==='removed'?65:80,verification_status:'REVIEW_REQUIRED',refresh_tier:target?.refresh_tier||'weekly',acquired_by:'firecrawl_monitor_webhook'});processed++;if(result.verification_status!=='VERIFIED')review++;
    }
    await sql`update monitor_webhook_events set processed_at=now(),status=${nonMeaningful&&!processed?'ignored_not_meaningful':'processed'} where id=${delivery.id}`;
    if(target)await sql`update monitor_targets set last_check_at=now(),last_error='',updated_at=now() where id=${target.id}`;
    return res.status(200).json({version:'9.8.3',status:nonMeaningful&&!processed?'IGNORED_NOT_MEANINGFUL':'PROCESSED',observations_processed:processed,non_meaningful_retained:nonMeaningful,review_required:review,negative_inference_allowed:false});
  }catch(e){return res.status(500).json({error:e.message})}
}
