import { db } from './_db.js';
import { sessionData, clearSessionCookie, createSessionCookie, isAdminBearer } from './_auth.js';
import { ensureIdentitySchema, memberSectionAccess, memberTeams } from './_identity.js';
import { permissionSummary } from './_permissions.js';

export default async function handler(req,res){
 if(req.method==='DELETE'){res.setHeader('set-cookie',clearSessionCookie());return res.status(200).json({logged_out:true})}
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const session=sessionData(req);
 if(!session&&!isAdminBearer(req))return res.status(401).json({authenticated:false});
 const sql=db();
 try{
  await ensureIdentitySchema(sql);
  if(!session?.user_id){const tenantId=session?.tenant_id||null,user={id:null,role:'ADMIN',manufacturer_id:tenantId,display_name:'Platform Admin'},sections=await memberSectionAccess({id:null,manufacturer_id:tenantId,role:'admin'},sql);return res.status(200).json({authenticated:true,user,teams:[],sections,permissions:permissionSummary({...user,source:'admin_bearer'})})}
  const member=(await sql`select mm.id,mm.email,mm.display_name,mm.role,mm.manufacturer_id,mm.default_team_id,m.name manufacturer_name from manufacturer_members mm join manufacturers m on m.id=mm.manufacturer_id where mm.id=${session.user_id} and mm.active=true limit 1`)[0];
  if(!member)return res.status(401).json({authenticated:false});
  const permissions=permissionSummary(member),[teams,sections]=await Promise.all([permissions.can_administer_tenant_users
    ?await sql`select id,name,description,active from manufacturer_teams where manufacturer_id=${member.manufacturer_id} and active=true order by name`
    :await memberTeams(member.id,sql),memberSectionAccess(member,sql)]);
  res.setHeader('set-cookie',createSessionCookie({role:permissions.role,tenant_id:member.manufacturer_id,user_id:member.id,display_name:member.display_name,email:member.email}));return res.status(200).json({authenticated:true,user:{...member,role:permissions.role},teams,sections,permissions});
 }catch(e){return res.status(500).json({error:'Session could not be loaded'})}
}
