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
  const rows=await sql`select mm.*,m.name manufacturer_name from manufacturer_members mm join manufacturers m on m.id=mm.manufacturer_id where lower(mm.email)=${email}`;
  const activeRows=rows.filter(r=>r.active===true);
  const passwordMatches=activeRows.filter(r=>verifyPassword(password,r.password_hash));
  let matches=passwordMatches;
  if(passwordMatches.length>1&&workspace){matches=passwordMatches.filter(r=>String(r.manufacturer_name||'').toLowerCase()===workspace||String(r.manufacturer_id)===workspace)}
  if(matches.length!==1){
   if(rows.length&&activeRows.length===0)return res.status(403).json({error:'This user account is suspended. Contact your workspace administrator.'});
   if(passwordMatches.length>1&&!workspace)return res.status(409).json({error:'Multiple workspaces use this login. Enter the workspace name.'});
   if(passwordMatches.length>1&&workspace&&matches.length!==1)return res.status(401).json({error:'Workspace name did not match this login. Leave it blank unless you use this email in more than one workspace.'});
   return res.status(401).json({error:'Invalid email or password'});
  }
  const member=matches[0];
  await sql`update manufacturer_members set last_login_at=now(),updated_at=now() where id=${member.id}`;
  res.setHeader('set-cookie',createSessionCookie({role:member.role,tenant_id:member.manufacturer_id,user_id:member.id,display_name:member.display_name,email:member.email}));
  return res.status(200).json({authenticated:true,user:{id:member.id,email:member.email,display_name:member.display_name,role:member.role,manufacturer_id:member.manufacturer_id,manufacturer_name:member.manufacturer_name}});
 }catch(e){console.error('user login failed',{message:e?.message||String(e)});return res.status(500).json({error:'Login could not be completed'})}
}
