import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buyerResearchRecord, classifyBuyerResearchCandidate } from '../api/_buyer-research-runner.js';
import { BUYER_RESEARCH_RUNNER_SQL } from '../api/db-init-buyer-research-runner.js';
import { extractPublicBuyerEvidence, parseRobotsTxt, researchPublicAccountBuyers, robotsAllows, zeroPaidAccountOrigin } from '../api/_zero-paid-buyer-research.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function verifiedRecord(overrides={}){
  return buyerResearchRecord({
    name:'Jane Merchant',title:'Category Manager, Audio',department:'Consumer Electronics',category_scope:'Audio',subcategory_scope:'Speakers',buyer_role:'CATEGORY_OWNER',identity_confidence:92,category_confidence:88,employment_verification_status:'VERIFIED',category_verification_status:'VERIFIED',employment_evidence_url:'https://retailer.example/leadership/jane',category_evidence_url:'https://retailer.example/news/audio-category',evidence_date:'2026-11-01',source_type:'official_retailer',rationale:'Current employer and category responsibility are explicitly documented.',...overrides
  },{name:'Retailer Example',domain:'retailer.example',organization_type:'retailer',categories:['Audio'],channel_codes:['ce']},'2026-11-09T12:00:00Z');
}

test('V9.8.4 migration is additive, idempotent, tenant scoped, and append-only',()=>{
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/create table if not exists buyer_research_settings/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/automatic_refresh_enabled boolean not null default false/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/refresh_interval_days integer not null default 30/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/zero_paid_authorized boolean not null default false/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/create table if not exists buyer_research_jobs/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/create unique index if not exists buyer_research_jobs_one_active_uq/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/manufacturer_id uuid not null/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/buyer_research_candidates_immutable/i);
  assert.match(BUYER_RESEARCH_RUNNER_SQL,/buyer_research_events_immutable/i);
  assert.doesNotMatch(BUYER_RESEARCH_RUNNER_SQL,/\bdrop\s+(?:table|column|trigger)\b|\btruncate\b|\bdelete\s+from\b/i);
});

test('research records preserve provenance and never copy contact fields',()=>{
  const record=verifiedRecord({email:'guessed@example.com',phone:'555-0100',linkedin:'https://www.linkedin.com/in/jane-merchant'});
  assert.equal(record.public_email,'');
  assert.equal(record.public_phone,'');
  assert.equal(record.public_profile_url,'https://www.linkedin.com/in/jane-merchant');
  assert.equal(record.source_url,'https://retailer.example/leadership/jane');
  assert.equal(record.category_evidence_url,'https://retailer.example/news/audio-category');
  assert.equal(record.source_type,'official_retailer');
  assert.equal(record.observed_at,'2026-11-09T12:00:00.000Z');
});

test('old or future-dated evidence cannot enter the verified import path',()=>{
  const old=verifiedRecord({employment_last_verified:'2023-01-01',category_last_verified:'2023-01-01',evidence_date:'2023-01-01'});
  assert.equal(old.employment_verification_status,'UNCONFIRMED');
  assert.equal(old.category_verification_status,'UNCONFIRMED');
  assert.equal(old.category_confidence,0);
  assert.equal(classifyBuyerResearchCandidate(old,[]).classification,'UNVERIFIED_CANDIDATE');
});

test('candidate classifier separates new, unchanged, update, stale, conflict, unverified, and duplicate states',()=>{
  const record=verifiedRecord();
  assert.equal(classifyBuyerResearchCandidate(record,[]).classification,'NEW_VERIFIED_BUYER');
  const existing={id:'b1',name:record.name,title:record.title,department:record.department,category_scope:record.category_scope,subcategory_scope:record.subcategory_scope,buyer_role:record.buyer_role,linkedin:'',employment_verification_status:'VERIFIED'};
  assert.equal(classifyBuyerResearchCandidate(record,[existing]).classification,'EXISTING_VERIFIED_RECORD_UNCHANGED');
  assert.equal(classifyBuyerResearchCandidate({...record,title:'Senior Category Manager'},[existing]).classification,'EXISTING_BUYER_REQUIRING_UPDATE');
  assert.equal(classifyBuyerResearchCandidate({...record,employment_verification_status:'STALE'},[existing]).classification,'STALE_OR_DEPARTED_BUYER');
  assert.equal(classifyBuyerResearchCandidate({...record,category_verification_status:'CONFLICTING'},[existing]).classification,'CONFLICTING_EVIDENCE');
  assert.equal(classifyBuyerResearchCandidate({...record,source_type:'web_search',employment_verification_status:'UNCONFIRMED'},[]).classification,'UNVERIFIED_CANDIDATE');
  assert.equal(classifyBuyerResearchCandidate({...record,source_type:'web_search',employment_verification_status:'UNCONFIRMED'},[{...existing,employment_verification_status:'UNCONFIRMED',verification_status:'REVIEW_REQUIRED'}]).classification,'DUPLICATE');
});

test('research worker is non-mutating, resumable, rate limited, cancellable, and bounded',()=>{
  const source=read('api/_buyer-research-runner.js');
  assert.doesNotMatch(source,/(?:insert\s+into|update|delete\s+from)\s+(?:buyers|accounts|retail_organizations)\b/i);
  assert.match(source,/status='PROCESSING'.*status='RETRY'/s);
  assert.match(source,/skip locked/i);
  assert.match(source,/pg_advisory_xact_lock/i);
  assert.match(source,/provider_call_budget/i);
  assert.match(source,/next_run_at/i);
  assert.match(source,/CANCEL_REQUESTED/);
  assert.match(source,/limit 250/i);
  assert.match(source,/dry_run:true/);
  assert.match(source,/A buyer research job is already active/);
  assert.match(source,/baseline_buyers/);
  assert.match(source,/production_totals_unchanged/);
  assert.match(source,/VERCEL_URL/);
  assert.doesNotMatch(source,/x-forwarded-host/);
});

test('runner uses its own zero-paid non-saving research path and prioritizes accounts without buyers',()=>{
  const source=read('api/_buyer-research-runner.js');
  assert.match(source,/researchPublicAccountBuyers/);
  assert.doesNotMatch(source,/searchOpenAIBuyers|OPENAI_API_KEY|APOLLO_API_KEY|FIRECRAWL_API_KEY/);
  assert.doesNotMatch(source,/account-research/);
  assert.match(source,/order by \(count\(distinct b\.id\)=0\) desc/i);
  assert.match(source,/research_mode='ZERO_PAID_API'/);
  assert.match(source,/ADMIN_CONFIRMATION_REQUIRED/);
  assert.match(source,/zero_paid_authorized=case when .*resume.* then true/s);
});

test('runner APIs enforce buyer intelligence administration and audit denied operations',()=>{
  const route=read('api/buyer-research-runner.js'),tick=read('api/buyer-research-runner-tick.js');
  assert.match(route,/CAPABILITIES\.BUYER_INTELLIGENCE_ADMIN/);
  assert.match(route,/appendPermissionAudit/);
  assert.match(route,/result:'DENIED'/);
  assert.match(tick,/requireInternal/);
  assert.match(tick,/BUYER_INTELLIGENCE_SERVICE_TENANT_ID/);
});

test('runner preview commits require Administrator approval and retain existing safe import workflow',()=>{
  const source=read('api/buyer-intelligence-import.js');
  assert.match(source,/buyer_research_preview_batches/);
  assert.match(source,/canonicalRole\(tenant\.role\)!=='ADMIN'/);
  assert.match(source,/Administrator approval is required to commit a buyer research preview/);
  assert.match(source,/preview_run_id/);
});

test('Buyer Intelligence Updates exposes progress, failures, preview review, and explicit approval',()=>{
  const ui=read('buyer-intelligence-updates-ui.js');
  for(const marker of ['Accounts researched','Public pages fetched','New verified buyers','Updates proposed','Unverified','Conflicting / stale','Robots / access blocked','Prepare Next Preview Batch','Admin Approve','Estimated paid research API cost'])assert.match(ui,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(ui,/Production buyer totals remain unchanged until an Administrator approves/);
  assert.match(ui,/Per-account Deep Search remains a separate paid-capable workflow/);
});

test('OpenAI research supports merchant roles, source classification, and verification-only LinkedIn policy',()=>{
  const source=read('api/_openai-research.js');
  assert.match(source,/MERCHANT/);
  assert.match(source,/source_type/);
  assert.match(source,/LinkedIn and public professional profiles may verify identity\/employment but never category ownership by themselves/);
  assert.match(source,/Never infer private contact details/);
});

test('Vercel schedules bounded research ticks and grants adequate function duration',()=>{
  const config=JSON.parse(read('vercel.json'));
  assert.deepEqual(config.functions['api/buyer-research-runner-tick.js'],{maxDuration:240});
  assert.ok(config.crons.some(item=>item.path==='/api/buyer-research-runner-tick'&&item.schedule==='* * * * *'));
  const tick=read('api/buyer-research-runner-tick.js');
  assert.match(tick,/ensureScheduledBuyerResearchJob/);
  assert.match(tick,/BUYER_RESEARCH_RUNNER_SQL/);
  assert.match(tick,/information_schema\.columns/);
  assert.match(tick,/required\.every/);
  assert.match(tick,/sql\.unsafe\(BUYER_RESEARCH_RUNNER_SQL\)/);
});

test('bulk research has no paid-provider import or fallback',()=>{
  const tick=read('api/buyer-research-runner-tick.js'),runner=read('api/_buyer-research-runner.js'),zeroPaid=read('api/_zero-paid-buyer-research.js'),weekly=read('api/weekly-refresh.js');
  for(const source of [tick,runner,zeroPaid])assert.doesNotMatch(source,/searchOpenAIBuyers|openai\.com|api\.apollo\.io|api\.firecrawl\.dev|ANTHROPIC_API_KEY/);
  assert.match(runner,/zero_paid_api_mode/);
  assert.match(runner,/external_api_cost_cents=0/);
  assert.match(runner,/automatic_refresh_enabled/);
  assert.match(runner,/AUTOMATIC_REFRESH_DISABLED/);
  assert.match(runner,/APPROVAL_REQUIRED/);
  assert.match(runner,/committed\.preview_run_id=ir\.id/);
  assert.match(zeroPaid,/DIRECT_PUBLIC_WEB/);
  assert.match(weekly,/SKIPPED_ZERO_PAID_MODE/);
  assert.match(weekly,/zeroPaidBulkBuyerResearch\?Promise\.resolve\(null\):fetch/);
});

test('zero-paid research respects robots, extracts explicit category ownership, and costs zero',async()=>{
  const origin='https://retailer.example',calls=[],html=`<html><head><meta property="article:published_time" content="2026-10-01"></head><body><script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Jane Merchant","jobTitle":"Category Manager, Audio and Speakers","sameAs":"https://www.linkedin.com/in/jane-merchant","description":"Owns audio and speaker merchandising."}</script></body></html>`;
  const responses=new Map([
    [`${origin}/robots.txt`,new Response('User-agent: *\nDisallow: /team\nSitemap: https://retailer.example/sitemap.xml',{status:200,headers:{'content-type':'text/plain'}})],
    [`${origin}/sitemap.xml`,new Response('<urlset><url><loc>https://retailer.example/about/leadership</loc></url><url><loc>https://retailer.example/team</loc></url></urlset>',{status:200,headers:{'content-type':'application/xml'}})],
    [`${origin}/about/leadership`,new Response(html,{status:200,headers:{'content-type':'text/html'}})]
  ]),fetcher=async url=>{calls.push(String(url));return responses.get(String(url))||new Response('missing',{status:404,headers:{'content-type':'text/plain'}})};
  const result=await researchPublicAccountBuyers({account:'Retailer Example',domain:'retailer.example',categories:['Audio']},{fetcher,maxPages:3,pageDelayMs:0,now:()=>new Date('2026-11-10T12:00:00Z')});
  assert.equal(result.status,'SUCCESS');assert.equal(result.external_api_cost_cents,0);assert.equal(result.people.length,1);assert.equal(result.people[0].name,'Jane Merchant');assert.equal(result.people[0].buyer_role,'CATEGORY_OWNER');assert.match(result.people[0].category_scope,/Audio/);assert.equal(result.people[0].category_verification_status,'VERIFIED');assert.ok(!calls.includes(`${origin}/team`));
});

test('zero-paid source controls reject private hosts, generic executives, and access challenges',async()=>{
  assert.equal(zeroPaidAccountOrigin('localhost'),'');assert.equal(zeroPaidAccountOrigin('127.0.0.1'),'');assert.equal(zeroPaidAccountOrigin('[::1]'),'');assert.equal(zeroPaidAccountOrigin('retailer.example'),'https://retailer.example');
  const robots=parseRobotsTxt('User-agent: *\nDisallow: /private/*\nDisallow: /draft$\nSitemap: https://retailer.example/sitemap.xml','https://retailer.example');assert.equal(robotsAllows('https://retailer.example/private/team',robots),false);assert.equal(robotsAllows('https://retailer.example/draft',robots),false);assert.equal(robotsAllows('https://retailer.example/draft/current',robots),true);assert.equal(robotsAllows('https://retailer.example/leadership',robots),true);
  const generic=extractPublicBuyerEvidence({html:'<script type="application/ld+json">{"@type":"Person","name":"John Executive","jobTitle":"Chief Executive Officer"}</script>',url:'https://retailer.example/leadership',account:'Retailer Example',observedAt:'2026-11-10T12:00:00Z'});assert.deepEqual(generic,[]);
  const blocked=await researchPublicAccountBuyers({account:'Retailer Example',domain:'retailer.example'},{fetcher:async()=>new Response('Verify you are human',{status:403,headers:{'content-type':'text/html'}}),pageDelayMs:0});assert.equal(blocked.status,'BLOCKED');assert.equal(blocked.pages_fetched,0);
});

test('main migration and readiness include all V9.8.4 staging tables',()=>{
  const migration=read('api/db-init-v9-8.js'),status=read('api/system-status.js');
  assert.match(migration,/BUYER_RESEARCH_RUNNER_SQL/);
  for(const table of ['buyer_research_settings','buyer_research_jobs','buyer_research_job_accounts','buyer_research_candidates','buyer_research_events','buyer_research_preview_batches','buyer_research_preview_items'])assert.match(status,new RegExp(table));
  assert.match(status,/direct_buyer_mutation:false/);
  assert.match(status,/zero_paid_api_mode:true/);
});
