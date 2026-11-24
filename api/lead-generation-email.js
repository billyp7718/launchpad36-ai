import crypto from 'node:crypto';
import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { ensureLeadGenerationRecipientSchema } from './lead-generation.js';

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean=(value,max)=>String(value??'').trim().slice(0,max);
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const section=req.body?.section_key;
  if(!['commercial_goods','services','consumer_goods'].includes(section))return res.status(400).json({error:'Choose an application section.'});
  const tenant=await resolveTenant(req,res,{requiredSection:section});if(!tenant)return;
  const key=process.env.RESEND_API_KEY||'',from=process.env.REPORT_FROM_EMAIL||'';
  if(!key||!from)return res.status(503).json({error:'Direct email is not configured for this workspace.',code:'EMAIL_NOT_CONFIGURED'});
  const email=clean(req.body?.to,250).toLowerCase(),subject=clean(req.body?.subject,180),message=String(req.body?.message||'').trim().slice(0,20000);
  if(!EMAIL.test(email))return res.status(400).json({error:'Choose one valid recipient email.'});
  if(!subject)return res.status(400).json({error:'Enter an email subject.'});
  if(!message)return res.status(400).json({error:'Write a message before sending.'});
  try{
    const sql=db();await ensureLeadGenerationRecipientSchema(sql);
    const recipient=(await sql`select email from lead_generation_recipients where manufacturer_id=${tenant.tenant_id} and section_key=${section} and lower(email)=lower(${email}) limit 1`)[0];
    if(!recipient)return res.status(403).json({error:'This address is not on the selected section mass email list.'});
    const contentHash=crypto.createHash('sha256').update([tenant.tenant_id,section,email,subject,message].join('|')).digest('hex');
    const html=`<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:normal">${escapeHtml(message).replace(/\r?\n/g,'<br>')}</div>`;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','Idempotency-Key':`lead-generation-${contentHash}`},body:JSON.stringify({from,to:[email],subject,html,text:message})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){console.error('[lead-generation-email] provider rejected message',{status:response.status,message:data?.message||data?.error||''});return res.status(502).json({error:'The email provider could not send this message. Earlier recipients may already have received it.'})}
    return res.status(200).json({sent:true,id:data.id||''});
  }catch(error){console.error('[lead-generation-email] send failed',{message:error?.message||String(error)});return res.status(502).json({error:'The email could not be sent. Earlier recipients may already have received it.'})}
}
