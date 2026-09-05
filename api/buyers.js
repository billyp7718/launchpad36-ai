import { db, upsertBuyer } from './_db.js';
import { requireAdmin } from './_auth.js';
const clean=(value,max=300)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
export default async function handler(req,res){
 try{
  if(!requireAdmin(req,res)) return;
  if(req.method==='GET'){
    const sql=db(),account=req.query.account_id||null,organization=req.query.organization_id||null;
    const rows=organization?await sql`select b.* from buyers b join accounts a on a.id=b.account_id where a.organization_id=${organization} order by b.updated_at desc`
                       :account ? await sql`select * from buyers where account_id=${account} order by updated_at desc`
                       : await sql`select * from buyers order by updated_at desc limit 1000`;
    return res.status(200).json({buyers:rows});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const b of body) out.push(await upsertBuyer(b||{}));
    return res.status(200).json({buyers:out});
  }
  if(req.method==='PATCH'){
    const sql=db(),id=String(req.body?.id||'').trim(),name=clean(req.body?.name,160),title=clean(req.body?.title,180),email=clean(req.body?.email,200),linkedin=clean(req.body?.linkedin,500);
    if(!id||!name||!title)return res.status(400).json({error:'Buyer id, name, and title are required'});
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid buyer email address'});
    if(linkedin&&!/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\//i.test(linkedin))return res.status(400).json({error:'Enter a valid LinkedIn URL'});
    const buyer=(await sql`update buyers set name=${name},title=${title},category=${clean(req.body?.category,180)},email=${email},phone=${clean(req.body?.phone,80)},linkedin=${linkedin},updated_at=now() where id=${id} returning *`)[0];
    if(!buyer)return res.status(404).json({error:'Buyer was not found'});
    return res.status(200).json({buyer});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error('buyer operation failed',{message:e?.message||String(e)});return res.status(500).json({error:'Buyer operation could not be completed'})}
}
