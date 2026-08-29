import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

export default async function handler(req,res){
  const t=await resolveTenant(req,res); if(!t)return;
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const sql=db();
  try{
    const brands=await sql`select * from brands where manufacturer_id=${t.tenant_id} and active=true order by name`;
    const products=await sql`select p.*,b.name brand_name from products p left join brands b on b.id=p.brand_id where p.manufacturer_id=${t.tenant_id} and p.active=true order by b.name,p.name`;
    const hydrated=[];
    for(const p of products){
      let variants=[],channels=[],categories=[];
      try{variants=await sql`select * from product_variants where product_id=${p.id} order by created_at`;}catch{}
      try{const rows=await sql`select c.name from product_channels pc join channels c on c.id=pc.channel_id where pc.product_id=${p.id} order by c.name`;channels=rows.map(x=>x.name);}catch{}
      try{const rows=await sql`select category from product_categories where product_id=${p.id} order by category`;categories=rows.map(x=>x.category);}catch{}
      hydrated.push({...p,variants,channels,categories});
    }
    return res.status(200).json({tenant_id:t.tenant_id,brands,products:hydrated,schema_status:'compatible'});
  }catch(e){
    console.error('portfolio failed',{message:e?.message||String(e)});
    return res.status(500).json({error:'Portfolio could not be loaded',code:'PORTFOLIO_LOAD_FAILED'});
  }
}
