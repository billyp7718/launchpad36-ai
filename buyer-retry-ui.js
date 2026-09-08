(function(){
  window.runBuyerResearch=async function(orgId){
    if(window.accountResearchRunning){toast('Research is already running');return}
    state.selectedBuyerOrgId=String(orgId);
    const result=$('buyerResearchResult'),button=$('buyerRunBtn'),website=$('researchWebsite')?.value.trim();
    if(!website){toast('Enter the account website');return}
    window.accountResearchRunning=true;if(button){button.disabled=true;button.textContent='Buyer Research Running…'}
    const started=Date.now();
    result.innerHTML='<div class="callout"><b id="researchStage">Searching public buyer sources with automatic recovery…</b><div class="progressTrack"><div id="researchProgress" class="progressBar"></div></div><div class="progressMeta"><span>Malformed AI output will be retried automatically.</span><span id="researchElapsed">0 seconds</span></div></div>';
    const timer=setInterval(()=>{const sec=Math.floor((Date.now()-started)/1000);if($('researchProgress'))$('researchProgress').style.width=`${Math.min(94,10+sec*.7)}%`;if($('researchElapsed'))$('researchElapsed').textContent=`${sec} seconds`},500);
    try{
      const d=await api('/api/buyer-research-resilient',{method:'POST',body:JSON.stringify({organization_id:orgId,website})});
      const saved=await api(`/api/buyers?organization_id=${encodeURIComponent(orgId)}`).catch(()=>({buyers:d.buyers||[]})),buyers=saved.buyers||d.buyers||[],r=d.research||{},sources=r.buyer_sources||{},openai=sources.openai_web_search||{},apollo=sources.apollo||{},corporate=sources.corporate_pages||{};
      state.buyers=buyers;await load();
      const retryNote=d.resilient_retry_used?`Automatic recovery used ${Number(d.retry_attempts)||1} retr${Number(d.retry_attempts)===1?'y':'ies'}.`:'';
      const providerError=openai.status==='RETRY_EXHAUSTED'?'<div class="warning"><b>OpenAI structured output could not be recovered.</b><p>Saved buyer records were preserved. Public-page and optional enrichment results are still shown; try Refresh All Buyers again later.</p></div>':'';
      result.innerHTML=`<div class="callout"><b>Buyer research completed across all buying functions</b><div class="progressTrack"><div class="progressBar" style="width:100%"></div></div><p class="muted">${buyers.length} buyer record(s) are stored on this account. ${esc(retryNote)}</p><div class="funnel"><span>OpenAI: ${esc(openai.status||'UNKNOWN')} · ${Number(openai.candidates)||0}</span><span>Public pages: ${esc(corporate.status||'UNKNOWN')} · ${Number(corporate.candidates)||0}</span><span>Apollo: ${esc(apollo.status||'OPTIONAL')} · ${Number(apollo.candidates)||0}</span></div></div>${providerError}${buyers.length?buyerTableHtml(buyers,true):'<div class="warning">No source-backed buyers were found. This remains unknown, not proof that no buyer exists.</div>'}`;
      toast(d.resilient_retry_used?'Buyer research completed after automatic recovery':'Buyer data saved to account');
    }catch(e){result.innerHTML=`<div class="warning"><b>Buyer research failed.</b><p>${esc(e.message)}</p><p>Previously saved buyer records were preserved.</p></div>`}
    finally{clearInterval(timer);window.accountResearchRunning=false;if(button){button.disabled=false;button.textContent='Refresh All Buyers'}}
  };
})();
