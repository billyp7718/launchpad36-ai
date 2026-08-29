import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
export default async function handler(req,res){const t=await resolveTenant(req,res);if(!t)return;if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});const sql=db();try{
 const brands=await sql`select * from brands where manufacturer_id=${t.tenant_id} and active=true order by name`;
 const products=await sql`select p.*,b.name brand_name,
   coalesce((select json_agg(v order by v.created_at) from product_variants v where v.product_id=p.id and v.active=true),'[]') variants,
   coalesce((select json_agg(c.name order by c.name) from product_channels pc join channels c on c.id=pc.channel_id where pc.product_id=p.id),'[]') channels,
   coalesce((select json_agg(pc.category order by pc.category) from product_categories pc where pc.product_id=p.id),'[]') categories
   from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${t.tenant_id} and p.active=true order by b.name,p.name`;
 return res.status(200).json({tenant_id:t.tenant_id,brands,products});
}catch(e){return res.status(500).json({error:e.message})}}
