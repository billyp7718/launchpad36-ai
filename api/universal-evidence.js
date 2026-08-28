import { requireInternal } from './_auth.js';
import { universalAcquire, safeDomain } from './_acquisition.js';

export default async function handler(req,res){
  if(!requireInternal(req,res))return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const domain=safeDomain(req.body?.domain),organization=String(req.body?.organization||req.body?.account||domain),categories=Array.isArray(req.body?.categories)?req.body.categories:String(req.body?.categories||'').split('|').map(x=>x.trim()).filter(Boolean);
  if(!domain)return res.status(400).json({error:'Valid organization domain required'});
  const result=await universalAcquire({domain,organization,categories});
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({version:'9.4.1',engine:'L36 Universal Evidence Acquisition Engine',organization,domain,categories,...result});
}
