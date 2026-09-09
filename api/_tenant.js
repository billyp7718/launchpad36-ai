import { db } from './_db.js';
import { sessionData, isAdminBearer, isCron } from './_auth.js';
import { ensureIdentitySchema, memberTeams } from './_identity.js';

export async function resolveTenant(req,res,{allowAdminBearer=true,allowCron=false}={}){
  const session=sessionData(req);
  if(session?.tenant_id){
    const sql=db();await ensureIdentitySchema(sql);
    const teams=session.user_id?await memberTeams(session.user_id,sql):[];
    return {tenant_id:session.tenant_id,user_id:session.user_id||null,role:session.role||'member',team_ids:teams.map(t=>t.id),teams,source:'session'};
  }
  if(allowAdminBearer && isAdminBearer(req)){
    const sql=db();
    const rows=await sql`select id from manufacturers order by created_at asc limit 1`;
    if(!rows[0]){res.status(409).json({error:'No tenant exists. Run /api/db-init-v9-8 first.'});return null}
    return {tenant_id:rows[0].id,user_id:null,role:'admin',team_ids:[],teams:[],source:'admin_bearer'};
  }
  if(allowCron && isCron(req)) return {tenant_id:null,user_id:null,role:'cron',team_ids:[],teams:[],source:'cron'};
  res.status(401).json({error:'Tenant authentication required'});return null;
}

export function tenantWhere(tenantId){
  if(!tenantId) throw new Error('tenant_id is required');
  return tenantId;
}

export function canSeeAllTenantData(tenant={}){return ['owner','admin'].includes(String(tenant.role||'').toLowerCase())||tenant.source==='admin_bearer'}
