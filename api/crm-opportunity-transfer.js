import crypto from 'crypto';
import { db } from './_db.js';
import { launchpadCrmOpportunityPayload, signLaunchpadCrmRequest } from './_crm.js';
import { ensureCrmBridgeSchema } from './crm-bridge-token.js';
import { ensureIdentitySchema } from './_identity.js';
import { canSeeAllTenantData, resolveTenant } from './_tenant.js';

const CRM_IMPORT_URL='https://crm.launchpad36.com/api/integrations/launchpad36-ai/opportunities';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);

async function postSigned(body,tokenHash){
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    const timestamp=String(Math.floor(Date.now()/1000)),requestId=crypto.randomUUID(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
    try{
      const response=await fetch(CRM_IMPORT_URL,{method:'POST',headers:{'content-type':'application/json','x-l36-crm-tenant':JSON.parse(body).tenant_id,'x-l36-crm-timestamp':timestamp,'x-l36-crm-request-id':requestId,'x-l36-crm-signature':`v1=${signLaunchpadCrmRequest(tokenHash,timestamp,requestId,body)}`},body,signal:controller.signal});
      let data={};try{data=await response.json()}catch{}
      if(response.ok)return {response,data};
      const error=Object.assign(new Error(clean(data.error||`Launchpad36 CRM returned HTTP ${response.status}`,500)),{status:response.status,data});
      if(response.status===401)return {response,data,error};
      if(![408,425,429,500,502,503,504].includes(response.status)||attempt===1)throw error;
      lastError=error;
    }catch(error){
      lastError=error;
      const transient=error?.name==='AbortError'||/timeout|aborted|fetch failed/i.test(String(error?.message||''));
      if(!transient||attempt===1)throw error;
    }finally{clearTimeout(timer)}
  }
  throw lastError||new Error('Launchpad36 CRM did not accept the transfer');
}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const ids=[...new Set((Array.isArray(req.body?.opportunity_ids)?req.body.opportunity_ids:[req.body?.opportunity_id]).map(value=>String(value||'').trim()).filter(Boolean))];
  if(!ids.length||ids.length>50||ids.some(id=>!UUID.test(id)))return res.status(400).json({error:'Select between 1 and 50 valid opportunities'});
  const sql=db();
  try{
    await Promise.all([ensureCrmBridgeSchema(sql),ensureIdentitySchema(sql)]);
    const tokenRows=await sql`select token_hash from crm_bridge_tokens where manufacturer_id=${tenant.tenant_id} and active=true order by created_at desc limit 10`;
    if(!tokenRows.length)return res.status(409).json({error:'Connect Launchpad36 CRM with an active CRM bridge token before sending opportunities'});
    const rows=await sql`
      select ow.*,ro.name account_name,ro.domain,
        coalesce(buyer_summary.buyers,'[]'::json) buyers
      from opportunity_workspaces ow
      join retail_organizations ro on ro.id=ow.organization_id
      left join lateral(
        select coalesce(json_agg(json_build_object('id',b.id,'name',b.name,'title',b.title,'category',b.category,'email',b.email,'phone',b.phone) order by b.updated_at desc),'[]'::json) buyers
        from accounts a join buyers b on b.account_id=a.id where a.organization_id=ow.organization_id
      ) buyer_summary on true
      where ow.manufacturer_id=${tenant.tenant_id} and ow.id=any(${ids}::uuid[])
        and (${canSeeAllTenantData(tenant)} or ow.owner_user_id=${tenant.user_id} or (ow.visibility='team' and ow.team_id=any(${tenant.team_ids||[]}::uuid[])) or (ow.visibility='tenant' and ow.owner_user_id is null and ow.team_id is null))`;
    if(rows.length!==ids.length)return res.status(404).json({error:'One or more selected opportunities were not found in your private or team scope'});
    const byId=new Map(rows.map(row=>[String(row.id),row])),ordered=ids.map(id=>byId.get(id)),requestBody=JSON.stringify({version:1,tenant_id:String(tenant.tenant_id),manual_transfer:true,opportunities:ordered.map(row=>launchpadCrmOpportunityPayload(row,tenant.tenant_id))});
    let accepted=null;
    for(const token of tokenRows){
      const attempt=await postSigned(requestBody,token.token_hash);
      if(attempt.response.ok){accepted=attempt.data;break}
      if(attempt.response.status!==401)throw attempt.error;
    }
    if(!accepted)return res.status(409).json({error:'The CRM connection token does not match this workspace. Reconnect the CRM account bridge, then retry.'});
    for(const result of accepted.results||[]){
      const opportunityId=clean(result.source_opportunity_id,100),success=result.status==='SUCCESS';
      if(!opportunityId||!ids.includes(opportunityId))continue;
      await sql`insert into crm_sync_mappings(manufacturer_id,provider,opportunity_id,external_deal_id,last_synced_at,last_status,last_error) values(${tenant.tenant_id},'launchpad36_crm',${opportunityId},${success?String(result.crm_opportunity_id||''):''},now(),${success?'SUCCESS':'FAILED'},${success?'':clean(result.error,1000)}) on conflict(manufacturer_id,provider,opportunity_id) do update set external_deal_id=case when excluded.external_deal_id<>'' then excluded.external_deal_id else crm_sync_mappings.external_deal_id end,last_synced_at=now(),last_status=excluded.last_status,last_error=excluded.last_error`;
    }
    return res.status(200).json({...accepted,manual_transfer:true,standard_sync:false,crm_url:'https://crm.launchpad36.com'});
  }catch(error){
    console.error('manual CRM opportunity transfer failed',{message:error?.message||String(error),opportunity_count:ids.length});
    const status=Number(error?.status);return res.status(status>=400&&status<500?status:502).json({error:clean(error?.message||'Launchpad36 CRM transfer failed',500)});
  }
}
