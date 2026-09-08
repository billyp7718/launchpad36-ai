(()=>{
  const style=document.createElement('style');style.textContent=`
    .l36-deep-buyer-grid{display:grid;gap:10px}.l36-deep-buyer-card{border:1px solid #dbe6f2;border-radius:12px;padding:13px;background:#fff}.l36-deep-buyer-card .workspaceTop{gap:12px}.l36-apollo-state{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.l36-apollo-state span{font-size:10px;border:1px solid #dbe6f2;border-radius:999px;padding:5px 7px;background:#f7faff}.l36-deep-note{border-left:4px solid #2f6fed;background:#f4f8fe;padding:10px 12px;border-radius:8px;margin-bottom:12px}
  `;document.head.appendChild(style);

  const priorRender=window.renderAccount360;
  const buyerCategory=b=>String(b?.category_scope||b?.category||'General / Unknown').trim()||'General / Unknown';
  const statusText=b=>b?.email?'Email saved':'Email missing';

  function deepBuyerHtml(org,buyers=[]){
    if(!buyers.length)return `<div class="empty"><b>No saved buyers yet.</b><p>Run Refresh + Enrich Buyers first to identify buyer candidates, then use Deep Buyer Search on an individual.</p><button class="btn dark" onclick="refreshAllAccountBuyers('${esc(org.id)}')">Refresh + Enrich Buyers</button></div>`;
    return `<div class="l36-deep-note"><b>Individual Apollo enrichment</b><p class="muted" style="margin:5px 0 0">Deep Search targets one buyer using the saved name, retailer domain and LinkedIn URL when available. If Apollo cannot enrich the direct match, Launchpad36 performs an exact retailer-scoped Apollo people search and retries using the returned Apollo person ID. Apollo may consume enrichment credits when data is returned.</p></div><div class="l36-deep-buyer-grid">${buyers.map((b,i)=>`<div class="l36-deep-buyer-card"><div class="workspaceTop"><div><b>${esc(b.name||'Unknown buyer')}</b><div class="muted">${esc(b.title||'Title not available')} · ${esc(buyerCategory(b))}</div></div><button id="l36DeepBuyer${i}" class="btn ${b.email?'secondary':'dark'}" onclick="runDeepBuyerSearch('${esc(b.id)}','l36DeepBuyer${i}')">${b.email?'Recheck in Apollo':'Deep Search'}</button></div><div class="contactLinks" style="margin-top:8px">${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">Email not found</span>'}${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:''}${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a>`:''}</div><div class="l36-apollo-state"><span>${esc(statusText(b))}</span><span>Confidence ${Number(b.confidence)||0}%</span><span>${esc((b.verification_status||b.status||'REVIEW_REQUIRED').replaceAll('_',' '))}</span>${b.source?`<span>${esc(b.source)}</span>`:''}</div></div>`).join('')}</div>`;
  }

  function addDeepTab(tab){
    const tabs=document.querySelector('#modalCard .l36-account-tabs');if(!tabs)return null;
    let button=[...tabs.querySelectorAll('button')].find(b=>b.dataset.l36DeepBuyerTab==='1');
    if(!button){button=document.createElement('button');button.dataset.l36DeepBuyerTab='1';button.textContent='Deep Buyer Search';button.onclick=()=>renderAccount360('deepbuyers');tabs.appendChild(button)}
    tabs.querySelectorAll('button').forEach(b=>b.classList.remove('active'));if(tab==='deepbuyers')button.classList.add('active');else{const target=[...tabs.querySelectorAll('button')].find(b=>String(b.getAttribute('onclick')||'').includes(`'${tab}'`));if(target)target.classList.add('active')}
    return tabs;
  }

  window.runDeepBuyerSearch=async function(buyerId,buttonId){
    const buyer=(state.__account360?.buyers||[]).find(b=>String(b.id)===String(buyerId));if(!buyer)return toast('Buyer record was not found');
    if(!confirm(`Deep Search will run Apollo individual enrichment for ${buyer.name}. Apollo may consume enrichment credits when data is returned. Continue?`))return;
    const button=$(buttonId);if(button){button.disabled=true;button.textContent='Searching Apollo…'}
    try{
      const result=await api('/api/buyer-deep-search',{method:'POST',body:JSON.stringify({buyer_id:buyerId})});
      const orgId=state.__account360?.org?.id,saved=orgId?await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`):{buyers:[]};
      if(state.__account360)state.__account360.buyers=saved.buyers||[];
      const org=(state.orgs||[]).find(o=>String(o.id)===String(orgId));if(org)org.buyers=state.__account360.buyers;
      renderAccount360('deepbuyers');
      const confidence=result?.apollo?.match_confidence?` · ${result.apollo.match_confidence} match`:'';
      if(result.status==='EMAIL_FOUND')toast(`Apollo email saved for ${buyer.name}${confidence}`);
      else if(result.status==='MATCH_NO_EMAIL')toast(`Apollo matched ${buyer.name}, but no work email was returned`);
      else toast(`Apollo did not return a confident match for ${buyer.name}`);
    }catch(e){toast(e.message||'Deep Buyer Search failed');if(button){button.disabled=false;button.textContent='Deep Search'}}
  };

  if(typeof priorRender==='function')window.renderAccount360=function(tab='overview'){
    priorRender(tab==='deepbuyers'?'buyers':tab);
    const d=state.__account360;if(!d)return;const tabs=addDeepTab(tab);if(tab!=='deepbuyers'||!tabs)return;
    let node=tabs.nextSibling;while(node){const next=node.nextSibling;node.remove();node=next}
    tabs.insertAdjacentHTML('afterend',deepBuyerHtml(d.org||{},d.buyers||[]));
  };

  window.__L36_DEEP_BUYER_SEARCH__=true;
})();
