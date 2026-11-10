import crypto from 'node:crypto';
import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { buyerReportDeliveryConfig } from './_buyer-report-delivery.js';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const html=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);

export function easternScheduleParts(value=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return {...parts,hour:Number(parts.hour)};
}
export function isMondayNineEastern(value=new Date()){const parts=easternScheduleParts(value);return parts.weekday==='Mon'&&parts.hour===9}

export function weeklyBuyerReportHtml({tenant,periodStart,periodEnd,summary={},events=[],failedRuns=[],missingCategoryBuyers=0}={}){
  const rows=events.map(event=>{const value=event.new_value||{},source=event.source_url||value.source_url||'';return `<tr><td>${html(event.action_type)}</td><td>${html(value.account_name||'')}</td><td><b>${html(value.name||'')}</b><br>${html(value.title||'')}</td><td>${html(value.category_scope||'Unconfirmed')}</td><td>${html(event.result)}</td><td>${html(value.last_verified_at||event.observed_at||'')}</td><td>${source?`<a href="${html(source)}">Source</a>`:'—'}</td></tr>`}).join('');
  const failures=failedRuns.map(run=>`<li>${html(run.source_name||run.id)} · ${html(run.status)} · ${html(JSON.stringify(run.errors||[]).slice(0,500))}</li>`).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17324f"><h1>Launchpad36 Weekly Buyer Intelligence</h1><p><b>${html(tenant.name)}</b> · ${html(periodStart.toISOString())} through ${html(periodEnd.toISOString())}</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><td><b>${Number(summary.newly_verified)||0}</b><br>Newly verified</td><td><b>${Number(summary.updated)||0}</b><br>Updated / changed</td><td><b>${Number(summary.flagged)||0}</b><br>Needs verification</td><td><b>${Number(summary.duplicates_prevented)||0}</b><br>Duplicates prevented</td><td><b>${Number(missingCategoryBuyers)||0}</b><br>Missing category buyers</td></tr></table><h2>Buyer changes and verification activity</h2><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr><th>Action</th><th>Account</th><th>Buyer</th><th>Category</th><th>Result</th><th>Verified</th><th>Evidence</th></tr></thead><tbody>${rows||'<tr><td colspan="7">No buyer intelligence changes were committed during this period.</td></tr>'}</tbody></table><h2>Failed imports requiring attention</h2>${failures?`<ul>${failures}</ul>`:'<p>None.</p>'}<p style="color:#71869e">Launchpad36 never infers personal email addresses or telephone numbers. Category ownership remains unconfirmed until supported by attributable public evidence.</p></body></html>`;
}

export default async function handler(req,res){
  if(req.method!=='GET'&&req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res))return;
  const delivery=buyerReportDeliveryConfig();
  if(!delivery.enabled)return res.status(200).json({status:'SKIPPED_EXTERNAL_DELIVERY',delivery_mode:delivery.mode});
  const force=String(req.query?.force||req.body?.force||'')==='1';if(!force&&!isMondayNineEastern())return res.status(200).json({status:'SKIPPED_OUTSIDE_EASTERN_WINDOW'});
  const apiKey=process.env.RESEND_API_KEY||'',from=process.env.REPORT_FROM_EMAIL||'',recipient=clean(process.env.BUYER_INTELLIGENCE_REPORT_TO||'Billp@launchpad36.com',200).toLowerCase(),reportTenant=clean(process.env.BUYER_INTELLIGENCE_REPORT_TENANT_ID||process.env.BUYER_INTELLIGENCE_SERVICE_TENANT_ID,80);
  if(!apiKey||!from)return res.status(503).json({error:'Weekly buyer intelligence email is not configured'});if(!EMAIL.test(recipient))return res.status(503).json({error:'Weekly buyer intelligence report recipient is invalid'});
  if(!UUID.test(reportTenant))return res.status(503).json({error:'Weekly buyer intelligence report tenant is not configured'});
  const sql=db(),periodEnd=new Date(),periodStart=new Date(periodEnd.getTime()-7*86400000),parts=easternScheduleParts(periodEnd),reportKey=`buyer-intelligence-${parts.year}-${parts.month}-${parts.day}`,results=[];
  try{
    const tenants=await sql`select id,name from manufacturers where id=${reportTenant} limit 1`;
    if(!tenants.length)return res.status(503).json({error:'Weekly buyer intelligence report tenant is unavailable'});
    for(const tenant of tenants){
      const prior=(await sql`select * from buyer_intelligence_report_deliveries where manufacturer_id=${tenant.id} and report_key=${reportKey} and recipient=${recipient} limit 1`)[0];if(prior?.status==='SENT'){results.push({tenant_id:tenant.id,status:'ALREADY_SENT',provider_id:prior.provider_id});continue}
      const [summaryRows,events,failedRuns,missingRows]=await Promise.all([
        sql`select count(*) filter(where action_type='ADD_BUYER' and result='SUCCESS')::int newly_verified,count(*) filter(where action_type in('UPDATE_BUYER','MARK_STALE') and result='SUCCESS')::int updated,count(*) filter(where result='FLAGGED')::int flagged from buyer_intelligence_audit_events where manufacturer_id=${tenant.id} and created_at>=${periodStart.toISOString()} and created_at<${periodEnd.toISOString()}`,
        sql`select * from buyer_intelligence_audit_events where manufacturer_id=${tenant.id} and created_at>=${periodStart.toISOString()} and created_at<${periodEnd.toISOString()} order by created_at desc limit 250`,
        sql`select id,source_name,status,errors,created_at from buyer_intelligence_import_runs where manufacturer_id=${tenant.id} and created_at>=${periodStart.toISOString()} and status in('FAILED','COMPLETED_WITH_ERRORS') order by created_at desc limit 50`,
        sql`select count(*)::int missing_category_buyers from retail_organizations ro where ro.active=true and not exists(select 1 from accounts a join buyers b on b.account_id=a.id where a.organization_id=ro.id and b.category_verification_status='VERIFIED' and b.status<>'Stale')`
      ]),runDuplicates=(await sql`select coalesce(sum(duplicates_prevented),0)::int duplicates_prevented,coalesce(sum(records_flagged),0)::int run_flagged from buyer_intelligence_import_runs where manufacturer_id=${tenant.id} and created_at>=${periodStart.toISOString()} and created_at<${periodEnd.toISOString()}`)[0]||{},summary={...(summaryRows[0]||{}),duplicates_prevented:runDuplicates.duplicates_prevented,flagged:Math.max(Number(summaryRows[0]?.flagged)||0,Number(runDuplicates.run_flagged)||0)},missingCategoryBuyers=missingRows[0]?.missing_category_buyers||0,body=weeklyBuyerReportHtml({tenant,periodStart,periodEnd,summary,events,failedRuns,missingCategoryBuyers}),subject=`Launchpad36 Weekly Buyer Intelligence — ${tenant.name} — ${parts.month}/${parts.day}/${parts.year}`,idempotency=crypto.createHash('sha256').update(`${tenant.id}|${reportKey}|${recipient}`).digest('hex');
      if(!prior)await sql`insert into buyer_intelligence_report_deliveries(manufacturer_id,report_key,period_start,period_end,recipient,status,summary) values(${tenant.id},${reportKey},${periodStart.toISOString()},${periodEnd.toISOString()},${recipient},'SENDING',${sql.json(summary)})`;
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json','Idempotency-Key':`buyer-intelligence-${idempotency}`},body:JSON.stringify({from,to:[recipient],subject,html:body})}),data=await response.json().catch(()=>({}));
      if(!response.ok){await sql`update buyer_intelligence_report_deliveries set status='FAILED',error=${clean(data.message||data.error||`Provider HTTP ${response.status}`,500)} where manufacturer_id=${tenant.id} and report_key=${reportKey} and recipient=${recipient}`;results.push({tenant_id:tenant.id,status:'FAILED'});continue}
      await sql`update buyer_intelligence_report_deliveries set status='SENT',provider_id=${clean(data.id,180)},error='' where manufacturer_id=${tenant.id} and report_key=${reportKey} and recipient=${recipient}`;results.push({tenant_id:tenant.id,status:'SENT',provider_id:data.id||''});
    }
    return res.status(results.some(item=>item.status==='FAILED')?502:200).json({status:results.some(item=>item.status==='FAILED')?'PARTIAL_FAILURE':'COMPLETE',recipient_count:1,tenants:results});
  }catch(error){console.error('weekly buyer intelligence report failed',{message:error?.message||String(error)});return res.status(500).json({error:'Weekly buyer intelligence report failed'})}
}
