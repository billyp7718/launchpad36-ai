
import { db, upsertAccount } from '../../lib/db.js';
export default async function handler(req,res){
 try{
  if(req.method==='GET'){
    const sql=db(); const rows=await sql`select * from accounts where active=true order by score desc, name`;
    return res.status(200).json({accounts:rows});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const a of body) out.push(await upsertAccount(a||{}));
    return res.status(200).json({accounts:out});
  }
  res.status(405).json({error:'Method not allowed'});
 }catch(e){res.status(500).json({error:e.message})}
}
