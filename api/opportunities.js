import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
export default async function handler(req,res){const tenant=await resolveTenant(req,res);if(!tenant)return;
 try{const sql=db();
  if(req.method==='GET'){const rows=await sql`select os.*,a.name account_name,pv.sku,pv.variant_name,p.name product_name from opportunity_scores os join accounts a on a.id=os.account_id left join product_variants pv on pv.id=os.product_variant_id left join products p on p.id=pv.product_id where os.manufacturer_id=${tenant.tenant_id} order by os.scored_at desc limit 250`;return res.status(200).json({opportunities:rows})}
  if(req.method==='POST'){const x=req.body||{};if(x.product_variant_id){const owned=(await sql`select pv.id from product_variants pv join products p on p.id=pv.product_id where pv.id=${x.product_variant_id} and p.manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!owned)return res.status(400).json({error:'product_variant_id is not owned by this tenant'})}const row=(await sql`insert into opportunity_scores(manufacturer_id,account_id,product_variant_id,overall_score,assortment_gap,price_white_space,feature_differentiation,competitive_density,buyer_accessibility,online_fit,in_store_fit,explanation) values(${tenant.tenant_id},${x.account_id},${x.product_variant_id||null},${Number(x.overall_score)||0},${Number(x.assortment_gap)||0},${Number(x.price_white_space)||0},${Number(x.feature_differentiation)||0},${Number(x.competitive_density)||0},${Number(x.buyer_accessibility)||0},${Number(x.online_fit)||0},${Number(x.in_store_fit)||0},${sql.json(x.explanation||{})}) returning *`)[0];return res.status(200).json({opportunity:row})}
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){return res.status(500).json({error:e.message})}
}
