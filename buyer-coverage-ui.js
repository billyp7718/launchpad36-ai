(()=>{
  const priorRenderAccount360=window.renderAccount360;
  const accountStyle=document.createElement('style');accountStyle.textContent='.l36-account-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.l36-action-menu{position:relative}.l36-action-menu summary{list-style:none}.l36-action-menu summary::-webkit-details-marker{display:none}.l36-action-menu[open] .l36-action-menu-panel{display:grid}.l36-action-menu-panel{position:absolute;z-index:20;right:0;top:calc(100% + 6px);display:none;gap:6px;min-width:190px;padding:9px;border:1px solid #d6e1ed;border-radius:12px;background:#fff;box-shadow:0 14px 38px rgba(18,49,85,.18)}.l36-action-menu-panel .btn{text-align:left;width:100%}.l36-account-buyer-list{display:grid;gap:3px}.l36-account-category-list{display:flex;flex-wrap:wrap;gap:4px}.l36-next-action{max-width:220px}@media(max-width:760px){.l36-action-menu-panel{left:0;right:auto}}';document.head.appendChild(accountStyle);

  function buyerCategory(b){const status=String(b?.category_verification_status||'UNCONFIRMED').toUpperCase();return status==='UNCONFIRMED'?'Unconfirmed':`${String(b?.category_scope||'Unconfirmed').trim()||'Unconfirmed'}${['STALE','CONFLICTING'].includes(status)?' (historical)':''}`}
  function buyerCoverageHtml(buyers=[],compact=false){
    if(!buyers.length)return '<div class="empty">No saved buyer contacts yet.</div>';
    const rows=buyers.map(b=>`<div class="item" style="margin-bottom:8px"><div class="workspaceTop"><div><b>${esc(b.name||'Unknown buyer')}</b><div class="muted">${esc(b.title||'Title not available')}</div><div class="muted"><b>Department:</b> ${esc(b.department||'Unconfirmed')} · <b>Category:</b> ${esc(buyerCategory(b))}</div></div><span class="badge">${esc(String(b.buyer_role||'UNCONFIRMED').replaceAll('_',' '))}</span></div>${compact?'':`<div class="contactLinks">${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">Email not found</span>'}${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'<span class="muted">Phone not found</span>'}${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`:''}</div><div class="muted" style="margin-top:5px">Identity ${Number(b.identity_confidence??b.confidence)||0}% · ${esc((b.verification_status||b.status||'REVIEW_REQUIRED').replaceAll('_',' '))} · Category ${Number(b.category_confidence)||0}% · ${esc(String(b.category_verification_status||'UNCONFIRMED').replaceAll('_',' '))}</div>`}</div>`).join('');
    return rows;
  }

  function accountOpportunity(orgId){const rows=(state.workspaces||[]).filter(row=>String(row.organization_id)===String(orgId)),total=rows.reduce((sum,row)=>sum+(Number(row.scenario?.account?.base_manufacturer_revenue)||Number(row.potential_revenue)||0),0),latest=rows.slice().sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0))[0];return {count:rows.length,total,next_action:latest?.next_action||''}}
  window.accounts=function(){return `<div class="pageHead"><div><div class="eyebrow">ACCOUNT 360</div><h1>Account Universe</h1><p>Find the right account, then use Account 360 for buyers, assortment, opportunity and next actions.</p></div><div class="l36-account-actions"><button class="btn dark" onclick="openFindMeRevenue()">Find Me Revenue</button><button id="retailerDiscoveryBtn" class="btn secondary" onclick="runRetailerDiscovery()">Discover New Accounts</button><details class="l36-action-menu"><summary class="btn secondary">Add Accounts ▾</summary><div class="l36-action-menu-panel"><button class="btn ghost" onclick="openAddAccount()">Add One Account</button><button class="btn ghost" onclick="openAccountImport()">Import Accounts</button><button class="btn ghost" onclick="downloadAccountTemplate()">Download Template</button></div></details></div></div><div class="callout" style="margin-bottom:14px"><b>Weekly Account Discovery Agent</b><p class="muted">Runs every Monday using active portfolio categories. Attributable results are added as discovery candidates for review.</p></div><div class="card"><div class="toolbar"><input id="acctQ" type="search" placeholder="Search account or domain"><input id="acctBuyerCategory" type="search" placeholder="Search buyer category" aria-label="Search buyer category"><select id="acctChannel"><option value="">All channels</option><option value="mass">Mass Retail</option><option value="ce">Consumer Electronics</option><option value="ecommerce">E-commerce</option><option value="distribution">Distribution</option><option value="independent_pharmacy">Pharmacy — Independent &amp; Small-Chain</option><optgroup label="Alcohol Distribution"><option value="alcohol_distributor">Alcohol Distributors</option></optgroup><option value="specialty_av">Specialty AV</option><option value="automotive">Automotive</option><option value="convenience_travel">Convenience &amp; Travel</option><option value="12v">12V / Automotive Specialty</option><option value="ci">CI / Custom Integration</option></select><button class="btn" onclick="searchAccounts()">Search</button><button class="btn ghost" onclick="clearAccountFilters()">Clear</button></div><p id="accountFilterCount" class="muted">${state.orgs.length} accounts shown.</p><div id="accountResults">${accountTable(state.ui.accountFilters.results||state.orgs)}</div></div>`};
  window.accountTable=function(rows){return `<div class="tableWrap"><table class="table"><thead><tr><th>Account</th><th>Channel / Locations</th><th>Fit</th><th>Annual Opportunity</th><th>Buyers</th><th>Buyer Category</th><th>Next Action</th></tr></thead><tbody>${(rows||[]).map(o=>{const buyers=o.buyers||[],fit=Number(o.fit_score)||0,opportunity=accountOpportunity(o.id),categories=[...new Set(buyers.map(buyerCategory).filter(Boolean))];return `<tr><td><b class="l36-account-name" onclick="openAccount360('${esc(o.id)}')">${esc(o.name)}</b><div class="muted">${esc(o.organization_type||'account')} · ${esc(o.domain||'')}</div></td><td>${(o.channel_codes||[]).slice(0,2).map(c=>`<span class="badge">${esc(c.replaceAll('_',' '))}</span>`).join(' ')||'—'}<div class="muted">${Number(o.footprint)||'—'} locations · ${esc(o.headquarters||o.region||'Head office unconfirmed')}</div></td><td><span class="score">${fit}</span><div class="muted">Confidence ${Number(o.confidence)||0}%</div></td><td><b>${opportunity.count?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(opportunity.total):'Not modeled'}</b><div class="muted">${opportunity.count?`${opportunity.count} saved ${opportunity.count===1?'opportunity':'opportunities'}`:'Run Find Me Revenue'}</div></td><td>${buyers.length?`<b>${buyers.length} saved</b><div class="l36-account-buyer-list">${buyers.slice(0,2).map(b=>`<span class="muted">${esc(b.name)}</span>`).join('')}</div>`:'<span class="muted">No buyers saved</span>'}</td><td><div class="l36-account-category-list">${categories.length?categories.slice(0,4).map(category=>`<span class="pill">${esc(category)}</span>`).join(''):'—'}</div></td><td class="l36-next-action"><div class="muted">${esc(opportunity.next_action||'Review account fit and buyer coverage')}</div><button class="btn dark" style="margin-top:7px" onclick="openAccount360('${esc(o.id)}')">Open Account 360</button></td></tr>`}).join('')}</tbody></table>${rows?.length?'':'<div class="empty"><b>No accounts match these filters.</b><p>Clear the filters or add another account.</p></div>'}</div>`};

  window.refreshAllAccountBuyers=async function(orgId){
    const d=state.__account360;if(!d||String(d.org?.id)!==String(orgId))return;
    const button=$('l36RefreshAllBuyers');if(button){button.disabled=true;button.textContent='Researching + Enriching Buyers…'}
    try{
      const website=d.org?.source_url||d.org?.domain||'';
      const result=await api('/api/buyer-research-resilient',{method:'POST',body:JSON.stringify({organization_id:orgId,website})});
      const saved=await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`);
      state.__account360.buyers=saved.buyers||result.buyers||[];
      const org=(state.orgs||[]).find(x=>String(x.id)===String(orgId));if(org)org.buyers=state.__account360.buyers;
      const wf=result?.research?.buyer_sources?.contact_waterfall||{};
      renderAccount360('buyers');
      toast(`${state.__account360.buyers.length} buyers · ${Number(wf.total_with_email)||state.__account360.buyers.filter(x=>x.email).length} with email · ${Number(wf.emails_added)||0} new email(s)`);
    }catch(e){toast(e.message||'Buyer research failed');if(button){button.disabled=false;button.textContent='Refresh All Buyers'}}
  };

  if(typeof priorRenderAccount360==='function'){
    window.renderAccount360=function(tab='overview'){
      priorRenderAccount360(tab);
      const d=state.__account360;if(!d)return;const buyers=d.buyers||[],org=d.org||{};
      if(tab==='overview'){
        const heading=[...document.querySelectorAll('#modalCard h3')].find(x=>x.textContent.trim()==='Primary buyer');
        if(heading){
          const card=heading.closest('.card');
          const emailCount=buyers.filter(b=>b.email).length;
          card.innerHTML=`<div class="workspaceTop"><div><h3 style="margin:0">Buyer coverage</h3><p class="muted">${buyers.length} saved buyer${buyers.length===1?'':'s'} across ${new Set(buyers.map(buyerCategory)).size} category scope${new Set(buyers.map(buyerCategory)).size===1?'':'s'} · ${emailCount} with email.</p></div><button id="l36RefreshAllBuyers" class="btn ghost" onclick="refreshAllAccountBuyers('${esc(org.id)}')">Refresh + Enrich Buyers</button></div>${buyerCoverageHtml(buyers,false)}<button class="btn secondary" onclick="renderAccount360('buyers')">Open Buyer Intelligence</button>`;
        }
      }
      if(tab==='buyers'){
        const tabs=document.querySelector('#modalCard .l36-account-tabs');
        if(tabs){
          const summary=document.createElement('div');summary.className='callout';summary.style.marginBottom='12px';
          const categories=[...new Set(buyers.map(buyerCategory))],emailCount=buyers.filter(b=>b.email).length;
          summary.innerHTML=`<div class="workspaceTop"><div><b>Buyer Coverage</b><p class="muted">${buyers.length} saved buyer${buyers.length===1?'':'s'} · ${emailCount} with email · ${categories.length} category scope${categories.length===1?'':'s'}${categories.length?` · ${categories.map(c=>esc(c)).join(' · ')}`:''}</p></div><button id="l36RefreshAllBuyers" class="btn dark" onclick="refreshAllAccountBuyers('${esc(org.id)}')">Refresh + Enrich Buyers</button></div>`;
          tabs.insertAdjacentElement('afterend',summary);
        }
      }
    };
  }

  window.__L36_ALL_BUYER_COVERAGE__=true;
})();
