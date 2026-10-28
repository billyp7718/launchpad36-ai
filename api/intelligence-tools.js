import { db } from './_db.js';
import { resolveTenant,canSeeAllTenantData } from './_tenant.js';
import { CAPABILITIES,requireCapability } from './_permissions.js';
import { buildAccountIntelligenceSummary } from './_account-intelligence-summary.js';
import { ensureRetailContextSchema } from './db-init-retail-context.js';

const clean=(value,max=180)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const TOOLS=[
  {name:'account_brief',description:'Return a tenant-scoped account intelligence brief with trust/evidence posture.',required:['organization_id']},
  {name:'find_buyer',description:'Return current buyer/category-owner intelligence for one retail organization.',required:['organization_id']},
  {name:'competitive_assortment',description:'Return active competitive products saved for one retail organization.',required:['organization_id']},
  {name:'opportunity_status',description:'Return one tenant-visible opportunity workspace and its current status.',required:['opportunity_id']},
  {name:'revenue_mission',description:'Return one tenant-visible Revenue Mission and linked opportunity stages.',required:['mission_id']}
];

const canAccess=(row,tenant)=>canSeeAllTenantData(tenant)||String(row.owner_user_id||'')===String(tenant.user_id||'')||(row.visibility==='team'&&(tenant.team_ids||[]).includes(String(row.team_id||'')))||(row.visibility==='tenant'&&!row.owner_user_id&&!row.team_id);

async function audit(sql,tenant,tool,{organizationId=null,opportunityId=null,request={},count=0}={}){
  try{await sql`insert into intelligence_tool_access_events(manufacturer_id,actor_user_id,tool_name,organization_id,opportunity_id,request_summary,result_count) values(${tenant.tenant_id},${tenant.user_id},${tool},${organizationId},${opportunityId},${sql.json(request)},${Math.max(0,Number(count)||0)})`}catch(error){console.error('intelligence tool audit failed',{message:error?.message||String(error)})}
}

async function accountBrief(sql,tenant,organizationId){
  const organization=(await sql`select * from retail_organizations where id=${organizationId} and active=true limit 1`)[0];if(!organization)throw Object.assign(new Error('Account was not found'),{status:404});
  const admin=canSeeAllTenantData(tenant),teamIds=tenant.team_ids||[];
  const [targets,workspaces,buyers,evidence]=await Promise.all([
    sql`select max(fit_score)::int fit_score,max(whitespace_score)::int whitespace_score,string_agg(nullif(notes,''),' | ' order by updated_at desc) notes from manufacturer_account_targets where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId}`,
    sql`select * from opportunity_workspaces where manufacturer_id=${tenant.tenant_id} and organization_id=${organizationId} and (${admin} or owner_user_id=${tenant.user_id} or (visibility='team' and team_id=any(${teamIds}::uuid[])) or (visibility='tenant' and owner_user_id is null and team_id is null)) order by updated_at desc limit 100`,
    sql`select b.* from accounts a join buyers b on b.account_id=a.id where a.organization_id=${organizationId} order by (b.category_verification_status='VERIFIED') desc,b.category_confidence desc,b.identity_confidence desc,b.updated_at desc limit 100`,
    sql`select ce.id,ce.subject_type,ce.evidence_type,ce.payload,ce.observed_at,ce.last_verified_at,ce.confidence,ce.verification_status,es.source_url,es.source_kind,es.publisher from commercial_evidence ce join evidence_sources es on es.id=ce.source_id where ce.organization_id=${organizationId} order by ce.observed_at desc limit 250`
  ]);
  return buildAccountIntelligenceSummary({organization,target:targets[0]||{},workspaces,buyers,evidence});
}

export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Read-only endpoint. GET is required'});
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(!requireCapability(tenant,res,CAPABILITIES.APP_READ))return;
  const sql=db();await ensureRetailContextSchema(sql);res.setHeader('Cache-Control','no-store, max-age=0');
  const tool=clean(req.query?.tool,80).toLowerCase();
  if(!tool||tool==='manifest')return res.status(200).json({name:'Launchpad36 Retail Intelligence Tools',version:'1.0',mode:'READ_ONLY',tools:TOOLS,write_actions:false,human_approval_required_for_external_actions:true});
  if(!TOOLS.some(item=>item.name===tool))return res.status(400).json({error:'Unsupported intelligence tool',available_tools:TOOLS.map(item=>item.name)});
  try{
    if(tool==='account_brief'){
      const organizationId=clean(req.query?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
      const result=await accountBrief(sql,tenant,organizationId);await audit(sql,tenant,tool,{organizationId,request:{organization_id:organizationId},count:1});return res.status(200).json({tool,result,read_only:true});
    }
    if(tool==='find_buyer'){
      const organizationId=clean(req.query?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
      const buyers=await sql`select b.id,b.name,b.title,b.department,b.category_scope,b.subcategory_scope,b.buyer_role,b.email,b.phone,b.identity_confidence,b.category_confidence,b.employment_verification_status,b.category_verification_status,b.employment_evidence_url,b.category_evidence_url,b.category_last_verified,b.updated_at from accounts a join buyers b on b.account_id=a.id where a.organization_id=${organizationId} order by (b.category_verification_status='VERIFIED') desc,b.category_confidence desc,b.identity_confidence desc,b.updated_at desc limit 50`;
      await audit(sql,tenant,tool,{organizationId,request:{organization_id:organizationId},count:buyers.length});return res.status(200).json({tool,result:buyers,read_only:true});
    }
    if(tool==='competitive_assortment'){
      const organizationId=clean(req.query?.organization_id,100);if(!organizationId)return res.status(400).json({error:'organization_id is required'});
      const products=await sql`select cp.* from competitive_products cp join accounts a on a.id=cp.account_id where a.organization_id=${organizationId} and cp.active=true order by cp.updated_at desc,cp.brand limit 500`;
      await audit(sql,tenant,tool,{organizationId,request:{organization_id:organizationId},count:products.length});return res.status(200).json({tool,result:products,read_only:true});
    }
    if(tool==='opportunity_status'){
      const opportunityId=clean(req.query?.opportunity_id,100);if(!opportunityId)return res.status(400).json({error:'opportunity_id is required'});
      const row=(await sql`select * from opportunity_workspaces where id=${opportunityId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!row||!canAccess(row,tenant))return res.status(404).json({error:'Opportunity was not found in your private or team scope'});
      await audit(sql,tenant,tool,{organizationId:row.organization_id,opportunityId:row.id,request:{opportunity_id:opportunityId},count:1});return res.status(200).json({tool,result:row,read_only:true});
    }
    if(tool==='revenue_mission'){
      const missionId=clean(req.query?.mission_id,100);if(!missionId)return res.status(400).json({error:'mission_id is required'});
      const mission=(await sql`select * from revenue_missions where id=${missionId} and manufacturer_id=${tenant.tenant_id} limit 1`)[0];if(!mission||!canAccess(mission,tenant))return res.status(404).json({error:'Revenue Mission was not found in your private or team scope'});
      const linked=await sql`select rmo.opportunity_id,rmo.pipeline_stage,rmo.updated_at,ow.organization_id,ow.account_name,ow.next_action from revenue_mission_opportunities rmo join opportunity_workspaces ow on ow.id=rmo.opportunity_id where rmo.mission_id=${mission.id} and ow.manufacturer_id=${tenant.tenant_id} order by rmo.updated_at desc`;
      await audit(sql,tenant,tool,{request:{mission_id:missionId},count:linked.length});return res.status(200).json({tool,result:{mission,linked_opportunities:linked},read_only:true});
    }
  }catch(error){
    console.error('intelligence tool failed',{tool,message:error?.message||String(error)});
    return res.status(error?.status||500).json({error:error?.status?error.message:'Intelligence tool could not be completed'});
  }
}
