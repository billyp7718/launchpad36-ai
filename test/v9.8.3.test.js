import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { normalizeFirecrawlSearch } from '../api/catalog-website.js';
import { validateCatalogRows } from '../api/catalog-import.js';
import { AURELIUS_AUDIO_DEMO } from '../api/demo-catalog.js';
import { validateCommercialObservation, livingHash, refreshTier } from '../api/_living-intelligence.js';
import { verifyFirecrawlSignature, monitorJudgmentMeaningful, shouldProcessMonitorPage } from '../api/firecrawl-monitor-webhook.js';

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
