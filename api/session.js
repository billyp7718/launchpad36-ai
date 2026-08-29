import { db } from './_db.js';
import { createSessionCookie, clearSessionCookie, sessionData, verifySecret } from './_auth.js';
export default async function handler(req,res){
  if(req.method==='GET'){const s=sessionData(req);return res.status(200).json({authenticated:Boolean(s),tenant_id:s?.tenant_id||null,role:s?.role||null})}
  if(req.method==='DELETE'){res.setHeader('Set-Cookie',clearSessionCookie());return res.status(200).json({authenticated:false})}
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!process.env.ADMIN_SECRET)return res.status(503).json({error:'ADMIN_SECRET is not configured'});
  if(!verifySecret(req.body?.secret||''))return res.status(401).json({error:'Invalid admin secret'});
  const sql=db();
  const rows=await sql`select id from manufacturers order by created_at asc limit 1`;
  if(!rows[0])return res.status(409).json({error:'No tenant exists. Initialize V9.8 first.'});
  res.setHeader('Set-Cookie',createSessionCookie({role:'admin',tenant_id:rows[0].id}));
  return res.status(200).json({authenticated:true,tenant_id:rows[0].id,role:'admin'});
}
