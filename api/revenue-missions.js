import { db } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { PIPELINE_STAGES,normalizePipelineStage,refreshRevenueMission } from './_revenue-missions.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const STATUSES=new Set(['ACTIVE','AT_RISK','ACHIEVED','PAUSED','ARCHIVED']);
const PRIORITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const VISIBILITIES=new Set(['private','team','tenant']);
const canAccess=(row,tenant)=>canSeeAllTenantData(tenant)||String(row.owner_user_id||'')===String(tenant.user_id||'')||(row.visibility==='team'&&(tenant.team_ids||[]).includes(String(row.team_id||'')))||(row.visibility==='tenant'&&!row.owner_user_id&&!row.team_id);
const dateOnly=value=>{const text=String(value||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(`${text}T00:00:00Z`)))throw Object.assign(new Error('Choose a valid mission target date'),{status:400});return text};
const positiveMoney=value=>{const amount=Math.round(Number(value)*100)/100;if(!Number.isFinite(amount)||amount<=0||amount>1000000000000)throw Object.assign(new Error('Target revenue must be greater than zero'),{status:400});return amount};

async function missionById(sql,tenant,id){const row=(await sql`select * from revenue_missions where id=${id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];return row&&canAccess(row,tenant)?row:null}

async function validateProducts(sql,tenant,productIds){
  const ids=[...new Set((Array.isArray(productIds)?productIds:[]).map(String).filter(Boolean))];if(ids.length>100)throw Object.assign(new Error('A mission can include no more than 100 products'),{status:400});if(!ids.length)return [];
  const rows=await sql`select id,owner_user_id,team_id,visibility from products where manufacturer_id=${tenant.tenant_id} and active=true and id=any(${ids}::uuid[])`;
  if(rows.length!==ids.length||rows.some(row=>!canAccess(row,tenant)))throw Object.assign(new Error('One or more mission products are outside your private or team scope'),{status:404});return ids;
}

async function validateBrand(sql,tenant,brandId){
  const id=String(brandId||'').trim();if(!id)return null;
  const row=(await sql`select id,owner_user_id,team_id,visibility from brands where id=${id} and manufacturer_id=${tenant.tenant_id} and active=true limit 1`)[0];
  if(!row||!canAccess(row,tenant))throw Object.assign(new Error('Mission brand is outside your private or team scope'),{status:404});return id;
}

async function validateOpportunities(sql,tenant,opportunityIds){
  const ids=[...new Set((Array.isArray(opportunityIds)?opportunityIds:[]).map(String).filter(Boolean))];if(ids.length>500)throw Object.assign(new Error('A mission can link no more than 500 opportunities at once'),{status:400});if(!ids.length)return [];
  const rows=await sql`select id,owner_user_id,team_id,visibility from opportunity_workspaces where manufacturer_id=${tenant.tenant_id} and id=any(${ids}::uuid[])`;
  if(rows.length!==ids.length||rows.some(row=>!canAccess(row,tenant)))throw Object.assign(new Error('One or more opportunities are outside your private or team scope'),{status:404});return ids;
}

async function linkOpportunities(sql,tenant,missionId,opportunityIds){
  const ids=await validateOpportunities(sql,tenant,opportunityIds);for(const id of ids)await sql`insert into revenue_mission_opportunities(mission_id,opportunity_id,linked_by) values(${missionId},${id},${tenant.user_id}) on conflict(mission_id,opportunity_id) do nothing`;return ids;
}

async function missionResponse(sql,tenant,missionId){
  const mission=await refreshRevenueMission(sql,{manufacturerId:tenant.tenant_id,missionId,actorUserId:tenant.user_id});if(!mission)return null;
  const events=await sql`select id,event_type,previous_value,new_value,summary,created_at from revenue_mission_events where mission_id=${missionId} and manufacturer_id=${tenant.tenant_id} order by created_at desc limit 100`;
  return {...mission,events,pipeline_stages:PIPELINE_STAGES};
}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
  try{
    if(req.method==='GET'){
      const requestedId=clean(req.query?.id,100),rows=await sql`select * from revenue_missions where manufacturer_id=${tenant.tenant_id} and (${canSeeAllTenantData(tenant)} or owner_user_id=${tenant.user_id} or (visibility='team' and team_id=any(${tenant.team_ids||[]}::uuid[])) or (visibility='tenant' and owner_user_id is null and team_id is null)) and (${requestedId||null}::text is null or id::text=${requestedId||null}) order by case status when 'ACTIVE' then 1 when 'AT_RISK' then 2 when 'PAUSED' then 3 when 'ACHIEVED' then 4 else 5 end,target_date,updated_at desc limit 200`;
      const missions=[];for(const row of rows){const mission=await missionResponse(sql,tenant,row.id);if(mission)missions.push(mission)}return res.status(200).json({missions,pipeline_stages:PIPELINE_STAGES});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const action=clean(req.body?.action||'create',50).toLowerCase();
    if(action==='create'){
      const name=clean(req.body?.name,180);if(!name)return res.status(400).json({error:'Mission name is required'});
      const targetRevenue=positiveMoney(req.body?.target_revenue),targetDate=dateOnly(req.body?.target_date),priority=clean(req.body?.priority||'HIGH',20).toUpperCase();if(!PRIORITIES.has(priority))return res.status(400).json({error:'Unsupported mission priority'});
      const productIds=await validateProducts(sql,tenant,req.body?.product_ids),brandId=await validateBrand(sql,tenant,req.body?.brand_id),opportunityIds=await validateOpportunities(sql,tenant,req.body?.opportunity_ids||[]),visibility=VISIBILITIES.has(req.body?.visibility)?req.body.visibility:'private';let teamId=null,ownerUserId=tenant.user_id;
      if(visibility==='team'){teamId=String(req.body?.team_id||'');if(!teamId||(tenant.team_ids||[]).includes(teamId)===false)return res.status(403).json({error:'Choose a team within your authenticated team scope'});}
      if(visibility==='tenant'){if(!canSeeAllTenantData(tenant))return res.status(403).json({error:'Only an Administrator can create a tenant-wide mission'});ownerUserId=null;}
      let row;await sql.begin(async tx=>{row=(await tx`insert into revenue_missions(manufacturer_id,brand_id,name,target_revenue,target_date,product_ids,status,priority,remaining_gap,owner_user_id,team_id,visibility,created_by) values(${tenant.tenant_id},${brandId},${name},${targetRevenue},${targetDate},${tx.json(productIds)},'ACTIVE',${priority},${targetRevenue},${ownerUserId},${teamId},${visibility},${tenant.user_id}) returning *`)[0];for(const opportunityId of opportunityIds)await tx`insert into revenue_mission_opportunities(mission_id,opportunity_id,linked_by) values(${row.id},${opportunityId},${tenant.user_id}) on conflict(mission_id,opportunity_id) do nothing`;await tx`insert into revenue_mission_events(mission_id,manufacturer_id,actor_user_id,event_type,new_value,summary) values(${row.id},${tenant.tenant_id},${tenant.user_id},'CREATED',${tx.json({name,target_revenue:targetRevenue,target_date:targetDate,product_ids:productIds,opportunity_ids:opportunityIds})},${`Created revenue mission ${name}`})`});
      return res.status(201).json({mission:await missionResponse(sql,tenant,row.id)});
    }
    const id=clean(req.body?.id,100);if(!id)return res.status(400).json({error:'Mission id is required'});const existing=await missionById(sql,tenant,id);if(!existing)return res.status(404).json({error:'Revenue mission was not found in your private or team scope'});
    if(action==='link_opportunities'){
      const linked=await linkOpportunities(sql,tenant,id,req.body?.opportunity_ids||[]);await sql`insert into revenue_mission_events(mission_id,manufacturer_id,actor_user_id,event_type,new_value,summary) values(${id},${tenant.tenant_id},${tenant.user_id},'OPPORTUNITIES_LINKED',${sql.json({opportunity_ids:linked})},${`Linked ${linked.length} opportunity workspace(s)`})`;return res.status(200).json({mission:await missionResponse(sql,tenant,id)});
    }
    if(action==='set_stage'){
      const opportunityId=clean(req.body?.opportunity_id,100);if(!opportunityId)return res.status(400).json({error:'Opportunity id is required'});const stage=normalizePipelineStage(req.body?.pipeline_stage);await validateOpportunities(sql,tenant,[opportunityId]);const link=(await sql`select pipeline_stage from revenue_mission_opportunities where mission_id=${id} and opportunity_id=${opportunityId} limit 1`)[0];if(!link)return res.status(404).json({error:'The opportunity is not linked to this mission'});await sql`update revenue_mission_opportunities set pipeline_stage=${stage},stage_updated_at=now() where mission_id=${id} and opportunity_id=${opportunityId}`;await sql`insert into revenue_mission_events(mission_id,manufacturer_id,actor_user_id,event_type,previous_value,new_value,summary) values(${id},${tenant.tenant_id},${tenant.user_id},'PIPELINE_STAGE_CHANGED',${sql.json({opportunity_id:opportunityId,pipeline_stage:link.pipeline_stage})},${sql.json({opportunity_id:opportunityId,pipeline_stage:stage})},${`Changed mission opportunity stage to ${stage}`})`;return res.status(200).json({mission:await missionResponse(sql,tenant,id)});
    }
    if(action==='recalculate')return res.status(200).json({mission:await missionResponse(sql,tenant,id)});
    if(action==='update'){
      const name=req.body?.name===undefined?existing.name:clean(req.body.name,180),targetRevenue=req.body?.target_revenue===undefined?Number(existing.target_revenue):positiveMoney(req.body.target_revenue),targetDate=req.body?.target_date===undefined?String(existing.target_date).slice(0,10):dateOnly(req.body.target_date),status=clean(req.body?.status||existing.status,30).toUpperCase(),priority=clean(req.body?.priority||existing.priority,20).toUpperCase();if(!name)return res.status(400).json({error:'Mission name is required'});if(!STATUSES.has(status)||!PRIORITIES.has(priority))return res.status(400).json({error:'Unsupported mission status or priority'});
      const previous={name:existing.name,target_revenue:Number(existing.target_revenue),target_date:existing.target_date,status:existing.status,priority:existing.priority};await sql`update revenue_missions set name=${name},target_revenue=${targetRevenue},target_date=${targetDate},status=${status},priority=${priority},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id}`;await sql`insert into revenue_mission_events(mission_id,manufacturer_id,actor_user_id,event_type,previous_value,new_value,summary) values(${id},${tenant.tenant_id},${tenant.user_id},'UPDATED',${sql.json(previous)},${sql.json({name,target_revenue:targetRevenue,target_date:targetDate,status,priority})},'Updated revenue mission settings')`;return res.status(200).json({mission:await missionResponse(sql,tenant,id)});
    }
    return res.status(400).json({error:'Unsupported revenue mission action'});
  }catch(error){console.error('revenue mission failed',{message:error?.message||String(error)});if(error?.code==='42P01'||error?.code==='42703')return res.status(409).json({error:'Revenue Mission schema is not initialized. Open System Status and initialize the additive schema.',code:'SCHEMA_REQUIRED'});return res.status(error?.status||500).json({error:error?.status?error.message:'Revenue Mission could not be completed'});}
}
