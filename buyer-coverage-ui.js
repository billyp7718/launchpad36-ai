(()=>{
  const priorRenderAccount360=window.renderAccount360;

  function buyerCategory(b){return String(b?.category_scope||b?.category||'General / Unknown').trim()||'General / Unknown'}
  function buyerCoverageHtml(buyers=[],compact=false){
    if(!buyers.length)return '<div class="empty">No saved buyer contacts yet.</div>';
    const rows=buyers.map(b=>`<div class="item" style="margin-bottom:8px"><div class="workspaceTop"><div><b>${esc(b.name||'Unknown buyer')}</b><div class="muted">${esc(b.title||'Title not available')}</div></div><span class="badge">${esc(buyerCategory(b))}</span></div>${compact?'':`<div class="contactLinks">${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">Email not found</span>'}${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'<span class="muted">Phone not found</span>'}${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`:''}</div><div class="muted" style="margin-top:5px">Confidence ${Number(b.confidence)||0}% · ${esc((b.verification_status||b.status||'REVIEW_REQUIRED').replaceAll('_',' '))}</div>`}</div>`).join('');
    return rows;
  }

  window.accountTable=function(rows){return `<div class="tableWrap"><table class="table"><thead><tr><th>Account</th><th>Channel</th><th>Head Office</th><th>Locations</th><th>Buyer Coverage</th><th>Email</th><th>Phone</th><th>Fit</th><th>Gap</th><th>Confidence</th><th>Action</th></tr></thead><tbody>${(rows||[]).map(o=>{const buyers=o.buyers||[],fit=Number(o.fit_score)||0,gap=Number(o.whitespace_score)||0,conf=Number(o.confidence)||0,primary=buyers.find(b=>b.email||b.phone)||buyers[0];return `<tr><td><b class="l36-account-name" onclick="openAccount360('${esc(o.id)}')">${esc(o.name)}</b><div class="muted">${esc(o.organization_type||'retailer')} · ${esc(o.domain||'')}</div></td><td>${(o.channel_codes||[]).slice(0,2).map(c=>`<span class="badge">${esc(c.replaceAll('_',' '))}</span>`).join(' ')||'—'}</td><td>${esc(o.headquarters||o.region||'—')}</td><td>${Number(o.footprint)||'—'}</td><td>${buyers.length?`<b>${buyers.length} buyer${buyers.length===1?'':'s'}</b>${buyers.slice(0,6).map(b=>`<div class="muted">${esc(b.name)} · ${esc(buyerCategory(b))}</div>`).join('')}${buyers.length>6?`<div class="muted">+${buyers.length-6} more</div>`:''}`:'<span class="muted">No buyers saved</span>'}</td><td>${primary?.email?`<a href="mailto:${esc(primary.email)}">${esc(primary.email)}</a>`:'—'}</td><td>${primary?.phone?`<a href="tel:${esc(primary.phone)}">${esc(primary.phone)}</a>`:'—'}</td><td><span class="score">${fit}</span></td><td><span class="score">${gap}</span></td><td>${conf}%</td><td><button class="btn dark" onclick="openAccount360('${esc(o.id)}')">Open Account</button></td></tr>`}).join('')}</tbody></table>${rows?.length?'':'<div class="empty"><b>No accounts loaded.</b></div>'}</div>`};

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
