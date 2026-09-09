import { db } from './_db.js';
import { verifySecret, createSessionCookie } from './_auth.js';
import { ensureIdentitySchema, hashPassword } from './_identity.js';

const clean=(v,m=240)=>String(v||'').trim().slice(0,m);
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!verifySecret(req.body?.admin_secret))return res.status(401).json({error:'Invalid platform admin key'});
 const email=clean(req.body?.email).toLowerCase(),displayName=clean(req.body?.display_name,180),password=String(req.body?.password||'');
 if(!email||!email.includes('@'))return res.status(400).json({error:'Valid owner email is required'});
 const sql=db();
 try{
  await ensureIdentitySchema(sql);
  const manufacturer=(await sql`select id,name from manufacturers order by created_at asc limit 1`)[0];if(!manufacturer)return res.status(409).json({error:'No workspace exists yet'});
  const owner=(await sql`insert into manufacturer_members(manufacturer_id,email,display_name,role,active,password_hash,updated_at) values(${manufacturer.id},${email},${displayName},'owner',true,${hashPassword(password)},now()) on conflict(manufacturer_id,lower(email)) do update set display_name=excluded.display_name,role='owner',active=true,password_hash=excluded.password_hash,updated_at=now() returning *`)[0];
  res.setHeader('set-cookie',createSessionCookie({role:'owner',tenant_id:manufacturer.id,user_id:owner.id,display_name:owner.display_name,email:owner.email}));
  return res.status(201).json({created:true,user:{id:owner.id,email:owner.email,display_name:owner.display_name,role:'owner'},workspace:{id:manufacturer.id,name:manufacturer.name}});
 }catch(e){return res.status(e.status||500).json({error:e.message||'Owner setup failed'})}
}
