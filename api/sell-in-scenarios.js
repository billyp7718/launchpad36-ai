import { db } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { buildSellInScenario } from './_sell-in-scenario.js';

const clean=(value,max=180)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const canAccess=(row,tenant)=>canSeeAllTenantData(tenant)||String(row.owner_user_id||'')===String(tenant.user_id||'')||(row.visibility==='team'&&(tenant.team_ids||[]).includes(String(row.team_id||'')))||(row.visibility==='tenant'&&!row.owner_user_id&&!row.team_id);

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db(),workspaceId=clean(req.query?.workspace_id||req.body?.workspace_id,100);if(!workspaceId)return res.status(400).json({error:'workspace_id is required'});
  try{
    const workspace=(await sql`select * from opportunity_workspaces where id=${workspaceId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];
    if(!workspace||!canAccess(workspace,tenant))return res.status(404).json({error:'Opportunity was not found in your private or team scope'});
    if(req.method==='GET'){
      const rows=(await sql`select * from sell_in_scenarios where manufacturer_id=${tenant.tenant_id} and opportunity_workspace_id=${workspaceId} order by updated_at desc limit 100`).filter(row=>canAccess(row,tenant));
      return res.status(200).json({scenarios:rows,workspace_id:workspaceId});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const assortment=Array.isArray(workspace.scenario?.proposed_assortment)?workspace.scenario.proposed_assortment:Array.isArray(workspace.scenario?.account?.product_contributions)?workspace.scenario.account.product_contributions:[],snapshot=buildSellInScenario({input:req.body?.scenario||req.body,assortment,accountFootprint:workspace.scenario?.volume_model?.store_count||workspace.scenario?.account?.footprint||1}),id=clean(req.body?.id,100);
    let row;
    if(id){
      const existing=(await sql`select * from sell_in_scenarios where id=${id} and manufacturer_id=${tenant.tenant_id} and opportunity_workspace_id=${workspaceId} limit 1`)[0];if(!existing||!canAccess(existing,tenant))return res.status(404).json({error:'Sell-in scenario was not found in your private or team scope'});
      row=(await sql`update sell_in_scenarios set name=${snapshot.name},scenario_type=${snapshot.scenario_type},deployment_type=${snapshot.deployment_type},selected_skus=${sql.json(snapshot.selected_skus)},assumptions=${sql.json(snapshot.assumptions)},calculated_snapshot=${sql.json(snapshot)},confidence=${snapshot.confidence},notes=${snapshot.notes},launch_date=${snapshot.assumptions.launch_date||null},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} returning *`)[0];
    }else row=(await sql`insert into sell_in_scenarios(manufacturer_id,opportunity_workspace_id,organization_id,name,scenario_type,deployment_type,selected_skus,assumptions,calculated_snapshot,confidence,notes,launch_date,owner_user_id,team_id,visibility) values(${tenant.tenant_id},${workspace.id},${workspace.organization_id},${snapshot.name},${snapshot.scenario_type},${snapshot.deployment_type},${sql.json(snapshot.selected_skus)},${sql.json(snapshot.assumptions)},${sql.json(snapshot)},${snapshot.confidence},${snapshot.notes},${snapshot.assumptions.launch_date||null},${workspace.owner_user_id||tenant.user_id},${workspace.team_id||null},${workspace.visibility||'private'}) returning *`)[0];
    return res.status(id?200:201).json({scenario:row,calculation:snapshot.calculation,warnings:snapshot.warnings});
  }catch(error){console.error('sell-in scenario operation failed',{message:error?.message||String(error)});if(error?.code==='42P01')return res.status(409).json({error:'Sell-in scenario storage is not initialized. Run the additive V9.8 database update.',code:'SCHEMA_REQUIRED'});if(error?.code==='23505')return res.status(409).json({error:'A scenario with this name already exists for the opportunity'});return res.status(error?.status||500).json({error:error?.status?error.message:'Sell-in scenario operation could not be completed'});}
}
