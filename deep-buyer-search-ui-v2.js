(()=>{
  if(window.__L36_DEEP_BUYER_SEARCH_V2__)return;
  window.__L36_DEEP_BUYER_SEARCH_V2__=true;

  const css=`
  .l36-deep-inline{margin:12px 0;padding:12px;border:1px solid #d9e5f2;border-radius:12px;background:#f8fbff}
  .l36-deep-inline h3{margin:0 0 4px}.l36-deep-inline-row{display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(130px,1fr) minmax(180px,1.4fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #e5edf6}.l36-deep-inline-row:first-of-type{border-top:0}.l36-apollo-error{background:#fff5f5;border:1px solid #f1c7c7;border-radius:8px;padding:9px 10px;margin-top:8px;color:#8f2b2b}.l36-deep-pill{font-size:10px;padding:4px 7px;border:1px solid #d9e5f2;border-radius:999px;background:white;display:inline-block;margin-right:5px}@media(max-width:800px){.l36-deep-inline-row{grid-template-columns:1fr}}
  `;
  const s=document.createElement('style');s.textContent=css;document.head.appendChild(s);

  const cat=b=>String(b?.category_scope||b?.category||'General / Unknown').trim()||'General / Unknown';
  const html=(org,buyers=[])=>`<div class="l36-deep-inline" data-l36-deep-inline="1"><div class="workspaceTop"><div><h3>Deep Buyer Search</h3><p class="muted" style="margin:3px 0 0">Use Apollo one buyer at a time to enrich work email using the saved name, retailer domain and LinkedIn profile when available.</p></div></div>${buyers.length?buyers.map((b,i)=>`<div class="l36-deep-inline-row"><div><b>${esc(b.name||'Unknown buyer')}</b><div class="muted">${esc(b.title||'Title unavailable')}</div></div><div><span class="l36-deep-pill">${esc(cat(b))}</span><span class="l36-deep-pill">${Number(b.confidence)||0}% confidence</span></div><div>${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">No email saved</span>'}${b.linkedin?`<div><a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></div>`:''}</div><button id="l36DeepInline${i}" class="btn ${b.email?'secondary':'dark'}" onclick="runDeepBuyerSearchV2('${esc(b.id)}','l36DeepInline${i}')">${b.email?'Recheck Apollo':'Deep Search'}</button></div>`).join(''):`<div class="empty">No buyers are saved for this account yet. Run Refresh + Enrich Buyers first.</div>`}<div id="l36DeepApolloMessage"></div></div>`;

  function inject(){
    const d=state?.__account360;if(!d)return;
    const modal=document.querySelector('#modalCard');if(!modal||modal.querySelector('[data-l36-deep-inline="1"]'))return;
    const tabs=modal.querySelector('.l36-account-tabs');if(!tabs)return;
    const buyersTab=[...tabs.querySelectorAll('button')].find(b=>/buyers/i.test(b.textContent||''));
    if(!buyersTab)return;
    const isBuyers=buyersTab.classList.contains('active');
    if(!isBuyers)return;
    tabs.insertAdjacentHTML('afterend',html(d.org||{},d.buyers||[]));
  }

  window.runDeepBuyerSearchV2=async function(buyerId,buttonId){
    const d=state?.__account360,buyer=(d?.buyers||[]).find(b=>String(b.id)===String(buyerId));if(!buyer)return toast('Buyer record not found');
    if(!confirm(`Enriching ${buyer.name} with Apollo may use 1 credit if Apollo finds a match. Continue?`))return;
    const btn=$(buttonId),msg=$('l36DeepApolloMessage');if(btn){btn.disabled=true;btn.textContent='Searching Apollo…'}if(msg)msg.innerHTML='';
    try{
      const r=await api('/api/buyer-deep-search',{method:'POST',body:JSON.stringify({buyer_id:buyerId})});
      if(r.status==='APOLLO_FORBIDDEN'){
        if(msg)msg.innerHTML=`<div class="l36-apollo-error"><b>Apollo access blocked (403)</b><div>${esc(r.message||'The configured Apollo API key or plan does not currently permit People Enrichment.')}</div></div>`;
        toast('Apollo returned 403 Forbidden');
        return;
      }
      const saved=await api(`/api/buyers?organization_id=${encodeURIComponent(d.org.id)}`);d.buyers=saved.buyers||[];const org=(state.orgs||[]).find(o=>String(o.id)===String(d.org.id));if(org)org.buyers=d.buyers;
      renderAccount360('buyers');setTimeout(inject,0);
      if(r.status==='EMAIL_FOUND')toast(`Apollo email saved for ${buyer.name}`);else if(r.status==='MATCH_NO_EMAIL')toast(`Apollo matched ${buyer.name}, but no work email was returned`);else toast(`Apollo did not return a match for ${buyer.name}`);
    }catch(e){if(msg)msg.innerHTML=`<div class="l36-apollo-error"><b>Deep Search failed</b><div>${esc(e.message||'Unknown error')}</div></div>`;toast(e.message||'Deep Buyer Search failed')}
    finally{if(btn){btn.disabled=false;btn.textContent=buyer.email?'Recheck Apollo':'Deep Search'}}
  };

  const prior=window.renderAccount360;
  if(typeof prior==='function')window.renderAccount360=function(tab='overview'){prior(tab);setTimeout(inject,0)};
  const observer=new MutationObserver(()=>setTimeout(inject,0));observer.observe(document.body,{childList:true,subtree:true});
})();
