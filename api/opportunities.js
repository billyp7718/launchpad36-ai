import { db } from './_db.js';
import { requireAdmin } from './_auth.js';
export default async function handler(req,res){
 try{
  if(!requireAdmin(req,res)) return;
  const sql=db();
  if(req.method==='GET'){
    const rows=await sql`
      select os.*, a.name as account_name, pv.sku, pv.variant_name, p.name as product_name
      from opportunity_scores os
      join accounts a on a.id=os.account_id
      left join product_variants pv on pv.id=os.product_variant_id
      left join products p on p.id=pv.product_id
      order by os.scored_at desc limit 250`;
    return res.status(200).json({opportunities:rows});
  }
  if(req.method==='POST'){
    const x=req.body||{};
    const row=(await sql`
      insert into opportunity_scores(
        account_id,product_variant_id,overall_score,assortment_gap,price_white_space,
        feature_differentiation,competitive_density,buyer_accessibility,online_fit,in_store_fit,explanation
      ) values(
        ${x.account_id},${x.product_variant_id||null},${Number(x.overall_score)||0},${Number(x.assortment_gap)||0},
        ${Number(x.price_white_space)||0},${Number(x.feature_differentiation)||0},${Number(x.competitive_density)||0},
        ${Number(x.buyer_accessibility)||0},${Number(x.online_fit)||0},${Number(x.in_store_fit)||0},${sql.json(x.explanation||{})}
      ) returning *`)[0];
    return res.status(200).json({opportunity:row});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){return res.status(500).json({error:e.message})}
}
