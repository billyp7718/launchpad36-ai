import crypto from 'crypto';
import { requireAdmin } from './_auth.js';
import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { prepareMarketReportAttachment } from './_market-report.js';
import { loadReportSnapshot } from './market-report-snapshots.js';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function reportRecipients(value){return [...new Set(String(value||'').split(/[;,]/).map(x=>x.trim().toLowerCase()).filter(Boolean))].slice(0,10)}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const key=process.env.RESEND_API_KEY||'',from=process.env.REPORT_FROM_EMAIL||'';
  if(!key||!from)return res.status(503).json({error:'Direct email is not configured. Add RESEND_API_KEY and REPORT_FROM_EMAIL in Vercel, or use Download/Open Email App.',code:'EMAIL_NOT_CONFIGURED'});
  const recipients=reportRecipients(req.body?.to);if(!recipients.length||recipients.some(x=>!EMAIL.test(x)))return res.status(400).json({error:'Enter one or more valid recipient email addresses'});
  const subject=String(req.body?.subject||'Launchpad36 Market Analysis').trim().slice(0,180),snapshotId=String(req.body?.snapshot_id||'');
  try{
    const snapshot=await loadReportSnapshot(db(),tenant.tenant_id,snapshotId);if(!snapshot)return res.status(404).json({error:'Saved market analysis snapshot was not found'});
    let pdf;try{pdf=await prepareMarketReportAttachment(snapshot.report_snapshot)}catch(error){console.error('[market-report-email] PDF generation failed',{message:error?.message||String(error)});return res.status(error?.code==='PDF_ATTACHMENT_TOO_LARGE'?413:502).json({error:error.message})}
    const html=String(snapshot.email_html||'');if(html.length<100||html.length>500000)return res.status(422).json({error:'The saved email body is invalid. No email was sent.'});
    const idempotency=crypto.createHash('sha256').update([recipients.join(','),subject,snapshot.content_hash].join('|')).digest('hex');
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','Idempotency-Key':`market-report-${idempotency}`},body:JSON.stringify({from,to:recipients,subject,html,attachments:[{filename:snapshot.filename,content:pdf.toString('base64')}]})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){console.error('[market-report-email] provider failed',{status:response.status,message:data?.message||data?.error||''});return res.status(502).json({error:'Email provider rejected the report. Check the verified sender address in Vercel.'})}
    console.log('[market-report-email] sent',{id:data.id||'',recipients:recipients.length});return res.status(200).json({sent:true,id:data.id||'',recipients:recipients.length});
  }catch(error){console.error('[market-report-email] failed',{message:error?.message||String(error)});return res.status(502).json({error:'The report email could not be sent'})}
}
