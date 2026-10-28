import { db } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { CAPABILITIES,requireCapability } from './_permissions.js';
import { feedbackRecommendations } from './_retail-context.js';
import { ensureRetailContextSchema } from './db-init-retail-context.js';

const clean=(value,max=800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const list=value=>Array.isArray(value)?value.map(item=>clean(item,180)).filter(Boolean).slice(0,50):[];
const dateTime=value=>{const t=Date.parse(String(value||''));return Number.isFinite(t)?new Date(t).toISOString():new Date().toISOString()};
const dateOnly=value=>{const text=clean(value,20);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:null};

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const capability=req.method==='GET'?CAPABILITIES.APP_READ:CAPABILITIES.APP_WRITE;
  if(!requireCapability(tenant,res,capability))return;
  const sql=db();await ensureRetailContextSchema(sql);
  try{
    if(req.method==='GET'){
      const organizationId=clean(req.query?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
      const rows=await sql`select f.*,b.name buyer_name,b.title buyer_title from buyer_meeting_feedback f left join buyers b on b.id=f.buyer_id where f.manufacturer_id=${tenant.tenant_id} and f.organization_id=${organizationId} order by f.meeting_at desc limit 100`;
      return res.status(200).json({feedback:rows,read_only:true});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const organizationId=clean(req.body?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
    const organization=(await sql`select id,name from retail_organizations where id=${organizationId} and active=true limit 1`)[0];
    if(!organization)return res.status(404).json({error:'Account was not found'});
    const account=(await sql`select id from accounts where organization_id=${organizationId} order by updated_at desc limit 1`)[0]||null;
    let workspace=null;const opportunityId=clean(req.body?.opportunity_id,100);
    if(opportunityId){
      const admin=canSeeAllTenantData(tenant),teamIds=tenant.team_ids||[];
      workspace=(await sql`select id from opportunity_workspaces where id=${opportunityId} and manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} and (${admin} or owner_user_id=${tenant.user_id} or (visibility='team' and team_id=any(${teamIds}::uuid[])) or (visibility='tenant' and owner_user_id is null and team_id is null)) limit 1`)[0];
      if(!workspace)return res.status(404).json({error:'Opportunity was not found in your private or team scope'});
    }
    const buyerId=clean(req.body?.buyer_id,100)||null;
    if(buyerId){
      const buyer=(await sql`select b.id from buyers b join accounts a on a.id=b.account_id where b.id=${buyerId} and a.organization_id=${organizationId} limit 1`)[0];
      if(!buyer)return res.status(400).json({error:'Buyer is not associated with this account'});
    }
    const input={
      meeting_at:dateTime(req.body?.meeting_at),
      meeting_type:clean(req.body?.meeting_type||'buyer_meeting',80),
      notes:clean(req.body?.notes,4000),
      buyer_feedback:clean(req.body?.buyer_feedback,4000),
      objections:list(req.body?.objections),
      accepted_skus:list(req.body?.accepted_skus),
      rejected_skus:list(req.body?.rejected_skus),
      requested_changes:list(req.body?.requested_changes),
      rollout_scope:clean(req.body?.rollout_scope,100),
      follow_up_date:dateOnly(req.body?.follow_up_date),
      next_action:clean(req.body?.next_action,600)
    };
    if(!input.notes&&!input.buyer_feedback&&!input.next_action&&!input.objections.length&&!input.accepted_skus.length&&!input.rejected_skus.length&&!input.requested_changes.length)return res.status(400).json({error:'Record at least one meeting note, buyer feedback item, SKU decision, objection, requested change, or next action'});
    const row=(await sql`insert into buyer_meeting_feedback(manufacturer_id,organization_id,account_id,opportunity_id,buyer_id,meeting_at,meeting_type,notes,buyer_feedback,objections,accepted_skus,rejected_skus,requested_changes,rollout_scope,follow_up_date,next_action,created_by) values(${tenant.tenant_id},${organizationId},${account?.id||null},${workspace?.id||null},${buyerId},${input.meeting_at},${input.meeting_type},${input.notes},${input.buyer_feedback},${sql.json(input.objections)},${sql.json(input.accepted_skus)},${sql.json(input.rejected_skus)},${sql.json(input.requested_changes)},${input.rollout_scope},${input.follow_up_date},${input.next_action},${tenant.user_id}) returning *`)[0];
    const recommendations=feedbackRecommendations(input);
    await sql`insert into retail_context_events(manufacturer_id,organization_id,account_id,opportunity_id,buyer_id,event_type,source_type,payload,happened_at,created_by) values(${tenant.tenant_id},${organizationId},${account?.id||null},${workspace?.id||null},${buyerId},'BUYER_MEETING_FEEDBACK','user',${sql.json({feedback_id:row.id,meeting_type:input.meeting_type,buyer_feedback:input.buyer_feedback,objections:input.objections,accepted_skus:input.accepted_skus,rejected_skus:input.rejected_skus,requested_changes:input.requested_changes,rollout_scope:input.rollout_scope,next_action:input.next_action,recommendations})},${input.meeting_at},${tenant.user_id})`;
    return res.status(201).json({feedback:row,recommendations,human_approval_required:true,automatic_external_actions:false});
  }catch(error){
    console.error('buyer meeting feedback failed',{message:error?.message||String(error)});
    return res.status(error?.status||500).json({error:error?.status?error.message:'Buyer meeting feedback could not be saved'});
  }
}
