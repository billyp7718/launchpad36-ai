import { db } from './_db.js';
import { requireAdmin, sessionData } from './_auth.js';
import { resolveTenant } from './_tenant.js';
import { ensureIdentitySchema, hashPassword, normalizeRole } from './_identity.js';

const clean=(v,m=240)=>String(v||'').trim().slice(0,m);
function actorRole(req){return normalizeRole(sessionData(req)?.role||'admin')}
function canGrant(actor,target){if(actor==='owner')return true;if(actor==='admin')return target!=='owner';return false}
async function log(sql,tenant,userId,action,subjectType,subjectId,metadata={}){await sql`insert into tenant_activity_log(manufacturer_id,user_id,action,subject_type,subject_id,metadata) values(${tenant.tenant_id},${userId||null},${action},${subjectType},${String(subjectId||'')},${sql.json(metadata)})`}
export default async function handler(req,res){
 if(!requireAdmin(req,res))return;
 const tenant=await resolveTenant(req,res);if(!tenant)return;
 const sql=db(),actor=actorRole(req),actorId=sessionData(req)?.user_id||null;
 try{
  await ensureIdentitySchema(sql);
  if(req.method==='GET'){
   const [members,teams,memberships]=await Promise.all([
    sql`select id,email,display_name,role,active,default_team_id,last_login_at,created_at from manufacturer_members where manufacturer_id=${tenant.tenant_id} order by active desc,display_name,email`,
    sql`select * from manufacturer_teams where manufacturer_id=${tenant.tenant_id} order by active desc,name`,
    sql`select mtm.team_id,mtm.member_id,mtm.role from manufacturer_team_members mtm join manufacturer_teams t on t.id=mtm.team_id where t.manufacturer_id=${tenant.tenant_id}`
   ]);
   return res.status(200).json({members,teams,memberships,permissions:{actor_role:actor,can_manage_owner:actor==='owner'}});
  }
  if(req.method==='POST'){
   const action=clean(req.body?.action,40);
   if(action==='create_team'){
    const name=clean(req.body?.name,160);if(!name)return res.status(400).json({error:'Team name is required'});
    const row=(await sql`insert into manufacturer_teams(manufacturer_id,name,description) values(${tenant.tenant_id},${name},${clean(req.body?.description,500)}) on conflict(manufacturer_id,lower(name)) do update set active=true,description=excluded.description,updated_at=now() returning *`)[0];
    await log(sql,tenant,actorId,'TEAM_CREATED','team',row.id,{name:row.name});return res.status(201).json({team:row});
   }
   if(action==='create_user'){
    const email=clean(req.body?.email,240).toLowerCase(),displayName=clean(req.body?.display_name,180),role=normalizeRole(req.body?.role),password=String(req.body?.password||''),teamId=clean(req.body?.team_id,80)||null;
    if(!email||!email.includes('@'))return res.status(400).json({error:'Valid email is required'});if(!canGrant(actor,role))return res.status(403).json({error:'You cannot grant that role'});
    const hash=hashPassword(password);if(teamId){const t=(await sql`select id from manufacturer_teams where id=${teamId} and manufacturer_id=${tenant.tenant_id} and active=true limit 1`)[0];if(!t)return res.status(400).json({error:'Team is not part of this workspace'})}
    const member=(await sql`insert into manufacturer_members(manufacturer_id,email,display_name,role,active,password_hash,default_team_id,created_by,updated_at) values(${tenant.tenant_id},${email},${displayName},${role},true,${hash},${teamId},${actorId},now()) on conflict(manufacturer_id,lower(email)) do update set display_name=excluded.display_name,role=excluded.role,active=true,password_hash=excluded.password_hash,default_team_id=excluded.default_team_id,updated_at=now() returning *`)[0];
    if(teamId)await sql`insert into manufacturer_team_members(team_id,member_id,role) values(${teamId},${member.id},'member') on conflict(team_id,member_id) do update set role=excluded.role`;
    await log(sql,tenant,actorId,'USER_CREATED','user',member.id,{email:member.email,role:member.role,team_id:teamId});return res.status(201).json({member:{id:member.id,email:member.email,display_name:member.display_name,role:member.role,default_team_id:member.default_team_id}});
   }
   if(action==='reset_password'){
    const memberId=clean(req.body?.member_id,80),password=String(req.body?.password||'');
    const target=(await sql`select id,email,role from manufacturer_members where id=${memberId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!target)return res.status(404).json({error:'User not found'});if(target.role==='owner'&&actor!=='owner')return res.status(403).json({error:'Only an owner can reset an owner password'});
    const hash=hashPassword(password);await sql`update manufacturer_members set password_hash=${hash},active=true,updated_at=now() where id=${memberId}`;await log(sql,tenant,actorId,'USER_PASSWORD_RESET','user',memberId,{email:target.email});return res.status(200).json({reset:true,member_id:memberId});
   }
   if(action==='set_role'){
    const memberId=clean(req.body?.member_id,80),role=normalizeRole(req.body?.role);if(!canGrant(actor,role))return res.status(403).json({error:'You cannot grant that role'});const target=(await sql`select id,role from manufacturer_members where id=${memberId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!target)return res.status(404).json({error:'User not found'});if(target.role==='owner'&&actor!=='owner')return res.status(403).json({error:'Only an owner can change another owner'});if(actorId&&String(actorId)===memberId&&role!=='owner'&&actor==='owner')return res.status(400).json({error:'Transfer ownership before reducing your own owner role'});const row=(await sql`update manufacturer_members set role=${role},updated_at=now() where id=${memberId} returning id,email,display_name,role`)[0];await log(sql,tenant,actorId,'USER_ROLE_CHANGED','user',memberId,{from:target.role,to:role});return res.status(200).json({member:row});
   }
   if(action==='assign_team'){
    const memberId=clean(req.body?.member_id,80),teamId=clean(req.body?.team_id,80),teamRole=normalizeRole(req.body?.team_role||'member');
    const ok=(await sql`select mm.id from manufacturer_members mm join manufacturer_teams t on t.manufacturer_id=mm.manufacturer_id where mm.id=${memberId} and t.id=${teamId} and mm.manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!ok)return res.status(404).json({error:'User/team not found in workspace'});
    await sql`insert into manufacturer_team_members(team_id,member_id,role) values(${teamId},${memberId},${teamRole}) on conflict(team_id,member_id) do update set role=excluded.role`;await sql`update manufacturer_members set default_team_id=coalesce(default_team_id,${teamId}),updated_at=now() where id=${memberId}`;await log(sql,tenant,actorId,'TEAM_ASSIGNED','user',memberId,{team_id:teamId});return res.status(200).json({assigned:true});
   }
   if(action==='set_active'){
    const memberId=clean(req.body?.member_id,80),active=req.body?.active===true;const current=sessionData(req)?.user_id;if(current&&String(current)===memberId&&!active)return res.status(400).json({error:'You cannot deactivate your own account'});const target=(await sql`select id,role from manufacturer_members where id=${memberId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!target)return res.status(404).json({error:'User not found'});if(target.role==='owner'&&actor!=='owner')return res.status(403).json({error:'Only an owner can deactivate an owner'});const row=(await sql`update manufacturer_members set active=${active},updated_at=now() where id=${memberId} returning id,active`)[0];await log(sql,tenant,actorId,active?'USER_ACTIVATED':'USER_DEACTIVATED','user',memberId,{});return res.status(200).json({member:row});
   }
   return res.status(400).json({error:'Unsupported action'});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error('team admin failed',{message:e?.message||String(e)});return res.status(e.status||500).json({error:e.message||'Team administration failed'})}
}
