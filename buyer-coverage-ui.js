(()=>{
  const priorRenderAccount360=window.renderAccount360;

  function buyerCategory(b){return String(b?.category_scope||b?.category||'General / Unknown').trim()||'General / Unknown'}
  function buyerCoverageHtml(buyers=[],compact=false){
    if(!buyers.length)return '<div class="empty">No saved buyer contacts yet.</div>';
    const rows=buyers.map(b=>`<div class="item" style="margin-bottom:8px"><div class="workspaceTop"><div><b>${esc(b.name||'Unknown buyer')}</b><div class="muted">${esc(b.title||'Title not available')}</div></div><span class="badge">${esc(buyerCategory(b))}</span></div>${compact?'':`<div class="contactLinks">${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">No public email</span>'}${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'<span class="muted">No public phone</span>'}${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`:''}</div><div class="muted" style="margin-top:5px">Confidence ${Number(b.confidence)||0}% · ${esc((b.verification_status||b.status||'REVIEW_REQUIRED').replaceAll('_',' '))}</div>`}</div>`).join('');
    return rows;
  }

  // Keep the Account Universe concise while exposing the full buyer coverage count and category scope.
  window.accountTable=function(rows){return `<div class="tableWrap"><table class="table"><thead><tr><th>Account</th><th>Channel</th><th>Head Office</th><th>Locations</th><th>Buyer Coverage</th><th>Email / Phone</th><th>Fit</th><th>Gap</th><th>Confidence</th><th>Action</th></tr></thead><tbody>${(rows||[]).map(o=>{const buyers=o.buyers||[],fit=Number(o.fit_score)||0,gap=Number(o.whitespace_score)||0,conf=Number(o.confidence)||0,primary=buyers[0];return `<tr><td><b class="l36-account-name" onclick="openAccount360('${esc(o.id)}')">${esc(o.name)}</b><div class="muted">${esc(o.organization_type||'retailer')} · ${esc(o.domain||'')}</div></td><td>${(o.channel_codes||[]).slice(0,2).map(c=>`<span class="badge">${esc(c.replaceAll('_',' '))}</span>`).join(' ')||'—'}</td><td>${esc(o.headquarters||o.region||'—')}</td><td>${Number(o.footprint)||'—'}</td><td>${buyers.length?`<b>${buyers.length} buyer${buyers.length===1?'':'s'}</b>${buyers.map(b=>`<div class="muted">${esc(b.name)} · ${esc(buyerCategory(b))}</div>`).join('')}`:'<span class="muted">No buyers saved</span>'}</td><td>${primary?`${primary.email?`<a href="mailto:${esc(primary.email)}">${esc(primary.email)}</a>`:'—'}${primary.phone?`<div><a href="tel:${esc(primary.phone)}">${esc(primary.phone)}</a></div>`:''}`:'—'}</td><td><span class="score">${fit}</span></td><td><span class="score">${gap}</span></td><td>${conf}%</td><td><button class="btn dark" onclick="openAccount360('${esc(o.id)}')">Open Account</button></td></tr>`}).join('')}</tbody></table>${rows?.length?'':'<div class="empty"><b>No accounts loaded.</b></div>'}</div>`};

  window.refreshAllAccountBuyers=async function(orgId){
    const d=state.__account360;if(!d||String(d.org?.id)!==String(orgId))return;
    const button=$('l36RefreshAllBuyers');if(button){button.disabled=true;button.textContent='Researching All Buyers…'}
    try{
      const website=d.org?.source_url||d.org?.domain||'';
      const result=await api('/api/account-research',{method:'POST',body:JSON.stringify({organization_id:orgId,website,research_type:'buyer',all_buyers:true})});
      const saved=await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`);
      state.__account360.buyers=saved.buyers||result.buyers||[];
      const org=(state.orgs||[]).find(x=>String(x.id)===String(orgId));if(org)org.buyers=state.__account360.buyers;
      renderAccount360('buyers');
      toast(`${state.__account360.buyers.length} buyer record(s) loaded across buying categories`);
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
          card.innerHTML=`<div class="workspaceTop"><div><h3 style="margin:0">Buyer coverage</h3><p class="muted">${buyers.length} saved buyer${buyers.length===1?'':'s'} across ${new Set(buyers.map(buyerCategory)).size} category scope${new Set(buyers.map(buyerCategory)).size===1?'':'s'}.</p></div><button id="l36RefreshAllBuyers" class="btn ghost" onclick="refreshAllAccountBuyers('${esc(org.id)}')">Refresh All Buyers</button></div>${buyerCoverageHtml(buyers,false)}<button class="btn secondary" onclick="renderAccount360('buyers')">Open Buyer Intelligence</button>`;
        }
      }
      if(tab==='buyers'){
        const tabs=document.querySelector('#modalCard .l36-account-tabs');
        if(tabs){
          const summary=document.createElement('div');summary.className='callout';summary.style.marginBottom='12px';
          const categories=[...new Set(buyers.map(buyerCategory))];
          summary.innerHTML=`<div class="workspaceTop"><div><b>Buyer Coverage</b><p class="muted">${buyers.length} saved buyer${buyers.length===1?'':'s'} · ${categories.length} category scope${categories.length===1?'':'s'}${categories.length?` · ${categories.map(c=>esc(c)).join(' · ')}`:''}</p></div><button id="l36RefreshAllBuyers" class="btn dark" onclick="refreshAllAccountBuyers('${esc(org.id)}')">Refresh All Buyers</button></div>`;
          tabs.insertAdjacentElement('afterend',summary);
        }
      }
    };
  }

  window.__L36_ALL_BUYER_COVERAGE__=true;
})();
