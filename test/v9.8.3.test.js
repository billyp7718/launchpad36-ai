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
import { calculateMarketOpportunity, categoryConcepts, evaluateProductAccountFit } from '../api/market-opportunity.js';
import { buyerProfiles, evidenceProfiles } from '../api/_account-fit.js';
import { domainFromWebsite, normalizePublicUrl } from '../api/_url.js';
import { normalizeOpenAIProducts, normalizeOpenAIResearch, normalizeOpenAIRetailers, responseOutputText, responseWebSources } from '../api/_openai-research.js';
import { discoveredUrls } from '../api/_acquisition.js';
import { RETAIL_DISTRIBUTORS } from '../api/retail-distributor-seed.js';
import { reportRecipients } from '../api/market-report-email.js';

test('market report email normalizes and limits recipient addresses',()=>{
  assert.deepEqual(reportRecipients('A@Example.com; b@example.com, a@example.com'),['a@example.com','b@example.com']);
  assert.equal(reportRecipients(Array.from({length:20},(_,i)=>`x${i}@example.com`).join(',')).length,10);
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
  assert.match(ui,/loadSavedAccountProducts/);assert.match(ui,/Saved account products/);assert.match(ui,/competitive-products\?organization_id=/);
});

test('interactive account product research uses OpenAI without Firecrawl browser slots',async()=>{
  const [apiSource,ui]=await Promise.all([readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  assert.match(apiSource,/searchOpenAIProducts/);assert.doesNotMatch(apiSource,/universalAcquire/);assert.doesNotMatch(apiSource,/product_sources:\{firecrawl/);
  assert.match(ui,/Searching account sources with OpenAI/);assert.match(ui,/OpenAI web research/);assert.doesNotMatch(ui,/Website pages:/);
});

test('account product research can find comparables for a tenant-owned portfolio product',async()=>{
  const [apiSource,openaiSource,ui]=await Promise.all([readFile(new URL('../api/account-research.js',import.meta.url),'utf8'),readFile(new URL('../api/_openai-research.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8')]);
  for(const marker of ['comparableProductQuery','portfolioProductOptions','Comparable to one of your products','comparison_product_id','selectedComparableProduct'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/p\.manufacturer_id=\$\{tenant\.tenant_id\}/);assert.match(apiSource,/comparisonProduct/);assert.match(apiSource,/openai_comparable_product_research/);
  assert.match(openaiSource,/comparisonProduct/);assert.match(openaiSource,/competing or substitute offerings/);assert.match(openaiSource,/do not search only for our brand/);
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

test('OpenAI buyer research fails closed when citations or structured JSON are missing',()=>{
  const uncited={output_text:JSON.stringify({status:'FOUND',search_summary:'',buyer_candidates:[{name:'Jane Merchant',title:'Buyer',account:'Home Depot',category_scope:'Electronics',source_url:'https://invented.example',source_title:'Unknown',evidence_quote:'Buyer',evidence_date:'',confidence:90,verification_status:'REVIEW_REQUIRED',rationale:''}]})};
  assert.equal(normalizeOpenAIResearch(uncited,{account:'Home Depot'}).people.length,0);
  assert.equal(normalizeOpenAIResearch({output_text:'not-json'},{account:'Home Depot'}).status,'ERROR');
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
  assert.match(source,/Low Scenario/);assert.match(source,/Base Scenario/);assert.match(source,/High Scenario/);assert.match(source,/Review Scenario/);assert.match(source,/api\/market-opportunity/);
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

test('account universe UI exposes Excel CSV import, manual entry and a template',async()=>{
  const source=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/Import Accounts/);assert.match(source,/Download Template/);assert.match(source,/Add Account/);assert.match(source,/api\/retail-universe-import/);assert.match(source,/launchpad36-account-import-template\.csv/);
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
    assert.doesNotMatch(source,/select organization_id,payload,source_url,observed_at/);
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
  assert.match(productApi,/brand_id.*manufacturer_id=\$\{tenantId\}/);assert.match(productApi,/sql\.begin/);
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

test('retailer discovery agent is attached to the existing weekly Vercel job',async()=>{
  const [agent,weekly,ui,status,config]=await Promise.all([readFile(new URL('../api/retailer-discovery-agent.js',import.meta.url),'utf8'),readFile(new URL('../api/weekly-refresh.js',import.meta.url),'utf8'),readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/system-status.js',import.meta.url),'utf8'),readFile(new URL('../vercel.json',import.meta.url),'utf8')]);
  assert.match(agent,/searchOpenAIRetailers/);assert.match(agent,/DISCOVERY_CANDIDATE/);assert.match(agent,/runLivingIntelligencePipeline/);assert.match(agent,/where active=true and \(lower\(regexp_replace\(domain/);
  assert.match(weekly,/runRetailerDiscovery/);assert.match(weekly,/weekly-retailer-discovery/);assert.match(ui,/Discover New Retailers/);assert.match(ui,/Runs every Monday/);assert.match(status,/Retailer Discovery/);
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
  for(const marker of ['Account Assortment Comparison','Edit Proposed Assortment','Save Proposed Assortment','addAssortmentProduct','removeAssortmentProduct','All Source-Backed Account Offerings','Research Account Products'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/proposed_assortment/);assert.match(apiSource,/assortment_updated_at/);assert.match(apiSource,/manufacturer_id=\$\{tenant\.tenant_id\}/);
  assert.match(apiSource,/from commercial_evidence ce join evidence_sources es/);assert.match(apiSource,/from competitive_products cp join accounts a/);
  assert.match(apiSource,/competitive_offerings/);assert.match(apiSource,/b\.email/);assert.match(apiSource,/b\.phone/);assert.match(apiSource,/b\.linkedin/);
  for(const marker of ['Opportunity Buyer','Assign Buyer','saveOpportunityBuyer','Research All Buyers'])assert.match(ui,new RegExp(marker));
  assert.match(apiSource,/assigned_buyer_id/);assert.match(apiSource,/buyer_assigned_at/);assert.match(apiSource,/a\.organization_id=\$\{existing\.organization_id\}/);
});

test('account assortment volume uses catalog dealer cost to calculate annual revenue',async()=>{
  const [ui,apiSource]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../api/opportunities.js',import.meta.url),'utf8')
  ]);
  for(const marker of ['Monthly Sales Volume','Dealer Cost','Annual Revenue','assortmentMonthly','expected monthly unit sales'])assert.match(ui,new RegExp(marker,'i'));
  assert.match(ui,/monthly units × catalog dealer cost × 12/i);
  assert.match(apiSource,/pv\.wholesale/);
  for(const marker of ['monthly_sales_volume','dealer_cost','annual_revenue','account_sku_monthly_units_x_dealer_cost'])assert.match(apiSource,new RegExp(marker));
  assert.match(apiSource,/modeled_contribution:dealerCost/);
  assert.match(apiSource,/dealerCost\*volume\*12/);
});

test('opportunity workspace can add and remove targets without deleting account intelligence',async()=>{
  const [ui,apiSource]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../api/opportunities.js',import.meta.url),'utf8')]);
  assert.doesNotMatch(ui,/Trust boundary/);
  for(const marker of ['Add Target Account','openAddTargetAccount','createTargetAccount','Remove Target','removeTargetAccount','account_and_evidence_preserved'])assert.match(`${ui}\n${apiSource}`,new RegExp(marker));
  assert.match(apiSource,/req\.body\?\.action==='create'/);assert.match(apiSource,/req\.method==='DELETE'/);assert.match(apiSource,/delete from opportunity_workspaces/);
  assert.doesNotMatch(apiSource,/delete from retail_organizations/);assert.doesNotMatch(apiSource,/delete from commercial_evidence/);
});
