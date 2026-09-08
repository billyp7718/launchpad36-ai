(()=>{
  if(window.__L36_DEEP_BUYER_SEARCH_V3__)return;
  window.__L36_DEEP_BUYER_SEARCH_V3__=true;

  const style=document.createElement('style');
  style.textContent=`
    .l36-deep-buyer-card{margin:14px 0;border:1px solid #cfe0f6;background:linear-gradient(135deg,#f5f9ff,#fff);border-radius:16px;padding:16px}
    .l36-deep-buyer-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:10px}
    .l36-deep-buyer-grid{display:grid;grid-template-columns:minmax(160px,1.25fr) minmax(150px,1fr) minmax(120px,.9fr) minmax(190px,1.3fr) minmax(140px,.9fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #e4edf7}
    .l36-deep-buyer-grid.header{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#71869e;border-top:0;padding-top:2px}
    .l36-deep-buyer-grid a{word-break:break-word}
    .l36-deep-result{margin-top:10px}
    .l36-deep-error{border-left:3px solid #c83c3c;background:#fff3f3;color:#7d2424;padding:10px 12px;border-radius:8px}
    .l36-deep-success{border-left:3px solid #18795a;background:#eefaf5;color:#185f49;padding:10px 12px;border-radius:8px}
    @media(max-width:980px){.l36-deep-buyer-grid{grid-template-columns:1fr 1fr}.l36-deep-buyer-grid.header{display:none}}
    @media(max-width:620px){.l36-deep-buyer-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const categoryOf=b=>String(b?.category_scope||b?.category||'General / Unknown').trim()||'General / Unknown';
  const orgFor=id=>(state.orgs||[]).find(o=>String(o.id)===String(id));

  function deepPanel(orgId,rows=[]){
    const org=orgFor(orgId)||state.__account360?.org||{};
    const domain=org.domain||'retailer domain unavailable';
    return `<div class="l36-deep-buyer-card" data-l36-deep-v3="1">
      <div class="l36-deep-buyer-head"><div><div class="eyebrow">INDIVIDUAL CONTACT ENRICHMENT</div><h3 style="margin:5px 0">Deep Buyer Search</h3><p class="muted" style="margin:0">Run Apollo against one saved buyer at a time using the buyer name, ${esc(domain)}, and LinkedIn when available. Work email is saved back to the buyer record when Apollo returns it.</p></div><span class="badge">Apollo individual enrichment</span></div>
      ${rows.length?`<div class="l36-deep-buyer-grid header"><span>Buyer</span><span>Title</span><span>Category</span><span>Email</span><span>Phone / LinkedIn</span><span>Action</span></div>${rows.map((b,i)=>`<div class="l36-deep-buyer-grid"><div><b>${esc(b.name||'Unknown buyer')}</b><div class="muted">${Number(b.confidence)||0}% confidence</div></div><div>${esc(b.title||'—')}</div><div><span class="pill">${esc(categoryOf(b))}</span></div><div>${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">No work email saved</span>'}</div><div>${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a><br>`:''}${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`:(!b.phone?'—':'')}</div><button id="l36DeepV3-${i}" class="btn ${b.email?'secondary':'dark'}" onclick="runDeepBuyerSearchV3('${esc(orgId)}','${esc(b.id)}','l36DeepV3-${i}')">${b.email?'Recheck Apollo':'Deep Search'}</button></div>`).join('')}`:`<div class="empty">No saved buyers yet. Run Refresh All Buyers first, then use Deep Search on the individual people you want to enrich.</div>`}
      <div id="l36DeepBuyerMessage" class="l36-deep-result"></div>
    </div>`;
  }

  function buyerTable(rows=[]){
    return `<div class="tableWrap"><table class="table"><thead><tr><th>Buyer</th><th>Title</th><th>Category</th><th>Email</th><th>Phone</th><th>LinkedIn</th><th>Confidence</th><th>Edit</th></tr></thead><tbody>${rows.map(b=>`<tr><td><b>${esc(b.name||'')}</b></td><td>${esc(b.title||'—')}</td><td>${esc(categoryOf(b))}</td><td>${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'—'}</td><td>${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'—'}</td><td>${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td><td>${Number(b.confidence)||0}%</td><td><button class="btn ghost" onclick="openBuyerEditor('${esc(b.id)}')">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  window.runDeepBuyerSearchV3=async function(orgId,buyerId,buttonId){
    const button=$(buttonId),message=$('l36DeepBuyerMessage');
    const rows=state.__account360&&String(state.__account360.org?.id)===String(orgId)?state.__account360.buyers:state.buyers;
    const buyer=(rows||[]).find(b=>String(b.id)===String(buyerId));
    if(!buyer){toast('Buyer record not found');return;}
    if(!confirm(`Run individual Apollo enrichment for ${buyer.name}? Apollo may consume a credit when contact data is returned.`))return;
    if(button){button.disabled=true;button.textContent='Searching Apollo…'}
    if(message)message.innerHTML='<div class="muted">Searching Apollo for this exact buyer…</div>';
    try{
      const r=await api('/api/buyer-deep-search',{method:'POST',body:JSON.stringify({buyer_id:buyerId})});
      if(r.status==='APOLLO_FORBIDDEN'){
        if(message)message.innerHTML=`<div class="l36-deep-error"><b>Apollo access blocked (${Number(r.http_status)||403})</b><div>${esc(r.message||'The configured Apollo API key or plan does not permit this enrichment endpoint.')}</div></div>`;
        toast('Apollo enrichment is blocked by the current API access');
        return;
      }
      const refreshed=await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`);
      state.buyers=refreshed.buyers||[];
      if(state.__account360&&String(state.__account360.org?.id)===String(orgId))state.__account360.buyers=state.buyers;
      const org=orgFor(orgId);if(org)org.buyers=state.buyers;
      if(state.screen==='Buyers')await loadBuyerAccount();
      else if(state.__account360)renderAccount360('buyers');
      const msg=r.status==='EMAIL_FOUND'?`Apollo found and saved a work email for ${buyer.name}.`:r.status==='MATCH_NO_EMAIL'?`Apollo matched ${buyer.name}, but did not return a work email.`:`Apollo did not return a confident match for ${buyer.name}.`;
      const next=$('l36DeepBuyerMessage');if(next)next.innerHTML=`<div class="${r.status==='EMAIL_FOUND'?'l36-deep-success':'warning'}"><b>${esc(msg)}</b></div>`;
      toast(msg);
    }catch(e){
      if(message)message.innerHTML=`<div class="l36-deep-error"><b>Deep Buyer Search failed</b><div>${esc(e.message||'Unknown error')}</div></div>`;
      toast(e.message||'Deep Buyer Search failed');
    }finally{
      if(button){button.disabled=false;button.textContent=buyer.email?'Recheck Apollo':'Deep Search'}
    }
  };

  const priorBuyers=window.buyers;
  window.buyers=function(){
    const base=typeof priorBuyers==='function'?priorBuyers():'';
    return base.replace('<div id="buyerResults"',`<div id="buyerDeepSearchIntro" class="callout" style="margin-top:12px"><b>Deep Buyer Search</b><p class="muted">Load an account to see every saved buyer and run Apollo enrichment individually for missing work emails.</p></div><div id="buyerResults"`);
  };

  const priorLoadBuyerAccount=window.loadBuyerAccount;
  window.loadBuyerAccount=async function(){
    const target=$('buyerResults'),orgId=$('buyerAccount')?.value;
    if(!target||!orgId)return typeof priorLoadBuyerAccount==='function'?priorLoadBuyerAccount():undefined;
    state.selectedBuyerOrgId=String(orgId);
    target.innerHTML='<div class="empty">Loading saved buyers and Deep Search controls…</div>';
    try{
      const d=await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`);
      state.buyers=d.buyers||[];
      target.innerHTML=`${deepPanel(orgId,state.buyers)}${state.buyers.length?buyerTable(state.buyers):''}`;
    }catch(e){target.innerHTML=`<div class="warning">${esc(e.message)}</div>`;}
  };

  const priorRender360=window.renderAccount360;
  if(typeof priorRender360==='function')window.renderAccount360=function(tab='overview'){
    priorRender360(tab);
    if(tab!=='buyers')return;
    const d=state.__account360;if(!d)return;
    const modal=$('modalCard');if(!modal||modal.querySelector('[data-l36-deep-v3="1"]'))return;
    const tabs=modal.querySelector('.l36-account-tabs');if(tabs)tabs.insertAdjacentHTML('afterend',deepPanel(d.org.id,d.buyers||[]));
  };
})();
