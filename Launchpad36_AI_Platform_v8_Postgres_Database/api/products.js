
import { db } from './_db.js';
export default async function handler(req,res){
 try{
  const sql=db();
  if(req.method==='GET'){
    const rows=await sql`
      select p.*, coalesce(json_agg(v order by v.created_at) filter (where v.id is not null),'[]') as variants
      from products p left join product_variants v on v.product_id=p.id and v.active=true
      where p.active=true group by p.id order by p.name`;
    return res.status(200).json({products:rows});
  }
  if(req.method==='POST'){
    const list=Array.isArray(req.body)?req.body:[req.body], out=[];
    for(const p of list){
      const prod=(await sql`
        insert into products(name,category,positioning,differentiator,updated_at)
        values(${p.name||''},${p.category||''},${p.positioning||p.position||''},${p.differentiator||p.diff||''},now())
        returning *`)[0];
      for(const v of (p.variants||[])){
        await sql`
          insert into product_variants(product_id,sku,variant_name,msrp,map,wholesale,attributes)
          values(${prod.id},${v.sku||''},${v.name||v.variant_name||''},${Number(v.msrp)||0},${Number(v.map)||0},${Number(v.wholesale)||0},${sql.json(v.attributes||{})})
          on conflict(product_id,sku,variant_name) do update set msrp=excluded.msrp,map=excluded.map,wholesale=excluded.wholesale,attributes=excluded.attributes,updated_at=now()`;
      }
      out.push(prod);
    }
    return res.status(200).json({products:out});
  }
  res.status(405).json({error:'Method not allowed'});
 }catch(e){res.status(500).json({error:e.message})}
}
