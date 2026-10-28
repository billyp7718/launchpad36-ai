import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES,requireCapability } from './_permissions.js';
import { ensureRetailContextSchema } from './db-init-retail-context.js';

const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const TYPES=new Set(['retail_organization','buyer','product','sku','brand','category','opportunity','distributor','account']);
const STATUSES=new Set(['VERIFIED','USER_ENTERED','MODELED','NEEDS_RESEARCH','STALE','CONFLICTING']);
const bounded=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const capability=req.method==='GET'?CAPABILITIES.APP_READ:CAPABILITIES.APP_WRITE;if(!requireCapability(tenant,res,capability))return;
  const sql=db();await ensureRetailContextSchema(sql);
  try{
    if(req.method==='GET'){
      const organizationId=clean(req.query?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
      const rows=await sql`select * from retail_context_relationships where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} and active=true order by updated_at desc,id desc limit 250`;
      return res.status(200).json({relationships:rows});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const organizationId=clean(req.body?.organization_id,100),subjectType=clean(req.body?.subject_type,60).toLowerCase(),subjectId=clean(req.body?.subject_id,180),relationshipType=clean(req.body?.relationship_type,100).toUpperCase(),objectType=clean(req.body?.object_type,60).toLowerCase(),objectId=clean(req.body?.object_id,180),verificationStatus=clean(req.body?.verification_status||'USER_ENTERED',40).toUpperCase();
    if(!organizationId||!subjectId||!relationshipType||!objectId)return res.status(400).json({error:'organization_id, subject, relationship_type, and object are required'});
    if(!TYPES.has(subjectType)||!TYPES.has(objectType))return res.status(400).json({error:'Unsupported relationship entity type'});
    if(!STATUSES.has(verificationStatus))return res.status(400).json({error:'Unsupported verification status'});
    const organization=(await sql`select id from retail_organizations where id=${organizationId} and active=true limit 1`)[0];if(!organization)return res.status(404).json({error:'Account was not found'});
    const sourceUrl=clean(req.body?.source_url,1200);
    if(verificationStatus==='VERIFIED'&&!sourceUrl)return res.status(400).json({error:'Verified relationships require an attributable source URL'});
    const row=(await sql`insert into retail_context_relationships(manufacturer_id,organization_id,subject_type,subject_id,relationship_type,object_type,object_id,category_scope,valid_from,valid_to,confidence,verification_status,source_url,notes,created_by) values(${tenant.tenant_id},${organizationId},${subjectType},${subjectId},${relationshipType},${objectType},${objectId},${clean(req.body?.category_scope,220)},${req.body?.valid_from||null},${req.body?.valid_to||null},${bounded(req.body?.confidence)},${verificationStatus},${sourceUrl},${clean(req.body?.notes,1200)},${tenant.user_id}) returning *`)[0];
    await sql`insert into retail_context_events(manufacturer_id,organization_id,event_type,source_type,source_url,payload,created_by) values(${tenant.tenant_id},${organizationId},'RELATIONSHIP_RECORDED',${verificationStatus==='USER_ENTERED'?'user':'evidence'},${sourceUrl},${sql.json({relationship_id:row.id,subject_type:subjectType,subject_id:subjectId,relationship_type:relationshipType,object_type:objectType,object_id:objectId,verification_status:verificationStatus,confidence:row.confidence})},${tenant.user_id})`;
    return res.status(201).json({relationship:row});
  }catch(error){
    console.error('retail context relationship failed',{message:error?.message||String(error)});
    return res.status(500).json({error:'Retail context relationship could not be saved'});
  }
}
