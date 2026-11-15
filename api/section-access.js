import { resolveTenant } from './_tenant.js';
import { normalizeApplicationSection } from './_identity.js';

export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const tenant=await resolveTenant(req,res,{enforceWriteCapability:false,requiredSection:null});if(!tenant)return;
 const requested=normalizeApplicationSection(req.query?.section_key);
 if(req.query?.section_key&&!requested)return res.status(400).json({error:'Unknown application section'});
 const sections=tenant.sections||[],allowed=sections.filter(section=>section.granted);
 if(requested&&!allowed.some(section=>section.key===requested))return res.status(403).json({error:'You are not authorized for this application section',code:'SECTION_ACCESS_REQUIRED',required_section:requested});
 res.setHeader('Cache-Control','private, no-store');
 return res.status(200).json({authorized:true,section_key:requested||null,sections,allowed_sections:allowed.map(section=>section.key)});
}
