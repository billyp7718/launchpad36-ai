import { db, upsertCompetitiveProduct } from './_db.js';
import { requireAdmin } from './_auth.js';
export default async function handler(req,res){
 try{
  if(!requireAdmin(req,res)) return;
  if(req.method==='GET'){
    const sql=db(); const account=req.query.account_id||null,organization=req.query.organization_id||null;
    const rows=organization ? await sql`select cp.* from competitive_products cp join accounts a on a.id=cp.account_id where a.organization_id=${organization} and cp.active=true order by cp.updated_at desc,cp.brand`
                       : account ? await sql`select * from competitive_products where account_id=${account} and active=true order by updated_at desc,brand`
                       : await sql`select * from competitive_products where active=true order by updated_at desc limit 2000`;
    const products=rows.map(row=>{let research_context={};try{research_context=JSON.parse(row.raw_text||'{}')}catch{}return {...row,research_context,comparison_product_ids:Array.isArray(research_context.comparison_product_ids)?research_context.comparison_product_ids:[]}});
    return res.status(200).json({products});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const p of body) out.push(await upsertCompetitiveProduct(p||{}));
    return res.status(200).json({products:out});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error('competitive product operation failed',{message:e?.message||String(e)});return res.status(500).json({error:'Competitive product operation could not be completed'})}
}
