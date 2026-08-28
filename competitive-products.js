
import { db, upsertCompetitiveProduct } from './_db.js';
export default async function handler(req,res){
 try{
  if(req.method==='GET'){
    const sql=db(); const account=req.query.account_id||null;
    const rows=account ? await sql`select * from competitive_products where account_id=${account} and active=true order by verified_at desc nulls last, brand`
                       : await sql`select * from competitive_products where active=true order by updated_at desc limit 2000`;
    return res.status(200).json({products:rows});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const p of body) out.push(await upsertCompetitiveProduct(p||{}));
    return res.status(200).json({products:out});
  }
  res.status(405).json({error:'Method not allowed'});
 }catch(e){res.status(500).json({error:e.message})}
}
