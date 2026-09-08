(()=>{
  const priorDeep=window.runDeepMarketAnalysis;
  const priorMarketAccount=window.marketAccount;
  const priorChannelSummary=window.marketChannelSummary;
  const priorRenderResults=window.renderMarketResults;
  const priorOpenMarketAccount=window.openMarketAccount;
  const priorRender360=window.renderAccount360;

  const recLabel=v=>({IN_STORE:'In Store',ONLINE:'Online',BOTH:'In Store + Online',NOT_RECOMMENDED:'Not Recommended'}[v]||'Not Evaluated');
  const fitTone=n=>Number(n)>=80?'Strong':Number(n)>=65?'Good':Number(n)>=50?'Moderate':'Low';
  const routeFitForAccount=x=>x?.route_to_market_fit||x?.workspace?.scenario?.route_to_market_fit||null;
  const skuKey=v=>String(v||'').trim().toLowerCase();
  const manualConfirmed=status=>status?.confirmation_source==='manual_account_review';

  function fitStatusFor(account,item){
    const saved=account?.workspace?.scenario?.comparison_status||account?.comparison_status||{};
    const manual=typeof comparisonStatusFor==='function'?comparisonStatusFor(saved,item):{};
    if(manualConfirmed(manual))return {...manual,source:'MANUAL_OVERRIDE'};
    const fit=routeFitForAccount(account),recs=fit?.sku_recommendations||[];
    const sku=skuKey(item?.sku),product=String(item?.product_name||'').trim().toLowerCase();
    const found=recs.find(r=>sku&&skuKey(r.sku)===sku)||recs.find(r=>product&&String(r.product||'').trim().toLowerCase()===product);
    if(!found)return {...manual,source:Object.keys(manual||{}).length?'SAVED_STATUS':'UNASSIGNED'};
    return {in_store:['IN_STORE','BOTH'].includes(found.recommendation),online:['ONLINE','BOTH'].includes(found.recommendation),source:fit.source||'AI_EVIDENCE_SYNTHESIS',recommendation:found.recommendation,in_store_fit:Number(found.in_store_fit)||0,online_fit:Number(found.online_fit)||0,confidence:Number(found.confidence)||0,rationale:found.rationale||''};
  }

  window.marketAccount=function(x){
    const account=typeof priorMarketAccount==='function'?priorMarketAccount(x):x;
    const fit=account?.workspace?.scenario?.route_to_market_fit||x?.route_to_market_fit||null;
    return fit?{...account,route_to_market_fit:fit}:account;
  };

  window.marketChannelSummary=function(rows=[]){
    const totals={in_store:0,online:0,omnichannel:0,unassigned:0,not_recommended:0,ai_evaluated:0};
    for(const account of rows){
      const assortment=account.proposed_assortment||account.product_contributions||[];
      for(const item of assortment){
        const amount=Number(item.annual_revenue??item.base_manufacturer_revenue)||0,status=fitStatusFor(account,item);
        if(status.source==='AI_EVIDENCE_SYNTHESIS'||status.source==='HEURISTIC_FALLBACK')totals.ai_evaluated++;
        if(status.recommendation==='NOT_RECOMMENDED'){totals.not_recommended+=amount;continue}
        if(status.in_store)totals.in_store+=amount;
        if(status.online)totals.online+=amount;
        if(status.in_store&&status.online)totals.omnichannel+=amount;
        if(!status.in_store&&!status.online)totals.unassigned+=amount;
      }
    }
    return totals;
  };

  function routeCoverage(){
    const rows=typeof marketAccounts==='function'?marketAccounts():[];
    const withFit=rows.filter(x=>routeFitForAccount(x));
    return {total:rows.length,evaluated:withFit.length,ai:withFit.filter(x=>routeFitForAccount(x)?.source==='AI_EVIDENCE_SYNTHESIS').length,fallback:withFit.filter(x=>routeFitForAccount(x)?.source==='HEURISTIC_FALLBACK').length};
  }

  window.renderMarketResults=function(){
    const html=typeof priorRenderResults==='function'?priorRenderResults():'';
    if(!state.marketOpportunity)return html;
    const c=routeCoverage();
    const callout=`<div class="callout" style="margin:12px 0"><div class="workspaceTop"><div><b>AI Route-to-Market Fit</b><p class="muted">${c.evaluated} of ${c.total} modeled account(s) have SKU-level channel evaluation · ${c.ai} AI evidence synthesis${c.fallback?` · ${c.fallback} evidence-based fallback`:''}. In-store and online scores are calculated independently for each SKU using retailer assortment evidence, account format, category relevance, price architecture, physical merchandising burden, demonstration value, and ecommerce suitability.</p></div><span class="sourceTag">${c.ai?'AI ROUTE INTELLIGENCE':'RUN DEEP ANALYSIS'}</span></div>${c.evaluated<c.total?'<p class="muted"><b>Channel totals use AI recommendations where available.</b> Run Deep Market Analysis to expand AI coverage. A manually confirmed SKU channel status overrides the AI recommendation for that SKU.</p>':''}</div>`;
    const marker='<div class="toolbar" style="justify-content:flex-end;margin-bottom:12px">';
    return html.includes(marker)?html.replace(marker,callout+marker):callout+html;
  };

  function routeFitPanel(fit,orgId='',workspaceId='',productIds=[]){
    if(!fit)return `<div class="callout"><div class="workspaceTop"><div><b>AI Route-to-Market Fit</b><p class="muted">This account has not been evaluated at the SKU level yet.</p></div>${orgId&&productIds.length?`<button class="btn dark" onclick='refreshRouteFit(${JSON.stringify(orgId)},${JSON.stringify(workspaceId)},${JSON.stringify(productIds)})'>Run AI Channel Fit</button>`:''}</div></div>`;
    const summary=fit.summary||{},rows=fit.sku_recommendations||[],source=fit.source==='AI_EVIDENCE_SYNTHESIS'?'AI evidence synthesis':fit.source==='HEURISTIC_FALLBACK'?'Evidence-based fallback':fit.source||'Unknown';
    return `<div class="callout"><div class="workspaceTop"><div><div class="label">AI ROUTE-TO-MARKET FIT</div><h3 style="margin:5px 0">${esc(recLabel(summary.account_recommendation))}</h3><p class="muted">${esc(summary.rationale||'')}</p></div><div><span class="sourceTag">${esc(source)}</span>${orgId&&productIds.length?`<div style="margin-top:8px"><button class="btn ghost" onclick='refreshRouteFit(${JSON.stringify(orgId)},${JSON.stringify(workspaceId)},${JSON.stringify(productIds)})'>Refresh AI Fit</button></div>`:''}</div></div><div class="stats" style="margin-bottom:10px"><div class="card stat"><small>In-Store Fit</small><strong>${Number(summary.account_in_store_fit)||0}</strong><span class="muted">${fitTone(summary.account_in_store_fit)}</span></div><div class="card stat"><small>Online Fit</small><strong>${Number(summary.account_online_fit)||0}</strong><span class="muted">${fitTone(summary.account_online_fit)}</span></div><div class="card stat"><small>Observed Comparables</small><strong>${Number(fit.evidence_observation_count??fit.observed_channel_signals?.total)||0}</strong><span class="muted">Channel evidence inputs</span></div><div class="card stat"><small>Evaluated SKUs</small><strong>${rows.length}</strong><span class="muted">Independent route decisions</span></div></div><div class="tableWrap"><table class="table"><thead><tr><th>Product / SKU</th><th>Recommendation</th><th>In Store</th><th>Online</th><th>Confidence</th><th>AI Rationale</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.product||'')}</b><div class="muted">${esc(r.sku||'')}</div></td><td><span class="badge">${esc(recLabel(r.recommendation))}</span></td><td><b>${Number(r.in_store_fit)||0}/100</b><div class="muted">${fitTone(r.in_store_fit)}</div></td><td><b>${Number(r.online_fit)||0}/100</b><div class="muted">${fitTone(r.online_fit)}</div></td><td>${Number(r.confidence)||0}%</td><td class="muted">${esc(r.rationale||'')}</td></tr>`).join('')}</tbody></table></div><p class="muted">These are commercial placement recommendations, not proof the retailer will accept or stock a SKU. Manual confirmation remains available and overrides the AI recommendation.</p></div>`;
  }

  window.refreshRouteFit=async function(orgId,workspaceId,productIds){
    const ids=(Array.isArray(productIds)?productIds:[]).map(String).filter(Boolean);if(!orgId||!ids.length){toast('No products are available for AI channel fit');return}
    toast('Evaluating in-store and online fit…');
    try{
      const d=await api('/api/route-to-market-fit',{method:'POST',body:JSON.stringify({organization_id:orgId,product_ids:ids,workspace_id:workspaceId||undefined})}),fit=d.route_to_market_fit;
      const w=(state.workspaces||[]).find(x=>String(x.id)===String(workspaceId));if(w)w.scenario={...(w.scenario||{}),route_to_market_fit:fit};
      const marketRow=(state.marketOpportunity?.account_opportunities||[]).find(x=>String(x.organization_id)===String(orgId));if(marketRow)marketRow.route_to_market_fit=fit;
      if(state.__account360&&String(state.__account360.org?.id)===String(orgId))state.__account360.route_to_market_fit=fit;
      if(workspaceId&&typeof openOpportunityWorkspace==='function'&&document.getElementById('modal')?.classList.contains('show'))openOpportunityWorkspace(workspaceId);
      else if(state.marketOpportunity&&typeof marketAccounts==='function'){const idx=(state.marketOpportunity.account_opportunities||[]).findIndex(x=>String(x.organization_id)===String(orgId));if(idx>=0&&typeof openMarketAccount==='function')openMarketAccount(idx)}
      toast(`${recLabel(fit?.summary?.account_recommendation)} recommended · In-store ${fit?.summary?.account_in_store_fit||0} · Online ${fit?.summary?.account_online_fit||0}`);
    }catch(e){toast(e.message||'AI channel fit failed')}
  };

  window.openMarketAccount=function(index){
    if(typeof priorOpenMarketAccount!=='function')return;
    priorOpenMarketAccount(index);
    setTimeout(()=>{
      const source=state.marketOpportunity?.account_opportunities?.[index],account=source?marketAccount(source):null;if(!account)return;
      const fit=routeFitForAccount(account),workspace=account.workspace||marketWorkspace?.(account),ids=(workspace?.product_ids||state.marketOpportunity?.selected_products?.map(p=>p.id)||[]).map(String),card=document.createElement('div');card.id='l36RouteFitAccountPanel';card.style.marginTop='14px';card.innerHTML=routeFitPanel(fit,account.organization_id,workspace?.id||'',ids);
      const modal=document.getElementById('modalCard');if(modal&&!document.getElementById('l36RouteFitAccountPanel'))modal.insertBefore(card,modal.children[2]||null);
    },0);
  };

  async function evaluateAccountsAfterDeep(){
    const payload=typeof marketFormPayload==='function'?marketFormPayload():{},productIds=(payload.product_ids||[]).map(String);if(!productIds.length||!state.marketOpportunity)return;
    const accounts=(state.marketOpportunity.account_opportunities||[]).filter(x=>x.domain).slice(0,25);if(!accounts.length)return;
    const button=document.getElementById('deepMarketBtn'),target=document.getElementById('marketResults');if(button){button.disabled=true;button.textContent='AI Channel Fit Running…'}
    let cursor=0,done=0,failed=0;
    const progress=()=>{if(target)target.insertAdjacentHTML('afterbegin',`<div id="l36RouteFitProgress" class="callout" style="margin-bottom:12px"><b>AI Route-to-Market Fit</b><p class="muted">Scoring in-store and online fit independently for every selected SKU across the ${accounts.length} researched accounts.</p><div class="progressTrack"><div class="progressBar" style="width:${Math.round((done+failed)/accounts.length*100)}%"></div></div><div class="progressMeta"><span>${done} evaluated · ${failed} need another attempt</span><span>${done+failed} of ${accounts.length}</span></div></div>`)};
    if(target)target.querySelector('#l36RouteFitProgress')?.remove();progress();
    const worker=async()=>{while(cursor<accounts.length){const account=accounts[cursor++],workspace=typeof marketWorkspace==='function'?marketWorkspace(account):null;try{const d=await api('/api/route-to-market-fit',{method:'POST',body:JSON.stringify({organization_id:account.organization_id,product_ids:productIds,workspace_id:workspace?.id||undefined})}),fit=d.route_to_market_fit;account.route_to_market_fit=fit;if(workspace)workspace.scenario={...(workspace.scenario||{}),route_to_market_fit:fit};done++}catch(e){failed++}const p=document.getElementById('l36RouteFitProgress');if(p)p.remove();progress()}};
    await Promise.all([worker(),worker()]);
    await loadOpportunityWorkspaces(false).catch(()=>{});
    if(target){target.innerHTML=renderMarketResults();if(failed)target.insertAdjacentHTML('afterbegin',`<div class="warning"><b>AI route fit completed with ${failed} account(s) needing another attempt.</b><p>${done} accounts now have SKU-level in-store / online recommendations.</p></div>`)}
    if(button){button.disabled=false;button.textContent='Run Deep Market Analysis'}
    toast(`AI channel fit complete: ${done} account(s) evaluated${failed?`, ${failed} need another attempt`:''}`);
  }

  if(typeof priorDeep==='function')window.runDeepMarketAnalysis=async function(){await priorDeep();if(state.marketOpportunity)await evaluateAccountsAfterDeep()};

  // Opportunity workspace: display the saved AI recommendation above the editable competitive channel evidence.
  const priorOpenWorkspace=window.openOpportunityWorkspace;
  if(typeof priorOpenWorkspace==='function')window.openOpportunityWorkspace=function(id){
    priorOpenWorkspace(id);
    setTimeout(()=>{const w=(state.workspaces||[]).find(x=>String(x.id)===String(id)),modal=document.getElementById('modalCard');if(!w||!modal||document.getElementById('l36WorkspaceRouteFit'))return;const box=document.createElement('div');box.id='l36WorkspaceRouteFit';box.style.margin='14px 0';box.innerHTML=routeFitPanel(w.scenario?.route_to_market_fit||null,w.organization_id,w.id,(w.product_ids||[]).map(String));const firstH3=[...modal.querySelectorAll('h3')].find(x=>x.textContent.includes('Account Assortment Comparison'));if(firstH3)firstH3.before(box);else modal.prepend(box)},0)
  };

  // Account 360 opportunity tab: expose route strategy without requiring a separate module.
  if(typeof priorRender360==='function')window.renderAccount360=function(tab='overview'){
    priorRender360(tab);if(tab!=='opportunity')return;const d=state.__account360,modal=document.getElementById('modalCard');if(!d||!modal||document.getElementById('l36Account360RouteFit'))return;const w=(state.workspaces||[]).find(x=>String(x.organization_id)===String(d.org?.id)),fit=w?.scenario?.route_to_market_fit||d.route_to_market_fit||null,ids=(w?.product_ids||[]).map(String);const box=document.createElement('div');box.id='l36Account360RouteFit';box.style.marginTop='12px';box.innerHTML=routeFitPanel(fit,d.org?.id||'',w?.id||'',ids);modal.appendChild(box)
  };

  window.__L36_AI_ROUTE_FIT__=true;
})();
