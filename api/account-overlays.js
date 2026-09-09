import { db } from './_db.js';
import { resolveTenant, canSeeAllTenantData } from './_tenant.js';
import { ensureIdentitySchema } from './_identity.js';

const clean=(v,m=3000)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,m);
const allowedVisibility=new Set(['private','team','tenant']);
function canEditOverlay(row,tenant){return canSeeAllTenantData(tenant)||String(row.owner_user_id||'')===String(tenant.user_id||'')||(row.visibility==='team'&&(tenant.team_ids||[]).includes(String(row.team_id||'')))}
function scopeFor(input,tenant){if(canSeeAllTenantData(tenant)){const visibility=allowedVisibility.has(String(input.visibility||'').toLowerCase())?String(input.visibility).toLowerCase():'tenant';const teamId=visibility==='team'?clean(input.team_id,80)||null:null;return {visibility,team_id:teamId,owner_user_id:visibility==='private'?tenant.user_id:null}}const requestedTeam=clean(input.team_id,80)||null;if(requestedTeam){if(!(tenant.team_ids||[]).includes(requestedTeam))throw Object.assign(new Error('You are not a member of that team'),{status:403});return {visibility:'team',team_id:requestedTeam,owner_user_id:null}}return {visibility:'private',team_id:null,owner_user_id:tenant.user_id}}

export default async function handler(req,res){
 const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
 try{
  await ensureIdentitySchema(sql);
  const organizationId=clean(req.query?.organization_id||req.body?.organization_id,80);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
  const org=(await sql`select id,name from retail_organizations where id=${organizationId} and active=true limit 1`)[0];if(!org)return res.status(404).json({error:'Account was not found'});
  const admin=canSeeAllTenantData(tenant),teamIds=tenant.team_ids||[];
  if(req.method==='GET'){
   const rows=admin?await sql`select * from tenant_account_overlays where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} order by updated_at desc`:await sql`select * from tenant_account_overlays where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} and (visibility='tenant' or owner_user_id=${tenant.user_id} or (visibility='team' and team_id=any(${teamIds}::uuid[]))) order by updated_at desc`;
   return res.status(200).json({account:org,overlays:rows,scope:{role:tenant.role,user_id:tenant.user_id,team_ids:teamIds}});
  }
  if(!['POST','PATCH'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const id=clean(req.body?.id,80)||null,scope=scopeFor(req.body||{},tenant),relationship=clean(req.body?.relationship_status,120),accountOwner=clean(req.body?.account_owner,180),notes=clean(req.body?.notes,8000),strategy=req.body?.strategy&&typeof req.body.strategy==='object'&&!Array.isArray(req.body.strategy)?req.body.strategy:{};
  if(id){const existing=(await sql`select * from tenant_account_overlays where id=${id} and manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} limit 1`)[0];if(!existing)return res.status(404).json({error:'Account overlay not found'});if(!canEditOverlay(existing,tenant))return res.status(403).json({error:'You do not have permission to edit this account plan'});const updated=(await sql`update tenant_account_overlays set owner_user_id=${scope.owner_user_id},team_id=${scope.team_id},visibility=${scope.visibility},relationship_status=${relationship},account_owner=${accountOwner},notes=${notes},strategy=${sql.json(strategy)},updated_at=now() where id=${id} returning *`)[0];return res.status(200).json({overlay:updated})}
  const created=(await sql`insert into tenant_account_overlays(manufacturer_id,organization_id,owner_user_id,team_id,visibility,relationship_status,account_owner,notes,strategy,updated_at) values(${tenant.tenant_id},${organizationId},${scope.owner_user_id},${scope.team_id},${scope.visibility},${relationship},${accountOwner},${notes},${sql.json(strategy)},now()) returning *`)[0];return res.status(201).json({overlay:created});
 }catch(e){console.error('account overlay failed',{message:e?.message||String(e)});return res.status(e.status||500).json({error:e.message||'Account overlay operation failed'})}
}
