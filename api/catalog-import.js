import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

function text(v){return String(v??'').trim()}
function num(v){const n=Number(String(v??'').replace(/[$,]/g,''));return Number.isFinite(n)?n:0}
function split(v){return text(v).split(/[|;,]/).map(x=>x.trim()).filter(Boolean)}
function sourceType(v){const x=text(v).toLowerCase();return ['excel','csv','demo','website_discovery'].includes(x)?x:'excel'}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value}
function digest(rows){return createHash('sha256').update(JSON.stringify(stable(rows))).digest('hex')}
function reviewSecret(){return process.env.CATALOG_REVIEW_SECRET||process.env.ADMIN_SECRET||''}
function reviewToken(tenantId,rows,type){const secret=reviewSecret();if(!secret)return '';return createHmac('sha256',secret).update(`${tenantId}:${type}:${digest(rows)}`).digest('base64url')}
function safeEqual(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb)}

export function normalizeCatalogRow(r={},index=0,type='excel'){
  const brand=text(r.brand||r.Brand),productName=text(r.product_name||r.Product||r['Product Name']),sku=text(r.sku||r.SKU||r['Model Number']);
  const errors=[];
  if(!brand)errors.push('Brand is required');if(!productName)errors.push('Product Name is required');if(!sku)errors.push('SKU is required');
  const msrp=num(r.msrp||r.MSRP),map=num(r.map||r.MAP),wholesale=num(r.wholesale||r.Wholesale);
  if(msrp<0||map<0||wholesale<0)errors.push('Prices cannot be negative');
  const row={brand,product_name:productName,sku,product_family:text(r.product_family||r['Product Family']),category:text(r.category||r.Category),description:text(r.description||r.Description),variant_name:text(r.variant_name||r.Variant||r['Variant Name']),msrp,map,wholesale,upc:text(r.upc||r.UPC),model_number:text(r.model_number||r['Model Number']||sku),features:split(r.features||r.Features),channels:split(r.channels||r.Channels),additional_categories:split(r.additional_categories||r['Additional Categories']),positioning:text(r.positioning||r.Positioning),differentiator:text(r.differentiator||r.Differentiator),brand_website:text(r.brand_website||r['Brand Website']),product_url:text(r.product_url||r['Product URL']),image_url:text(r.image_url||r['Image URL']),source_url:text(r.source_url||r['Source URL']||r.product_url||r['Product URL']),source_type:type,demo_data:type==='demo'||r.demo_data===true};
  return {row_number:index+2,row,errors,status:errors.length?'REVIEW_REQUIRED':'VALID'};
}

export function validateCatalogRows(rows=[],type='excel'){
  const reviewed=rows.map((r,i)=>normalizeCatalogRow(r,i,type));
  return {reviewed,valid_rows:reviewed.filter(x=>!x.errors.length).map(x=>x.row),errors:reviewed.filter(x=>x.errors.length).map(x=>({row:x.row_number,error:x.errors.join('; ')}))};
}

export default async function handler(req,res){
  const t=await resolveTenant(req,res);if(!t)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[];if(!rows.length)return res.status(400).json({error:'rows are required'});
  const type=sourceType(req.body?.source_type),review=validateCatalogRows(rows,type),token=reviewToken(t.tenant_id,review.valid_rows,type);
  if(req.body?.mode==='review')return res.status(200).json({version:'9.8.3',status:review.errors.length?'REVIEW_REQUIRED':'READY_FOR_APPROVAL',source_type:type,rows_seen:rows.length,rows_valid:review.valid_rows.length,rows_rejected:review.errors.length,errors:review.errors.slice(0,100),rows:review.valid_rows,review_token:token,requires_explicit_approval:true});
  if(req.body?.approved!==true)return res.status(409).json({error:'Catalog review approval is required before import',code:'CATALOG_APPROVAL_REQUIRED'});
  if(!token||!safeEqual(req.body?.review_token||'',token))return res.status(409).json({error:'Catalog contents changed after review; review again before importing',code:'CATALOG_REVIEW_STALE'});
  const sql=db(),errors=[...review.errors];let imported=0;
  const run=(await sql`insert into catalog_import_runs(manufacturer_id,source_type,source_name,rows_seen,status) values(${t.tenant_id},${type},${req.body?.source_name||''},${rows.length},'approved') returning *`)[0];
  try{
    for(const r of review.valid_rows){
      const brand=(await sql`insert into brands(manufacturer_id,name,website,active,updated_at) values(${t.tenant_id},${r.brand},${r.brand_website},true,now()) on conflict(manufacturer_id,name) do update set active=true,updated_at=now() returning *`)[0];
      let product=(await sql`select * from products where manufacturer_id=${t.tenant_id} and brand_id=${brand.id} and lower(name)=lower(${r.product_name}) limit 1`)[0];
      if(!product)product=(await sql`insert into products(manufacturer_id,brand_id,name,product_family,category,description,product_url,image_url,positioning,differentiator,source_type,source_url,active,updated_at) values(${t.tenant_id},${brand.id},${r.product_name},${r.product_family},${r.category},${r.description},${r.product_url},${r.image_url},${r.positioning},${r.differentiator},${type},${r.source_url},true,now()) returning *`)[0];
      else await sql`update products set product_family=${r.product_family},category=${r.category},description=${r.description},product_url=${r.product_url},image_url=${r.image_url},positioning=${r.positioning},differentiator=${r.differentiator},source_type=${type},source_url=${r.source_url},active=true,updated_at=now() where id=${product.id}`;
      await sql`insert into product_variants(product_id,sku,variant_name,msrp,map,wholesale,upc,model_number,image_url,product_url,attributes,active,updated_at) values(${product.id},${r.sku},${r.variant_name},${r.msrp},${r.map},${r.wholesale},${r.upc},${r.model_number},${r.image_url},${r.product_url},${sql.json({features:r.features,source:'catalog_import',source_type:type,demo_data:r.demo_data})},true,now()) on conflict(product_id,sku,variant_name) do update set msrp=excluded.msrp,map=excluded.map,wholesale=excluded.wholesale,upc=excluded.upc,model_number=excluded.model_number,image_url=excluded.image_url,product_url=excluded.product_url,attributes=excluded.attributes,active=true,updated_at=now()`;
      const cats=[...new Set([r.category,...r.additional_categories].filter(Boolean))];for(const c of cats)await sql`insert into product_categories(product_id,category) values(${product.id},${c}) on conflict do nothing`;
      for(const code of r.channels.map(x=>x.toLowerCase().replace(/[^a-z0-9]+/g,'_'))){const c=(await sql`select id from channels where code=${code} limit 1`)[0];if(c)await sql`insert into product_channels(product_id,channel_id) values(${product.id},${c.id}) on conflict do nothing`}
      imported++;
    }
    await sql`update catalog_import_runs set rows_imported=${imported},rows_rejected=${errors.length},status='complete',errors=${sql.json(errors)},finished_at=now() where id=${run.id}`;
    return res.status(200).json({version:'9.8.3',status:'IMPORTED',source_type:type,demo_data:type==='demo',rows_seen:rows.length,rows_imported:imported,rows_rejected:errors.length,errors:errors.slice(0,50),interpretation:errors.length?'Approved catalog imported with rejected review rows excluded.':'Approved catalog imported successfully.'});
  }catch(e){console.error('catalog import failed',{message:e?.message||String(e)});await sql`update catalog_import_runs set status='error',errors=${sql.json([{error:'Catalog import failed'}])},finished_at=now() where id=${run.id}`;return res.status(500).json({error:'Catalog import could not be completed'})}
}
