import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { ensureIdentitySchema, hashPassword, isPermanentAdminEmail, normalizeRole } from './_identity.js';
import { CAPABILITIES, ROLES, canonicalRole, hasCapability, managerMayGrant, permissionSummary, requireCapability, teamScopeIncludes } from './_permissions.js';

const clean=(v,m=240)=>String(v||'').trim().slice(0,m);
async function log(sql,tenant,userId,action,subjectType,subjectId,metadata={}){await sql`insert into tenant_activity_log(manufacturer_id,user_id,action,subject_type,subject_id,metadata) values(${tenant.tenant_id},${userId||null},${action},${subjectType},${String(subjectId||'')},${sql.json(metadata)})`}
async function targetTeamIds(sql,tenantId,memberId){return (await sql`select tm.team_id from manufacturer_team_members tm join manufacturer_teams t on t.id=tm.team_id join manufacturer_members m on m.id=tm.member_id where tm.member_id=${memberId} and t.manufacturer_id=${tenantId} and m.manufacturer_id=${tenantId} and t.active=true`).map(row=>String(row.team_id))}
async function managerTarget(sql,tenant,memberId){if(!memberId||String(memberId)===String(tenant.user_id))return null;const target=(await sql`select id,email,role,active from manufacturer_members where id=${memberId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!target||canonicalRole(target.role)===ROLES.ADMIN)return null;return teamScopeIncludes(tenant.team_ids,await targetTeamIds(sql,tenant.tenant_id,memberId))?target:null}
function teamAllowed(tenant,teamId){return hasCapability(tenant,CAPABILITIES.USER_ADMIN_TENANT)||(hasCapability(tenant,CAPABILITIES.USER_ADMIN_TEAM)&&(tenant.team_ids||[]).includes(String(teamId)))}
function grantAllowed(tenant,role){return hasCapability(tenant,CAPABILITIES.USER_ADMIN_TENANT)||managerMayGrant(role)}

export default async function handler(req,res){
 const tenant=await resolveTenant(req,res);if(!tenant)return;
 if(!hasCapability(tenant,CAPABILITIES.USER_ADMIN_TENANT)&&!hasCapability(tenant,CAPABILITIES.USER_ADMIN_TEAM))return requireCapability(tenant,res,CAPABILITIES.USER_ADMIN_TEAM);
 const sql=db(),actorId=tenant.user_id||null,isTenantAdmin=hasCapability(tenant,CAPABILITIES.USER_ADMIN_TENANT);
 try{
  await ensureIdentitySchema(sql);
  if(req.method==='GET'){
   const [members,teams,memberships]=isTenantAdmin?await Promise.all([
    sql`select id,email,display_name,role,active,default_team_id,last_login_at,created_at from manufacturer_members where manufacturer_id=${tenant.tenant_id} order by active desc,display_name,email`,
    sql`select * from manufacturer_teams where manufacturer_id=${tenant.tenant_id} order by active desc,name`,
    sql`select mtm.team_id,mtm.member_id,mtm.role from manufacturer_team_members mtm join manufacturer_teams t on t.id=mtm.team_id where t.manufacturer_id=${tenant.tenant_id}`
   ]):await Promise.all([
    sql`select distinct mm.id,mm.email,mm.display_name,mm.role,mm.active,mm.default_team_id,mm.last_login_at,mm.created_at from manufacturer_members mm join manufacturer_team_members mtm on mtm.member_id=mm.id where mm.manufacturer_id=${tenant.tenant_id} and mtm.team_id=any(${tenant.team_ids}::uuid[]) order by mm.active desc,mm.display_name,mm.email`,
    sql`select * from manufacturer_teams where manufacturer_id=${tenant.tenant_id} and id=any(${tenant.team_ids}::uuid[]) and active=true order by name`,
    sql`select mtm.team_id,mtm.member_id,mtm.role from manufacturer_team_members mtm join manufacturer_teams t on t.id=mtm.team_id where t.manufacturer_id=${tenant.tenant_id} and mtm.team_id=any(${tenant.team_ids}::uuid[])`
   ]);
   return res.status(200).json({members:members.map(member=>({...member,role:canonicalRole(member.role)})),teams,memberships,permissions:permissionSummary(tenant)});
  }
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const action=clean(req.body?.action,40);
  if(action==='create_team'){
   if(!requireCapability(tenant,res,CAPABILITIES.USER_ADMIN_TENANT))return;const name=clean(req.body?.name,160);if(!name)return res.status(400).json({error:'Team name is required'});
   const row=(await sql`insert into manufacturer_teams(manufacturer_id,name,description) values(${tenant.tenant_id},${name},${clean(req.body?.description,500)}) on conflict(manufacturer_id,lower(name)) do update set active=true,description=excluded.description,updated_at=now() returning *`)[0];await log(sql,tenant,actorId,'TEAM_CREATED','team',row.id,{name:row.name});return res.status(201).json({team:row});
  }
  if(action==='create_user'){
   const email=clean(req.body?.email,240).toLowerCase(),displayName=clean(req.body?.display_name,180),role=isPermanentAdminEmail(email)?ROLES.ADMIN:normalizeRole(req.body?.role),password=String(req.body?.password||''),teamId=clean(req.body?.team_id,80)||null;
   if(!email||!email.includes('@'))return res.status(400).json({error:'Valid email is required'});if(!teamId&&!isTenantAdmin)return res.status(403).json({error:'Managers must create users inside one of their teams'});if(teamId&&!teamAllowed(tenant,teamId))return res.status(403).json({error:'You cannot administer that team'});if(!grantAllowed(tenant,role))return res.status(403).json({error:'You cannot grant that role'});
   if(teamId){const team=(await sql`select id from manufacturer_teams where id=${teamId} and manufacturer_id=${tenant.tenant_id} and active=true limit 1`)[0];if(!team)return res.status(400).json({error:'Team is not part of this workspace'})}
   const existing=(await sql`select id,role from manufacturer_members where manufacturer_id=${tenant.tenant_id} and lower(email)=${email} limit 1`)[0];if(existing&&!isTenantAdmin&&!await managerTarget(sql,tenant,existing.id))return res.status(403).json({error:'You cannot update a user outside your teams'});
   const member=(await sql`insert into manufacturer_members(manufacturer_id,email,display_name,role,active,password_hash,default_team_id,created_by,updated_at) values(${tenant.tenant_id},${email},${displayName},${role},true,${hashPassword(password)},${teamId},${actorId},now()) on conflict(manufacturer_id,lower(email)) do update set display_name=excluded.display_name,role=excluded.role,active=true,password_hash=excluded.password_hash,default_team_id=coalesce(excluded.default_team_id,manufacturer_members.default_team_id),updated_at=now() returning *`)[0];
   if(teamId)await sql`insert into manufacturer_team_members(team_id,member_id,role) values(${teamId},${member.id},'member') on conflict(team_id,member_id) do update set role=excluded.role`;await log(sql,tenant,actorId,'USER_CREATED','user',member.id,{email:member.email,role:canonicalRole(member.role),team_id:teamId});return res.status(201).json({member:{id:member.id,email:member.email,display_name:member.display_name,role:canonicalRole(member.role),default_team_id:member.default_team_id}});
  }
  const memberId=clean(req.body?.member_id,80),target=isTenantAdmin?(await sql`select id,email,role,active from manufacturer_members where id=${memberId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0]:await managerTarget(sql,tenant,memberId);
  if(!target)return res.status(403).json({error:'You cannot administer this user'});
  if(action==='reset_password'){const hash=hashPassword(String(req.body?.password||''));await sql`update manufacturer_members set password_hash=${hash},active=true,updated_at=now() where id=${memberId}`;await log(sql,tenant,actorId,'USER_PASSWORD_RESET','user',memberId,{email:target.email});return res.status(200).json({reset:true,member_id:memberId})}
  if(action==='set_role'){const role=normalizeRole(req.body?.role);if(isPermanentAdminEmail(target.email)&&role!==ROLES.ADMIN)return res.status(400).json({error:'This account is a permanent workspace administrator'});if(!grantAllowed(tenant,role))return res.status(403).json({error:'You cannot grant that role'});if(!isTenantAdmin&&String(actorId)===memberId)return res.status(403).json({error:'Managers cannot promote themselves'});const row=(await sql`update manufacturer_members set role=${role},updated_at=now() where id=${memberId} returning id,email,display_name,role`)[0];await log(sql,tenant,actorId,'USER_ROLE_CHANGED','user',memberId,{from:canonicalRole(target.role),to:canonicalRole(role)});return res.status(200).json({member:{...row,role:canonicalRole(row.role)}})}
  if(action==='assign_team'){const teamId=clean(req.body?.team_id,80);if(!teamAllowed(tenant,teamId))return res.status(403).json({error:'You cannot administer that team'});await sql`insert into manufacturer_team_members(team_id,member_id,role) values(${teamId},${memberId},'member') on conflict(team_id,member_id) do update set role='member'`;await sql`update manufacturer_members set default_team_id=coalesce(default_team_id,${teamId}),updated_at=now() where id=${memberId}`;await log(sql,tenant,actorId,'TEAM_ASSIGNED','user',memberId,{team_id:teamId});return res.status(200).json({assigned:true})}
  if(action==='set_active'){const active=req.body?.active===true;if(String(actorId)===memberId&&!active)return res.status(400).json({error:'You cannot deactivate your own account'});const row=(await sql`update manufacturer_members set active=${active},updated_at=now() where id=${memberId} returning id,active`)[0];await log(sql,tenant,actorId,active?'USER_ACTIVATED':'USER_DEACTIVATED','user',memberId,{});return res.status(200).json({member:row})}
  return res.status(400).json({error:'Unsupported action'});
 }catch(error){console.error('team admin failed',{message:error?.message||String(error)});return res.status(error.status||500).json({error:error.message||'Team administration failed'})}
}
