import { db } from './_db.js';

const clean=(v,m=600)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,m);
const money=v=>Math.max(0,Number(v)||0);
const arr=v=>Array.isArray(v)?v:[];
const productKey=p=>[p?.brand||'',p?.name||p?.product_name||'',p?.sku||p?.model||''].map(x=>clean(x,180).toLowerCase()).join('|');
const priceOf=p=>{const n=Number(p?.price_numeric);if(Number.isFinite(n)&&n>0)return n;const m=String(p?.price_text||p?.price||'').match(/([\d,]+(?:\.\d{1,2})?)/);return m?Number(m[1].replace(/,/g,'')):0};
const flags=p=>{const s=[p?.availability,p?.purchase_channel,p?.channel,p?.store_verification].filter(Boolean).join(' ').toLowerCase();return {online:/online|shipping|delivery|add to cart|ecommerce/.test(s),in_store:/in.?store|pickup|store availability|confirmed at/.test(s)}};

export async function ensureOpportunityAlerts(sql=db()){
 await sql`create table if not exists opportunity_alerts(
   id bigserial primary key,
   manufacturer_id uuid not null references manufacturers(id) on delete cascade,
   organization_id uuid references retail_organizations(id) on delete cascade,
   account_id uuid references accounts(id) on delete set null,
   opportunity_id uuid references opportunity_workspaces(id) on delete set null,
   change_event_id bigint not null,
   alert_type text not null,
   severity text not null default 'medium',
   impact_score integer not null default 0,
   title text not null,
   summary text not null,
   recommended_action text not null default '',
   revenue_potential numeric not null default 0,
   fit_score numeric not null default 0,
   gap_score numeric not null default 0,
   route_recommendation text not null default '',
   buyer_count integer not null default 0,
   source_url text not null default '',
   observed_at timestamptz,
   status text not null default 'NEW',
   metadata jsonb not null default '{}'::jsonb,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now(),
   unique(manufacturer_id,change_event_id)
 )`;
 await sql.unsafe(`do $$ begin
   if exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_alerts' and column_name='manufacturer_id' and data_type='text')
      and not exists(select 1 from opportunity_alerts where manufacturer_id is null or manufacturer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
     alter table opportunity_alerts alter column manufacturer_id type uuid using manufacturer_id::uuid;
   end if;
   if exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_alerts' and column_name='organization_id' and data_type='text')
      and not exists(select 1 from opportunity_alerts where organization_id is not null and organization_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
     alter table opportunity_alerts alter column organization_id type uuid using organization_id::uuid;
   end if;
   if exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_alerts' and column_name='account_id' and data_type='text')
      and not exists(select 1 from opportunity_alerts where account_id is not null and account_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
     alter table opportunity_alerts alter column account_id type uuid using account_id::uuid;
   end if;
   if exists(select 1 from information_schema.columns where table_schema='public' and table_name='opportunity_alerts' and column_name='opportunity_id' and data_type='text')
      and not exists(select 1 from opportunity_alerts where opportunity_id is not null and opportunity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
     alter table opportunity_alerts alter column opportunity_id type uuid using opportunity_id::uuid;
   end if;
 end $$`);
 await sql`create index if not exists opportunity_alerts_mfr_status_idx on opportunity_alerts(manufacturer_id,status,created_at desc)`;
}

function diffAssortment(prev={},curr={}){
 const a=arr(prev.offerings),b=arr(curr.offerings),am=new Map(a.map(x=>[productKey(x),x])),bm=new Map(b.map(x=>[productKey(x),x]));
 const added=[...bm.entries()].filter(([k])=>!am.has(k)).map(([,v])=>v),removed=[...am.entries()].filter(([k])=>!bm.has(k)).map(([,v])=>v),priceDrops=[],priceIncreases=[],channelChanges=[],promotions=[];
 for(const [k,n] of bm){const o=am.get(k);if(!o)continue;const op=priceOf(o),np=priceOf(n);if(op&&np&&np!==op){const pct=(np-op)/op;if(pct<=-.05)priceDrops.push({product:n,from:op,to:np,pct});if(pct>=.05)priceIncreases.push({product:n,from:op,to:np,pct})}const of=flags(o),nf=flags(n);if(of.online!==nf.online||of.in_store!==nf.in_store)channelChanges.push({product:n,from:of,to:nf});const oldPromo=Boolean(o.promotion||/sale|deal|promo|save|off/i.test(String(o.availability||''))),newPromo=Boolean(n.promotion||/sale|deal|promo|save|off/i.test(String(n.availability||'')));if(!oldPromo&&newPromo)promotions.push(n)}
 return {added,removed,priceDrops,priceIncreases,channelChanges,promotions,previous_count:a.length,current_count:b.length};
}
function classify(event,workspace,buyers=[]){
 const st=String(event.subject_type||''),prev=event.previous_payload||{},curr=event.current_payload||{},baseRevenue=money(workspace?.scenario?.account?.base_manufacturer_revenue??workspace?.scenario?.volume_model?.annual_manufacturer_revenue),fit=Number(workspace?.scenario?.account?.fit_score)||0,gap=Number(workspace?.scenario?.account?.whitespace_score||workspace?.scenario?.account?.gap_score)||0,route=workspace?.scenario?.route_to_market_fit?.recommendation||workspace?.route_to_market||'';
 if(/assortment|product/i.test(st)){const d=diffAssortment(prev,curr);let score=25+d.removed.length*12+d.channelChanges.length*8+d.priceIncreases.length*7+d.added.length*4+d.priceDrops.length*5+d.promotions.length*4;score=Math.min(100,score+Math.round(fit*.18)+Math.round(gap*.2));let type='ASSORTMENT_CHANGE',severity=score>=75?'critical':score>=55?'high':score>=35?'medium':'low',title='Retail assortment changed',summary=`${d.added.length} added · ${d.removed.length} removed · ${d.priceDrops.length+d.priceIncreases.length} price moves · ${d.channelChanges.length} channel changes.`;let action='Review assortment gap and rerun Find Me Revenue.';
   if(d.removed.length){type='WHITESPACE_OPENED';title=`${d.removed.length} competitive SKU${d.removed.length===1?'':'s'} removed`;action='Recalculate gap score, SKU fit and revenue opportunity now.'}
   else if(d.channelChanges.some(x=>x.from.in_store&&!x.to.in_store)){type='IN_STORE_WHITESPACE';title='Competitor lost in-store presence';action='Re-run AI route-to-market fit for in-store placement.'}
   else if(d.priceIncreases.length){type='PRICE_WINDOW';title='Competitive price window opened';action='Compare your MSRP/wholesale position and rerun revenue modeling.'}
   else if(d.added.length){type='COMPETITIVE_RISK';title=`${d.added.length} competing SKU${d.added.length===1?'':'s'} added`;action='Review new competition and adjust recommended SKU mix.'}
   return {type,severity,score,title,summary,action,baseRevenue,fit,gap,route,metadata:{diff:d}};
 }
 if(/buyer|leadership/i.test(st)){const score=Math.min(100,45+Math.round(fit*.2)+(buyers.length?10:0));return {type:'BUYER_CHANGE',severity:score>=70?'high':'medium',score,title:'Buyer organization changed',summary:'New or changed buyer/merchandising evidence was detected for this account.',action:'Refresh buyer coverage, verify contact information and update the opportunity owner/next action.',baseRevenue,fit,gap,route,metadata:{buyer_change:true}}}
 return {type:'INTELLIGENCE_CHANGE',severity:'low',score:25,title:'Commercial intelligence changed',summary:'New commercial evidence differs from the prior observation.',action:'Review the change before updating the opportunity.',baseRevenue,fit,gap,route,metadata:{}};
}

export async function scanOpportunityAlerts({manufacturerId,limit=100,sql=db()}={}){
 if(!manufacturerId)throw new Error('manufacturerId is required');await ensureOpportunityAlerts(sql);
 const events=await sql`select ice.* from intelligence_change_events ice where ice.meaningful=true and ice.organization_id is not null and exists(select 1 from opportunity_workspaces ow where ow.organization_id=ice.organization_id and ow.manufacturer_id=${manufacturerId}) and not exists(select 1 from opportunity_alerts oa where oa.manufacturer_id=${manufacturerId} and oa.change_event_id=ice.id) order by ice.observed_at desc limit ${Math.min(Math.max(Number(limit)||100,1),500)}`;
 let created=0;const alerts=[];
 for(const event of events){const workspace=(await sql`select * from opportunity_workspaces where manufacturer_id=${manufacturerId} and organization_id=${event.organization_id} order by updated_at desc limit 1`)[0]||null,buyers=await sql`select b.* from accounts a join buyers b on b.account_id=a.id where a.organization_id=${event.organization_id} order by b.confidence desc limit 25`,org=(await sql`select * from retail_organizations where id=${event.organization_id} limit 1`)[0]||{};const x=classify(event,workspace,buyers);const row=(await sql`insert into opportunity_alerts(manufacturer_id,organization_id,account_id,opportunity_id,change_event_id,alert_type,severity,impact_score,title,summary,recommended_action,revenue_potential,fit_score,gap_score,route_recommendation,buyer_count,source_url,observed_at,status,metadata) values(${manufacturerId},${event.organization_id},${event.account_id||workspace?.account_id||null},${workspace?.id||null},${event.id},${x.type},${x.severity},${x.score},${`${org.name||'Account'} — ${x.title}`},${x.summary},${x.action},${x.baseRevenue},${x.fit},${x.gap},${clean(x.route,80)},${buyers.length},${event.source_url||''},${event.observed_at||new Date().toISOString()},'NEW',${sql.json({...x.metadata,organization_name:org.name||'',subject_type:event.subject_type,subject_key:event.subject_key,verification_status:event.verification_status})}) on conflict(manufacturer_id,change_event_id) do nothing returning *`)[0];if(row){created++;alerts.push(row)}}return {events_scanned:events.length,alerts_created:created,alerts};
}
