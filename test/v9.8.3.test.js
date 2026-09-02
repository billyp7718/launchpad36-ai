import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { normalizeFirecrawlSearch } from '../api/catalog-website.js';
import { validateCatalogRows } from '../api/catalog-import.js';
import { AURELIUS_AUDIO_DEMO } from '../api/demo-catalog.js';
import { validateCommercialObservation, livingHash, refreshTier } from '../api/_living-intelligence.js';
import { verifyFirecrawlSignature, monitorJudgmentMeaningful, shouldProcessMonitorPage } from '../api/firecrawl-monitor-webhook.js';
import { normalizeOfferings, focusTokens } from '../api/living-intelligence-refresh.js';
import { calculateMarketOpportunity, categoryConcepts } from '../api/market-opportunity.js';

test('normalizes common and nested Firecrawl search response shapes',()=>{
  const payload={data:{web:{results:[{url:'https://vendor.example/p/1',title:'One'}]},items:{pages:[{link:'https://vendor.example/p/2',description:'Two'}]}},result:{metadata:{sourceURL:'https://vendor.example/p/3',title:'Three'}}};
  assert.deepEqual(normalizeFirecrawlSearch(payload).map(x=>x.url),['https://vendor.example/p/1','https://vendor.example/p/2','https://vendor.example/p/3']);
  assert.deepEqual(normalizeFirecrawlSearch({data:{message:'no array'}}),[]);
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
  assert.match(source,/create trigger intelligence_change_events_immutable/);
});

test('system status reports the complete production readiness chain without exposing secrets',async()=>{
  const source=await readFile(new URL('../api/system-status.js',import.meta.url),'utf8');
  for(const name of ['Database','Schema','Firecrawl','Monitoring','Evidence','Change Detection','Scheduled Refresh']){
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
  assert.match(uiSource,/View Products/);assert.match(uiSource,/Approve as Verified/);assert.match(uiSource,/Evidence quote/);
});

test('category relevance gate rejects unrelated retailer products',()=>{
  const data={json:{offerings:[{name:'Samsung Electric Dryer',category:'Appliances'},{name:'Full Motion TV Wall Mount',category:'TV Mounts',price_text:'$99.00'}]}};
  const rows=normalizeOfferings(data,focusTokens('TV mounts'));
  assert.equal(rows.length,1);assert.match(rows[0].name,/TV Wall Mount/);assert.deepEqual(focusTokens('', 'https://homedepot.com/tvmounts'),['tv','mount']);
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

test('market intelligence UI supports multiple products, channel models and SKU drill-down',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/class="moProduct" type="checkbox"/);assert.match(source,/Select All/);
  for(const route of ['retail','direct_b2b','distributor_dealer','mixed'])assert.match(source,new RegExp(`value="${route}"`));
  assert.match(source,/Low/);assert.match(source,/Base Manufacturer Revenue/);assert.match(source,/High/);assert.match(source,/View SKUs/);assert.match(source,/api\/market-opportunity/);
});

test('broad account categories match related product families',()=>{
  assert.ok(categoryConcepts(['Floorstanding Speakers']).includes('audio'));
  const result=calculateMarketOpportunity({products:[{id:'p1',name:'Speaker',category:'Floorstanding Speakers',variants:[{sku:'S1',wholesale:500}]}],organizations:[{id:'r1',name:'Audio Retailer',organization_type:'retailer',categories:['Audio'],footprint:10}],route:'retail',assumptions:{annual_units_per_location:2,distribution_probability:50}});
  assert.equal(result.summary.target_account_count,1);assert.equal(result.summary.base_manufacturer_revenue,5000);
});

test('account universe UI exposes Excel CSV import, manual entry and a template',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Import Accounts/);assert.match(source,/Download Template/);assert.match(source,/Add Account/);assert.match(source,/api\/retail-universe-import/);assert.match(source,/launchpad36-account-import-template\.csv/);
});
