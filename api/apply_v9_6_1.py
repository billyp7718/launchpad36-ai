#!/usr/bin/env python3
from pathlib import Path
p=Path("index.html")
s=p.read_text()

s=s.replace(
"const state={accounts:[],products:[],buyers:[],opportunities:[],currentAccount:null,auth:false,intel:{},loadingCore:false,loadError:''};",
"const state={accounts:[],products:[],buyers:[],opportunities:[],currentAccount:null,auth:false,intel:{},loadingCore:false,loadError:'',channelTab:'ALL'};"
)

s=s.replace(
".strategy h4{margin:0 0 7px}.strategy ul{margin:0;padding-left:18px;font-size:10px;color:#617891;line-height:1.7}",
".strategy h4{margin:0 0 7px}.strategy ul{margin:0;padding-left:18px;font-size:10px;color:#617891;line-height:1.7}.channelTabs{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}.channelTab{border:1px solid #d6e2ef;background:#f7faff;color:#45627f;border-radius:999px;padding:7px 10px;font-size:9px;font-weight:850;cursor:pointer}.channelTab.active{background:#0d3b73;color:#fff;border-color:#0d3b73}.compareCard{grid-column:1/-1}.compareTable td,.compareTable th{white-space:nowrap}.adv{color:var(--good);font-weight:850}.risk{color:var(--bad);font-weight:850}.unknown{color:var(--muted)}"
)

old = """async function runIntel(){const a=state.currentAccount;if(!a.domain){toast('Add a valid account domain first.');return}state.intel.loading=true;renderAccountDetail();const qs=`domain=${encodeURIComponent(a.domain)}&account=${encodeURIComponent(a.name)}&categories=${encodeURIComponent(a.category||'')}`;const [cur,comp,dm]=await Promise.allSettled([api('/api/current-products?'+qs),api('/api/competitors?'+qs),api('/api/decision-makers?'+qs)]);state.intel.current=cur.status==='fulfilled'?(cur.value.products||[]):[];state.intel.competitors=comp.status==='fulfilled'?(comp.value.competitors||[]):[];state.intel.people=dm.status==='fulfilled'?(dm.value.people||[]):[];try{const g=await api('/api/assortment-gap',{method:'POST',body:JSON.stringify({domain:a.domain,account:a.name,products:portfolioPayload()})});state.intel.gap=g}catch(e){state.intel.gapError=e.message}state.intel.loading=false;renderAccountDetail();toast('Account intelligence refreshed')}"""
new = """async function runIntel(){const a=state.currentAccount;if(!a.domain){toast('Add a valid account domain first.');return}state.intel.loading=true;renderAccountDetail();const qs=`domain=${encodeURIComponent(a.domain)}&account=${encodeURIComponent(a.name)}&categories=${encodeURIComponent(a.category||'')}`;const [cur,comp,dm]=await Promise.allSettled([api('/api/current-products?'+qs),api('/api/competitors?'+qs),api('/api/decision-makers?'+qs)]);state.intel.current=cur.status==='fulfilled'?(cur.value.products||[]):[];state.intel.competitors=comp.status==='fulfilled'?(comp.value.competitors||[]):[];state.intel.people=dm.status==='fulfilled'?(dm.value.people||[]):[];try{const g=await api('/api/assortment-gap',{method:'POST',body:JSON.stringify({domain:a.domain,account:a.name,products:portfolioPayload()})});state.intel.gap=g}catch(e){state.intel.gapError=e.message}try{state.intel.channel=await api('/api/channel-competitive-intelligence',{method:'POST',body:JSON.stringify({account:a.name,retailer_products:state.intel.current,manufacturer_products:state.products})})}catch(e){state.intel.channelError=e.message}state.intel.loading=false;renderAccountDetail();toast('Account intelligence refreshed')}"""
if old not in s: raise SystemExit("runIntel anchor not found")
s=s.replace(old,new)

anchor="function portfolioPayload(){"
helpers=r"""function setChannelTab(t){state.channelTab=t;renderAccountDetail()}
function channelLabel(s){return ({ONLINE_CONFIRMED:'Online',IN_STORE_SIGNAL:'In-Store Signal',OMNICHANNEL_SIGNAL:'Omnichannel',ONLINE_DETECTED_IN_STORE_UNKNOWN:'In-Store Unknown'})[s]||s||'Unknown'}
function renderChannelCompetitive(){
 const c=state.intel.channel;if(!c)return `<div class="card compareCard"><div class="sectionTitle"><h3>Channel & Competitive Intelligence</h3><span class="badge">V9.6</span></div><div class="empty">Run Account Intelligence to classify channel evidence and compare your SKUs with detected retailer products.</div></div>`;
 const all=c.retailer_products||[], tab=state.channelTab||'ALL';
 const filtered=tab==='ALL'?all:all.filter(x=>x.channel_status===tab);
 const tabs=[['ALL','All'],['ONLINE_CONFIRMED','Online'],['IN_STORE_SIGNAL','In-Store'],['OMNICHANNEL_SIGNAL','Omnichannel'],['ONLINE_DETECTED_IN_STORE_UNKNOWN','Unknown']];
 const comp=(c.comparisons||[]).filter(x=>(x.closest_competitors||[]).length).slice(0,12);
 return `<div class="card compareCard"><div class="sectionTitle"><div><h3>Channel Assortment</h3><div class="muted">Online detection is not treated as national in-store distribution.</div></div><span class="badge">${all.length} OBSERVATIONS</span></div>
 <div class="channelTabs">${tabs.map(([k,l])=>`<button class="channelTab ${tab===k?'active':''}" onclick="setChannelTab('${k}')">${l}</button>`).join('')}</div>
 <div class="metricGrid" style="margin-bottom:12px"><div class="metric"><small class="label">Online</small><b>${c.channel_summary?.online_confirmed||0}</b></div><div class="metric"><small class="label">In-Store Signals</small><b>${c.channel_summary?.in_store_signals||0}</b></div><div class="metric"><small class="label">Omnichannel</small><b>${c.channel_summary?.omnichannel_signals||0}</b></div><div class="metric"><small class="label">Store Unknown</small><b>${c.channel_summary?.in_store_unknown||0}</b></div></div>
 ${filtered.slice(0,12).map(x=>`<div class="item"><b>${esc(x.brand||'')} ${esc(x.price||'')}</b><p>${esc(x.product||'').slice(0,220)}</p><span class="status ${x.channel_status==='ONLINE_DETECTED_IN_STORE_UNKNOWN'?'warn':'ok'}">${esc(channelLabel(x.channel_status))}</span></div>`).join('')||'<div class="empty">No observations in this channel state.</div>'}
 <p class="muted">${esc(c.channel_summary?.warning||'')}</p></div>
 <div class="card compareCard"><div class="sectionTitle"><div><h3>Your SKU vs. Retailer Assortment</h3><div class="muted">Closest detected products; missing specifications remain unknown.</div></div><span class="badge">${comp.length} SKU MATCHES</span></div>
 <div class="tableWrap"><table class="table compareTable"><thead><tr><th>Your SKU</th><th>Your Price</th><th>Closest Product</th><th>Their Price</th><th>Δ Price</th><th>Channel</th><th>Feature Evidence</th></tr></thead><tbody>
 ${comp.map(x=>{const r=x.closest_competitors[0]||{},f=r.feature_comparison||{};return `<tr><td><b>${esc(x.sku||x.variant||x.product)}</b><div class="muted">${esc(x.product)}</div></td><td>${x.our_price?money(x.our_price):'<span class="unknown">Unknown</span>'}</td><td><b>${esc(r.brand||'')} ${esc(r.product||'').slice(0,90)}</b></td><td>${r.price_numeric?money(r.price_numeric):'<span class="unknown">Unknown</span>'}</td><td class="${r.price_delta!=null?(r.price_delta<=0?'adv':'risk'):'unknown'}">${r.price_delta==null?'Unknown':(r.price_delta>0?'+':'')+money(r.price_delta)}</td><td>${esc(channelLabel(r.channel_status))}</td><td>${f.compared?`${f.wins} advantage / ${f.losses} competitor`:'<span class="unknown">Specs needed</span>'}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Add real manufacturer SKUs/specifications to generate direct comparisons.</td></tr>'}
 </tbody></table></div>
 ${(c.price_whitespace||[]).length?`<div class="strategy" style="margin-top:12px"><h4>Observed Price Whitespace</h4><ul>${c.price_whitespace.slice(0,5).map(g=>`<li>${money(g.from)} → ${money(g.to)} (${money(g.gap)} gap)</li>`).join('')}</ul></div>`:''}</div>`;
}
"""
if anchor not in s: raise SystemExit("portfolio anchor not found")
s=s.replace(anchor,helpers+anchor)

needle="""<div class="intelGrid"><div class="card"><div class="sectionTitle"><h3>Detected on Retailer Site</h3>"""
repl="""<div class="intelGrid">${renderChannelCompetitive()}<div class="card"><div class="sectionTitle"><h3>Detected on Retailer Site</h3>"""
if needle not in s: raise SystemExit("intelGrid anchor not found")
s=s.replace(needle,repl)

p.write_text(s)
print("Patched index.html for V9.6.1")
