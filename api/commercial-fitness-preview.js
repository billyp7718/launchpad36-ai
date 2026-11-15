import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';
import { COMMERCIAL_FITNESS_PREVIEW } from './_commercial-fitness-preview.js';

export default async function handler(req,res){
 const tenant=await resolveTenant(req,res,{requiredSection:'commercial_goods'});if(!tenant)return;
 if(!requireCapability(tenant,res,CAPABILITIES.APP_WRITE))return;
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','private, no-store');
 return res.status(200).json({
  records:COMMERCIAL_FITNESS_PREVIEW,
  count:COMMERCIAL_FITNESS_PREVIEW.length,
  decision_maker_count:COMMERCIAL_FITNESS_PREVIEW.filter(record=>record.decision_maker_name).length,
  researched_at:'2026-11-15T00:00:00.000Z',
  status:'REVIEW_REQUIRED',
  message:'Review this source-backed Fitness account preview before importing. No records have been saved.',
  contact_policy:'Only publicly documented professional information is included. No personal email address or telephone number is inferred.'
 });
}
