import { db } from './_db.js';
import { canonicalRole } from './_permissions.js';

const text=(value,max=240)=>String(value??'').trim().slice(0,max);
const FORBIDDEN_KEY=/(password|hash|secret|token|authorization|cookie|api[_-]?key|session)/i;

export function safeAuditValue(value,depth=0){
  if(depth>3||value===undefined)return null;
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return text(value,500);
  if(Array.isArray(value))return value.slice(0,25).map(item=>safeAuditValue(item,depth+1));
  if(typeof value==='object'){
    const clean={};
    for(const [key,item] of Object.entries(value).slice(0,40))if(!FORBIDDEN_KEY.test(key))clean[text(key,80)]=safeAuditValue(item,depth+1);
    return clean;
  }
  return text(value,500);
}

export function auditRequestId(req={}){
  return text(req.headers?.['x-request-id']||req.headers?.['x-vercel-id']||req.headers?.['x-correlation-id']||'',160);
}

export async function appendPermissionAudit({sql=db(),req={},tenant,actor={},action_type,target_user={},target_team={},previous_value={},new_value={},result='SUCCESS',reason=''}){
  if(!tenant?.tenant_id)throw new Error('Permission audit tenant is required');
  const actorId=actor.id||tenant.user_id||null,actorName=text(actor.display_name||actor.email||tenant.display_name||'',180),actorRole=canonicalRole(actor.role||tenant.role);
  const targetUserId=target_user.id||null,targetUserName=text(target_user.display_name||target_user.email||target_user.name||'',180);
  const targetTeamId=target_team.id||null,targetTeamName=text(target_team.name||'',180),outcome=['SUCCESS','DENIED','FAILED'].includes(result)?result:'FAILED';
  return (await sql`insert into permission_audit_events(manufacturer_id,actor_user_id,actor_name,actor_role,action_type,target_user_id,target_user_name,target_team_id,target_team_name,previous_value,new_value,result,reason,request_id) values(${tenant.tenant_id},${actorId},${actorName},${actorRole},${text(action_type,100)},${targetUserId},${targetUserName},${targetTeamId},${targetTeamName},${sql.json(safeAuditValue(previous_value)||{})},${sql.json(safeAuditValue(new_value)||{})},${outcome},${text(reason,500)},${auditRequestId(req)}) returning *`)[0];
}
