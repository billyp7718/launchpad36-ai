import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { appendFieldObservation,evidencePresentation } from './_field-evidence.js';

const clean=(value,max=180)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
  try{
    if(req.method==='GET'){
      const entityType=clean(req.query?.entity_type,80).toLowerCase(),entityId=clean(req.query?.entity_id),fieldName=clean(req.query?.field_name,120),limit=Math.min(Math.max(Number(req.query?.limit)||100,1),500);
      if(!entityType||!entityId)return res.status(400).json({error:'entity_type and entity_id are required'});
      const observations=await sql`select * from entity_field_observations where (manufacturer_id=${tenant.tenant_id} or (manufacturer_id is null and entity_type in('retail_organization','retailer_listing','buyer','buyer_category_relationship'))) and entity_type=${entityType} and entity_id=${entityId} and (${fieldName}='' or field_name=${fieldName}) order by observed_at desc,id desc limit ${limit}`;
      const current=await sql`select * from current_entity_field_values where (scope_key=${String(tenant.tenant_id)} or scope_key='global') and entity_type=${entityType} and entity_id=${entityId} and (${fieldName}='' or field_name=${fieldName}) order by updated_at desc`;
      return res.status(200).json({observations:observations.map(item=>({...item,presentation:evidencePresentation(item.verification_status)})),current:current.map(item=>({...item,presentation:evidencePresentation(item.verification_status)}))});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const result=await sql.begin(transaction=>appendFieldObservation(transaction,tenant,req.body||{}));return res.status(201).json(result);
  }catch(error){console.error('field evidence operation failed',{message:error?.message||String(error)});if(error?.code==='42P01')return res.status(409).json({error:'Intelligence foundation schema is not initialized',code:'SCHEMA_REQUIRED'});return res.status(error?.status||500).json({error:error?.status?error.message:'Field evidence operation failed'});}
}
