import { db } from './_db.js';
import { createSessionCookie } from './_auth.js';
import { ensureIdentitySchema, verifyPassword } from './_identity.js';

const clean=(v,m=240)=>String(v||'').trim().slice(0,m);
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const email=clean(req.body?.email).toLowerCase(),password=String(req.body?.password||''),workspace=clean(req.body?.workspace).toLowerCase();
 if(!email||!password)return res.status(400).json({error:'Email and password are required'});
 const sql=db();
 try{
  await ensureIdentitySchema(sql);
  let rows=await sql`select mm.*,m.name manufacturer_name from manufacturer_members mm join manufacturers m on m.id=mm.manufacturer_id where lower(mm.email)=${email} and mm.active=true`;
  if(workspace)rows=rows.filter(r=>String(r.manufacturer_name||'').toLowerCase()===workspace||String(r.manufacturer_id)===workspace);
  const matches=rows.filter(r=>verifyPassword(password,r.password_hash));
  if(matches.length!==1)return res.status(401).json({error:matches.length>1?'Multiple workspaces use this login. Enter the workspace name.':'Invalid email or password'});
  const member=matches[0];
  await sql`update manufacturer_members set last_login_at=now(),updated_at=now() where id=${member.id}`;
  res.setHeader('set-cookie',createSessionCookie({role:member.role,tenant_id:member.manufacturer_id,user_id:member.id,display_name:member.display_name,email:member.email}));
  return res.status(200).json({authenticated:true,user:{id:member.id,email:member.email,display_name:member.display_name,role:member.role,manufacturer_id:member.manufacturer_id,manufacturer_name:member.manufacturer_name}});
 }catch(e){console.error('user login failed',{message:e?.message||String(e)});return res.status(500).json({error:'Login could not be completed'})}
}
