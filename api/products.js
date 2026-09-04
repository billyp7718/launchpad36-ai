import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=1000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const amount=value=>{const parsed=Number(String(value??'').replace(/[$,]/g,''));return Number.isFinite(parsed)&&parsed>=0?parsed:0};
const list=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[|;,]/)).map(item=>clean(item,120)).filter(Boolean))];

function normalizeVariant(value={}){
  return {sku:clean(value.sku,120),variant_name:clean(value.variant_name||value.name,180),msrp:amount(value.msrp),map:amount(value.map),wholesale:amount(value.wholesale),upc:clean(value.upc,80),model_number:clean(value.model_number,120),image_url:clean(value.image_url,1000),product_url:clean(value.product_url,1000),attributes:value.attributes&&typeof value.attributes==='object'?value.attributes:{features:list(value.features)}};
}

function normalizeProduct(value={}){
  return {brand_id:clean(value.brand_id,80)||null,name:clean(value.name,220),product_family:clean(value.product_family,180),category:clean(value.category,180),description:clean(value.description,3000),positioning:clean(value.positioning||value.position,1000),differentiator:clean(value.differentiator||value.diff,1000),product_url:clean(value.product_url,1000),image_url:clean(value.image_url,1000),categories:list(value.categories),channels:list(value.channels).map(channel=>channel.toLowerCase().replace(/[^a-z0-9]+/g,'_')).filter(Boolean),variants:(Array.isArray(value.variants)?value.variants:[]).map(normalizeVariant)};
}

async function validateProduct(sql,product,tenantId){
  if(!product.name)throw Object.assign(new Error('Product name is required'),{status:400});
  if(product.brand_id){const brand=(await sql`select id from brands where id=${product.brand_id} and manufacturer_id=${tenantId} and active=true limit 1`)[0];if(!brand)throw Object.assign(new Error('Brand is not owned by this tenant'),{status:400})}
  const identities=new Set();for(const variant of product.variants){if(!variant.sku)throw Object.assign(new Error('Each product variant requires a SKU'),{status:400});const key=`${variant.sku}|${variant.variant_name}`.toLowerCase();if(identities.has(key))throw Object.assign(new Error(`Duplicate SKU and variant: ${variant.sku}`),{status:400});identities.add(key)}
}

async function syncProductDetails(sql,productId,product){
  await sql`delete from product_categories where product_id=${productId}`;
  for(const category of [...new Set([product.category,...product.categories].filter(Boolean))])await sql`insert into product_categories(product_id,category) values(${productId},${category}) on conflict do nothing`;
  await sql`delete from product_channels where product_id=${productId}`;
  for(const code of product.channels){const channel=(await sql`select id from channels where code=${code} or lower(name)=lower(${code.replaceAll('_',' ')}) limit 1`)[0];if(channel)await sql`insert into product_channels(product_id,channel_id) values(${productId},${channel.id}) on conflict do nothing`}
  await sql`update product_variants set active=false,updated_at=now() where product_id=${productId}`;
  for(const variant of product.variants)await sql`insert into product_variants(product_id,sku,variant_name,msrp,map,wholesale,upc,model_number,image_url,product_url,attributes,active,updated_at) values(${productId},${variant.sku},${variant.variant_name},${variant.msrp},${variant.map},${variant.wholesale},${variant.upc},${variant.model_number},${variant.image_url||product.image_url},${variant.product_url||product.product_url},${sql.json(variant.attributes)},true,now()) on conflict(product_id,sku,variant_name) do update set msrp=excluded.msrp,map=excluded.map,wholesale=excluded.wholesale,upc=excluded.upc,model_number=excluded.model_number,image_url=excluded.image_url,product_url=excluded.product_url,attributes=excluded.attributes,active=true,updated_at=now()`;
}

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const sql=db();
  try{
    if(req.method==='GET'){const rows=await sql`select p.*,coalesce(json_agg(v order by v.created_at) filter(where v.id is not null),'[]') variants from products p left join product_variants v on v.product_id=p.id and v.active=true where p.manufacturer_id=${tenant.tenant_id} and p.active=true group by p.id order by p.name`;return res.status(200).json({products:rows})}
    if(req.method==='POST'){
      const inputs=Array.isArray(req.body)?req.body:[req.body],products=inputs.map(normalizeProduct);for(const product of products)await validateProduct(sql,product,tenant.tenant_id);
      const saved=[];for(const product of products){const row=await sql.begin(async tx=>{const created=(await tx`insert into products(manufacturer_id,brand_id,name,product_family,category,description,product_url,image_url,positioning,differentiator,source_type,source_url,active,updated_at) values(${tenant.tenant_id},${product.brand_id},${product.name},${product.product_family},${product.category},${product.description},${product.product_url},${product.image_url},${product.positioning},${product.differentiator},'manual',${product.product_url},true,now()) returning *`)[0];await syncProductDetails(tx,created.id,product);return created});saved.push(row)}
      return res.status(200).json({products:saved});
    }
    if(req.method==='PATCH'){
      const id=clean(req.query?.id||req.body?.id,80);if(!id)return res.status(400).json({error:'Product id is required'});const product=normalizeProduct(req.body);await validateProduct(sql,product,tenant.tenant_id);
      const row=await sql.begin(async tx=>{const updated=(await tx`update products set brand_id=${product.brand_id},name=${product.name},product_family=${product.product_family},category=${product.category},description=${product.description},product_url=${product.product_url},image_url=${product.image_url},positioning=${product.positioning},differentiator=${product.differentiator},source_type='manual',source_url=${product.product_url},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} and active=true returning *`)[0];if(!updated)throw Object.assign(new Error('Product not found'),{status:404});await syncProductDetails(tx,id,product);return updated});
      return res.status(200).json({product:row});
    }
    if(req.method==='DELETE'){const id=clean(req.query?.id||req.body?.id,80);if(!id)return res.status(400).json({error:'Product id is required'});const row=(await sql`update products set active=false,updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} and active=true returning id,name`)[0];if(!row)return res.status(404).json({error:'Product not found'});return res.status(200).json({deleted:true,product:row})}
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){return res.status(error.status||500).json({error:error.message})}
}
