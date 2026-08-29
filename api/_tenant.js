import { db } from './_db.js';
import { sessionData, isAdminBearer, isCron } from './_auth.js';

export async function resolveTenant(req,res,{allowAdminBearer=true,allowCron=false}={}){
  const session=sessionData(req);
  if(session?.tenant_id) return {tenant_id:session.tenant_id,user_id:session.user_id||null,role:session.role||'admin',source:'session'};
  if(allowAdminBearer && isAdminBearer(req)){
    const sql=db();
    const rows=await sql`select id from manufacturers order by created_at asc limit 1`;
    if(!rows[0]){res.status(409).json({error:'No tenant exists. Run /api/db-init-v9-8 first.'});return null}
    return {tenant_id:rows[0].id,user_id:null,role:'admin',source:'admin_bearer'};
  }
  if(allowCron && isCron(req)) return {tenant_id:null,user_id:null,role:'cron',source:'cron'};
  res.status(401).json({error:'Tenant authentication required'});return null;
}

export function tenantWhere(tenantId){
  if(!tenantId) throw new Error('tenant_id is required');
  return tenantId;
}
