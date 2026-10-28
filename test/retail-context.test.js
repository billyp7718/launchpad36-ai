import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBuyerMeetingBrief,feedbackRecommendations } from '../api/_retail-context.js';
import { RETAIL_CONTEXT_SQL } from '../api/db-init-retail-context.js';

test('retail context migration is additive and preserves append-only account history',()=>{
  for(const table of ['retail_context_relationships','buyer_meeting_feedback','retail_context_events','intelligence_tool_access_events'])assert.match(RETAIL_CONTEXT_SQL,new RegExp(`create table if not exists ${table}`));
  assert.match(RETAIL_CONTEXT_SQL,/retail_context_events_immutable/);
  assert.match(RETAIL_CONTEXT_SQL,/before update or delete on retail_context_events/);
  assert.doesNotMatch(RETAIL_CONTEXT_SQL,/drop\s+(table|column)|truncate\s+|delete\s+from/i);
});

test('buyer meeting brief combines account, buyer, opportunity, assortment and prior feedback without relabeling modeled revenue as verified',()=>{
  const brief=buildBuyerMeetingBrief({
    organization:{id:'org-1',name:'Example Retailer',footprint:100,channel_codes:['ce']},
    summary:{buyer:{identified:true,ownership_confirmed:true,id:'b1',name:'Jordan Merchant',title:'Audio Buyer',category_scope:'Home Audio',category_confidence:91},opportunity:{value:850000},trust_score:88,trust_level:'STRONG',last_verified_at:'2026-10-27T12:00:00Z'},
    buyers:[],
    workspace:{id:'opp-1',status:'ready',next_action:'Present 50-store pilot',scenario:{proposed_assortment:[{product_id:'p1',brand_name:'Demo Audio',product_name:'Bookshelf Speaker',sku:'DA-100',dealer_cost:200,annual_revenue:250000}]}},
    products:[{brand:'Competitor',product_name:'Speaker X',price_numeric:499,availability:'Online'}],
    feedback:[{meeting_at:'2026-10-20T12:00:00Z',buyer_feedback:'Needs a lower opening price point',objections:['Price'],requested_changes:['Add sub-$399 SKU'],rollout_scope:'pilot',next_action:'Revise assortment'}]
  });
  assert.equal(brief.organization.name,'Example Retailer');
  assert.equal(brief.buyer.name,'Jordan Merchant');
  assert.equal(brief.opportunity.modeled_revenue,850000);
  assert.equal(brief.proposed_assortment[0].sku,'DA-100');
  assert.deepEqual(brief.prior_objections,['Price']);
  assert.equal(brief.latest_feedback.rollout_scope,'pilot');
  assert.equal(brief.human_approval_required,true);
});

test('buyer feedback recommendations keep commercial changes behind human approval',()=>{
  const recs=feedbackRecommendations({accepted_skus:['A-1'],rejected_skus:['B-2'],requested_changes:['Lower price'],objections:['Margin'],rollout_scope:'regional',next_action:'Send revised proposal'});
  assert.ok(recs.some(x=>x.type==='ASSORTMENT'&&x.approval_required));
  assert.ok(recs.some(x=>x.type==='SCENARIO'&&x.approval_required));
  assert.ok(recs.some(x=>x.type==='CRM_TASK'&&x.approval_required));
  assert.ok(recs.some(x=>x.type==='PLAYBOOK'&&x.approval_required===false));
});

test('retail context APIs are tenant scoped and intelligence tools are read only',async()=>{
  const [context,feedback,relationships,tools,health]=await Promise.all([
    readFile(new URL('../api/retail-context.js',import.meta.url),'utf8'),
    readFile(new URL('../api/buyer-meeting-feedback.js',import.meta.url),'utf8'),
    readFile(new URL('../api/retail-context-relationships.js',import.meta.url),'utf8'),
    readFile(new URL('../api/intelligence-tools.js',import.meta.url),'utf8'),
    readFile(new URL('../api/retail-context-health.js',import.meta.url),'utf8')
  ]);
  for(const source of [context,feedback,relationships,tools,health])assert.match(source,/resolveTenant\(req,res/);
  for(const source of [context,feedback,relationships,tools])assert.match(source,/tenant\.tenant_id/);
  assert.match(tools,/Read-only endpoint\. GET is required/);
  assert.match(tools,/write_actions:false/);
  assert.doesNotMatch(tools,/req\.method==='POST'|req\.method==='PATCH'|req\.method==='DELETE'/);
  assert.match(health,/TENANT_SECURITY/);
  assert.match(feedback,/automatic_external_actions:false/);
  assert.match(feedback,/human_approval_required:true/);
});

test('read-only intelligence tool manifest covers the prioritized Launchpad36 retail workflow',async()=>{
  const source=await readFile(new URL('../api/intelligence-tools.js',import.meta.url),'utf8');
  for(const tool of ['account_brief','find_buyer','competitive_assortment','opportunity_status','revenue_mission'])assert.match(source,new RegExp(tool));
  for(const marker of ['APP_READ','intelligence_tool_access_events','Cache-Control','manufacturer_id'])assert.match(source,new RegExp(marker));
});

test('Account 360 exposes buyer meeting intelligence and account knowledge without autonomous outreach',async()=>{
  const [ui,shell]=await Promise.all([
    readFile(new URL('../retail-context-ui.js',import.meta.url),'utf8'),
    readFile(new URL('../api/app-shell.js',import.meta.url),'utf8')
  ]);
  for(const marker of ['Prepare Buyer Meeting','Record Buyer Feedback','RETAIL ACCOUNT KNOWLEDGE','prior buyer objections','automatic','APP_WRITE','buyer-meeting-feedback','retail-context'])assert.match(ui,new RegExp(marker,'i'));
  assert.doesNotMatch(ui,/mailto:|sendEmail\(|fetch\([^\n]*email/i);
  assert.match(shell,/retail-context-ui\.js/);
});
