import { createSessionCookie, clearSessionCookie, isAdmin, verifySecret } from './_auth.js';
export default async function handler(req,res){
  if(req.method==='GET') return res.status(200).json({authenticated:isAdmin(req)});
  if(req.method==='DELETE'){
    res.setHeader('Set-Cookie',clearSessionCookie());
    return res.status(200).json({authenticated:false});
  }
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!process.env.ADMIN_SECRET) return res.status(503).json({error:'ADMIN_SECRET is not configured'});
  if(!verifySecret(req.body?.secret||'')) return res.status(401).json({error:'Invalid admin secret'});
  res.setHeader('Set-Cookie',createSessionCookie());
  return res.status(200).json({authenticated:true});
}
