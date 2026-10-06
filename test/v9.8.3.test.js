import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { normalizeFirecrawlSearch, filterCatalogCandidates, extractCatalogPages } from '../api/catalog-website.js';
import { validateCatalogRows } from '../api/catalog-import.js';
import { AURELIUS_AUDIO_DEMO } from '../api/demo-catalog.js';
import { validateCommercialObservation, livingHash, refreshTier } from '../api/_living-intelligence.js';
import { verifyFirecrawlSignature, monitorJudgmentMeaningful, shouldProcessMonitorPage } from '../api/firecrawl-monitor-webhook.js';
import { normalizeOfferings, focusTokens } from '../api/living-intelligence-refresh.js';
import { applyAccountScope, calculateMarketOpportunity, calculateMultiRouteMarketOpportunity, categoryConcepts, compareAccountRank, evaluateProductAccountFit } from '../api/market-opportunity.js';
import { buyerProfiles, evidenceProfiles } from '../api/_account-fit.js';
import { domainFromWebsite, normalizePublicUrl } from '../api/_url.js';
import { buyerCategorySearchTerms, normalizeOpenAIProducts, normalizeOpenAIResearch, normalizeOpenAIRetailers, responseOutputText, responseWebSources, searchOpenAIBuyers } from '../api/_openai-research.js';
import { detectBuyerRelationshipChange, relationshipDisposition } from '../api/_buyer-relationships.js';
import { discoveredUrls } from '../api/_acquisition.js';
import { RETAIL_DISTRIBUTORS } from '../api/retail-distributor-seed.js';
import { reportRecipients } from '../api/market-report-email.js';
import { generateMarketAnalysisPdf,prepareMarketReportAttachment,reportFilename,reportSnapshotHash,validateReportSnapshot } from '../api/_market-report.js';
import { createReportSnapshot,loadReportSnapshot } from '../api/market-report-snapshots.js';
import { calculateSkuAnnualRevenue } from '../api/opportunities.js';
import { CAPABILITIES, ROLES, canonicalRole, hasCapability, managerMayGrant, requireCapability, roleCapabilities, teamScopeIncludes } from '../api/_permissions.js';
import { canSeeAllTenantData } from '../api/_tenant.js';
import { isPermanentAdminEmail, PERMANENT_ADMIN_EMAILS } from '../api/_identity.js';
import { safeAuditValue } from '../api/_permission-audit.js';
import { calculateTrustScore, trustLevel } from '../api/_trust-score.js';
import { evaluateProductIdentityMatch, normalizeIdentifier } from '../api/_product-identity.js';
import { evidencePresentation, shouldPromoteObservation } from '../api/_field-evidence.js';
import { INTELLIGENCE_FOUNDATION_SQL } from '../api/db-init-intelligence-foundation.js';
import { buildAccountIntelligenceSummary, inStoreCoverage, selectCategoryOwner } from '../api/_account-intelligence-summary.js';
import { REVENUE_MISSION_SQL } from '../api/db-init-revenue-missions.js';
import { calculateMissionMetrics, evaluateMissionOpportunity, missionNextActions, normalizePipelineStage } from '../api/_revenue-missions.js';

test('central authorization matrix grants only the intended role capabilities',()=>{
  const expected={
    ADMIN:['APP_READ','APP_WRITE','DEEP_SEARCH','DEEP_MARKET_ANALYSIS','USER_ADMIN_TENANT','USER_ADMIN_TEAM','TENANT_SECURITY','SEE_ALL_BUSINESS_DATA'],
    MANAGER:['APP_READ','APP_WRITE','DEEP_SEARCH','DEEP_MARKET_ANALYSIS','USER_ADMIN_TEAM','SEE_ALL_BUSINESS_DATA'],
    MEMBER:['APP_READ','APP_WRITE','DEEP_SEARCH'],
    VIEWER:['APP_READ']
  };
  for(const role of Object.values(ROLES))assert.deepEqual(new Set(roleCapabilities(role)),new Set(expected[role]),role);
  assert.equal(canonicalRole('owner'),ROLES.ADMIN);
  assert.equal(hasCapability(ROLES.MEMBER,CAPABILITIES.DEEP_MARKET_ANALYSIS),false);
  assert.equal(hasCapability(ROLES.VIEWER,CAPABILITIES.DEEP_SEARCH),false);
  assert.equal(hasCapability(ROLES.VIEWER,CAPABILITIES.DEEP_MARKET_ANALYSIS),false);
  assert.equal(hasCapability(ROLES.VIEWER,CAPABILITIES.APP_WRITE),false);
});

test('manager administration cannot escape team scope or escalate roles',()=>{
  assert.equal(teamScopeIncludes(['team-a'],['team-a']),true);
  assert.equal(teamScopeIncludes(['team-a'],['team-b']),false);
  assert.equal(managerMayGrant(ROLES.ADMIN),false);
  assert.equal(managerMayGrant(ROLES.MANAGER),false);
  assert.equal(managerMayGrant(ROLES.MEMBER),true);
  assert.equal(managerMayGrant(ROLES.VIEWER),true);
});

test('role controls persist canonical roles instead of visually reverting to viewer',async()=>{
  const ui=await readFile(new URL('../multi-user-ui.js',import.meta.url),'utf8');
  assert.match(ui,/current=String\(member\.role\|\|'member'\)\.toLowerCase\(\)/);
  assert.match(ui,/current===r\?'selected'/);
  assert.match(ui,/action:'set_role'/);
  assert.match(ui,/d\.permissions\?\.role/);
});

test('workspace administration opens the existing application modal',async()=>{
  const ui=await readFile(new URL('../multi-user-ui.js',import.meta.url),'utf8');
  assert.match(ui,/getElementById\('modalCard'\)/);
  assert.match(ui,/getElementById\('modal'\)/);
  assert.match(ui,/dialog\.classList\.add\('show'\)/);
  assert.match(ui,/showWorkspaceModal\(body\)/);
  assert.doesNotMatch(ui,/typeof modal==='function'/);
  assert.doesNotMatch(ui,/document\.body\.appendChild\(host\)/);
});

test('Retail Revenue hero renders opaque and refreshes after deferred UI enhancement',async()=>{
  const ui=await readFile(new URL('../executive-workflow-ui.js',import.meta.url),'utf8');
  assert.match(ui,/hero l36-revenue-hero/);
  assert.match(ui,/\.l36-revenue-hero\{opacity:1;filter:none;background-color:#071d3e/);
  assert.match(ui,/isolation:isolate;contain:paint/);
  assert.match(ui,/requestAnimationFrame\(\(\)=>requestAnimationFrame/);
  assert.match(ui,/state\.screen==='Dashboard'.*render\(\)/);
});

test('designated permanent administrator cannot be downgraded',async()=>{
  const [identity,migration,teamAdmin,ui]=await Promise.all([
    readFile(new URL('../api/_identity.js',import.meta.url),'utf8'),
    readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8'),
    readFile(new URL('../api/team-admin.js',import.meta.url),'utf8'),
    readFile(new URL('../multi-user-ui.js',import.meta.url),'utf8')
  ]);
  assert.deepEqual(PERMANENT_ADMIN_EMAILS,['wtpantaleo@gmail.com','billp@launchpad36.com']);
  assert.equal(isPermanentAdminEmail(' WTPantaleo@gmail.com '),true);
  assert.equal(isPermanentAdminEmail(' BILLP@Launchpad36.com '),true);
  assert.equal(isPermanentAdminEmail('another@example.com'),false);
  assert.match(identity,/set role='admin',updated_at=now\(\).*PERMANENT_ADMIN_EMAIL/);
  assert.match(migration,/lower\(email\) in\('wtpantaleo@gmail\.com','billp@launchpad36\.com'\).*lower\(role\)<>'admin'/);
  assert.match(teamAdmin,/isPermanentAdminEmail\(requestedTarget\.email\).*role!==ROLES\.ADMIN/);
  assert.match(teamAdmin,/isPermanentAdminEmail\(email\)\?ROLES\.ADMIN/);
  assert.match(ui,/PERMANENT ADMIN/);
});

test('Evidence Explorer and Health Check authorize the current database role',async()=>{
  const [tenant,session,evidenceStatus,systemStatus]=await Promise.all([
    readFile(new URL('../api/_tenant.js',import.meta.url),'utf8'),
    readFile(new URL('../api/auth-session.js',import.meta.url),'utf8'),
    readFile(new URL('../api/living-intelligence-status.js',import.meta.url),'utf8'),
    readFile(new URL('../api/system-status.js',import.meta.url),'utf8')
  ]);
  assert.match(tenant,/export async function resolveInternalTenant/);
  assert.match(tenant,/hasCapability\(tenant,CAPABILITIES\.TENANT_SECURITY\)/);
  assert.match(session,/createSessionCookie\(\{role:permissions\.role/);
  for(const source of [evidenceStatus,systemStatus]){
    assert.match(source,/await resolveInternalTenant\(req,\s*res\)/);
    assert.doesNotMatch(source,/requireInternal/);
  }
});

test('Opportunity Alerts UI is hidden while backend alert processing remains available',async()=>{
  const [shell,route,refresh]=await Promise.all([
    readFile(new URL('../api/app-shell.js',import.meta.url),'utf8'),
    readFile(new URL('../api/opportunity-alerts.js',import.meta.url),'utf8'),
    readFile(new URL('../api/_opportunity-alerts.js',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(shell,/opportunity-alerts-ui\.js/);
  assert.match(route,/scanOpportunityAlerts/);
  assert.match(refresh,/opportunity_alerts/);
});

test('permission audit migration is additive, idempotent and append-only',async()=>{
  const [identity,migration]=await Promise.all([readFile(new URL('../api/_identity.js',import.meta.url),'utf8'),readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8')]);
  for(const source of [identity,migration]){
    assert.match(source,/create table if not exists permission_audit_events/);
    assert.match(source,/permission_audit_tenant_time_idx/);
    assert.match(source,/permission_audit_actor_idx/);
    assert.match(source,/permission_audit_target_idx/);
    assert.match(source,/permission_audit_events_immutable/);
    assert.match(source,/before update or delete on permission_audit_events/);
    assert.doesNotMatch(source,/drop\s+table\s+(?:if exists\s+)?permission_audit_events|truncate\s+permission_audit_events|delete\s+from\s+permission_audit_events/i);
  }
});

test('permission audit payloads redact credentials and retain only safe context',()=>{
  const safe=safeAuditValue({role:'ADMIN',password:'bad',password_hash:'bad',reset_token:'bad',authorization:'bad',cookie:'bad',api_key:'bad',nested:{team:'Sales',session_token:'bad'}});
  assert.deepEqual(safe,{role:'ADMIN',nested:{team:'Sales'}});
  assert.doesNotMatch(JSON.stringify(safe),/password|token|authorization|cookie|api_key|bad/i);
});

test('permission audit access is tenant scoped and Managers are team scoped',async()=>{
  const source=await readFile(new URL('../api/permission-audit.js',import.meta.url),'utf8');
  assert.match(source,/pae\.manufacturer_id=\$\{tenant\.tenant_id\}/);
  assert.match(source,/pae\.target_team_id=any\(\$\{teamIds\}::uuid\[\]\)/);
  assert.match(source,/mtm\.member_id=pae\.target_user_id/);
  assert.match(source,/pae\.actor_user_id=\$\{tenant\.user_id\}/);
  assert.match(source,/Role cannot view permission audit records/);
  assert.match(source,/Permission Audit Log is available only to Administrators and Managers/);
  assert.match(source,/Permission audit records are append-only/);
  assert.doesNotMatch(source,/update permission_audit_events|delete from permission_audit_events/i);
});

test('user administration audits successful and denied privilege operations',async()=>{
  const [source,tenantSource]=await Promise.all([readFile(new URL('../api/team-admin.js',import.meta.url),'utf8'),readFile(new URL('../api/_tenant.js',import.meta.url),'utf8')]);
  for(const action of ['create_user','set_role','assign_team','remove_team','set_active','reset_password'])assert.match(source,new RegExp(`action==='${action}'`));
  for(const marker of ['Manager attempted to update a user outside authorized teams','Manager attempted cross-team or privileged-user administration','Manager cannot grant','Permanent Administrator cannot be downgraded','Actor cannot administer the requested team','Role has no user administration capability'])assert.match(source,new RegExp(marker));
  assert.match(source,/result:'SUCCESS'/);assert.match(source,/result:'DENIED'/);assert.match(source,/result:'FAILED'/);
  assert.match(source,/previous_value:/);assert.match(source,/new_value:/);
  assert.match(source,/Target user is outside this tenant/);
  assert.match(source,/resolveTenant\(req,res,\{enforceWriteCapability:false\}\)/);
  assert.match(tenantSource,/enforceWriteCapability=true/);
  assert.doesNotMatch(source,/target_user:requestedTarget\|\|\{id:memberId\}/);
  assert.doesNotMatch(source,/target_team:targetTeam\|\|\{id:teamId\}/);
});

test('Admin and Manager user administration exposes permission audit filters',async()=>{
  const ui=await readFile(new URL('../multi-user-ui.js',import.meta.url),'utf8');
  for(const marker of ['Permission Audit Log','paDateFrom','paDateTo','paActor','paTarget','paTeam','paAction','paResult','/api/permission-audit'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/Managers see only events within their authorized teams/);
  assert.match(ui,/auditValue\(event\.previous_value\)/);assert.match(ui,/auditValue\(event\.new_value\)/);
});

test('tenant-private portfolio and account analyses are team scoped while public intelligence stays shared',async()=>{
  const [identity,migration,brands,portfolio,products,overlays,opportunities,market,scenarios,catalogImport,phase2,universe,buyers]=await Promise.all([
    readFile(new URL('../api/_identity.js',import.meta.url),'utf8'),readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8'),readFile(new URL('../api/brands.js',import.meta.url),'utf8'),readFile(new URL('../api/portfolio.js',import.meta.url),'utf8'),readFile(new URL('../api/products.js',import.meta.url),'utf8'),readFile(new URL('../api/account-overlays.js',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8'),readFile(new URL('../api/market-opportunity.js',import.meta.url),'utf8'),readFile(new URL('../api/market-scenarios.js',import.meta.url),'utf8'),readFile(new URL('../api/catalog-import.js',import.meta.url),'utf8'),readFile(new URL('../phase2-tenancy-ui.js',import.meta.url),'utf8'),readFile(new URL('../api/account-universe.js',import.meta.url),'utf8'),readFile(new URL('../api/buyers.js',import.meta.url),'utf8')
  ]);
  assert.equal(canSeeAllTenantData({role:'ADMIN'}),true);assert.equal(canSeeAllTenantData({role:'MANAGER'}),false);
  for(const source of [identity,migration])for(const marker of ['brands add column if not exists owner_user_id','brands add column if not exists team_id','brands add column if not exists visibility','brands_scope_idx'])assert.match(source,new RegExp(marker));
  for(const source of [brands,portfolio,products,overlays]){assert.match(source,/owner_user_id/);assert.match(source,/visibility='team'/);assert.match(source,/team_id=any/)}
  assert.match(phase2,/Brand sharing/);assert.match(phase2,/Brands are private by default/);assert.match(phase2,/current=mine\.visibility\|\|'private'/);
  for(const source of [identity,migration])for(const marker of ['opportunity_workspaces add column if not exists owner_user_id','opportunity_workspaces add column if not exists team_id','opportunity_workspaces add column if not exists visibility','market_opportunity_scenarios add column if not exists owner_user_id'])assert.match(source,new RegExp(marker));
  assert.match(opportunities,/canAccess\(existing,tenant\)/);assert.match(opportunities,/owner_user_id,visibility/);assert.match(market,/scope=\$\{scopeKey\}/);assert.match(market,/owner_user_id,visibility/);assert.match(scenarios,/canAccess\(row,tenant\)/);
  assert.match(catalogImport,/outside your private or team scope/);assert.match(catalogImport,/owner_user_id,visibility/);
  assert.match(universe,/retail_organizations/);assert.doesNotMatch(universe,/owner_user_id/);
  assert.match(buyers,/select b\.\*/);assert.doesNotMatch(buyers,/visibility='team'/);
  assert.doesNotMatch(migration,/drop\s+(column|table)|truncate|delete\s+from\s+(brands|products|manufacturer_members|tenant_account_overlays)/i);
});

test('brand sharing loads every active tenant team for Admin and refreshes the modal dropdown',async()=>{
  const [session,ui,brands]=await Promise.all([readFile(new URL('../api/auth-session.js',import.meta.url),'utf8'),readFile(new URL('../phase2-tenancy-ui.js',import.meta.url),'utf8'),readFile(new URL('../api/brands.js',import.meta.url),'utf8')]);
  assert.match(session,/permissions\.can_administer_tenant_users/);assert.match(session,/manufacturer_id=\$\{member\.manufacturer_id\} and active=true/);assert.match(session,/:await memberTeams\(member\.id,sql\)/);
  for(const marker of ['refreshTeamSelect','/api/auth-session','brTeam'])assert.match(ui,new RegExp(marker));
  assert.ok(ui.includes('teamOptions(brand.team_id)'));
  assert.ok(ui.includes("refreshTeamSelect('brTeam'"));
  assert.match(brands,/manufacturer_id=\$\{tenant\.tenant_id\} and active=true/);assert.match(brands,/Team is not part of this workspace/);
});

test('restricted direct API capability checks fail with 403',()=>{
  const denied=[];const response={status(code){denied.push(code);return this},json(payload){denied.push(payload);return this}};
  assert.equal(requireCapability({role:ROLES.MEMBER},response,CAPABILITIES.DEEP_MARKET_ANALYSIS),false);
  assert.equal(requireCapability({role:ROLES.VIEWER},response,CAPABILITIES.DEEP_SEARCH),false);
  assert.equal(requireCapability({role:ROLES.VIEWER},response,CAPABILITIES.DEEP_MARKET_ANALYSIS),false);
  assert.deepEqual(denied.filter(value=>value===403),[403,403,403]);
  assert.ok(denied.filter(value=>value?.code==='FORBIDDEN').every(value=>value.required_capability));
});

test('deep-search and deep-market entry points enforce capabilities server-side',async()=>{
  const deepSearchFiles=['account-research.js','buyer-deep-search.js','buyer-intelligence.js','buyer-research-resilient.js','decision-makers.js'];
  for(const file of deepSearchFiles){const source=await readFile(new URL(`../api/${file}`,import.meta.url),'utf8');assert.match(source,/CAPABILITIES\.DEEP_SEARCH/,file)}
  const [market,research,ui]=await Promise.all([readFile(new URL('../api/market-opportunity.js',import.meta.url),'utf8'),readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  assert.match(market,/analysis_mode.*deep_market/);assert.match(market,/CAPABILITIES\.DEEP_MARKET_ANALYSIS/);
  assert.match(research,/analysis_mode.*deep_market/);assert.match(research,/CAPABILITIES\.DEEP_MARKET_ANALYSIS/);
  assert.match(ui,/analysis_mode:'deep_market'/);assert.match(ui,/data-capability="DEEP_MARKET_ANALYSIS"/);assert.match(ui,/data-capability="DEEP_SEARCH"/);assert.match(ui,/VIEWER_MUTATION/);assert.match(ui,/Viewer access is read-only/);
});

test('role migration is additive, idempotent, and does not reset users or sessions',async()=>{
  const migration=await readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8');
  assert.match(migration,/set role='admin' where lower\(role\)='owner'/);
  assert.doesNotMatch(migration,/drop\s+(table|column)|truncate|delete\s+from\s+manufacturer_members|update\s+manufacturer_members\s+set\s+password_hash/i);
});

test('public browser and share metadata use the version-independent product name',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8'),title='Launchpad36 Commercial Intelligence';
  assert.match(ui,new RegExp(`<title>${title}</title>`));
  assert.match(ui,new RegExp(`<meta property="og:title" content="${title}">`));
  assert.match(ui,new RegExp(`<meta name="twitter:title" content="${title}">`));
  const head=ui.slice(0,ui.indexOf('</head>'));
  assert.doesNotMatch(head,/V\d+(?:\.\d+)+|Living Commercial Intelligence/);
});

test('market report email normalizes and limits recipient addresses',()=>{
  assert.deepEqual(reportRecipients('A@Example.com; b@example.com, a@example.com'),['a@example.com','b@example.com']);
  assert.equal(reportRecipients(Array.from({length:20},(_,i)=>`x${i}@example.com`).join(',')).length,10);
});

const reportFixture=(accountCount=2)=>({title:'Full Market Analysis - Café & Audio™',brand:'Aurelius Audio',generated_at:'2026-09-27T12:00:00.000Z',executive_summary:'A complete multi-account market analysis.',recommendations:'Validate evidence before outreach.',summary:{base_manufacturer_revenue:250000,low_manufacturer_revenue:162500,high_manufacturer_revenue:337500,evidence_backed_manufacturer_revenue:90000},assumptions:{route_to_market:'retail',annual_units_per_location:12,distribution_probability:25,portfolio_overlap_discount:10,provenance:'USER_PROVIDED'},warnings:['Modeled opportunity is not verified retailer sales.'],selected_products:[{brand_name:'Aurelius Audio',name:'Élan Soundbar',product_family:'Home Theater',category:'Audio',skus:[{sku:'AA-É100'},{sku:'AA-É200'}]},{brand_name:'Aurelius Audio',name:'Verona Speaker',category:'Speakers',skus:[{sku:'AA-V300'}]}],accounts:Array.from({length:accountCount},(_,index)=>({name:`Retailer ${index+1} & Co.`,domain:`retailer${index+1}.example`,annual_opportunity:125000/(index+1),fit_score:90-index,evidence_status:index%2?'UNCONFIRMED':'VERIFIED',confidence:index%2?40:90,last_verified_at:index%2?null:'2026-09-20',route_to_market:'retail',channel_findings:index%2?'Needs confirmation':'In-store and online',sku_details:[{brand_name:'Aurelius Audio',product_name:'Élan Soundbar',sku:'AA-É100',monthly_units_per_store:2,retail_price:499.99,wholesale_price:300,channel:'In store + online',annual_opportunity:7200,evidence_sources:[{url:`https://retailer${index+1}.example/audio`,verification_status:index%2?'UNKNOWN':'VERIFIED'}]},{brand_name:'Aurelius Audio',product_name:'Verona Speaker',sku:'AA-V300',monthly_units_per_store:1,retail_price:999.99,wholesale_price:600,channel:'Online',annual_opportunity:7200}],competitive_assortment:[{brand:'Example',name:'Competing Soundbar',price_text:'$399.99',in_store:true,online:true,verification_status:'VERIFIED',source_url:`https://retailer${index+1}.example/competitor`}],buyers:index%3?[{name:'Jamie Merchant',title:'Category Manager',department:index%2?'Unconfirmed':'Consumer Electronics',category_scope:index%2?'Unconfirmed':'Audio',buyer_role:'CATEGORY_OWNER',identity_confidence:88,category_confidence:index%2?0:84,employment_verification_status:'VERIFIED',category_verification_status:index%2?'UNCONFIRMED':'VERIFIED',source_url:`https://retailer${index+1}.example/leadership`}]:[]}))});

test('Full Market Analysis PDF supports multi-account, multi-SKU, long and optional-buyer reports',async()=>{
  const snapshot=reportFixture(55),pdf=await generateMarketAnalysisPdf(snapshot);
  assert.ok(Buffer.isBuffer(pdf));assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(pdf.length>20000);
  assert.equal(validateReportSnapshot(snapshot).accounts.length,55);
  assert.equal(reportFilename('Café & Audio™','2026-09-27T12:00:00Z'),'Launchpad36_Full_Market_Analysis_Cafe_AudioTM_2026-09-27.pdf');
});

test('PDF download and retained backend email infrastructure use saved snapshots and the shared generator',async()=>{
  const [ui,download,email,snapshots]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/market-report-pdf.js',import.meta.url),'utf8'),readFile(new URL('../api/market-report-email.js',import.meta.url),'utf8'),readFile(new URL('../api/market-report-snapshots.js',import.meta.url),'utf8')]);
  for(const source of [download,email]){assert.match(source,/loadReportSnapshot/);assert.match(source,/snapshot_id|snapshotId/)}
  assert.match(download,/generateMarketAnalysisPdf/);assert.match(email,/prepareMarketReportAttachment/);assert.match(ui,/ensureMarketReportSnapshot/);assert.match(ui,/market-report-pdf\?snapshot_id=/);assert.match(snapshots,/content_hash/);
  const fixture=reportFixture(),html='<!doctype html><html><body>'+('Original email body '.repeat(10))+'</body></html>',hash=reportSnapshotHash(fixture,html);assert.equal(hash,reportSnapshotHash(fixture,html));assert.notEqual(hash,reportSnapshotHash({...fixture,title:'Changed'},html));
});

test('Full Market Analysis UI downloads through a snapshot and opens a manual-attachment email draft',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8'),calls=[],snapshotId='11111111-1111-1111-1111-111111111111',elements={downloadPdfBtn:{disabled:false,textContent:'Download PDF'},openEmailAppBtn:{disabled:false,textContent:'Open Email App'},reportActionError:{style:{},textContent:''}},location={href:''};
  const extract=(start,end)=>ui.slice(ui.indexOf(start),ui.indexOf(end,ui.indexOf(start)));
  const context=createContext({Blob,Response,encodeURIComponent,JSON,String,Error,console,setTimeout,clearTimeout,marketReportSnapshotCache:null,marketReportSnapshotPayload:()=>({title:'Full Market Analysis',brand:'Aurelius Audio',email_message:''}),buildMarketReportHtml:()=>'<html><body>Existing Full Market Analysis email HTML</body></html>',api:async(url,options={})=>{calls.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});if(url==='/api/market-report-snapshots')return {snapshot:{id:snapshotId,filename:'Launchpad36_Full_Market_Analysis_Aurelius_Audio_2026-09-28.pdf'}};throw new Error(`Unexpected API ${url}`)},fetch:async(url,options={})=>{calls.push({url,method:options.method||'GET'});return new Response(new Blob(['%PDF-1.4'],{type:'application/pdf'}),{status:200,headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="Launchpad36_Full_Market_Analysis_Aurelius_Audio_2026-09-28.pdf"'}})},$:id=>elements[id]||null,responseErrorMessage:(payload,status,fallback)=>payload?.error||`${fallback} (HTTP ${status})`,showMarketReportError:error=>{throw error},reportValue:id=>id==='reportTo'?'authorized@example.com':id==='reportMessage'?'Please review the analysis.':id==='reportSummary'?'Executive summary':id==='reportRecommendations'?'Recommendations':'Launchpad36 Market Analysis',toast:()=>{},document:{createElement:()=>({click(){}})},URL:{createObjectURL:()=> 'blob:report',revokeObjectURL:()=>{}},location,state:{marketOpportunity:{selected_products:[{brand_name:'Aurelius Audio',name:'Elan Soundbar'}]}},marketSummary:()=>({target_account_count:2,base_manufacturer_revenue:250000}),fmtMoney:value=>`$${value}`});
  runInContext(`let marketReportSnapshotCache=null;${extract('async function ensureMarketReportSnapshot','function refreshMarketReportPreview')}${extract('async function downloadMarketReportPdf','function openMarketReportEmailApp')}${extract('function openMarketReportEmailApp','function channel')}globalThis.run=async()=>{await downloadMarketReportPdf();openMarketReportEmailApp()}`,context);
  await context.run();
  assert.deepEqual(calls.map(call=>[call.method,call.url]),[['POST','/api/market-report-snapshots'],['GET',`/api/market-report-pdf?snapshot_id=${snapshotId}`]]);
  assert.equal((calls.filter(call=>call.url==='/api/market-report-snapshots')).length,1);assert.doesNotMatch(JSON.stringify(calls),/market-report-email/);
  assert.match(decodeURIComponent(location.href),/^mailto:authorized@example\.com\?/);assert.match(decodeURIComponent(location.href),/Please attach it to this email before sending\./);
  assert.match(ui,/download\.addEventListener\('click',downloadMarketReportPdf\)/);assert.match(ui,/email\.addEventListener\('click',openMarketReportEmailApp\)/);
  for(const legacy of ['Download HTML','Download CSV','sendMarketReport()','id="sendReportBtn"'])assert.doesNotMatch(ui,new RegExp(legacy.replace(/[()]/g,'\\$&')));
  assert.match(ui,/Open Email App/);assert.match(ui,/The complete Full Market Analysis PDF was downloaded separately\./);assert.doesNotMatch(ui,/Download and attach the full HTML or CSV report/);
});

test('Full Market Analysis snapshot tolerates an unassigned buyer without hiding malformed buyer data',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8'),start=ui.indexOf('function marketReportBuyers'),end=ui.indexOf('function marketReportSnapshotPayload',start),context=createContext({Error,String});
  runInContext(`${ui.slice(start,end)}globalThis.marketReportBuyers=marketReportBuyers`,context);
  const buyer={id:'buyer-1',name:'Jamie Merchant'};
  assert.deepEqual(Array.from(context.marketReportBuyers(undefined,[buyer,buyer])),[buyer]);
  assert.throws(()=>context.marketReportBuyers(undefined,[{}]),/without an id or name/);
  assert.throws(()=>context.marketReportBuyers(undefined,{}),/must be an array/);
});

test('production-scale Market Opportunity resolves five selected products and exports 215 accounts over HTTP',async t=>{
  const products=Array.from({length:5},(_,index)=>({id:`ergo-${index+1}`,brand_name:'ErgoAV',name:`ErgoAV Product ${index+1}`,product_family:'Mounting Solutions',category:'Consumer Electronics',variants:[{sku:`ERGO-${index+1}`,msrp:199.99+index,wholesale:119.99+index}]}));
  const accountOpportunities=Array.from({length:215},(_,index)=>({organization_id:`org-${index+1}`,name:`Account ${index+1}`,domain:`account${index+1}.example`,base_manufacturer_revenue:index===0?32116101:0,fit_score:90-(index%20),fit_reason:'Category and channel fit',evidence_status:'INSUFFICIENT',verification_status:'UNCONFIRMED',product_contributions:products.map(product=>({product_id:product.id,brand_name:product.brand_name,product_name:product.name,sku:product.variants[0].sku,base_manufacturer_revenue:1000,monthly_sales_volume:0})),buyers:index%3?[{id:`buyer-${index}`,name:`Buyer ${index}`,title:'Merchant'}]:[]}));
  const marketOpportunity={summary:{selected_product_count:5,target_account_count:215,base_manufacturer_revenue:32116101,verified_account_count:0},assumptions:{route_to_market:'retail'},account_opportunities:accountOpportunities,warnings:[]};
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8'),start=ui.indexOf('function marketReportSelectedProducts'),end=ui.indexOf('function marketReportSnapshotPayload',start),context=createContext({state:{marketOpportunity,portfolio:{products}},Error,String,Number,Array,Set});
  runInContext(`${ui.slice(start,end)}globalThis.resolveProducts=()=>marketReportSelectedProducts(state.marketOpportunity)`,context);
  const resolved=Array.from(context.resolveProducts());assert.equal(resolved.length,5);assert.deepEqual(resolved.map(product=>product.name),products.map(product=>product.name));
  const snapshot={...reportFixture(215),brand:'ErgoAV',summary:marketOpportunity.summary,selected_products:products.map(product=>({...product,skus:product.variants})),accounts:accountOpportunities.map((account,index)=>({name:account.name,domain:account.domain,annual_opportunity:index===0?32116101:0,fit_score:account.fit_score,fit_reason:account.fit_reason,evidence_status:'INSUFFICIENT',verification_status:'UNCONFIRMED',channel_findings:'Needs confirmation',sku_details:account.product_contributions,buyers:account.buyers}))},email_html=`<!doctype html><html><body>${'Complete account analysis. '.repeat(24000)}</body></html>`;
  assert.ok(Buffer.byteLength(email_html)>500000);assert.equal(snapshot.selected_products.length,5);assert.equal(snapshot.accounts.length,215);
  let saved=null;const sql=async(strings,...values)=>{const query=strings.join('?');if(query.includes('select id,title'))return saved?[saved]:[];if(query.includes('insert into market_analysis_report_snapshots')){saved={id:'22222222-2222-2222-2222-222222222222',title:values[1],brand_name:values[2],analysis_date:values[3],filename:values[4],content_hash:values[5],report_snapshot:values[6],email_html:values[7],created_at:new Date().toISOString()};return [saved]}throw new Error(`Unexpected SQL: ${query}`)};sql.json=value=>value;
  const server=createServer(async(req,res)=>{try{if(req.method==='POST'&&req.url==='/api/market-report-snapshots'){let raw='';for await(const chunk of req)raw+=chunk;const row=await createReportSnapshot(sql,'tenant-1',JSON.parse(raw));res.writeHead(201,{'content-type':'application/json'}).end(JSON.stringify({snapshot:row}));return}if(req.method==='GET'&&req.url?.startsWith('/api/market-report-pdf')){const id=new URL(req.url,'http://localhost').searchParams.get('snapshot_id'),row=await loadReportSnapshot(sql,'tenant-1',id);const pdf=await generateMarketAnalysisPdf(row.report_snapshot);res.writeHead(200,{'content-type':'application/pdf','content-disposition':`attachment; filename="${row.filename}"`}).end(pdf);return}res.writeHead(404).end()}catch(error){res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:error.message}))}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
  const postBody={snapshot,email_html},post=await fetch(`${base}/api/market-report-snapshots`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(postBody)});assert.equal(post.status,201);const created=await post.json();assert.equal(created.snapshot.id,saved.id);assert.equal(saved.report_snapshot.selected_products.length,5);assert.equal(saved.report_snapshot.accounts.length,215);
  const pdfResponse=await fetch(`${base}/api/market-report-pdf?snapshot_id=${created.snapshot.id}`);assert.equal(pdfResponse.status,200);assert.equal(pdfResponse.headers.get('content-type'),'application/pdf');const pdf=Buffer.from(await pdfResponse.arrayBuffer());assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(pdf.length>20000);
});

test('market report validation identifies the missing snapshot component',()=>{
  assert.throws(()=>validateReportSnapshot({selected_products:[],accounts:[{}]}),/PDF snapshot contains no selected products/);
  assert.throws(()=>validateReportSnapshot({selected_products:[{name:'ErgoAV Product'}],accounts:[]}),/PDF snapshot contains no included accounts/);
});

test('download-only account briefs create an immutable snapshot without a legacy email body',async()=>{
  let inserted=null;const sql=async(strings,...values)=>{const query=strings.join('?');if(query.includes('select id,title'))return [];if(query.includes('insert into market_analysis_report_snapshots')){inserted={id:'33333333-3333-3333-3333-333333333333',title:values[1],brand_name:values[2],analysis_date:values[3],filename:values[4],content_hash:values[5],report_snapshot:values[6],email_html:values[7],created_at:new Date().toISOString()};return [inserted]}throw new Error(`Unexpected SQL: ${query}`)};sql.json=value=>value;
  const row=await createReportSnapshot(sql,'tenant-1',{snapshot:reportFixture(1),email_html:''});
  assert.equal(row.id,inserted.id);assert.match(inserted.email_html,/authenticated PDF download/);assert.ok(inserted.email_html.length>=100);assert.match(inserted.email_html,/not verified retailer sales/);
});

test('email attachment preparation fails closed when PDF generation or size validation fails',async()=>{
  await assert.rejects(()=>prepareMarketReportAttachment(reportFixture(),async()=>{throw new Error('renderer failed')}),error=>error.code==='PDF_GENERATION_FAILED'&&/no email was sent/i.test(error.message));
  await assert.rejects(()=>prepareMarketReportAttachment(reportFixture(),async()=>Buffer.alloc(8*1024*1024+1)),error=>error.code==='PDF_ATTACHMENT_TOO_LARGE'&&/no email was sent/i.test(error.message));
});

test('retail industry update uses PostgreSQL-safe daily cache SQL and keeps authenticated attributable research',async()=>{
  const source=await readFile(new URL('../api/retail-industry-news.js',import.meta.url),'utf8');
  assert.match(source,/sessionData\(req\)/);
  assert.match(source,/retail_industry_daily_news\("day" date primary key/);
  assert.match(source,/select current_date::text as cache_day/);
  assert.match(source,/where "day"=current_date/);
  assert.match(source,/on conflict\("day"\)/);
  assert.doesNotMatch(source,/current_date::text day/);
  for(const topic of ['retailer strategy','merchandising','consumer electronics','audio\/video','appliances','pricing\/promotions','distribution','store openings\/closures'])assert.match(source,new RegExp(topic));
  assert.match(source,/allowed\.has\(norm\(s\.source_url\)\)/);
});

test('market analysis output removes markdown and decorative separator symbols',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/function cleanReportNarrative/);
  assert.match(source,/replace\(\/\\\*\\\*\|__\|`\/g,''\)/);
  assert.match(source,/annual units per location per SKU/);
  assert.doesNotMatch(source,/Launchpad36 Market Analysis —/);
  assert.doesNotMatch(source,/Generated \$\{esc\(new Date\(\)\.toLocaleString\(\)\)\} ·/);
});

test('retail distributor seed contains 50 unique, categorized, sourceable accounts',()=>{
  assert.equal(RETAIL_DISTRIBUTORS.length,50);
  assert.equal(new Set(RETAIL_DISTRIBUTORS.map(x=>x.name.toLowerCase())).size,50);
  assert.equal(new Set(RETAIL_DISTRIBUTORS.map(x=>x.domain.toLowerCase())).size,50);
  assert.ok(RETAIL_DISTRIBUTORS.every(x=>x.domain.includes('.')&&x.channels.includes('distribution')&&x.categories.length>=4));
  assert.ok(RETAIL_DISTRIBUTORS.some(x=>x.channels.includes('specialty_av')));
  assert.ok(RETAIL_DISTRIBUTORS.some(x=>x.channels.includes('automotive')));
  assert.ok(RETAIL_DISTRIBUTORS.some(x=>x.channels.includes('office')));
});

test('account product discovery accepts nested Firecrawl result shapes',()=>{
  const payload={data:{web:{results:[{url:'https://academy.com/p/bluetooth-speaker'}]}},result:{items:[{metadata:{sourceURL:'https://academy.com/p/headphones'}}]}};
  assert.deepEqual(discoveredUrls(payload),['https://academy.com/p/bluetooth-speaker','https://academy.com/p/headphones']);
});

test('normalizes common and nested Firecrawl search response shapes',()=>{
  const payload={data:{web:{results:[{url:'https://vendor.example/p/1',title:'One'}]},items:{pages:[{link:'https://vendor.example/p/2',description:'Two'}]}},result:{metadata:{sourceURL:'https://vendor.example/p/3',title:'Three'}}};
  assert.deepEqual(normalizeFirecrawlSearch(payload).map(x=>x.url),['https://vendor.example/p/1','https://vendor.example/p/2','https://vendor.example/p/3']);
  assert.deepEqual(normalizeFirecrawlSearch({data:{message:'no array'}}),[]);
});

test('catalog discovery rejects discussion and support noise and ranks product pages first',()=>{
  const rows=[
    {url:'https://vendor.example/forum/topic/speaker-help',title:'Speaker discussion'},
    {url:'https://vendor.example/support/products/setup',title:'Product setup support'},
    {url:'https://vendor.example/blog/new-speakers',title:'Speaker news'},
    {url:'https://vendor.example/products/aurelius-one',title:'Aurelius One',description:'Model specifications and features'},
    {url:'https://vendor.example/collections/wireless-audio',title:'Wireless Audio Collection'},
    {url:'https://vendor.example/about',title:'About us'}
  ];
  assert.deepEqual(filterCatalogCandidates(rows).map(x=>x.url),['https://vendor.example/products/aurelius-one','https://vendor.example/collections/wireless-audio']);
});

test('catalog extraction batches pages, retries transient failures, and preserves partial results',async()=>{
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='x';
  const calls=new Map(),fetcher=async(_url,options)=>{const input=JSON.parse(options.body).input,first=input.includes('/products/1');calls.set(first?'first':'second',(calls.get(first?'first':'second')||0)+1);const count=calls.get(first?'first':'second');if(first&&count===1)throw Object.assign(new Error('This operation was aborted'),{name:'AbortError'});if(!first)return {ok:false,status:503,json:async()=>({error:{message:'temporarily unavailable'}})};return {ok:true,status:200,json:async()=>({output_text:JSON.stringify({products:[{brand:'Vendor',product_name:'Model One',sku:'V-1',product_family:'Series',category:'Audio',description:'Supported description',msrp:0,map:0,wholesale:0,upc:'',model_number:'V-1',features:[],product_url:'https://vendor.example/products/1',image_url:'',source_url:'https://vendor.example/products/1'}]})})}};
  try{
    const candidates=Array.from({length:6},(_,index)=>({url:`https://vendor.example/products/${index+1}`}));
    const result=await extractCatalogPages({website:'https://vendor.example',candidates,fetcher,timeoutMs:1000});
    assert.equal(result.rows.length,1);assert.equal(result.selectedPageCount,6);assert.equal(result.extractedPageCount,4);assert.equal(result.failedPages.length,2);assert.equal(result.batchCount,2);assert.equal(result.failedBatchCount,1);assert.equal(result.retriedBatchCount,2);assert.deepEqual([...calls.values()],[2,2]);
  }finally{if(previous===undefined)Reflect.deleteProperty(process.env,'OPENAI_API_KEY');else Reflect.set(process.env,'OPENAI_API_KEY',previous)}
});

test('opportunity alerts use UUID identifiers with a targeted legacy text compatibility join',async()=>{
  const [schema,route]=await Promise.all([readFile(new URL('../api/_opportunity-alerts.js',import.meta.url),'utf8'),readFile(new URL('../api/opportunity-alerts.js',import.meta.url),'utf8')]);
  for(const column of ['manufacturer_id uuid','organization_id uuid','account_id uuid','opportunity_id uuid'])assert.match(schema,new RegExp(column));
  assert.match(schema,/alter column organization_id type uuid using organization_id::uuid/);
  assert.match(route,/ro\.id::text=oa\.organization_id::text/);
  assert.match(route,/oa\.manufacturer_id=\$\{tenant\.tenant_id\}/);
});

test('Aurelius Audio demo contains exactly 12 fictional marked rows with local assets',async()=>{
  assert.equal(AURELIUS_AUDIO_DEMO.length,12);
  assert.equal(Math.min(...AURELIUS_AUDIO_DEMO.map(x=>x.msrp)),49.99);
  assert.equal(Math.max(...AURELIUS_AUDIO_DEMO.map(x=>x.msrp)),999.99);
  assert.ok(AURELIUS_AUDIO_DEMO.every(x=>x.brand==='Aurelius Audio'&&x.demo_data===true&&x.source_type==='demo'));
  assert.equal(new Set(AURELIUS_AUDIO_DEMO.map(x=>x.sku)).size,12);
  assert.ok(AURELIUS_AUDIO_DEMO.every(x=>x.model_number&&x.product_family&&x.category&&x.description&&x.features.length&&x.channels.length&&x.image_url));
  assert.ok(AURELIUS_AUDIO_DEMO.every(x=>x.image_url.startsWith('/assets/aurelius/')&&!x.image_url.includes('placehold.co')));
  await Promise.all(AURELIUS_AUDIO_DEMO.map(x=>access(new URL('..'+x.image_url,import.meta.url))));
});

test('demo and file rows pass the same catalog validator',()=>{
  const result=validateCatalogRows(AURELIUS_AUDIO_DEMO,'demo');
  assert.equal(result.valid_rows.length,12);assert.equal(result.errors.length,0);
  assert.ok(result.valid_rows.every(x=>x.demo_data&&x.source_type==='demo'));
  const invalid=validateCatalogRows([{Brand:'Aurelius Audio',SKU:'MISSING-NAME'}],'excel');
  assert.equal(invalid.valid_rows.length,0);assert.match(invalid.errors[0].error,/Product Name/);
});

test('website catalog review accepts a source-backed model number when no separate SKU is published',async()=>{
  const extracted={brand:'Vendor Audio',product_name:'Reference One',sku:'',model_number:'REF-ONE',category:'Speakers',product_url:'https://vendor.example/products/reference-one',source_url:'https://vendor.example/products/reference-one'};
  const result=validateCatalogRows([extracted],'website_discovery');
  assert.equal(result.errors.length,0);assert.equal(result.valid_rows.length,1);assert.equal(result.valid_rows[0].sku,'REF-ONE');assert.equal(result.valid_rows[0].model_number,'REF-ONE');assert.equal(result.valid_rows[0].source_url,extracted.source_url);
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(ui,/extracted row\(s\) need correction/);assert.match(ui,/error\.error\|\|'Invalid catalog data'/);
});

test('commercial evidence validation never auto-verifies weak or unattributed observations',()=>{
  const weak=validateCommercialObservation({subject_key:'retailer:sku',source_url:'https://retailer.example/p',payload:{price:99},confidence:55,verification_status:'VERIFIED',evidence_type:'assortment_product'});
  assert.equal(weak.verification_status,'REVIEW_REQUIRED');
  const missing=validateCommercialObservation({subject_key:'retailer:sku',payload:{price:99},confidence:99,verification_status:'VERIFIED'});
  assert.equal(missing.verification_status,'UNKNOWN');
  assert.equal(refreshTier('unexpected'),'weekly');
  assert.equal(livingHash({b:2,a:1}),livingHash({a:1,b:2}));
});

test('Firecrawl webhook authentication verifies documented raw-body HMAC only',()=>{
  const secret='test-webhook-secret',raw=Buffer.from('{"type":"monitor.page","data":[]}'),hash=createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal(verifyFirecrawlSignature(raw,`sha256=${hash}`,secret),true);
  assert.equal(verifyFirecrawlSignature(raw,secret,secret),false);
  assert.equal(verifyFirecrawlSignature(Buffer.from(raw.toString().replace('[]','[ ]')),`sha256=${hash}`,secret),false);
  assert.equal(verifyFirecrawlSignature(raw,'sha1='+hash,secret),false);
});

test('Firecrawl non-meaningful judgments are retained but gated from commercial processing',()=>{
  assert.equal(monitorJudgmentMeaningful({data:{judgment:{meaningful:false}}},{}),false);
  assert.equal(monitorJudgmentMeaningful({}, {judgment:{meaningful:false}}),false);
  assert.equal(monitorJudgmentMeaningful({data:{judgment:{meaningful:true}}},{}),true);
  assert.equal(monitorJudgmentMeaningful({},{}),true);
  assert.equal(shouldProcessMonitorPage({data:{judgment:{meaningful:false}}},{status:'changed',url:'https://retailer.example'}),false);
  assert.equal(shouldProcessMonitorPage({data:{judgment:{meaningful:true}}},{status:'changed',url:'https://retailer.example'}),true);
});

test('account agent retrieves living changes by explicit ownership, never subject-key prefix',async()=>{
  const source=await readFile(new URL('../api/intelligence-agent.js',import.meta.url),'utf8');
  assert.match(source,/ice\.account_id=\$\{accountId\}/);
  assert.match(source,/ice\.organization_id=\$\{account\.organization_id/);
  assert.doesNotMatch(source,/subject_key like/);
});

test('immutable change history keeps processing state in a separate table',async()=>{
  const source=await readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8');
  const eventDefinition=source.match(/create table if not exists intelligence_change_events \([\s\S]*?\n\);/)?.[0]||'';
  assert.ok(eventDefinition);assert.doesNotMatch(eventDefinition,/processed_at/);
  assert.match(source,/create table if not exists intelligence_change_event_processing/);
  assert.match(source,/column_name='processed_at'/);
  assert.match(source,/insert into intelligence_change_event_processing\(change_event_id,processor,status,processed_at,last_attempt_at\)/);
  assert.doesNotMatch(source,/drop column processed_at/i);
  assert.match(source,/create trigger intelligence_change_events_immutable/);
});

test('monitor provisioning uses server-side webhook configuration without exposing its secret',async()=>{
  const route=await import('../api/monitor-targets.js');
  const payload=route.buildFirecrawlMonitorPayload({sourceUrl:'https://retailer.example/audio',targetType:'retailer_assortment',tier:'weekly',categoryFocus:'Premium Audio',webhookUrl:'https://app.example/api/firecrawl-monitor-webhook'});
  assert.deepEqual(payload.schedule,{text:'every week'});
  assert.deepEqual(payload.targets,[{type:'scrape',urls:['https://retailer.example/audio']}]);
  assert.equal(payload.judgeEnabled,true);
  assert.deepEqual(payload.webhook,{url:'https://app.example/api/firecrawl-monitor-webhook',events:['monitor.page','monitor.check.completed']});
  assert.doesNotMatch(JSON.stringify(payload),/secret/i);
  const source=await readFile(new URL('../api/monitor-targets.js',import.meta.url),'utf8');
  assert.match(source,/process\.env\.FIRECRAWL_MONITOR_WEBHOOK_URL/);
  assert.match(source,/process\.env\.FIRECRAWL_WEBHOOK_SECRET/);
  assert.match(source,/api\.firecrawl\.dev\/v2\/monitor/);
  assert.match(source,/Authorization:`Bearer \$\{config\.apiKey\}`/);
  assert.doesNotMatch(source,/[?&](?:secret|token)=/i);
});

test('system status reports the complete production readiness chain without exposing secrets',async()=>{
  const source=await readFile(new URL('../api/system-status.js',import.meta.url),'utf8');
  for(const name of ['Database','Schema','Optional Web Crawler','OpenAI Research','Buyer Enrichment','Monitoring','Evidence','Change Detection','Scheduled Refresh']){
    assert.match(source,new RegExp(`['\"]${name}['\"]`));
  }
  assert.match(source,/VERCEL_GIT_COMMIT_SHA/);
  assert.doesNotMatch(source,/FIRECRAWL_API_KEY\s*[,}]/);
});

test('system status UI offers an authenticated repeatable schema repair',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Initialize Missing Schema/);
  assert.match(source,/api\/db-init-v9-8/);
  assert.match(source,/Existing records will be preserved/);
});

test('system status UI can create and execute the first monitoring target',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Add First Monitoring Target/);
  assert.match(source,/api\/monitor-targets/);
  assert.match(source,/api\/living-intelligence-refresh/);
  assert.match(source,/Save & Run Live Scrape/);
});

test('evidence explorer exposes source, confidence, verification and change state',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Evidence Explorer/);
  assert.match(source,/api\/living-intelligence-status/);
  for(const field of ['Confidence','Status','Changed','Open source'])assert.match(source,new RegExp(field));
});

test('structured retailer offerings are normalized without invented values',()=>{
  const rows=normalizeOfferings({json:{offerings:[{name:'Premium TV Mount',brand:'Acme',price_text:'$199.99',availability:'In stock',category:'TV Mounts',evidence_quote:'Premium TV Mount $199.99'},{name:'Premium TV Mount',brand:'Acme',price_text:'$199.99'}]}});
  assert.equal(rows.length,1);assert.equal(rows[0].price_numeric,199.99);assert.equal(rows[0].brand,'Acme');
  assert.deepEqual(normalizeOfferings({markdown:'No structured products'}),[]);
});

test('evidence explorer supports forced structured product extraction',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Re-extract Product Data/);assert.match(source,/force:true/);assert.match(source,/Structured Products/);
});

test('evidence review is human-approved and appends verified truth',async()=>{
  const apiSource=await readFile(new URL('../api/evidence-review.js',import.meta.url),'utf8');
  assert.match(apiSource,/requireAdmin/);assert.match(apiSource,/admin_human_review/);assert.match(apiSource,/verification_status:'VERIFIED'/);assert.match(apiSource,/runLivingIntelligencePipeline/);
  const uiSource=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(uiSource,/Review Products/);assert.match(uiSource,/Approve as Verified/);assert.match(uiSource,/Evidence quote/);
});

test('public website inputs accept domains without a URL scheme',()=>{
  assert.equal(normalizePublicUrl('bestbuy.com/site/audio'),'https://bestbuy.com/site/audio');
  assert.equal(normalizePublicUrl('//example.com/path'),'https://example.com/path');
  assert.equal(domainFromWebsite('www.example.com/products'),'example.com');
  assert.equal(normalizePublicUrl('not a website'),'');
});

test('account research joins product and buyer evidence to the selected organization',async()=>{
  const source=await readFile(new URL('../api/account-research.js',import.meta.url),'utf8');
  for(const marker of ['organization_id','searchOpenAIProducts','searchOpenAIBuyers','normalizeOfferings','focusTokens','decision-makers','runLivingIntelligencePipeline','upsertBuyer'])assert.match(source,new RegExp(marker));
  assert.doesNotMatch(source,/universalAcquire/);
  assert.match(source,/A buyer category is required/);assert.match(source,/A product or product category is required/);assert.match(source,/discarded_irrelevant_count/);
  assert.match(source,/research_type/);assert.match(source,/buyer_category/);assert.match(source,/product_query/);
  assert.match(source,/upsertCompetitiveProduct/);assert.match(source,/saved_product_count/);
});

test('saved competitive products can be reloaded by organization',async()=>{
  const [source,ui]=await Promise.all([readFile(new URL('../api/competitive-products.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  assert.match(source,/organization_id/);assert.match(source,/join accounts a on a\.id=cp\.account_id/);assert.match(source,/cp\.active=true/);
  assert.match(source,/resolveTenant/);assert.match(source,/CAPABILITIES\.APP_READ/);assert.match(source,/CAPABILITIES\.APP_WRITE/);assert.doesNotMatch(source,/requireAdmin/);
  assert.match(ui,/loadSavedAccountProducts/);assert.match(ui,/Saved account products/);assert.match(ui,/competitive-products\?organization_id=/);
});

test('interactive account product research uses OpenAI without Firecrawl browser slots',async()=>{
  const [apiSource,ui]=await Promise.all([readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  assert.match(apiSource,/searchOpenAIProducts/);assert.doesNotMatch(apiSource,/universalAcquire/);assert.doesNotMatch(apiSource,/product_sources:\{firecrawl/);
  assert.match(ui,/Searching account sources with OpenAI/);assert.match(ui,/OpenAI web research/);assert.doesNotMatch(ui,/Website pages:/);
});

test('account product research can find comparables for a tenant-owned portfolio product',async()=>{
  const [apiSource,openaiSource,ui]=await Promise.all([readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  for(const marker of ['comparisonProductList','comparisonProduct','Compare to your products','comparison_product_ids','selectedComparableProducts','productStoreZip','productStoreLocation'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/p\.manufacturer_id=\$\{tenant\.tenant_id\}/);assert.match(apiSource,/comparisonProducts/);assert.match(apiSource,/comparison_product_ids/);assert.match(apiSource,/store_verification_request/);assert.match(apiSource,/openai_comparable_product_research/);
  assert.match(openaiSource,/comparisonProducts/);assert.match(openaiSource,/competing or substitute offerings/);assert.match(openaiSource,/do not search only for our brand/);assert.match(openaiSource,/CONFIRMED_AT_LOCATION/);assert.match(openaiSource,/exact product to the requested ZIP or store/);
});

test('OpenAI buyer research retains only source-backed exact-account candidates',()=>{
  const valid={name:'Jane Merchant',title:'Senior Merchant, Consumer Electronics',account:'The Home Depot',category_scope:'Consumer electronics',source_url:'https://example.com/home-depot-buyer',source_title:'Trade interview',evidence_quote:'Jane Merchant leads consumer electronics buying.',evidence_date:'2026-08-01',confidence:86,verification_status:'REVIEW_REQUIRED',rationale:'Current role and category are explicit.'};
  const payload={output:[
    {type:'web_search_call',action:{sources:[{url:'https://example.com/home-depot-buyer',title:'Trade interview'}]}},
    {type:'message',content:[{type:'output_text',text:JSON.stringify({status:'FOUND',search_summary:'One attributable candidate.',buyer_candidates:[valid,{...valid,name:'Invented Person',source_url:'https://invented.example/person'},{...valid,name:'Wrong Account',account:'Best Buy'}]})}]}
  ]};
  assert.match(responseOutputText(payload),/Jane Merchant/);
  assert.deepEqual(responseWebSources(payload).map(x=>x.url),['https://example.com/home-depot-buyer']);
  const result=normalizeOpenAIResearch(payload,{account:'Home Depot'});
  assert.equal(result.status,'SUCCESS');assert.equal(result.people.length,1);assert.equal(result.people[0].name,'Jane Merchant');assert.equal(result.people[0].verification_status,'REVIEW_REQUIRED');
});

test('buyer category ownership is verified separately from identity and generic titles fail closed',()=>{
  const identity='https://retailer.example/leadership',category='https://trade.example/audio-buyer',base={name:'Jane Merchant',title:'Senior Buyer',account:'Example Retailer',department:'',category_scope:'Audio',subcategory_scope:'Speakers',buyer_role:'DIRECT_BUYER',identity_confidence:91,category_confidence:88,category_evidence_url:'',category_evidence_source:'',category_evidence_quote:'',category_last_verified:'',category_verification_status:'VERIFIED',source_url:identity,source_title:'Leadership',evidence_quote:'Jane Merchant is a current senior buyer.',evidence_date:'2026-09-20',confidence:91,email:'',phone:'',linkedin:'',verification_status:'REVIEW_REQUIRED',rationale:'Current employee.'};
  const payloadFor=row=>({output:[{type:'web_search_call',action:{sources:[{url:identity,title:'Leadership'},{url:category,title:'Audio trade report'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({status:'FOUND',search_summary:'',category_owner_status:'CONFIRMED',buyer_candidates:[row]})}]}]});
  const generic=normalizeOpenAIResearch(payloadFor(base),{account:'Example Retailer',category:'Audio'}).people[0];
  assert.equal(generic.identity_confidence,91);assert.equal(generic.category_verification_status,'UNCONFIRMED');assert.equal(generic.category_confidence,0);assert.equal(generic.department,'Unconfirmed');
  const supported=normalizeOpenAIResearch(payloadFor({...base,department:'Consumer Electronics',category_evidence_url:category,category_evidence_source:'Audio trade report',category_evidence_quote:'Jane leads speakers and home audio buying.',category_last_verified:'2026-09-20'}),{account:'Example Retailer',category:'Audio'});
  assert.equal(supported.category_owner_status,'CONFIRMED');assert.equal(supported.people[0].category_verification_status,'VERIFIED');assert.equal(supported.people[0].category_scope,'Audio');assert.equal(supported.people[0].category_confidence,88);
  const unrelated=normalizeOpenAIResearch(payloadFor({...base,department:'Home',category_scope:'Major Appliances',subcategory_scope:'Refrigeration',category_evidence_url:category,category_evidence_source:'Trade report',category_evidence_quote:'Jane leads major appliance buying.',category_last_verified:'2026-09-20'}),{account:'Example Retailer',category:'Audio'});
  assert.equal(unrelated.category_owner_status,'NOT_CONFIRMED');
  for(const synonym of ['home theater','speakers','soundbars','headphones','consumer electronics'])assert.ok(buyerCategorySearchTerms('Audio').includes(synonym));
});

test('buyer intelligence migration preserves legacy categories without claiming verification',async()=>{
  const migration=await readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8');
  for(const column of ['department','category_scope','subcategory_scope','buyer_role','identity_confidence','category_confidence','category_evidence_url','category_evidence_source','category_last_verified','category_verification_status'])assert.match(migration,new RegExp(`buyers add column if not exists ${column}`));
  assert.match(migration,/update buyers set category_scope=category where category_scope=''/);
  assert.match(migration,/category_verification_status='UNCONFIRMED',category_confidence=0/);
  assert.doesNotMatch(migration,/category_verification_status='VERIFIED'.*category_scope=category/s);
});

test('buyer relationship migration is additive, append-only and revalidation-ready',async()=>{
  const migration=await readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8');
  for(const column of ['employment_verification_status','employment_evidence_url','employment_last_verified','relationship_review_reason','replacement_search_required'])assert.match(migration,new RegExp(`buyers add column if not exists ${column}`));
  assert.match(migration,/create table if not exists buyer_category_relationships/);
  assert.match(migration,/create trigger buyer_category_relationships_immutable/);
  assert.doesNotMatch(migration,/drop\s+(table|column)|truncate\s+|delete\s+from\s+(buyers|accounts|retail_organizations)/i);
});

test('buyer relationship changes preserve verified scope and initiate replacement research',()=>{
  const previous={id:'buyer-1',title:'Senior Buyer',department:'Consumer Electronics',category_scope:'Audio',category_verification_status:'VERIFIED'};
  assert.equal(detectBuyerRelationshipChange(previous,{...previous,employment_verification_status:'STALE'}),'BUYER_LEFT_ACCOUNT');
  const changed=relationshipDisposition(previous,{...previous,category_scope:'Major Appliances',category_verification_status:'VERIFIED',employment_verification_status:'VERIFIED'});
  assert.equal(changed.change_type,'CATEGORY_RESPONSIBILITY_CHANGED');assert.equal(changed.category_verification_status,'CONFLICTING');assert.equal(changed.preserve_verified_scope,true);assert.equal(changed.replacement_search_required,true);
  const unconfirmed=relationshipDisposition(previous,{...previous,category_verification_status:'UNCONFIRMED',employment_verification_status:'VERIFIED'});
  assert.equal(unconfirmed.change_type,'RELATIONSHIP_NEEDS_VERIFICATION');assert.equal(unconfirmed.replacement_search_required,true);
});

test('weekly buyer relationship revalidation targets stale, conflicting and aging ownership',async()=>{
  const source=await readFile(new URL('../api/weekly-refresh.js',import.meta.url),'utf8');
  for(const marker of ['BUYER_REVALIDATION_WEEKLY_LIMIT','replacement_search_required','category_last_verified','buyer_relationship_revalidation','/api/buyer-intelligence'])assert.match(source,new RegExp(marker));
});

test('buyer UI separates department, category, identity and category verification',async()=>{
  const [deep,coverage,focused]=await Promise.all([readFile(new URL('../deep-buyer-search-ui-v3.js',import.meta.url),'utf8'),readFile(new URL('../buyer-coverage-ui.js',import.meta.url),'utf8'),readFile(new URL('../buyer-category-intelligence-ui.js',import.meta.url),'utf8')]);
  for(const marker of ['Department:','Category:','Identity verification','Category verification','identity_confidence','category_confidence','Category owner not yet confirmed'])assert.match(deep,new RegExp(marker));
  assert.match(coverage,/Identity \$\{Number\(b\.identity_confidence/);assert.match(coverage,/Category \$\{Number\(b\.category_confidence/);
  assert.match(focused,/buyerCategoryFocus/);assert.match(focused,/all_buyers:false/);assert.match(focused,/Category owner not yet confirmed/);
});

test('buyer category research preserves authentication, tenant resolution and LinkedIn policy',async()=>{
  const [accountResearch,buyerIntelligence,deepSearch]=await Promise.all([readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../api/buyer-intelligence.js',import.meta.url),'utf8'),readFile(new URL('../api/buyer-deep-search.js',import.meta.url),'utf8')]);
  for(const source of [accountResearch,buyerIntelligence]){assert.match(source,/CAPABILITIES\.DEEP_SEARCH/);assert.match(source,/resolveTenant\(req,res/)}
  assert.match(buyerIntelligence,/verification_enrichment_only/);assert.match(buyerIntelligence,/private_contact_inference:false/);
  assert.match(deepSearch,/CAPABILITIES\.DEEP_SEARCH/);assert.match(deepSearch,/reveal_personal_emails','false'/);assert.match(deepSearch,/reveal_phone_number','false'/);
});

test('OpenAI buyer research fails closed when citations or structured JSON are missing',()=>{
  const uncited={output_text:JSON.stringify({status:'FOUND',search_summary:'',buyer_candidates:[{name:'Jane Merchant',title:'Buyer',account:'Home Depot',category_scope:'Electronics',source_url:'https://invented.example',source_title:'Unknown',evidence_quote:'Buyer',evidence_date:'',confidence:90,verification_status:'REVIEW_REQUIRED',rationale:''}]})};
  assert.equal(normalizeOpenAIResearch(uncited,{account:'Home Depot'}).people.length,0);
  assert.equal(normalizeOpenAIResearch({output_text:'not-json'},{account:'Home Depot'}).status,'ERROR');
});

test('OpenAI buyer research retries one transient timeout within the Vercel runtime budget',async()=>{
  const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY=['regression','test','key'].join('-');
  const requests=[];
  try{
    const result=await searchOpenAIBuyers({account:'Example Retailer',domain:'example.test',category:'Audio'},{attemptTimeouts:[100,100],fetcher:async(_url,options)=>{
      requests.push(JSON.parse(options.body));
      if(requests.length===1)throw Object.assign(new Error('aborted'),{name:'AbortError'});
      return {ok:false,status:400,json:async()=>({error:{message:'deliberate non-transient test response'}})};
    }});
    assert.equal(requests.length,2);assert.equal(result.attempts,2);assert.equal(result.http_status,400);assert.match(result.error,/deliberate non-transient/);
    assert.equal(requests[0].reasoning.effort,'medium');assert.equal(requests[0].tools[0].search_context_size,'high');
    assert.equal(requests[1].reasoning.effort,'low');assert.equal(requests[1].tools[0].search_context_size,'medium');
    const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
    for(const name of ['account-research','buyer-intelligence','buyer-deep-search'])assert.equal(config.functions[`api/${name}.js`].maxDuration,240);
  }finally{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior}
});

test('OpenAI buyer research retries incomplete structured output without accepting malformed data',async()=>{
  const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY=['regression','test','key'].join('-');
  const requests=[];
  try{
    const result=await searchOpenAIBuyers({account:'Example Retailer',domain:'example.test',category:'Audio'},{attemptTimeouts:[100,100],fetcher:async(_url,options)=>{
      requests.push(JSON.parse(options.body));
      if(requests.length===1)return {ok:true,status:200,json:async()=>({id:'first',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:'{"status":"FOUND"'})};
      return {ok:true,status:200,json:async()=>({id:'second',output:[{type:'message',content:[{type:'output_text',text:'{"status":"NO_'},{type:'output_text',text:'RESULTS","search_summary":"No attributable candidate.","category_owner_status":"NOT_CONFIRMED","buyer_candidates":[]}'}]}]})};
    }});
    assert.equal(requests.length,2);assert.equal(result.attempts,2);assert.equal(result.status,'NO_RESULTS');assert.equal(result.response_id,'second');
    assert.equal(requests[0].max_output_tokens,12000);assert.equal(requests[1].max_output_tokens,9000);
  }finally{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior}
});

test('OpenAI research uses Responses web search and never exposes the API key',async()=>{
  const source=await readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8');
  assert.match(source,/api\.openai\.com\/v1\/responses/);assert.match(source,/type:'web_search'/);assert.match(source,/web_search_call\.action\.sources/);assert.match(source,/type:'json_schema'/);assert.match(source,/REVIEW_REQUIRED/);
  assert.doesNotMatch(source,/OPENAI_API_KEY\s*[,}]/);
});

test('invalid Apollo authentication degrades optional enrichment without failing buyer research',async()=>{
  const [provider,accountApi,ui]=await Promise.all([readFile(new URL('../api/_buyer-enrichment.js',import.meta.url),'utf8'),readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  assert.match(provider,/response\.status===401\|\|response\.status===403/);assert.match(provider,/OPTIONAL_UNAVAILABLE/);assert.match(provider,/OpenAI research continued/);
  assert.match(accountApi,/apollo\.detail/);assert.match(ui,/Optional Apollo enrichment/);
});

test('buyer and evidence interfaces are account-scoped and mobile-safe',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/id="buyerAccount"/);assert.match(source,/api\/buyers\?organization_id=/);
  assert.match(source,/id="evidenceAccount"/);assert.match(source,/api\/account-research/);
  assert.match(source,/https:\/\/ is optional/);assert.match(source,/@media\(max-width:760px\)/);
  assert.match(source,/font-size:16px/);assert.match(source,/min-height:44px/);assert.match(source,/-webkit-overflow-scrolling:touch/);
});

test('account research exposes progress and prevents duplicate submissions',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const marker of ['progressTrack','researchProgress','researchElapsed','accountResearchRunning','Research Running…'])assert.match(source,new RegExp(marker));
  assert.match(source,/button\.disabled=true/);assert.match(source,/clearInterval\(timer\)/);
});

test('saved buyer research is visible and reusable from its account',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const marker of ['buyer_count','Saved buyer data','loadSavedAccountBuyers','Refresh All Buyers','selectedBuyerOrgId','Buyer data saved to account'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/api\/buyers\?organization_id=\$\{encodeURIComponent\(orgId\)\}/);
  const universe=await readFile(new URL('../api/account-universe.js',import.meta.url),'utf8');
  assert.match(universe,/count\(\*\)::int/);assert.match(universe,/buyer_data_updated_at/);
  const database=await readFile(new URL('../api/_db.js',import.meta.url),'utf8');
  assert.match(database,/on conflict \(account_id, lower\(name\), lower\(title\)\) do update/);
});

test('buyer research searches all buyer functions while product research stays category-scoped',async()=>{
  const [ui,apiSource,openaiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8')]);
  for(const marker of ['Find buyers for this account','Research All Buyers','all_buyers','productResearchQuery','Research Products','runBuyerResearch','runProductResearch','productResearchTable'])assert.match(ui,new RegExp(marker));
  assert.doesNotMatch(ui,/buyerResearchCategory/);assert.match(ui,/research_type:researchType/);assert.match(ui,/product_query/);
  assert.match(apiSource,/all_buyers/);assert.match(apiSource,/allCategories:allBuyers/);assert.match(openaiSource,/all buying functions/);
});

test('account research parallelizes independent website calls',async()=>{
  const acquisition=await readFile(new URL('../api/_acquisition.js',import.meta.url),'utf8');
  const buyers=await readFile(new URL('../api/decision-makers.js',import.meta.url),'utf8');
  assert.match(acquisition,/Promise\.all\(queries\.map/);assert.match(acquisition,/Promise\.all\(eligible\.map/);
  assert.match(buyers,/Promise\.all\(seeds\.map/);
});

test('account evidence query qualifies joined columns to avoid ambiguous SQL',async()=>{
  const source=await readFile(new URL('../api/living-intelligence-status.js',import.meta.url),'utf8');
  assert.match(source,/latest\.source_url/);assert.match(source,/latest\.verification_status/);assert.match(source,/latest\.payload/);
});

test('category relevance gate rejects unrelated retailer products',()=>{
  const data={json:{offerings:[{name:'Samsung Electric Dryer',category:'Appliances'},{name:'Full Motion TV Wall Mount',category:'TV Mounts',price_text:'$99.00'}]}};
  const rows=normalizeOfferings(data,focusTokens('TV mounts'));
  assert.equal(rows.length,1);assert.match(rows[0].name,/TV Wall Mount/);assert.deepEqual(focusTokens('', 'https://homedepot.com/tvmounts'),['tv','mount']);
});

test('comparable product research retains direct substitutes across price tiers',async()=>{
  const data={json:{offerings:[
    {name:'Glass Cleaner Spray',brand:'Brand A',category:'Household Cleaners',price_text:'$4.99',evidence_quote:'Glass Cleaner Spray $4.99'},
    {name:'Premium Aerosol Glass Cleaner',brand:'Brand B',category:'Cleaning Supplies',price_text:'$8.49',evidence_quote:'Premium Aerosol Glass Cleaner $8.49'},
    {name:'Wireless Earbuds',brand:'Brand C',category:'Electronics',price_text:'$19.99',evidence_quote:'Wireless Earbuds $19.99'}
  ]}};
  const rows=normalizeOfferings(data,focusTokens('Cleaning Products'));
  assert.deepEqual(rows.map(x=>x.name),['Glass Cleaner Spray','Premium Aerosol Glass Cleaner']);
  assert.deepEqual(rows.map(x=>x.price_numeric),[4.99,8.49]);
  const openaiSource=await readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8');
  assert.match(openaiSource,/Price is comparison context, never an exclusion criterion/);
  assert.match(openaiSource,/even when their price tier differs/);
});

test('UI supports rejecting evidence and replacing a bad target',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Reject Evidence/);assert.match(source,/Replace Monitoring Target/);assert.match(source,/replace_target_id:targetId/);assert.doesNotMatch(source,/replace_active:true/);assert.match(source,/discarded_irrelevant_count/);
});

test('monitoring targets persist a separate required category field',async()=>{
  const migration=await readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8');
  assert.match(migration,/category_focus text not null default/);
  const route=await readFile(new URL('../api/monitor-targets.js',import.meta.url),'utf8');
  assert.match(route,/Category is required for retailer assortment targets/);assert.match(route,/category_focus/);
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(ui,/id="monitorCategory"/);assert.match(ui,/category_focus:category/);assert.match(ui,/category_focus:focus/);
});

test('multi-product retail opportunity deduplicates portfolio overlap and preserves account drill-down',()=>{
  const products=[
    {id:'p1',name:'Mount A',brand_name:'Acme',category:'TV Mounts',categories:['TV Mounts'],variants:[{sku:'A',wholesale:100,msrp:180}]},
    {id:'p2',name:'Mount B',brand_name:'Acme',category:'TV Mounts',categories:['TV Mounts'],variants:[{sku:'B',wholesale:200,msrp:350}]}
  ];
  const organizations=[{id:'r1',name:'Retail One',organization_type:'retailer',channel_codes:['ce'],categories:['TV Mounts'],footprint:2,confidence:90,verification_status:'VERIFIED'}];
  const result=calculateMarketOpportunity({products,organizations,route:'retail',assumptions:{annual_units_per_location:10,distribution_probability:50,portfolio_overlap_discount:10}});
  assert.equal(result.summary.selected_product_count,2);assert.equal(result.summary.target_account_count,1);
  assert.equal(result.summary.base_manufacturer_revenue,2700);assert.equal(result.summary.low_manufacturer_revenue,1755);assert.equal(result.summary.high_manufacturer_revenue,3645);
  assert.equal(result.account_opportunities[0].product_contributions.length,2);assert.equal(result.assumptions.provenance,'USER_PROVIDED');
});

test('direct B2B opportunity uses accounts rather than retail footprint',()=>{
  const products=[{id:'p1',name:'Display',category:'Displays',variants:[{sku:'D1',wholesale:500,msrp:800}]}];
  const organizations=[{id:'b1',name:'Enterprise One',organization_type:'enterprise',channel_codes:['corporate'],categories:['Displays'],footprint:100}];
  const result=calculateMarketOpportunity({products,organizations,route:'direct_b2b',assumptions:{units_per_account:5,win_probability:20}});
  assert.equal(result.summary.target_account_count,1);assert.equal(result.summary.base_manufacturer_revenue,500);assert.equal(result.account_opportunities[0].footprint,100);
});

test('multi-route market opportunity combines selected routes and deduplicates crossover accounts',()=>{
  const products=[{id:'p1',name:'Display Mount',category:'TV Mounts',categories:['TV Mounts'],variants:[{sku:'M1',wholesale:100,msrp:180}]}],organizations=[
    {id:'retail',name:'Retailer',organization_type:'retailer',channel_codes:['ce'],categories:['TV Mounts'],footprint:10},
    {id:'partner',name:'Distributor',organization_type:'distributor',channel_codes:['distribution'],categories:['TV Mounts'],footprint:20},
    {id:'crossover',name:'Retail Distributor',organization_type:'distributor',channel_codes:['distribution','ce'],categories:['TV Mounts'],footprint:5},
    {id:'direct',name:'Enterprise',organization_type:'enterprise',channel_codes:['enterprise'],categories:['TV Mounts'],footprint:1}
  ];
  const result=calculateMultiRouteMarketOpportunity({products,organizations,routes:['retail','distributor_dealer'],assumptions:{annual_units_per_location:10,units_per_account:10,distribution_probability:25,win_probability:25}});
  assert.deepEqual(result.account_opportunities.map(x=>x.organization_id).sort(),['crossover','partner','retail']);
  assert.equal(result.summary.target_account_count,3);assert.deepEqual(result.assumptions.routes_to_market,['retail','distributor_dealer']);assert.equal(result.assumptions.route_to_market,'mixed');
  assert.deepEqual(result.account_opportunities.find(x=>x.organization_id==='crossover').routes_to_market,['retail','distributor_dealer']);
});

test('account scope caps recommended accounts with deterministic fit ranking and recomputed totals',()=>{
  const accounts=Array.from({length:30},(_,index)=>({organization_id:`id-${String(index).padStart(2,'0')}`,name:index===0?'Zulu':'Account '+index,fit_score:index<2?90:89-index,base_manufacturer_revenue:index===0?100:index===1?200:10,low_manufacturer_revenue:5,high_manufacturer_revenue:15,evidence_backed_manufacturer_revenue:index===1?200:0,base_retail_value:20,evidence_status:index===1?'VERIFIED':'INSUFFICIENT',recommendation_eligible:true,product_contributions:[{product_category:'Audio',base_manufacturer_revenue:index===0?100:index===1?200:10}]}));
  const scoped=applyAccountScope({summary:{selected_product_count:1,priced_sku_count:1},assumptions:{},account_opportunities:accounts,warnings:[]},{mode:'recommended',maximum_relevant_accounts:25,custom_account_ids:[]});
  assert.equal(scoped.account_opportunities.length,25);assert.equal(scoped.account_opportunities[0].organization_id,'id-01');assert.equal(scoped.account_opportunities[1].organization_id,'id-00');
  assert.equal(scoped.summary.target_account_count,25);assert.equal(scoped.summary.base_manufacturer_revenue,530);assert.equal(scoped.account_scope.display_summary,'25 recommended + 0 custom = 25 accounts analyzed');
  assert.equal(compareAccountRank({fit_score:80,base_manufacturer_revenue:100,name:'Alpha',organization_id:'2'},{fit_score:80,base_manufacturer_revenue:100,name:'Alpha',organization_id:'1'}),1);
});

test('custom account scopes remove duplicates, retain real fit, and recalculate downstream opportunity',()=>{
  const accounts=[
    {organization_id:'top',name:'Top',fit_score:95,base_manufacturer_revenue:1000,low_manufacturer_revenue:650,high_manufacturer_revenue:1350,evidence_backed_manufacturer_revenue:1000,base_retail_value:1500,evidence_status:'VERIFIED',recommendation_eligible:true,product_contributions:[{product_category:'Audio',base_manufacturer_revenue:1000}]},
    {organization_id:'custom-fit',name:'Custom Fit',fit_score:70,base_manufacturer_revenue:400,low_manufacturer_revenue:260,high_manufacturer_revenue:540,evidence_backed_manufacturer_revenue:0,base_retail_value:600,evidence_status:'REVIEW_REQUIRED',recommendation_eligible:true,product_contributions:[{product_category:'Audio',base_manufacturer_revenue:400}]},
    {organization_id:'custom-zero',name:'Custom Zero',fit_score:0,fit_reason:'No selected product fits this account',base_manufacturer_revenue:0,low_manufacturer_revenue:0,high_manufacturer_revenue:0,evidence_backed_manufacturer_revenue:0,base_retail_value:0,evidence_status:'INSUFFICIENT',recommendation_eligible:false,product_contributions:[]}
  ],input={summary:{selected_product_count:1,priced_sku_count:1},assumptions:{},account_opportunities:accounts,warnings:[]};
  const customOnly=applyAccountScope(input,{mode:'custom_only',maximum_relevant_accounts:25,custom_account_ids:['custom-zero','custom-fit','custom-zero']});
  assert.deepEqual(customOnly.account_opportunities.map(row=>row.organization_id),['custom-fit','custom-zero']);assert.equal(customOnly.summary.base_manufacturer_revenue,400);assert.equal(customOnly.account_opportunities[1].fit_score,0);assert.equal(customOnly.account_opportunities[1].evidence_status,'INSUFFICIENT');
  const combined=applyAccountScope(input,{mode:'recommended_plus_custom',maximum_relevant_accounts:25,custom_account_ids:['top','custom-zero','custom-zero']});
  assert.deepEqual(combined.account_opportunities.map(row=>row.organization_id),['top','custom-fit','custom-zero']);assert.equal(combined.account_scope.recommended_count,2);assert.equal(combined.account_scope.custom_count,1);assert.equal(combined.account_opportunities.filter(row=>row.organization_id==='top').length,1);assert.equal(combined.summary.base_manufacturer_revenue,1400);
});

test('account scope UI persists scenarios and records inclusion provenance in report snapshots',async()=>{
  const [ui,scenarios,appShell]=await Promise.all([readFile(new URL('../market-account-scope-ui.js',import.meta.url),'utf8'),readFile(new URL('../api/market-scenarios.js',import.meta.url),'utf8'),readFile(new URL('../api/app-shell.js',import.meta.url),'utf8')]);
  for(const marker of ['Maximum Relevant Accounts','Recommended Accounts','Custom Accounts Only','Recommended \\+ Custom','account-universe','custom_account_ids','marketFormPayload','marketReportSnapshotPayload','scope_source','configured_account_limit','runMarketOpportunity'])assert.match(ui,new RegExp(marker));
  assert.match(scenarios,/assumptions=\$\{sql\.json\(result\.assumptions\|\|\{\}\)\}/);assert.match(scenarios,/result_snapshot/);assert.match(appShell,/market-account-scope-ui\.js/);
  const accountScope={mode:'recommended_plus_custom',maximum_relevant_accounts:50,custom_account_ids:['custom-1'],display_summary:'50 recommended + 1 custom = 51 accounts analyzed'},context=createContext({state:{marketOpportunity:{account_scope:accountScope,account_opportunities:[{organization_id:'custom-1',name:'Custom One',scope_source:'CUSTOM',system_recommended:false,manually_included:true}],selected_products:[]},orgs:[]},window:null,document:{body:{},getElementById:()=>null,querySelectorAll:()=>[]},MutationObserver:class{observe(){}},market:()=>'<p class="muted">Catalog wholesale price is used when available.',marketFormPayload:()=>({product_ids:['p1']}),renderMarketResults:()=>'',marketReportSnapshotPayload:()=>({assumptions:{},accounts:[{name:'Custom One'}]}),marketAccounts:()=>[{scope_source:'CUSTOM',system_recommended:false,manually_included:true}],esc:value=>String(value),api:async()=>({organizations:[]}),encodeURIComponent,clearTimeout,setTimeout:()=>0,Symbol,Set,Map,String,Number,Boolean,Array});context.window=context;runInContext(ui,context);
  const restored=JSON.parse(runInContext('JSON.stringify(marketFormPayload())',context)),snapshot=JSON.parse(runInContext('JSON.stringify(marketReportSnapshotPayload())',context));
  assert.deepEqual(restored.account_scope,{mode:'recommended_plus_custom',maximum_relevant_accounts:50,custom_account_ids:['custom-1']});assert.equal(snapshot.account_scope.maximum_relevant_accounts,50);assert.equal(snapshot.accounts[0].scope_source,'CUSTOM');assert.equal(snapshot.accounts[0].configured_account_limit,50);
});

test('custom account search renders only current name or domain matches',async()=>{
  const ui=await readFile(new URL('../market-account-scope-ui.js',import.meta.url),'utf8'),elements={moCustomAccountSearch:{value:'beta.example'},moCustomAccountResults:{style:{},innerHTML:''},moSelectedAccounts:{innerHTML:''},moAccountScopeMode:{value:'custom_only'}},requests=[];
  const context=createContext({state:{marketOpportunity:null,orgs:[{id:'alpha',name:'Alpha Retail',domain:'alpha.example'}]},window:null,document:{body:{},getElementById:id=>elements[id]||null,querySelectorAll:()=>[]},MutationObserver:class{observe(){}},market:()=>'<p class="muted">Catalog wholesale price is used when available.',marketFormPayload:()=>({}),renderMarketResults:()=>'',marketReportSnapshotPayload:()=>({accounts:[]}),api:async url=>{requests.push(url);return {organizations:[{id:'beta',name:'Beta Stores',domain:'beta.example'}]}},encodeURIComponent,clearTimeout,setTimeout:()=>0,Symbol,Set,Map,String,Number,Boolean,Array});context.window=context;runInContext(ui,context);
  await context.l36SearchCustomAccounts();
  assert.match(requests[0],/q=beta\.example/);assert.match(elements.moCustomAccountResults.innerHTML,/Beta Stores/);assert.doesNotMatch(elements.moCustomAccountResults.innerHTML,/Alpha Retail/);
});

test('market intelligence UI supports multiple products, channel models and SKU drill-down',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/class="moProduct" type="checkbox"/);assert.match(source,/class="moRoute" type="checkbox"/);assert.match(source,/routes_to_market/);assert.match(source,/Select All/);
  for(const route of ['retail','direct_b2b','distributor_dealer','mixed'])assert.match(source,new RegExp(`value="${route}"`));
  assert.match(source,/Low Scenario/);assert.match(source,/Base Scenario/);assert.match(source,/High Scenario/);assert.match(source,/Edit Account/);assert.match(source,/api\/market-opportunity/);
});

test('account opportunity headers sort the full result stably with unknown values last',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),snippet=source.match(/const marketOpportunitySort=[\s\S]*?(?=\nfunction marketChannelSummary)/)?.[0]||'';
  assert.ok(snippet);const context=createContext({$:()=>null,renderMarketResults:()=>''});runInContext(snippet,context);
  const rows=[{id:'b',name:'Beta',base_manufacturer_revenue:100,fit_score:80},{id:'a2',name:'Alpha',base_manufacturer_revenue:200,fit_score:90},{id:'a1',name:'Alpha',base_manufacturer_revenue:200,fit_score:90},{id:'unknown',name:null,base_manufacturer_revenue:null,fit_score:null}];
  const sorted=()=>JSON.parse(runInContext(`JSON.stringify(sortMarketOpportunityAccounts(${JSON.stringify(rows)}))`,context));
  runInContext("setMarketOpportunitySort('account')",context);assert.deepEqual(sorted().map(x=>x.id),['a2','a1','b','unknown']);
  runInContext("setMarketOpportunitySort('account')",context);assert.deepEqual(sorted().map(x=>x.id),['b','a2','a1','unknown']);
  runInContext("setMarketOpportunitySort('annual')",context);assert.deepEqual(sorted().map(x=>x.id),['a2','a1','b','unknown']);
  runInContext("setMarketOpportunitySort('annual')",context);assert.deepEqual(sorted().map(x=>x.id),['b','a2','a1','unknown']);
  runInContext("setMarketOpportunitySort('fit')",context);assert.deepEqual(sorted().map(x=>x.id),['a2','a1','b','unknown']);
  assert.match(source,/marketSortHeader\('account','Account'\)/);assert.match(source,/marketSortHeader\('annual','Annual Opportunity'\)/);assert.match(source,/marketSortHeader\('fit','Fit Score'\)/);assert.match(source,/aria-sort/);assert.match(source,/_marketSourceIndex/);
});

test('market intelligence replaces the redundant find me revenue interface',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const nav=source.match(/const NAV=\[[^\]]+\]/)?.[0]||'';
  assert.doesNotMatch(nav,/Find Me Revenue/);
  assert.doesNotMatch(source,/show\('Find Me Revenue'\)/);
  assert.match(source,/Analyze Market Opportunity/);
});

test('broad account categories match related product families',()=>{
  assert.ok(categoryConcepts(['Floorstanding Speakers']).includes('audio'));
  const result=calculateMarketOpportunity({products:[{id:'p1',name:'Speaker',category:'Floorstanding Speakers',variants:[{sku:'S1',wholesale:500}]}],organizations:[{id:'r1',name:'Audio Retailer',organization_type:'retailer',categories:['Audio'],footprint:10}],route:'retail',assumptions:{annual_units_per_location:2,distribution_probability:50}});
  assert.equal(result.summary.target_account_count,1);assert.equal(result.summary.base_manufacturer_revenue,5000);
});

test('household cleaning products qualify relevant mass, grocery and drug retailers only',()=>{
  const product={id:'clean-1',name:'Concentrated Surface Cleaner',category:'Household Cleaning Products',categories:['Cleaning Supplies'],channels:['mass','grocery'],variants:[{sku:'CLEAN-1',wholesale:5,msrp:9.99}]};
  assert.ok(categoryConcepts([product.category]).includes('household_cleaning'));
  const organizations=[
    {id:'mass',name:'Mass Merchant',organization_type:'retailer',channel_codes:['mass'],categories:['General Merchandise'],footprint:100},
    {id:'grocery',name:'Grocery Chain',organization_type:'retailer',channel_codes:['grocery'],categories:['Grocery'],footprint:50},
    {id:'drug',name:'Drug Chain',organization_type:'retailer',channel_codes:['drug'],categories:['Pharmacy'],footprint:25},
    {id:'furniture',name:'Furniture Chain',organization_type:'retailer',channel_codes:['furniture'],categories:['Furniture'],footprint:100},
    {id:'electronics',name:'Electronics Chain',organization_type:'retailer',channel_codes:['ce'],categories:['Consumer Electronics'],footprint:100}
  ];
  const result=calculateMarketOpportunity({products:[product],organizations,route:'retail',assumptions:{annual_units_per_location:12,distribution_probability:25}});
  assert.deepEqual(result.account_opportunities.map(x=>x.organization_id),['mass','grocery','drug']);
  assert.equal(result.summary.target_account_count,3);
  assert.equal(evaluateProductAccountFit(product,organizations[3]).qualified,false);
  assert.equal(evaluateProductAccountFit(product,organizations[4]).qualified,false);
});

test('account universe UI exposes Excel CSV import, manual entry and a template',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Import Accounts/);assert.match(source,/Download Template/);assert.match(source,/Add Account/);assert.match(source,/api\/retail-universe-import/);assert.match(source,/launchpad36-account-import-template\.csv/);
});

test('product import UI provides a downloadable catalog template',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const marker of ['Download Product Template','downloadProductImportTemplate','launchpad36-product-import-template.csv','Product Family','Image URL'])assert.match(source,new RegExp(marker));
});

test('product-account fit excludes incompatible and unprofiled retailers',()=>{
  const earbuds={id:'p1',name:'Wireless Earbuds',category:'Wireless Audio',categories:['Headphones']};
  assert.equal(evaluateProductAccountFit(earbuds,{name:'Ashley Furniture',categories:['Furniture','Home Furnishings']}).tier,'INCOMPATIBLE_VERTICAL');
  assert.equal(evaluateProductAccountFit(earbuds,{name:'Unknown Retailer',categories:[]}).tier,'INSUFFICIENT_DATA');
  assert.equal(evaluateProductAccountFit(earbuds,{name:'Electronics Retailer',categories:['Audio','Headphones']}).qualified,true);
  const result=calculateMarketOpportunity({products:[{...earbuds,variants:[{sku:'E1',wholesale:50}]}],organizations:[{id:'a',name:'Ashley Furniture',organization_type:'retailer',categories:['Furniture','Home Furnishings'],footprint:100},{id:'e',name:'Electronics Retailer',organization_type:'retailer',categories:['Audio','Headphones'],footprint:10}],route:'retail',assumptions:{annual_units_per_location:10,distribution_probability:20}});
  assert.deepEqual(result.account_opportunities.map(x=>x.name),['Electronics Retailer']);
});

test('account scale and confidence cannot qualify an unrelated product',()=>{
  const product={id:'p1',name:'Wireless Earbuds',category:'Wireless Audio',categories:['Headphones'],channels:['furniture']};
  const account={id:'a1',name:'Huge Furniture Chain',categories:['Furniture'],channel_codes:['furniture'],footprint:5000,confidence:100};
  const fit=evaluateProductAccountFit(product,account);
  assert.equal(fit.qualified,false);assert.equal(fit.score,0);assert.equal(fit.tier,'INCOMPATIBLE_VERTICAL');
});

test('verified assortment evidence is separated from modeled profile fit dollars',()=>{
  const products=[{id:'p1',name:'Full Motion TV Mount',category:'TV Mounts',categories:['TV Mounts'],variants:[{sku:'M1',wholesale:100}]}];
  const organizations=[
    {id:'verified',name:'Verified Retailer',organization_type:'retailer',categories:['Home Electronics'],footprint:10},
    {id:'profile',name:'Profile Retailer',organization_type:'retailer',categories:['TV Mounts'],footprint:10}
  ];
  const profiles=evidenceProfiles([{organization_id:'verified',payload:{offerings:[{name:'Full Motion TV Wall Mount',category:'TV Mounts'}]},source_url:'https://example.com/mounts',last_verified_at:'2026-09-03T00:00:00Z',verification_status:'VERIFIED'}]);
  const result=calculateMarketOpportunity({products,organizations,route:'retail',assumptions:{annual_units_per_location:10,distribution_probability:20},evidenceByOrganization:profiles});
  assert.equal(result.summary.target_account_count,2);assert.equal(result.summary.verified_account_count,1);assert.equal(result.summary.account_category_coverage,50);
  assert.equal(result.summary.base_manufacturer_revenue,4000);assert.equal(result.summary.evidence_backed_manufacturer_revenue,2000);
  assert.equal(result.account_opportunities.find(x=>x.organization_id==='verified').evidence_status,'VERIFIED');
  assert.equal(result.account_opportunities.find(x=>x.organization_id==='profile').evidence_backed_manufacturer_revenue,0);
});

test('opportunity workspaces persist tenant-scoped scenarios and gate approval on evidence',async()=>{
  const [migration,apiSource,ui]=await Promise.all([
    readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8'),
    readFile(new URL('../api/opportunities.js',import.meta.url),'utf8'),
    readFile(new URL('../index.html',import.meta.url),'utf8')
  ]);
  assert.match(migration,/create table if not exists opportunity_workspaces/);
  assert.match(apiSource,/where ow\.manufacturer_id=\$\{tenant\.tenant_id\}/);
  assert.match(apiSource,/Verify relevant account assortment evidence before approving/);
  for(const marker of ['Opportunity Workspace','loadOpportunityWorkspaces','Approve Opportunity','Evidence-Backed','Export CSV'])assert.match(ui,new RegExp(marker));
});

test('review-required product evidence and category-specific channels expand candidates transparently',()=>{
  const mount={id:'m1',name:'Full Motion TV Mount',category:'TV Mounts',categories:['TV Mounts'],channels:['home_improvement']};
  const observed=evidenceProfiles([{organization_id:'observed',payload:{offerings:[{name:'Tilting Television Wall Mount',category:'Mounts'}]},source_url:'https://example.com/mounts',observed_at:'2026-09-03T00:00:00Z',verification_status:'REVIEW_REQUIRED'}]);
  const observedFit=evaluateProductAccountFit(mount,{id:'observed',categories:[],channel_codes:[]},observed.get('observed'));
  assert.equal(observedFit.qualified,true);assert.equal(observedFit.tier,'OBSERVED_ASSORTMENT_FIT');assert.equal(observedFit.evidence_status,'OBSERVED_REVIEW_REQUIRED');
  const channelFit=evaluateProductAccountFit(mount,{id:'candidate',categories:['Home'],channel_codes:['home_improvement']});
  assert.equal(channelFit.qualified,true);assert.equal(channelFit.tier,'CATEGORY_CHANNEL_CANDIDATE');assert.equal(channelFit.evidence_status,'RESEARCH_REQUIRED');
  const wrongFit=evaluateProductAccountFit(mount,{id:'wrong',categories:['Furniture'],channel_codes:['furniture'],footprint:5000,confidence:100});
  assert.equal(wrongFit.qualified,false);assert.equal(wrongFit.tier,'INCOMPATIBLE_VERTICAL');
});

test('saved buyer contact details are joined to account results without changing buyer research',async()=>{
  const profiles=buyerProfiles([{organization_id:'o1',id:'b1',name:'Jane Buyer',title:'Electronics Merchant',email:'jane@example.com',phone:'555-0100',linkedin:'https://linkedin.com/in/jane',confidence:80}]);
  assert.equal(profiles.get('o1')[0].email,'jane@example.com');assert.equal(profiles.get('o1')[0].phone,'555-0100');
  const [findRevenue,market,ui]=await Promise.all([readFile(new URL('../api/find-me-revenue.js',import.meta.url),'utf8'),readFile(new URL('../api/market-opportunity.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  for(const source of [findRevenue,market]){assert.match(source,/b\.email/);assert.match(source,/b\.phone/);assert.match(source,/b\.linkedin/);assert.match(source,/buyerProfiles/)}
  assert.match(ui,/Buyer Contact/);assert.match(ui,/buyerContactSummary/);assert.match(ui,/mailto:/);assert.match(ui,/tel:/);
  const buyerTool=await readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8');assert.match(buyerTool,/api\.openai\.com\/v1\/responses/);
});

test('market intelligence returns calculated results when workspace schema is missing',async()=>{
  const source=await readFile(new URL('../api/market-opportunity.js',import.meta.url),'utf8');
  assert.match(source,/error\?\.code==='42P01'/);assert.match(source,/persistence_status='SCHEMA_REQUIRED'/);assert.match(source,/scenario was calculated, but workspaces were not saved/);
});

test('revenue APIs join evidence source URLs through the production schema',async()=>{
  const sources=await Promise.all(['find-me-revenue.js','market-opportunity.js'].map(name=>readFile(new URL(`../api/${name}`,import.meta.url),'utf8')));
  for(const source of sources){
    assert.match(source,/join evidence_sources es on es\.id=ce\.source_id/);
    assert.match(source,/es\.source_url/);
    assert.doesNotMatch(source,/select ce\.organization_id,ce\.payload,ce\.source_url/);
  }
});

test('OpenAI account product research keeps official-domain comparable products and channel evidence',()=>{
  const source='https://www.academy.com/p/bluetooth-speaker';
  const payload={output:[{type:'web_search_call',action:{sources:[{url:source,title:'Speaker'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({status:'SUCCESS',search_summary:'Found one',products:[{brand:'JBL',name:'Portable Bluetooth Speaker',category:'Bluetooth Speakers',price_text:'$99.99',availability:'Shipping and store pickup available',purchase_channel:'OMNICHANNEL_SIGNAL',source_url:source,evidence_quote:'Shipping and pickup available',confidence:86}]})}]}]};
  const result=normalizeOpenAIProducts(payload,{domain:'academy.com'});
  assert.equal(result.status,'SUCCESS');assert.equal(result.products.length,1);assert.equal(result.products[0].purchase_channel,'OMNICHANNEL_SIGNAL');
  assert.equal(normalizeOpenAIProducts(payload,{domain:'different.com'}).products.length,0);
});

test('distributor research accepts explicit third-party line evidence only for the exact account',()=>{
  const source='https://manufacturer.example/distributors';
  const payload={output:[{type:'web_search_call',action:{sources:[{url:source,title:'Authorized distributors'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({status:'FOUND',search_summary:'Line found',products:[{account:'Davis Distribution',brand:'Example Audio',name:'Example Audio product line',category:'Audio',price_text:'',availability:'Authorized distributor',purchase_channel:'UNKNOWN',source_url:source,source_title:'Authorized distributors',evidence_quote:'Davis Distribution carries Example Audio',confidence:84}]})}]}]};
  assert.equal(normalizeOpenAIProducts(payload,{domain:'davisdistribution.com',account:'Davis Distribution',allow_third_party_evidence:true}).products.length,1);
  assert.equal(normalizeOpenAIProducts(payload,{domain:'davisdistribution.com',account:'Different Distributor',allow_third_party_evidence:true}).products.length,0);
  assert.equal(normalizeOpenAIProducts(payload,{domain:'davisdistribution.com',account:'Davis Distribution'}).products.length,0);
});

test('account lead-gen UI is account-scoped, deletable, and captures head office',async()=>{
  const [ui,migration,status,productApi,brandApi]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/db-init-v9-8.js',import.meta.url),'utf8'),readFile(new URL('../api/system-status.js',import.meta.url),'utf8'),readFile(new URL('../api/products.js',import.meta.url),'utf8'),readFile(new URL('../api/brands.js',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(ui,/const NAV=\[[^\]]*'Channel Intelligence'/);assert.match(ui,/openAccountChannel/);assert.doesNotMatch(ui,/Add 50 Retail Distributors/);
  for(const marker of ['deleteProduct','deleteBrand','Head Office','Online vs In-store','Buyer Contact'])assert.match(ui,new RegExp(marker));
  assert.match(migration,/retail_organizations add column if not exists headquarters/);assert.match(status,/retail_organizations\.headquarters/);
  assert.match(productApi,/req\.method==='DELETE'/);assert.match(brandApi,/req\.method==='DELETE'/);
});

test('products can be added and fully edited without a catalog import',async()=>{
  const [ui,productApi]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/products.js',import.meta.url),'utf8')]);
  for(const marker of ['openProductEditor','saveProductEditor','Add Product','Edit','Product Family','Additional Categories','Sales Channels','SKUs & Pricing','Add SKU'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/method:id\?'PATCH':'POST'/);assert.match(ui,/productEditorModal/);assert.match(ui,/@media\(max-width:760px\)[\s\S]*?\.variantRow\{grid-template-columns:1fr 1fr\}/);
  assert.match(productApi,/req\.method==='PATCH'/);assert.match(productApi,/where id=\$\{id\} and manufacturer_id=\$\{tenant\.tenant_id\} and active=true/);
  for(const marker of ['product_family','description','positioning','differentiator','product_url','image_url','product_categories','product_channels','product_variants'])assert.match(productApi,new RegExp(marker));
  assert.match(productApi,/accessibleBrand\(sql,product\.brand_id,tenant\)/);assert.match(productApi,/sql\.begin/);
});

test('account information can be edited without replacing its organization id',async()=>{
  const [ui,apiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/account-universe.js',import.meta.url),'utf8')]);
  assert.match(ui,/openEditAccount/);assert.match(ui,/saveAccountEdits/);assert.match(ui,/method:'PATCH'/);assert.match(ui,/Corrections keep the existing account ID/);
  assert.match(apiSource,/req\.method==='PATCH'/);assert.match(apiSource,/where id=\$\{id\} and active=true returning \*/);assert.match(apiSource,/headquarters=\$\{/);
});

test('weekly retailer discovery retains only attributable candidates and deduplicates domains',()=>{
  const source='https://www.example-retailer.com/about';
  const payload={output:[{type:'web_search_call',action:{sources:[{url:source,title:'About Example Retailer'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({status:'FOUND',search_summary:'One candidate',retailers:[{name:'Example Retailer',official_domain:'example-retailer.com',organization_type:'retailer',channels:['specialty retail'],categories:['Consumer Electronics'],coverage:'National',region:'US',headquarters:'Austin, Texas',footprint:40,ecommerce:true,source_url:source,source_title:'About',evidence_quote:'Specialty consumer electronics retailer',confidence:82},{name:'Duplicate Banner',official_domain:'example-retailer.com',organization_type:'retailer',channels:[],categories:[],coverage:'',region:'',headquarters:'',footprint:0,ecommerce:true,source_url:source,source_title:'About',evidence_quote:'Retailer',confidence:60}]})}]}]};
  const result=normalizeOpenAIRetailers(payload);assert.equal(result.status,'SUCCESS');assert.equal(result.retailers.length,1);assert.equal(result.retailers[0].verification_status,'DISCOVERY_CANDIDATE');assert.equal(result.retailers[0].headquarters,'Austin, Texas');
});

test('retailer discovery and opportunity alerts share the existing scheduled refresh jobs',async()=>{
  const [agent,weekly,living,ui,status,config]=await Promise.all([readFile(new URL('../api/retailer-discovery-agent.js',import.meta.url),'utf8'),readFile(new URL('../api/weekly-refresh.js',import.meta.url),'utf8'),readFile(new URL('../api/living-intelligence-refresh.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/system-status.js',import.meta.url),'utf8'),readFile(new URL('../vercel.json',import.meta.url),'utf8')]);
  assert.match(agent,/searchOpenAIRetailers/);assert.match(agent,/DISCOVERY_CANDIDATE/);assert.match(agent,/runLivingIntelligencePipeline/);assert.match(agent,/where active=true and \(lower\(regexp_replace\(domain/);
  assert.match(weekly,/runRetailerDiscovery/);assert.match(weekly,/weekly-retailer-discovery/);assert.match(living,/runOpportunityAlertRefresh/);assert.match(ui,/Discover New Retailers/);assert.match(ui,/Runs every Monday/);assert.match(status,/Retailer Discovery/);
  const crons=JSON.parse(config).crons;assert.equal(crons.length,2);assert.ok(crons.some(x=>x.path==='/api/weekly-refresh'&&x.schedule==='0 13 * * 1'));
});

test('account research modal keeps product research visible across screen sizes',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(ui,/\.modalCard\.accountResearchModal\s*\{[^}]*width:\s*min\(1320px,/s);
  assert.match(ui,/\.accountResearchGrid\s*\{[^}]*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(ui,/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.accountResearchGrid\s*\{\s*grid-template-columns:\s*1fr/s);
  assert.match(ui,/class="card accountResearchPanel"><div class="label">PRODUCT RESEARCH/);
  assert.match(ui,/aria-label="Scrollable product research results"/);
  assert.match(ui,/classList\.remove\(["']accountResearchModal["']\)/);
});

test('opportunity details support editable proposed assortments and account competitive offerings',async()=>{
  const [ui,apiSource]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../api/opportunities.js',import.meta.url),'utf8')
  ]);
  for(const marker of ['Account Assortment Comparison','Edit SKU Mix','Save & Confirm SKU Mix','addAssortmentProduct','removeAssortmentProduct','All Source-Backed Account Offerings','Research Account Products'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/proposed_assortment/);assert.match(apiSource,/assortment_updated_at/);assert.match(apiSource,/manufacturer_id=\$\{tenant\.tenant_id\}/);
  assert.match(apiSource,/from commercial_evidence ce join evidence_sources es/);assert.match(apiSource,/from competitive_products cp join accounts a/);
  assert.match(apiSource,/competitive_offerings/);assert.match(apiSource,/b\.email/);assert.match(apiSource,/b\.phone/);assert.match(apiSource,/b\.linkedin/);
  for(const marker of ['Opportunity Buyers','Save Buyers','saveOpportunityBuyers','Research All Buyers'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/assigned_buyer_ids/);assert.match(apiSource,/assigned_buyers/);assert.match(apiSource,/buyer_assigned_at/);assert.match(apiSource,/a\.organization_id=\$\{existing\.organization_id\}/);
});

test('account opportunity model consolidates account tabs, SKUs and buyers into an executive PDF',async()=>{
  const [ui,apiSource,pdfSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8'),readFile(new URL('../api/_market-report.js',import.meta.url),'utf8')]);
  for(const marker of ['Combine products from this account','accountTabAssortment','mergeOpportunityTabAssortments','Download Executive Brief','downloadAccountOpportunityBrief','consolidatedOpportunityPlan','market-report-snapshots','market-report-pdf'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/new Set\(current\.map\(item=>skuComparisonKey\(item\)\)\)/);
  assert.match(ui,/assigned_buyer_ids/);assert.match(apiSource,/assignedBuyers\.length!==buyerIds\.length/);assert.match(apiSource,/a\.organization_id=\$\{existing\.organization_id\}/);
  assert.match(pdfSource,/Executive Takeaways/);assert.match(pdfSource,/recommended_actions/);assert.match(pdfSource,/modeled estimates/);
});

test('account assortment comparison adds and removes exact SKUs and saves membership with channel status',async()=>{
  const [ui,apiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8')]);
  for(const marker of ['Edit proposed account SKUs','comparisonAddSku','addComparisonSku','removeComparisonSku','Remove SKU','Save Assortment & Competitive Channels','proposed_assortment:proposed','competitive_channel_status:competitiveStatus','comparison_status:skuStatus'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/That SKU is already in the account assortment/);
  assert.match(apiSource,/Assortment item \$\{index\+1\} is not in this tenant's catalog/);
  assert.match(apiSource,/SKU \$\{requestedSku\} is not active in this tenant's catalog/);
  assert.match(apiSource,/where p\.manufacturer_id=\$\{tenant\.tenant_id\}/);
});

test('product research screen edits the selected account analysis assortment',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const marker of ['Proposed SKUs for this analysis','researchAssortmentEditor','researchAssortmentWorkspace','addResearchAssortmentSku','removeResearchAssortmentSku','saveResearchAssortment','Save Proposed SKUs','openAccountResearchWithoutAssortmentEditor'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/state\.selectedResearchWorkspaceId=String\(id\)/);
  assert.match(ui,/proposed_assortment:researchAssortmentDrafts\[w\.id\]\|\|\[\]/);
  assert.match(ui,/Research evidence remains separate and is not changed by these manual selections/);
});

test('account assortment volume uses editable SKU prices to calculate annual revenue',async()=>{
  const [ui,apiSource]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../api/opportunities.js',import.meta.url),'utf8')
  ]);
  for(const marker of ['Monthly Units / Store','Store / location count','Retail Price','Wholesale Price','Annual Revenue','assortmentMonthly','assortmentRetail','assortmentDealer','Editable retail','Editable wholesale'])assert.match(ui,new RegExp(marker,'i'));
  assert.match(ui,/Monthly units × stores × wholesale × 12/i);
  assert.match(apiSource,/pv\.wholesale/);assert.match(apiSource,/pv\.msrp/);assert.match(apiSource,/pv\.map/);
  for(const marker of ['monthly_sales_volume','dealer_cost','retail_price','annual_revenue','account_sku_monthly_units_x_dealer_cost_x_store_count'])assert.match(apiSource,new RegExp(marker));
  assert.match(apiSource,/modeled_contribution:dealerCost/);
  assert.equal(calculateSkuAnnualRevenue({dealer_cost:40,monthly_sales_volume:5,store_count:10}),24000);
  assert.equal(calculateSkuAnnualRevenue({dealer_cost:40,monthly_sales_volume:0,store_count:10}),0);
  assert.match(apiSource,/calculateSkuAnnualRevenue/);
});

test('deep market analysis queues the top 25 accounts and saves editable channel status',async()=>{
  const [ui,opportunitiesApi,buyersApi,researchApi]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8'),readFile(new URL('../api/buyers.js',import.meta.url),'utf8'),readFile(new URL('../api/account-research.js',import.meta.url),'utf8')]);
  for(const marker of ['Run Deep Market Analysis','runDeepMarketAnalysis','comparison_product_ids:ids','Each completed account is saved automatically','Competitive Product','Save Competitive Product Channels','competitiveInStore','competitiveOnline','competitiveOfferingKey','In-Store Opportunity','Online Opportunity','openBuyerEditor','Save Buyer','productBatches'])assert.match(ui,new RegExp(marker));
  assert.match(ui,/slice\(0,25\)/);
  for(const marker of ['comparison_status','competitive_channel_status','manual_competitive_product_review','in_store','online','store_count'])assert.match(opportunitiesApi,new RegExp(marker));
  assert.match(buyersApi,/req\.method==='PATCH'/);
  assert.match(researchApi,/existingComparisonIds/);assert.match(researchApi,/linkedProductIds/);
});

test('opportunity workspace can add and remove targets without deleting account intelligence',async()=>{
  const [ui,apiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8')]);
  assert.doesNotMatch(ui,/Trust boundary/);
  for(const marker of ['Add Target Account','openAddTargetAccount','createTargetAccount','Remove This Opportunity','removeTargetAccount','account_and_evidence_preserved'])assert.match(`${ui}\n${apiSource}`,new RegExp(marker));
  assert.match(apiSource,/req\.body\?\.action==='create'/);assert.match(apiSource,/req\.method==='DELETE'/);assert.match(apiSource,/delete from opportunity_workspaces/);
  assert.doesNotMatch(apiSource,/delete from retail_organizations/);assert.doesNotMatch(apiSource,/delete from commercial_evidence/);
});

test('market analysis supports persistent account adjustments and complete editable exports',async()=>{
  const [ui,opportunitiesApi,marketApi]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8'),readFile(new URL('../api/market-opportunity.js',import.meta.url),'utf8')]);
  for(const marker of ['Adjusted annual manufacturer revenue','Include in exported analysis','Opportunity rationale','Additional account input','Save Account Adjustment','Edit SKU Mix & Monthly Volume','Preview & Export Full Analysis','Download PDF','Open Email App','Account-Level Detail'])assert.match(ui,new RegExp(marker));
  for(const marker of ['account_adjustment','manual_annual_revenue','include_in_report','model_generated_annual_revenue'])assert.match(opportunitiesApi,new RegExp(marker));
  assert.match(marketApi,/retainAccountEdits/);assert.match(marketApi,/existingByOrganization/);assert.match(marketApi,/previousScenario\.account_adjustment/);
  assert.match(ui,/marketAccounts\(true\)/);assert.match(ui,/assigned_buyer/);assert.match(ui,/competitive_offerings/);
});

test('opportunities are grouped by account with brand and analysis-date tabs',async()=>{
  const ui=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const marker of ['opportunityBrands','opportunityDate','opportunityLabel','opportunityTabs','Account Opportunities','Search account, brand, product, or owner','All statuses','All routes'])assert.match(ui,new RegExp(marker,'i'));
  assert.match(ui,/state\.workspaces\.filter\(item=>String\(item\.organization_id\)===String\(w\.organization_id\)\)/);
  assert.match(ui,/role="tab"/);assert.match(ui,/aria-selected=/);
});

test('product intelligence supports multi-product comparison and exact store evidence',async()=>{
  const [ui,apiSource,openaiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8')]);
  for(const marker of ['comparisonProduct:checked','comparison_product_ids','productStoreZip','productStoreLocation','Store Verification','evidenceSquare','Evidence backed','Research needed'])assert.match(ui,new RegExp(marker));
  for(const marker of ['comparison_product_ids','store_zip','store_location','store_verification_request','confirmed_count','signal_count'])assert.match(apiSource,new RegExp(marker));
  for(const marker of ['CONFIRMED_AT_LOCATION','SIGNAL_ONLY','NOT_FOUND','NOT_REQUESTED','Price is comparison context, never an exclusion criterion'])assert.match(openaiSource,new RegExp(marker));
});

test('account evidence and website catalogs have explicit review and approval flows',async()=>{
  const [ui,catalogWebsite,catalogImport]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/catalog-website.js',import.meta.url),'utf8'),readFile(new URL('../api/catalog-import.js',import.meta.url),'utf8')]);
  for(const marker of ['Review & Approve','openAccountDataReview','openEvidenceReview','Approve Account Data as Verified','approveAllAccountEvidence','Other account research','websiteCandidate','Extract Selected Products','extractSelectedWebsiteProducts','website_discovery'])assert.match(ui,new RegExp(marker));
  for(const marker of ["action==='extract'",'extractCatalogPages','CATALOG_PAGE_SCHEMA','likelyProductPage','requires_explicit_approval'])assert.match(catalogWebsite,new RegExp(marker));
  assert.match(catalogImport,/approved!==true/);assert.match(catalogImport,/CATALOG_APPROVAL_REQUIRED/);assert.match(catalogImport,/review_token/);
});

test('evidence approval reconciles matching opportunities and competitive offerings',async()=>{
  const [review,reconcile]=await Promise.all([readFile(new URL('../api/evidence-review.js',import.meta.url),'utf8'),readFile(new URL('../api/_opportunity-evidence.js',import.meta.url),'utf8')]);
  for(const marker of ['reconcileOpportunityEvidenceForOrganization','syncCompetitiveOfferingVerification'])assert.match(review,new RegExp(marker));
  for(const marker of ['evaluateProductAccountFit','evidence_backed_manufacturer_revenue','research_required','competitive_products'])assert.match(reconcile,new RegExp(marker));
});

test('catalog review is editable and enforces the visible extraction limit',async()=>{
  const [ui,apiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/catalog-website.js',import.meta.url),'utf8')]);
  for(const marker of ['updateCatalogReviewRow','removeCatalogReviewRow','Validate & Import','MAX_CATALOG_PAGES','Extraction complete'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/candidates\.length>20/);assert.doesNotMatch(apiSource,/\.slice\(0,20\)/);
  assert.match(apiSource,/CATALOG_BATCH_SIZE=4/);assert.match(apiSource,/attempt<=2/);assert.match(apiSource,/failed_pages/);assert.match(apiSource,/PARTIAL_SUCCESS/);
});

test('brands and complete market scenarios can be edited and saved',async()=>{
  const [ui,brands,scenarios,status]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/brands.js',import.meta.url),'utf8'),readFile(new URL('../api/market-scenarios.js',import.meta.url),'utf8'),readFile(new URL('../api/system-status.js',import.meta.url),'utf8')]);
  for(const marker of ['openBrand','saveBrand','Saved Scenarios','Save Current Analysis','loadMarketScenario','deleteMarketScenario'])assert.match(ui,new RegExp(marker));
  assert.match(brands,/req\.method==='PATCH'/);for(const marker of ['result_snapshot','manufacturer_id','market_opportunity_scenarios'])assert.match(scenarios,new RegExp(marker));assert.match(status,/market_opportunity_scenarios/);
});

test('saved comparable product context is returned with account offerings',async()=>{
  const [research,productsApi,ui]=await Promise.all([readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../api/competitive-products.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  assert.match(research,/comparison_product_ids:comparisonProductIds/);assert.match(productsApi,/comparison_product_ids/);assert.match(ui,/saved portfolio-comparison link/);
});

test('intelligence foundation migration is additive, idempotent and append-only',()=>{
  for(const table of ['entity_field_observations','current_entity_field_values','canonical_products','canonical_product_identifiers','retailer_product_listings','retailer_listing_observations','product_identity_matches','l36_trust_evaluations'])assert.match(INTELLIGENCE_FOUNDATION_SQL,new RegExp(`create table if not exists ${table}`));
  assert.doesNotMatch(INTELLIGENCE_FOUNDATION_SQL,/drop\s+(table|column)|truncate|delete\s+from/i);
  assert.match(INTELLIGENCE_FOUNDATION_SQL,/entity_field_observations_immutable/);assert.match(INTELLIGENCE_FOUNDATION_SQL,/retailer_listing_observations_immutable/);assert.match(INTELLIGENCE_FOUNDATION_SQL,/product_identity_matches_immutable/);assert.match(INTELLIGENCE_FOUNDATION_SQL,/l36_trust_evaluations_immutable/);
  assert.match(INTELLIGENCE_FOUNDATION_SQL,/manufacturer_sku/);assert.match(INTELLIGENCE_FOUNDATION_SQL,/\bgtin\b/);assert.match(INTELLIGENCE_FOUNDATION_SQL,/\bean\b/);assert.match(INTELLIGENCE_FOUNDATION_SQL,/\bmpn\b/);
});

test('field evidence preserves verified truth and exposes explicit presentation states',()=>{
  const verified={verification_status:'VERIFIED',confidence:82};
  assert.equal(shouldPromoteObservation(verified,{verification_status:'MODELED',confidence:100,user_verified:false}),false);
  assert.equal(shouldPromoteObservation(verified,{verification_status:'VERIFIED',confidence:90,user_verified:false}),true);
  assert.deepEqual(evidencePresentation('USER_ENTERED'),{status:'USER_ENTERED',label:'USER ENTERED',kind:'user'});
  assert.equal(evidencePresentation('STALE').kind,'stale');
});

test('L36 Trust Score is explainable and penalizes conflicts and unsupported claims',()=>{
  const now=new Date().toISOString(),strong=calculateTrustScore({observations:[{value:'Home Audio',source_kind:'official_retailer',observed_at:now},{value:'Home Audio',source_kind:'trade_publication',observed_at:now}],product_match_confidence:96,account_match_confidence:94,buyer_role_confidence:92,category_ownership_confidence:91,in_store_evidence_strength:95,revenue_assumption_completeness:94});
  assert.ok(strong.trust_score>=90);assert.equal(strong.trust_level,'VERIFIED_HIGH_CONFIDENCE');assert.ok(strong.reasons.length);assert.equal(strong.algorithm_version,'l36-trust-v1');
  const weak=calculateTrustScore({source_authority:40,evidence_freshness:20,source_agreement:20,conflicts:['Employer conflict'],unsupported_claims:['Unattributed revenue claim']});assert.ok(weak.trust_score<50);assert.equal(trustLevel(weak.trust_score),'INSUFFICIENT_EVIDENCE');assert.ok(weak.recommended_verification.length);
});

test('canonical product matching prefers exact identifiers and never auto-links similar names alone',()=>{
  assert.equal(normalizeIdentifier('GTIN','00-123 456'),'00123456');
  const exact=evaluateProductIdentityMatch({name:'Reference Speaker',brand_name:'Aurelius',identifiers:{GTIN:'00123456789012'}},{product_name:'Reference Speaker Black',brand_name:'Aurelius',identifiers:{GTIN:'00123456789012'}});assert.equal(exact.product_match_confidence,99);assert.equal(exact.auto_link_allowed,true);
  const similar=evaluateProductIdentityMatch({name:'Reference Bookshelf Speaker',brand_name:'Aurelius',category:'Audio'},{product_name:'Reference Bookshelf Speakers',brand_name:'Aurelius',category:'Audio'});assert.equal(similar.auto_link_allowed,false);assert.ok(similar.product_match_confidence<75);
  const conflict=evaluateProductIdentityMatch({brand_name:'Aurelius',identifiers:{UPC:'111111111111'}},{brand_name:'Aurelius',identifiers:{UPC:'222222222222'}});assert.equal(conflict.auto_link_allowed,false);assert.ok(conflict.conflicts.length);
});

test('intelligence foundation APIs enforce tenant scope and avoid client-side provider credentials',async()=>{
  const [fieldApi,trustApi,identityApi,status,ui]=await Promise.all([readFile(new URL('../api/field-evidence.js',import.meta.url),'utf8'),readFile(new URL('../api/trust-score.js',import.meta.url),'utf8'),readFile(new URL('../api/product-identity.js',import.meta.url),'utf8'),readFile(new URL('../api/system-status.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  for(const source of [fieldApi,trustApi,identityApi])assert.match(source,/resolveTenant\(req,res\)/);
  assert.match(fieldApi,/manufacturer_id=\$\{tenant\.tenant_id\}/);assert.match(trustApi,/manufacturer_id=\$\{tenant\.tenant_id\}/);assert.match(identityApi,/manufacturer_id=\$\{tenant\.tenant_id\}/);
  assert.doesNotMatch(`${fieldApi}${trustApi}${identityApi}`,/OPENAI_API_KEY|FIRECRAWL_API_KEY|APOLLO_API_KEY/);
  for(const table of ['entity_field_observations','canonical_products','retailer_product_listings','l36_trust_evaluations'])assert.match(status,new RegExp(table));
  assert.match(ui,/db-init-intelligence-foundation/);
});

test('Account Intelligence Summary answers the four commercial questions from attributable data',()=>{
  const now=new Date().toISOString(),summary=buildAccountIntelligenceSummary({organization:{id:'org-1',name:'Example Retailer',last_verified:now},target:{fit_score:88,whitespace_score:76},workspaces:[{id:'workspace-1',status:'ready',next_action:'Build a 50-store pilot proposal',updated_at:now,scenario:{account:{fit_score:92,fit_reason:'Audio category and channel profile align',base_manufacturer_revenue:875000,evidence_status:'VERIFIED'},proposed_assortment:[{product_id:'p1',product_name:'Reference Speaker',brand_name:'Demo Audio',sku:'DA-100',dealer_cost:200,monthly_sales_volume:10,annual_revenue:240000}]}}],buyers:[{name:'Jordan Merchant',title:'Audio Category Manager',department:'Consumer Electronics',category_scope:'Audio and Home Theater',buyer_role:'CATEGORY_OWNER',identity_confidence:94,category_confidence:91,employment_verification_status:'VERIFIED',category_verification_status:'VERIFIED',employment_evidence_url:'https://retailer.example/team',category_evidence_url:'https://retailer.example/audio-team',category_last_verified:now}],evidence:[{payload:{offerings:[{name:'Soundbar','store_verification':'CONFIRMED_AT_LOCATION'}]},source_url:'https://retailer.example/audio',source_kind:'official_retailer',publisher:'Example Retailer',observed_at:now,last_verified_at:now,verification_status:'VERIFIED',evidence_type:'retailer_assortment'}]});
  assert.equal(summary.opportunity.value,875000);assert.equal(summary.opportunity.status,'MODELED');assert.equal(summary.fit.score,92);assert.equal(summary.assortment_gap.label,'High');assert.equal(summary.buyer.ownership_confirmed,true);assert.equal(summary.in_store_coverage.status,'VERIFIED');assert.equal(summary.products.length,1);assert.equal(summary.next_best_action.approval_required,true);assert.ok(summary.trust_score>0);assert.ok(summary.sources.length>=2);
});

test('Account Intelligence Summary fails closed when category, assortment or opportunity support is missing',()=>{
  const buyer=selectCategoryOwner([{name:'Generic Buyer',title:'Senior Buyer',identity_confidence:90,category_confidence:95,employment_verification_status:'VERIFIED',category_verification_status:'UNCONFIRMED',category_scope:'Audio'}]);assert.equal(buyer.identified,true);assert.equal(buyer.ownership_confirmed,false);assert.equal(buyer.category_confidence,0);assert.equal(buyer.category_scope,'Unconfirmed');assert.equal(buyer.category_status,'UNCONFIRMED');
  assert.equal(selectCategoryOwner([{name:'Former Category Owner',identity_confidence:90,category_confidence:95,employment_verification_status:'UNCONFIRMED',category_verification_status:'VERIFIED',category_scope:'Audio'}]).ownership_confirmed,false);
  assert.deepEqual(inStoreCoverage([{payload:{offerings:[{availability:'Available online'}]},verification_status:'REVIEW_REQUIRED'}]).label,'Online Only / Store Unknown');
  const summary=buildAccountIntelligenceSummary({organization:{id:'org-2',name:'Unknown Account'},buyers:[{name:'Generic Buyer',title:'Senior Buyer',identity_confidence:90,category_confidence:95,employment_verification_status:'VERIFIED',category_verification_status:'UNCONFIRMED',category_scope:'Audio'}]});assert.equal(summary.opportunity.status,'NEEDS_RESEARCH');assert.equal(summary.assortment_gap.label,'Unconfirmed');assert.equal(summary.in_store_coverage.label,'Unconfirmed');assert.equal(summary.next_best_action.action,'Run Find Me Revenue for this account');assert.equal(summary.last_verified_at,null);
});

test('Account Intelligence Summary combines multiple brand workspaces without duplicating SKUs',()=>{
  const workspace=(id,items)=>({id,scenario:{account:{base_manufacturer_revenue:999999,fit_score:80},proposed_assortment:items}}),shared={product_id:'p1',product_name:'Speaker',brand_name:'Brand A',sku:'SP-1',dealer_cost:100,monthly_sales_volume:2,annual_revenue:2400},summary=buildAccountIntelligenceSummary({organization:{id:'org-3',name:'Multi Brand Account'},workspaces:[workspace('one',[shared]),workspace('two',[{...shared,annual_revenue:1800},{product_id:'p2',product_name:'Soundbar',brand_name:'Brand B',sku:'SB-2',dealer_cost:200,monthly_sales_volume:3,annual_revenue:7200}])]});
  assert.equal(summary.workspace_count,2);assert.equal(summary.products.length,2);assert.equal(summary.opportunity.value,9600);assert.equal(summary.important_distinctions.opportunity,'MODELED');
});

test('Account Intelligence Summary API keeps tenant-private workspaces scoped server-side',async()=>{
  const source=await readFile(new URL('../api/account-intelligence-summary.js',import.meta.url),'utf8');assert.match(source,/resolveTenant\(req,res\)/);assert.match(source,/manufacturer_id=\$\{tenant\.tenant_id\}/);assert.match(source,/owner_user_id=\$\{tenant\.user_id\}/);assert.match(source,/visibility='team'/);assert.match(source,/team_id=any/);assert.match(source,/visibility='tenant'/);assert.match(source,/commercial_evidence/);assert.match(source,/organization_id=\$\{organizationId\}/);assert.doesNotMatch(source,/OPENAI_API_KEY|FIRECRAWL_API_KEY|APOLLO_API_KEY/);
});

test('Account 360 renders a progressive-disclosure Intelligence Summary without relabeling models as facts',async()=>{
  const ui=await readFile(new URL('../executive-workflow-ui.js',import.meta.url),'utf8');for(const marker of ['ACCOUNT INTELLIGENCE SUMMARY','What can I sell here?','Why should this retailer buy it?','Who owns the decision?','What should I do next?','Opportunity','Assortment Gap','Buyer Identified','In-Store Coverage','Last Verified','L36 Trust Score','Next Best Action','details','Attributable sources','Modeled manufacturer revenue','Unconfirmed'])assert.match(ui,new RegExp(marker,'i'));assert.match(ui,/api\/account-intelligence-summary\?organization_id=/);assert.match(ui,/accountIntelligenceSummaryHtml/);assert.match(ui,/Human approval required/);assert.doesNotMatch(ui,/verified retailer revenue/i);
});

test('Revenue Mission migration is additive, idempotent and preserves immutable history',()=>{
  for(const table of ['revenue_missions','revenue_mission_opportunities','revenue_mission_events'])assert.match(REVENUE_MISSION_SQL,new RegExp(`create table if not exists ${table}`));
  assert.match(REVENUE_MISSION_SQL,/revenue_mission_events_immutable/);assert.match(REVENUE_MISSION_SQL,/before update or delete on revenue_mission_events/);
  assert.doesNotMatch(REVENUE_MISSION_SQL,/drop\s+(table|column)|truncate|delete\s+from|update\s+(accounts|buyers|products|opportunity_workspaces)/i);
  for(const field of ['manufacturer_id','owner_user_id','team_id','visibility','target_revenue','confidence_adjusted_pipeline'])assert.match(REVENUE_MISSION_SQL,new RegExp(field));
});

test('Revenue Mission funnel metrics are deterministic and keep modeled revenue distinct from confidence',()=>{
  const row=(id,stage,amount)=>({opportunity_id:id,pipeline_stage:stage,scenario:{account:{name:`Account ${id}`,base_manufacturer_revenue:amount,fit_score:82,evidence_status:'REVIEW_REQUIRED',evidence_count:1},proposed_assortment:[{dealer_cost:50,monthly_sales_volume:2,fit_score:80}]},next_action:'Review'});
  const metrics=calculateMissionMetrics({target_revenue:2000},[row('1','IDENTIFIED',100),row('2','QUALIFIED',200),row('3','BUYER_CONFIRMED',300),row('4','COMMITTED',400),row('5','WON',500),row('6','LOST',600)]);
  assert.equal(metrics.identified_revenue,1500);assert.equal(metrics.qualified_pipeline,1400);assert.equal(metrics.buyer_confirmed_pipeline,1200);assert.equal(metrics.committed_revenue,900);assert.equal(metrics.won_revenue,500);assert.equal(metrics.remaining_gap,1500);assert.equal(metrics.opportunity_count,6);assert.equal(metrics.open_opportunity_count,4);
  assert.ok(metrics.confidence_adjusted_pipeline>0);assert.ok(metrics.confidence_adjusted_pipeline<1000);assert.ok(metrics.average_trust_score>0);assert.equal(normalizePipelineStage('buyer_confirmed'),'BUYER_CONFIRMED');assert.throws(()=>normalizePipelineStage('invented'));
});

test('Revenue Mission actions disclose evidence gaps and require approval for commercial progression',()=>{
  const evaluated=evaluateMissionOpportunity({opportunity_id:'one',pipeline_stage:'IDENTIFIED',scenario:{account:{name:'Example Retailer',base_manufacturer_revenue:125000,fit_score:90,evidence_status:'INSUFFICIENT'},proposed_assortment:[]}});
  const actions=missionNextActions([evaluated],125000);assert.ok(actions.some(item=>/Verify current assortment/.test(item.action)));assert.ok(actions.some(item=>/category owner/.test(item.action)));assert.ok(actions.some(item=>/sell-in assumptions/.test(item.action)));assert.ok(actions.some(item=>item.approval_required===true));assert.equal(evaluated.evidence_status,'INSUFFICIENT');
});

test('Revenue Mission API enforces tenant scope and exposes no destructive endpoint',async()=>{
  const source=await readFile(new URL('../api/revenue-missions.js',import.meta.url),'utf8');
  assert.match(source,/resolveTenant\(req,res\)/);assert.match(source,/manufacturer_id=\$\{tenant\.tenant_id\}/);assert.match(source,/validateProducts/);assert.match(source,/validateOpportunities/);assert.match(source,/canAccess/);assert.match(source,/team_ids/);assert.match(source,/Only an Administrator can create a tenant-wide mission/);
  assert.doesNotMatch(source,/req\.method==='DELETE'|delete\s+from/i);assert.match(source,/PIPELINE_STAGE_CHANGED/);assert.match(source,/SCHEMA_REQUIRED/);
});

test('Find Me Revenue renders mission progress from existing opportunity workspaces',async()=>{
  const [ui,shell,index]=await Promise.all([readFile(new URL('../revenue-missions-ui.js',import.meta.url),'utf8'),readFile(new URL('../api/app-shell.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  for(const marker of ['REVENUE MISSIONS','Create Revenue Mission','Target','Identified','Qualified','Buyer Confirmed','Remaining Gap','Confidence-adjusted','L36 Trust','Human approval is required','currentOpportunityIds'])assert.match(ui,new RegExp(marker,'i'));
  assert.match(ui,/state\.marketOpportunity\?\.workspaces/);
  assert.match(ui,/\/api\/revenue-missions/);assert.doesNotMatch(ui,/mailto:|sendEmail|automatic.{0,20}(email|contact)/i);assert.match(shell,/revenue-missions-ui\.js/);assert.match(index,/db-init-revenue-missions/);
});

test('opportunity and weekly research recalculation refresh linked Revenue Missions without requiring the new schema',async()=>{
  const [opportunities,market,weekly,status]=await Promise.all([readFile(new URL('../api/opportunities.js',import.meta.url),'utf8'),readFile(new URL('../api/market-opportunity.js',import.meta.url),'utf8'),readFile(new URL('../api/weekly-refresh.js',import.meta.url),'utf8'),readFile(new URL('../api/system-status.js',import.meta.url),'utf8')]);
  for(const source of [opportunities,market]){assert.match(source,/refreshRevenueMissionsForOpportunities/);assert.match(source,/42P01/)}
  assert.match(weekly,/refreshAllRevenueMissions/);assert.match(weekly,/revenue_missions_refreshed/);
  for(const table of ['revenue_missions','revenue_mission_opportunities','revenue_mission_events'])assert.match(status,new RegExp(table));
});
