import { db } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { buildAccountIntelligenceSummary } from './_account-intelligence-summary.js';

const clean=(value,max=180)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});const tenant=await resolveTenant(req,res);if(!tenant)return;const organizationId=clean(req.query?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});const sql=db();res.setHeader('Cache-Control','no-store, max-age=0');
  try{
    const organization=(await sql`select * from retail_organizations where id=${organizationId} and active=true limit 1`)[0];if(!organization)return res.status(404).json({error:'Account was not found'});
    const teamIds=tenant.team_ids||[],admin=canSeeAllTenantData(tenant);
    const [targets,workspaces,buyers,evidence]=await Promise.all([
      sql`select max(fit_score)::int fit_score,max(whitespace_score)::int whitespace_score,string_agg(nullif(notes,''),' | ' order by updated_at desc) notes from manufacturer_account_targets where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} and ${admin}`,
      sql`select * from opportunity_workspaces where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} and (${admin} or owner_user_id=${tenant.user_id} or (visibility='team' and team_id=any(${teamIds}::uuid[])) or (visibility='tenant' and owner_user_id is null and team_id is null)) order by updated_at desc limit 100`,
      sql`select b.* from accounts a join buyers b on b.account_id=a.id where a.organization_id=${organizationId} order by (b.category_verification_status='VERIFIED') desc,b.category_confidence desc,b.identity_confidence desc,b.updated_at desc limit 100`,
      sql`select ce.id,ce.subject_type,ce.evidence_type,ce.payload,ce.observed_at,ce.last_verified_at,ce.confidence,ce.verification_status,es.source_url,es.source_kind,es.publisher from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.organization_id=${organizationId} order by ce.observed_at desc limit 250`
    ]);
    const summary=buildAccountIntelligenceSummary({organization,target:targets[0]||{},workspaces,buyers,evidence});return res.status(200).json({summary,generated_at:new Date().toISOString(),scope:{tenant_id:tenant.tenant_id,private_workspaces:workspaces.length,public_account_intelligence:true}});
  }catch(error){console.error('account intelligence summary failed',{message:error?.message||String(error)});if(error?.code==='42P01'||error?.code==='42703')return res.status(409).json({error:'Required intelligence schema is not initialized',code:'SCHEMA_REQUIRED'});return res.status(500).json({error:'Account Intelligence Summary could not be loaded'});}
}
