import { db } from './_db.js';
import { ensureIdentitySchema } from './_identity.js';
import { appendPermissionAudit } from './_permission-audit.js';
import { CAPABILITIES, hasCapability } from './_permissions.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=180)=>String(value??'').trim().slice(0,max);
const dateOrNull=value=>{const text=clean(value,40);return text&&!Number.isNaN(Date.parse(text))?new Date(text).toISOString():null};

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res,{enforceWriteCapability:false});if(!tenant)return;
  const sql=db();
  try{
    await ensureIdentitySchema(sql);
    const actor=tenant.user_id?(await sql`select id,email,display_name,role from manufacturer_members where id=${tenant.user_id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0]:{id:null,display_name:'Platform Admin',role:'ADMIN'};
    const admin=hasCapability(tenant,CAPABILITIES.USER_ADMIN_TENANT),manager=hasCapability(tenant,CAPABILITIES.USER_ADMIN_TEAM);
    if(!admin&&!manager){
      await appendPermissionAudit({sql,req,tenant,actor,action_type:'PERMISSION_AUDIT_VIEW',result:'DENIED',reason:'Role cannot view permission audit records'});
      return res.status(403).json({error:'Permission Audit Log is available only to Administrators and Managers',code:'FORBIDDEN'});
    }
    if(req.method!=='GET'){
      await appendPermissionAudit({sql,req,tenant,actor,action_type:'PERMISSION_AUDIT_MUTATION',result:'DENIED',reason:'Permission audit records are append-only'});
      return res.status(405).json({error:'Permission audit records are append-only'});
    }
    const from=dateOrNull(req.query?.date_from),to=dateOrNull(req.query?.date_to),actorFilter=clean(req.query?.actor).toLowerCase(),targetFilter=clean(req.query?.target_user).toLowerCase(),teamFilter=clean(req.query?.team).toLowerCase(),action=clean(req.query?.action,100).toUpperCase(),result=clean(req.query?.result,20).toUpperCase(),limit=Math.min(Math.max(Number(req.query?.limit)||200,1),500),teamIds=tenant.team_ids||[];
    const rows=await sql`
      select pae.* from permission_audit_events pae
      where pae.manufacturer_id=${tenant.tenant_id}
        and (${admin} or pae.actor_user_id=${tenant.user_id} or pae.target_team_id=any(${teamIds}::uuid[])
          or exists(select 1 from manufacturer_team_members mtm where mtm.member_id=pae.actor_user_id and mtm.team_id=any(${teamIds}::uuid[]))
          or exists(select 1 from manufacturer_team_members mtm where mtm.member_id=pae.target_user_id and mtm.team_id=any(${teamIds}::uuid[])))
        and (${from}::timestamptz is null or pae.created_at>=${from}::timestamptz)
        and (${to}::timestamptz is null or pae.created_at<=${to}::timestamptz)
        and (${actorFilter}='' or lower(pae.actor_name) like ${`%${actorFilter}%`} or pae.actor_user_id::text=${actorFilter})
        and (${targetFilter}='' or lower(pae.target_user_name) like ${`%${targetFilter}%`} or pae.target_user_id::text=${targetFilter})
        and (${teamFilter}='' or lower(pae.target_team_name) like ${`%${teamFilter}%`} or pae.target_team_id::text=${teamFilter})
        and (${action}='' or pae.action_type=${action})
        and (${result}='' or pae.result=${result})
      order by pae.created_at desc limit ${limit}`;
    return res.status(200).json({events:rows,scope:admin?'TENANT':'AUTHORIZED_TEAMS',append_only:true,filters:{date_from:from,date_to:to,actor:actorFilter,target_user:targetFilter,team:teamFilter,action,result}});
  }catch(error){console.error('permission audit failed',{message:error?.message||String(error)});return res.status(500).json({error:'Permission Audit Log could not be loaded'})}
}
