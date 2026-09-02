import { db, upsertBuyer } from './_db.js';
import { requireAdmin } from './_auth.js';
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
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){return res.status(500).json({error:e.message})}
}
