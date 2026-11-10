import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buyerResearchRecord, classifyBuyerResearchCandidate } from '../api/_buyer-research-runner.js';
import { BUYER_RESEARCH_RUNNER_SQL } from '../api/db-init-buyer-research-runner.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function verifiedRecord(overrides={}){
  return buyerResearchRecord({
    name:'Jane Merchant',title:'Category Manager, Audio',department:'Consumer Electronics',category_scope:'Audio',subcategory_scope:'Speakers',buyer_role:'CATEGORY_OWNER',identity_confidence:92,category_confidence:88,employment_verification_status:'VERIFIED',category_verification_status:'VERIFIED',employment_evidence_url:'https://retailer.example/leadership/jane',category_evidence_url:'https://retailer.example/news/audio-category',evidence_date:'2026-11-01',source_type:'official_retailer',rationale:'Current employer and category responsibility are explicitly documented.',...overrides
  },{name:'Retailer Example',domain:'retailer.example',organization_type:'retailer',categories:['Audio'],channel_codes:['ce']},'2026-11-09T12:00:00Z');
}

test('V9.8.4 migration is additive, idempotent, tenant scoped, and append-only',()=>{
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

test('runner uses its own non-saving research path and prioritizes accounts without buyers',()=>{
  const source=read('api/_buyer-research-runner.js');
  assert.match(source,/searchOpenAIBuyers/);
  assert.doesNotMatch(source,/account-research/);
  assert.match(source,/order by \(count\(distinct b\.id\)=0\) desc/i);
  assert.match(source,/allCategories:true/);
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
  for(const marker of ['Accounts researched','Verified coverage','New verified buyers','Updates proposed','Unverified','Conflicting / stale','Failures / retries','Prepare Next Preview Batch','Admin Approve'])assert.match(ui,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(ui,/Production buyer totals remain unchanged until an Administrator approves/);
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
});

test('main migration and readiness include all V9.8.4 staging tables',()=>{
  const migration=read('api/db-init-v9-8.js'),status=read('api/system-status.js');
  assert.match(migration,/BUYER_RESEARCH_RUNNER_SQL/);
  for(const table of ['buyer_research_jobs','buyer_research_job_accounts','buyer_research_candidates','buyer_research_events','buyer_research_preview_batches','buyer_research_preview_items'])assert.match(status,new RegExp(table));
  assert.match(status,/direct_buyer_mutation:false/);
});
