import { db } from './_db.js';
import { sessionData, clearSessionCookie, isAdminBearer } from './_auth.js';
import { ensureIdentitySchema, memberTeams } from './_identity.js';

export default async function handler(req,res){
 if(req.method==='DELETE'){res.setHeader('set-cookie',clearSessionCookie());return res.status(200).json({logged_out:true})}
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const session=sessionData(req);
 if(!session&&!isAdminBearer(req))return res.status(401).json({authenticated:false});
 const sql=db();
 try{
  await ensureIdentitySchema(sql);
  if(!session?.user_id){const tenantId=session?.tenant_id||null;return res.status(200).json({authenticated:true,user:{id:null,role:'admin',manufacturer_id:tenantId,display_name:'Platform Admin'},teams:[]})}
  const member=(await sql`select mm.id,mm.email,mm.display_name,mm.role,mm.manufacturer_id,mm.default_team_id,m.name manufacturer_name from manufacturer_members mm join manufacturers m on m.id=mm.manufacturer_id where mm.id=${session.user_id} and mm.active=true limit 1`)[0];
  if(!member)return res.status(401).json({authenticated:false});
  return res.status(200).json({authenticated:true,user:member,teams:await memberTeams(member.id,sql)});
 }catch(e){return res.status(500).json({error:'Session could not be loaded'})}
}
