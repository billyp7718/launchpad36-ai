import { db, upsertAccount } from './_db.js';
import { requireAdmin } from './_auth.js';

const ACCOUNTS=[
 {name:'Best Buy',type:'National Retail',coverage:'National',region:'US',domain:'bestbuy.com',category:'TV mounts|audio|office',source:'L36 controlled QA seed'},
 {name:'Walmart',type:'Mass Retail',coverage:'National',region:'US',domain:'walmart.com',category:'TV mounts|audio|office',source:'L36 controlled QA seed'},
 {name:'Target',type:'Mass Retail',coverage:'National',region:'US',domain:'target.com',category:'TV mounts|audio|office',source:'L36 controlled QA seed'},
 {name:'Costco',type:'Warehouse Club',coverage:'National',region:'US',domain:'costco.com',category:'TV mounts|audio|office',source:'L36 controlled QA seed'},
 {name:'B&H Photo Video',type:'Specialty Retail',coverage:'National E-commerce',region:'US',domain:'bhphotovideo.com',category:'TV mounts|audio|office',source:'L36 controlled QA seed'}
];

export default async function handler(req,res){
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 if(!requireAdmin(req,res)) return;
 try{
  const sql=db();
  let m=(await sql`select * from manufacturers where lower(name)=lower('Launchpad36 QA Manufacturer') limit 1`)[0];
  if(!m) m=(await sql`insert into manufacturers(name,website,notes) values('Launchpad36 QA Manufacturer','launchpad36.com','Controlled non-customer QA dataset') returning *`)[0];
  let b=(await sql`select * from brands where manufacturer_id=${m.id} and lower(name)=lower('L36 QA Brand') limit 1`)[0];
  if(!b) b=(await sql`insert into brands(manufacturer_id,name,website) values(${m.id},'L36 QA Brand','launchpad36.com') returning *`)[0];
  const existing=(await sql`select * from products where manufacturer_id=${m.id} and name='QA Universal TV Mount' limit 1`)[0];
  let product=existing;
  if(!product){
    product=(await sql`insert into products(manufacturer_id,brand_id,name,category,positioning,differentiator) values(${m.id},${b.id},'QA Universal TV Mount','TV mounts','Controlled QA product only','Used to validate platform workflow; not a commercial claim') returning *`)[0];
    await sql`insert into product_variants(product_id,sku,variant_name,msrp,map,wholesale,attributes) values
      (${product.id},'QA-FIXED-49','Fixed Mount',49,39,20,${sql.json({qa_only:true})}),
      (${product.id},'QA-TILT-79','Tilting Mount',79,69,34,${sql.json({qa_only:true})}),
      (${product.id},'QA-FULL-149','Full Motion Mount',149,129,65,${sql.json({qa_only:true})})`;
  }
  const accounts=[]; for(const a of ACCOUNTS) accounts.push(await upsertAccount(a));
  return res.status(200).json({seeded:true,qa_only:true,manufacturer:m,brand:b,product,accounts});
 }catch(e){return res.status(500).json({error:e.message})}
}
