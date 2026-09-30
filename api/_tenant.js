import { db } from './_db.js';
import { sessionData, isAdminBearer, isCron } from './_auth.js';
import { ensureIdentitySchema, memberTeams } from './_identity.js';
import { CAPABILITIES, canonicalRole, hasCapability } from './_permissions.js';

export async function resolveTenant(req,res,{allowAdminBearer=true,allowCron=false}={}){
  const session=sessionData(req);
  if(session?.tenant_id){
    const sql=db();await ensureIdentitySchema(sql);
    let role=canonicalRole(session.role),userId=session.user_id||null;
    if(userId){const member=(await sql`select id,manufacturer_id,role,active from manufacturer_members where id=${userId} and manufacturer_id=${session.tenant_id} limit 1`)[0];if(!member?.active){res.status(401).json({error:'This user session is no longer active'});return null}role=canonicalRole(member.role)}
    const teams=userId?await memberTeams(userId,sql):[],tenant={tenant_id:session.tenant_id,user_id:userId,role,team_ids:teams.map(t=>String(t.id)),teams,source:'session'};
    if(String(req.method||'GET').toUpperCase()!=='GET'&&!hasCapability(tenant,CAPABILITIES.APP_WRITE)){res.status(403).json({error:'Viewer access is read-only',code:'READ_ONLY'});return null}
    return tenant;
  }
  if(allowAdminBearer && isAdminBearer(req)){
    const sql=db();
    const rows=await sql`select id from manufacturers order by created_at asc limit 1`;
    if(!rows[0]){res.status(409).json({error:'No tenant exists. Run /api/db-init-v9-8 first.'});return null}
    return {tenant_id:rows[0].id,user_id:null,role:'ADMIN',team_ids:[],teams:[],source:'admin_bearer'};
  }
  if(allowCron && isCron(req)) return {tenant_id:null,user_id:null,role:'cron',team_ids:[],teams:[],source:'cron'};
  res.status(401).json({error:'Tenant authentication required'});return null;
}

export function tenantWhere(tenantId){
  if(!tenantId) throw new Error('tenant_id is required');
  return tenantId;
}

// Tenant-private commercial data is visible across the workspace only to an Administrator.
// Managers retain full application capabilities but remain scoped to their authenticated teams.
export function canSeeAllTenantData(tenant={}){return hasCapability(tenant,CAPABILITIES.USER_ADMIN_TENANT)}

export async function resolveInternalTenant(req,res){
  const tenant=await resolveTenant(req,res,{allowAdminBearer:true,allowCron:true});
  if(!tenant)return null;
  if(tenant.source==='cron'||tenant.source==='admin_bearer'||hasCapability(tenant,CAPABILITIES.TENANT_SECURITY))return tenant;
  res.status(403).json({error:'Administrator authentication required',code:'FORBIDDEN',required_capability:CAPABILITIES.TENANT_SECURITY});
  return null;
}
