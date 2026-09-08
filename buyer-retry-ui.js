(function(){
  // Final buyer-table renderer: loaded last so Contact can never collapse Email/Phone again.
  window.buyerTableHtml=function(rows,showEvidence=false){
    return `<div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Buyer</th><th>Title</th><th>Category</th><th>Email</th><th>Phone</th>${showEvidence?'<th>Evidence</th>':''}<th>Status</th><th>Confidence</th><th>Source</th><th>Edit</th></tr></thead><tbody>${(rows||[]).map(b=>`<tr><td><b>${esc(b.name)}</b>${b.linkedin?`<div class="muted"><a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></div>`:''}</td><td>${esc(b.title||'—')}</td><td>${esc(b.category_scope||b.category||'General / Unknown')}</td><td>${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'<span class="muted">Not found</span>'}</td><td>${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'<span class="muted">Not found</span>'}</td>${showEvidence?`<td class="muted">${esc(b.evidence_quote||b.notes||'Review source')}</td>`:''}<td><span class="pill">${esc(b.verification_status||b.status||'UNKNOWN')}</span></td><td>${Number(b.confidence)||0}%</td><td>${b.source_url?`<a href="${esc(b.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>`:'—'}</td><td>${b.id?`<button class="btn ghost" onclick="openBuyerEditor('${esc(b.id)}')">Edit</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`;
  };

  window.runBuyerResearch=async function(orgId){
    if(window.accountResearchRunning){toast('Research is already running');return}
    state.selectedBuyerOrgId=String(orgId);
    const result=$('buyerResearchResult'),button=$('buyerRunBtn'),website=$('researchWebsite')?.value.trim();
    if(!website){toast('Enter the account website');return}
    window.accountResearchRunning=true;if(button){button.disabled=true;button.textContent='Researching + Enriching Buyers…'}
    const started=Date.now();
    result.innerHTML='<div class="callout"><b id="researchStage">Finding buyer roles, enriching work emails, and checking public sources…</b><div class="progressTrack"><div id="researchProgress" class="progressBar"></div></div><div class="progressMeta"><span>Search → Apollo work-email enrichment → public email fallback</span><span id="researchElapsed">0 seconds</span></div></div>';
    const timer=setInterval(()=>{const sec=Math.floor((Date.now()-started)/1000);if($('researchProgress'))$('researchProgress').style.width=`${Math.min(94,10+sec*.7)}%`;if($('researchElapsed'))$('researchElapsed').textContent=`${sec} seconds`},500);
    try{
      const d=await api('/api/buyer-research-resilient',{method:'POST',body:JSON.stringify({organization_id:orgId,website})});
      const saved=await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`).catch(()=>({buyers:d.buyers||[]})),buyers=saved.buyers||d.buyers||[],r=d.research||{},sources=r.buyer_sources||{},openai=sources.openai_web_search||{},apollo=sources.apollo||{},corporate=sources.corporate_pages||{},wf=sources.contact_waterfall||{};
      state.buyers=buyers;await load();
      const retryNote=d.resilient_retry_used?`Automatic recovery used ${Number(d.retry_attempts)||1} retr${Number(d.retry_attempts)===1?'y':'ies'}.`:'';
      const providerError=openai.status==='RETRY_EXHAUSTED'?'<div class="warning"><b>OpenAI structured output could not be recovered.</b><p>Saved buyer records were preserved and the contact-enrichment waterfall still ran.</p></div>':'';
      const emailCount=Number(wf.total_with_email)||buyers.filter(x=>x.email).length;
      result.innerHTML=`<div class="callout"><b>Buyer intelligence refresh completed</b><div class="progressTrack"><div class="progressBar" style="width:100%"></div></div><p class="muted">${buyers.length} buyer record(s) stored · ${emailCount} with email · ${Number(wf.emails_added)||0} new email(s) added · ${Number(wf.buyers_added)||0} new buyer(s) added. ${esc(retryNote)}</p><div class="funnel"><span>OpenAI buyers: ${esc(openai.status||'UNKNOWN')} · ${Number(openai.candidates)||0}</span><span>Apollo discovery: ${esc(wf.apollo?.status||apollo.status||'OPTIONAL')} · ${Number(wf.apollo?.candidates)||Number(apollo.candidates)||0}</span><span>Apollo email matches: ${Number(wf.apollo?.enriched_count)||0}</span><span>Public email fallback: ${esc(wf.public_email?.status||'UNKNOWN')} · ${Number(wf.public_email?.matches)||0}</span></div></div>${providerError}${buyers.length?buyerTableHtml(buyers,true):'<div class="warning">No source-backed buyers were found. This remains unknown, not proof that no buyer exists.</div>'}`;
      toast(`${buyers.length} buyers · ${emailCount} with email`);
    }catch(e){result.innerHTML=`<div class="warning"><b>Buyer research failed.</b><p>${esc(e.message)}</p><p>Previously saved buyer records were preserved.</p></div>`}
    finally{clearInterval(timer);window.accountResearchRunning=false;if(button){button.disabled=false;button.textContent='Refresh + Enrich Buyers'}}
  };
})();
