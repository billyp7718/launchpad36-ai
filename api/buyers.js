
import { db, upsertBuyer } from './_db.js';
export default async function handler(req,res){
 try{
  if(req.method==='GET'){
    const sql=db(); const account=req.query.account_id||null;
    const rows=account ? await sql`select * from buyers where account_id=${account} order by updated_at desc`
                       : await sql`select * from buyers order by updated_at desc limit 1000`;
    return res.status(200).json({buyers:rows});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const b of body) out.push(await upsertBuyer(b||{}));
    return res.status(200).json({buyers:out});
  }
  res.status(405).json({error:'Method not allowed'});
 }catch(e){res.status(500).json({error:e.message})}
}
