(()=>{
  if(window.__L36_DEEP_BUYER_SEARCH_V3__)return;
  window.__L36_DEEP_BUYER_SEARCH_V3__=true;

  const style=document.createElement('style');
  style.textContent=`
    .l36-deep-note{margin:12px 0;border:1px solid #cfe0f6;background:linear-gradient(135deg,#f5f9ff,#fff);border-radius:14px;padding:12px}
    .l36-deep-error{border-left:3px solid #c83c3c;background:#fff3f3;color:#7d2424;padding:10px 12px;border-radius:8px;margin-top:10px}
    .l36-deep-success{border-left:3px solid #18795a;background:#eefaf5;color:#185f49;padding:10px 12px;border-radius:8px;margin-top:10px}
    .l36-contact-cell{min-width:180px;word-break:break-word}
  `;
  document.head.appendChild(style);

  const categoryOf=b=>String(b?.category_scope||b?.category||'General / Unknown').trim()||'General / Unknown';
  const currentOrgId=()=>String(state.__account360?.org?.id||state.selectedBuyerOrgId||$('buyerAccount')?.value||'');
  const orgFor=id=>(state.orgs||[]).find(o=>String(o.id)===String(id));

  function deepMessage(text,type='warning'){
    let target=$('l36DeepBuyerMessage');
    if(!target){
      target=document.createElement('div');target.id='l36DeepBuyerMessage';
      const host=$('buyerResults')||document.querySelector('#modalCard .l36-account-tabs');
      if(host)host.insertAdjacentElement(host.id==='buyerResults'?'beforebegin':'afterend',target);
    }
    if(target)target.innerHTML=`<div class="${type==='success'?'l36-deep-success':type==='error'?'l36-deep-error':'warning'}">${esc(text)}</div>`;
  }

  window.runDeepBuyerSearchV3=async function(orgId,buyerId,buttonId){
    orgId=String(orgId||currentOrgId());
    const button=$(buttonId),all=[...(state.buyers||[]),...(state.__account360?.buyers||[])],buyer=all.find(b=>String(b.id)===String(buyerId));
    if(!buyer){toast('Buyer record not found');return;}
    if(!confirm(`Run individual Apollo enrichment for ${buyer.name}? Apollo may consume a credit when contact data is returned.`))return;
    if(button){button.disabled=true;button.textContent='Searching…'}
    deepMessage(`Searching Apollo for ${buyer.name}…`);
    try{
      const r=await api('/api/buyer-deep-search',{method:'POST',body:JSON.stringify({buyer_id:buyerId})});
      if(r.status==='APOLLO_FORBIDDEN'){
        deepMessage(r.message||'Apollo rejected individual enrichment for the configured API key or plan (403).','error');
        toast('Apollo access blocked (403)');return;
      }
      const refreshed=orgId?await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`):{buyers:[]};
      if(orgId){
        state.buyers=refreshed.buyers||[];
        if(state.__account360&&String(state.__account360.org?.id)===orgId)state.__account360.buyers=state.buyers;
        const org=orgFor(orgId);if(org)org.buyers=state.buyers;
      }
      const msg=r.status==='EMAIL_FOUND'?`Work email found and saved for ${buyer.name}.`:r.status==='MATCH_NO_EMAIL'?`Apollo matched ${buyer.name}, but did not return a work email.`:`Apollo did not return a confident match for ${buyer.name}.`;
      deepMessage(msg,r.status==='EMAIL_FOUND'?'success':'warning');toast(msg);
      if(state.screen==='Buyers'&&typeof loadBuyerAccount==='function')await loadBuyerAccount();
      else if(state.__account360&&typeof renderAccount360==='function')renderAccount360('buyers');
    }catch(e){deepMessage(`Deep Buyer Search failed: ${e.message||'Unknown error'}`,'error');toast(e.message||'Deep Buyer Search failed')}
    finally{if(button){button.disabled=false;button.textContent=buyer.email?'Recheck Apollo':'Deep Search'}}
  };

  const baseBuyerTable=window.buyerTableHtml;
  window.buyerTableHtml=function(rows=[],showEvidence=false,editable=false){
    const orgId=currentOrgId();
    return `<div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Buyer</th><th>Title</th><th>Category</th><th>Email</th><th>Phone</th><th>LinkedIn</th>${showEvidence?'<th>Evidence</th>':''}<th>Status</th><th>Confidence</th><th>Source</th><th>Action</th></tr></thead><tbody>${(rows||[]).map((b,i)=>`<tr><td><b>${esc(b.name||'')}</b></td><td>${esc(b.title||'—')}</td><td>${esc(categoryOf(b))}</td><td class="l36-contact-cell">${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'—'}</td><td>${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'—'}</td><td>${b.linkedin?`<a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">Open</a>`:'—'}</td>${showEvidence?`<td class="muted">${esc(b.evidence_quote||b.notes||'Review source')}</td>`:''}<td><span class="pill">${esc(b.verification_status||b.status||'UNKNOWN')}</span></td><td>${Number(b.confidence)||0}%</td><td>${b.source_url?`<a href="${esc(b.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>`:'—'}</td><td><div class="workspaceActions">${b.id?`<button id="l36Deep-${i}" class="btn dark" onclick="runDeepBuyerSearchV3('${esc(orgId)}','${esc(b.id)}','l36Deep-${i}')">${b.email?'Recheck Apollo':'Deep Search'}</button>`:''}${editable&&b.id?`<button class="btn ghost" onclick="openBuyerEditor('${esc(b.id)}')">Edit</button>`:''}</div></td></tr>`).join('')}</tbody></table>${rows?.length?'':'<div class="empty">No saved buyers for this account.</div>'}</div>`;
  };

  const baseBuyers=window.buyers;
  if(typeof baseBuyers==='function')window.buyers=function(){
    const html=baseBuyers();
    return html.replace('<div class="callout"><b>Evidence rule</b>',`<div class="l36-deep-note"><b>Deep Buyer Search</b><p class="muted">Saved buyer data loads normally. Use Deep Search on an individual row to request Apollo work-email enrichment without replacing the buyer list.</p><div id="l36DeepBuyerMessage"></div></div><div class="callout"><b>Evidence rule</b>`);
  };
})();
