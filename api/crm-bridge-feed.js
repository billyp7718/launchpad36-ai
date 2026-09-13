import { db } from './_db.js';
import { verifyCrmBridgeToken } from './crm-bridge-token.js';

const CRM_ORIGIN='https://launchpad36-crm.billyp7718.chatgpt.site';
export default async function handler(req,res){
  const origin=String(req.headers.origin||'');
  if(origin===CRM_ORIGIN)res.setHeader('Access-Control-Allow-Origin',CRM_ORIGIN);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','X-L36-CRM-Token, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const sql=db();
  try{
    const suppliedToken=String(req.headers['x-l36-crm-token']||'').trim()||String(req.headers.authorization||'').replace(/^Bearer\\s+/i,'').trim();
    const auth=await verifyCrmBridgeToken(suppliedToken,sql);
    if(!auth)return res.status(401).json({error:'Valid CRM bridge token required'});
    const limit=Math.min(Math.max(Number(req.query?.limit)||250,1),500);
    const offset=Math.max(Number(req.query?.offset)||0,0);
    const accounts=await sql`
      select ro.id,ro.name,ro.domain,ro.organization_type,ro.channel_codes,ro.categories,ro.coverage,ro.region,ro.headquarters,ro.footprint,ro.ecommerce,ro.source_url,ro.confidence,ro.verification_status,ro.updated_at,
      coalesce(mat.fit_score,0) fit_score,coalesce(mat.whitespace_score,0) whitespace_score,coalesce(mat.status,'') target_status
      from retail_organizations ro
      left join manufacturer_account_targets mat on mat.organization_id=ro.id and mat.manufacturer_id=${auth.manufacturer_id}
      where ro.active=true order by ro.name limit ${limit} offset ${offset}`;
    const result=[];
    for(const account of accounts){
      const buyers=await sql`select b.id,b.name,b.title,b.category,b.email,b.phone,b.linkedin,b.source_url,b.confidence,b.verification_status,b.updated_at from accounts a join buyers b on b.account_id=a.id where a.organization_id=${account.id} order by b.confidence desc,b.updated_at desc`;
      result.push({...account,buyers});
    }
    return res.status(200).json({source:'Launchpad36.ai',generated_at:new Date().toISOString(),count:result.length,limit,offset,next_offset:result.length===limit?offset+limit:null,accounts:result,product_data_included:false});
  }catch(e){console.error('crm bridge feed error',{message:e?.message||String(e)});return res.status(500).json({error:'CRM bridge feed could not be loaded'})}
}
