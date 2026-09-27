import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { reportFilename,reportSnapshotHash,validateReportSnapshot } from './_market-report.js';

const MAX_EMAIL_HTML_BYTES=2*1024*1024;
const clean=value=>String(value||'').trim();

export async function createReportSnapshot(sql,tenantId,{snapshot,email_html}={}){
  const report=validateReportSnapshot(snapshot),emailHtml=clean(email_html);
  if(emailHtml.length<100)throw new Error('The PDF snapshot email body is missing or incomplete');
  if(Buffer.byteLength(emailHtml,'utf8')>MAX_EMAIL_HTML_BYTES)throw new Error('The PDF snapshot email body exceeds the 2 MB safety limit');
  const contentHash=reportSnapshotHash(report,emailHtml),filename=reportFilename(report.brand,report.generated_at);
  const existing=(await sql`select id,title,brand_name,analysis_date,filename,content_hash,created_at from market_analysis_report_snapshots where manufacturer_id=${tenantId} and content_hash=${contentHash} order by created_at desc limit 1`)[0];
  if(existing)return existing;
  return (await sql`insert into market_analysis_report_snapshots(manufacturer_id,title,brand_name,analysis_date,filename,content_hash,report_snapshot,email_html) values(${tenantId},${report.title},${report.brand},${report.generated_at},${filename},${contentHash},${sql.json(report)},${emailHtml}) returning id,title,brand_name,analysis_date,filename,content_hash,created_at`)[0];
}

export async function loadReportSnapshot(sql,tenantId,id){return (await sql`select id,title,brand_name,analysis_date,filename,content_hash,report_snapshot,email_html,created_at from market_analysis_report_snapshots where id=${String(id||'')} and manufacturer_id=${tenantId} limit 1`)[0]||null}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{const row=await createReportSnapshot(db(),tenant.tenant_id,req.body);return res.status(201).json({snapshot:row})}
  catch(error){console.error('[market-report-snapshots] failed',{message:error?.message||String(error)});if(error?.code==='42P01')return res.status(409).json({error:'Report snapshot storage is not initialized. Run the V9.8 database update.',code:'SCHEMA_REQUIRED'});return res.status(400).json({error:error?.message||'The report snapshot could not be saved'})}
}
