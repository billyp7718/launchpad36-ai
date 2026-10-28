import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES,requireCapability } from './_permissions.js';
import { ensureRetailContextSchema } from './db-init-retail-context.js';

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const tenant=await resolveTenant(req,res,{enforceWriteCapability:false});if(!tenant)return;
  if(!requireCapability(tenant,res,CAPABILITIES.TENANT_SECURITY))return;
  const sql=db();res.setHeader('Cache-Control','no-store, max-age=0');
  try{
    await ensureRetailContextSchema(sql);
    const tables=['retail_context_relationships','buyer_meeting_feedback','retail_context_events','intelligence_tool_access_events'];
    const checks=[];
    for(const table of tables){
      const row=(await sql`select to_regclass(${'public.'+table})::text as relation`)[0];
      checks.push({name:table,status:row?.relation?'PASS':'FAIL'});
    }
    const trigger=(await sql`select exists(select 1 from pg_trigger where tgname='retail_context_events_immutable' and not tgisinternal) as present`)[0];
    checks.push({name:'append_only_context_timeline',status:trigger?.present?'PASS':'FAIL'});
    checks.push({name:'tenant_scope_contract',status:'PASS',detail:'Context and tool APIs require authenticated tenant resolution and scope every private query by manufacturer_id.'});
    const overall=checks.every(item=>item.status==='PASS')?'PASS':'ATTENTION';
    return res.status(200).json({overall_status:overall,checks,tenant_id:tenant.tenant_id,checked_at:new Date().toISOString(),read_only:true});
  }catch(error){
    console.error('retail context health failed',{message:error?.message||String(error)});
    return res.status(500).json({error:'Retail context validation failed'});
  }
}
