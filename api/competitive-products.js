import { db, upsertCompetitiveProduct } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';

const clean=(value,max=300)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const canAccess=(row,tenant)=>canSeeAllTenantData(tenant)||String(row.owner_user_id||'')===String(tenant.user_id||'')||(row.visibility==='team'&&(tenant.team_ids||[]).includes(String(row.team_id||'')))||(row.visibility==='tenant'&&!row.owner_user_id&&!row.team_id);

async function scopedWorkspace(sql,tenant,workspaceId){
  const id=clean(workspaceId,100);if(!id)throw Object.assign(new Error('Opportunity workspace id is required'),{status:400});
  const row=(await sql`select id,organization_id,owner_user_id,team_id,visibility from opportunity_workspaces where id=${id} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];
  if(!row||!canAccess(row,tenant))throw Object.assign(new Error('Opportunity workspace was not found in your private or team scope'),{status:404});return row;
}

async function scopedProduct(sql,tenant,workspaceId,productId){
  const workspace=await scopedWorkspace(sql,tenant,workspaceId),id=clean(productId,100);if(!id)throw Object.assign(new Error('Competitive product id is required'),{status:400});
  const product=(await sql`select cp.* from competitive_products cp join accounts a on a.id=cp.account_id where cp.id=${id} and a.organization_id=${workspace.organization_id} limit 1`)[0];
  if(!product)throw Object.assign(new Error('Competitive product was not found for this opportunity account'),{status:404});return {workspace,product};
}

export default async function handler(req,res){
 try{
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const capability=req.method==='GET'?CAPABILITIES.APP_READ:CAPABILITIES.APP_WRITE;
  if(!requireCapability(tenant,res,capability))return;
  const sql=db();
  if(req.method==='GET'){
    const account=req.query.account_id||null,organization=req.query.organization_id||null;
    const rows=organization ? await sql`select cp.* from competitive_products cp join accounts a on a.id=cp.account_id where a.organization_id=${organization} and cp.active=true order by cp.updated_at desc,cp.brand`
                       : account ? await sql`select * from competitive_products where account_id=${account} and active=true order by updated_at desc,brand`
                       : await sql`select * from competitive_products where active=true order by updated_at desc limit 2000`;
    const products=rows.map(row=>{let research_context={};try{research_context=JSON.parse(row.raw_text||'{}')}catch{}return {...row,research_context,comparison_product_ids:Array.isArray(research_context.comparison_product_ids)?research_context.comparison_product_ids:[]}});
    return res.status(200).json({products});
  }
  if(req.method==='PATCH'){
    const {product}=await scopedProduct(sql,tenant,req.body?.workspace_id,req.body?.id),brand=clean(req.body?.brand,140),name=clean(req.body?.product_name,220),category=clean(req.body?.category,140),priceText=clean(req.body?.price_text,80),availability=clean(req.body?.availability,180),sourceUrl=clean(req.body?.source_url??product.source_url,1000);
    if(!brand||!name)return res.status(400).json({error:'Competitive brand and product name are required'});
    const amount=priceText.replace(/,/g,'').match(/\d+(?:\.\d{1,2})?/),updated=(await sql`update competitive_products set brand=${brand},product_name=${name},category=${category},price_text=${priceText},price_numeric=${amount?Number(amount[0]):0},availability=${availability},source_url=${sourceUrl},evidence_type='manual_correction',verification_status='REVIEW_REQUIRED',last_verified_at=null,updated_at=now() where id=${product.id} returning *`)[0];
    return res.status(200).json({product:updated,verification_reset:true,source_evidence_preserved:true});
  }
  if(req.method==='DELETE'){
    const {product}=await scopedProduct(sql,tenant,req.query?.workspace_id||req.body?.workspace_id,req.query?.id||req.body?.id);
    await sql`update competitive_products set active=false,updated_at=now() where id=${product.id}`;
    return res.status(200).json({removed:true,id:product.id,soft_deleted:true,source_evidence_preserved:true});
  }
  if(req.method==='POST'){
    const body=Array.isArray(req.body)?req.body:[req.body]; const out=[];
    for(const p of body) out.push(await upsertCompetitiveProduct(p||{}));
    return res.status(200).json({products:out});
  }
  return res.status(405).json({error:'Method not allowed'});
 }catch(e){console.error('competitive product operation failed',{message:e?.message||String(e)});return res.status(e?.status||500).json({error:e?.status?e.message:'Competitive product operation could not be completed'})}
}
