(()=>{
  if(window.__L36_FAST_REVENUE_PLAN__)return;
  window.__L36_FAST_REVENUE_PLAN__=true;

  const css=document.createElement('style');
  css.textContent=`
    .l36-revenue-guide{margin-bottom:14px;border:1px solid #bcd4f2;background:linear-gradient(135deg,#eef6ff,#fff);border-radius:18px;padding:16px}
    .l36-revenue-guide h2{margin:4px 0 7px;font-size:20px;color:#173e72}.l36-revenue-guide p{margin:0;color:#60758d;font-size:14px;line-height:1.55}
    .l36-product-search{margin:10px 0}.l36-product-search input{width:100%;border:1px solid #cbdced;border-radius:11px;padding:11px 12px;font-size:14px;color:#18324e}
    .l36-plan-summary{margin:14px 0}.l36-plan-summary .metric small{font-size:12px}.l36-plan-summary .metric b{font-size:22px}
    .l36-plan-table td{vertical-align:top;min-width:130px}.l36-plan-table td:first-child{min-width:180px}.l36-plan-table .muted{font-size:12px}
    .l36-plan-action{display:block;font-weight:800;color:#173e72;margin-bottom:4px}.l36-plan-steps{margin:6px 0 0;padding-left:18px;color:#60758d;font-size:12px;line-height:1.5}
    @media(max-width:760px){.l36-plan-summary{grid-template-columns:1fr 1fr}.l36-plan-table{min-width:980px}}
  `;
  document.head.appendChild(css);

  const safe=value=>typeof esc==='function'?esc(value):String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const money=value=>typeof fmtMoney==='function'?fmtMoney(value):new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(value)||0);
  const accounts=()=>{try{return typeof marketAccounts==='function'?marketAccounts():state?.marketOpportunity?.account_opportunities||[]}catch{return state?.marketOpportunity?.account_opportunities||[]}};

  const baseMarket=window.market;
  if(typeof baseMarket==='function')window.market=function(){
    let html=baseMarket();
    html=html.replace('<h1>Market Opportunity Scenarios</h1>','<h1>Build a Revenue Plan</h1>')
      .replace('Model an addressable manufacturer-revenue scenario across multiple products, then distinguish qualified account fit from verified assortment evidence.','Select one or more products and how many accounts you want. Launchpad36 returns a ranked account plan with buyers, competitive placement, modeled retailer margin, revenue opportunity and executive next actions.')
      .replace('<div class="label">1 · SELECT PRODUCTS</div>','<div class="label">1 · ENTER OR SELECT PRODUCTS</div>')
      .replace('<div class="label">2 · ROUTE & ASSUMPTIONS</div>','<div class="label">2 · TARGET SETTINGS</div>')
      .replace('<div class="productPicker">','<div class="l36-product-search"><input id="l36RevenueProductSearch" type="search" placeholder="Search product, SKU, brand or category" aria-label="Search products for the revenue plan" oninput="l36FilterRevenueProducts()"></div><div class="productPicker">')
      .replace('<button class="btn dark" data-capability="APP_WRITE" onclick="runMarketOpportunity()">Calculate & Save Scenario</button>','<button id="l36BuildRevenuePlanBtn" class="btn dark" data-capability="APP_WRITE" onclick="runMarketOpportunity()">Build Revenue Plan</button>')
      .replace('<button id="deepMarketBtn" class="btn" data-capability="DEEP_MARKET_ANALYSIS" onclick="runDeepMarketAnalysis()">Run Deep Market Analysis</button>','<button id="deepMarketBtn" class="btn" data-capability="DEEP_MARKET_ANALYSIS" onclick="runDeepMarketAnalysis()">Research Missing Intelligence</button>')
      .replace('<b>Deep analysis researches the 25 highest-fit accounts</b>','<b>Optional research follows the selected Account Scope</b>')
      .replace('It checks every selected product against source-backed competitive offerings, saves results account by account, then recalculates the opportunity.','It refreshes buyer and competitive-product gaps for only the selected targets, saves successful accounts as they complete, then recalculates the plan. The fast plan above never waits for these paid research calls.');
    return `<section class="l36-revenue-guide"><div class="eyebrow">FAST PRODUCT-TO-ACCOUNT PLANNING</div><h2>Products in. Ranked revenue plan out.</h2><p>The standard plan uses saved tenant and public intelligence in one request and makes no paid research calls. Use optional research only when a returned account has a buyer or competitive-data gap.</p></section>${html}`;
  };

  window.l36FilterRevenueProducts=function(){
    const query=String(document.getElementById('l36RevenueProductSearch')?.value||'').trim().toLowerCase();
    const brand=document.getElementById('moBrandFilter')?.value||'';
    const productMap=new Map((state?.portfolio?.products||[]).map(product=>[String(product.id),product]));
    document.querySelectorAll('label.productChoice').forEach(label=>{
      const input=label.querySelector('.moProduct');if(!input)return;
      const product=productMap.get(String(input.value)),brandMatch=!brand||String(product?.brand_name||'')===brand,text=[product?.brand_name,product?.name,product?.category,product?.product_family,...(product?.variants||[]).flatMap(variant=>[variant.sku,variant.variant_name])].filter(Boolean).join(' ').toLowerCase();
      label.style.display=brandMatch&&(!query||text.includes(query))?'flex':'none';
    });
    const selectButton=document.getElementById('l36RevenueProductSearch')?.closest('.card')?.querySelector('button[onclick="toggleMarketProducts(true)"]'),selectLabel=query||brand?'Select Matches':'Select All';if(selectButton&&selectButton.textContent!==selectLabel)selectButton.textContent=selectLabel;
  };
  const priorBrandFilter=window.l36FilterMarketBrand;
  if(typeof priorBrandFilter==='function')window.l36FilterMarketBrand=function(){priorBrandFilter();window.l36FilterRevenueProducts()};
  const priorProductToggle=window.toggleMarketProducts;
  if(typeof priorProductToggle==='function')window.toggleMarketProducts=function(checked){
    const query=String(document.getElementById('l36RevenueProductSearch')?.value||'').trim(),brand=document.getElementById('moBrandFilter')?.value||'';
    if(!checked||(!query&&!brand))return priorProductToggle(checked);
    document.querySelectorAll('label.productChoice').forEach(label=>{const input=label.querySelector('.moProduct');if(input)input.checked=label.style.display!=='none'});if(typeof captureUiState==='function')captureUiState(document.querySelector('.moProduct'));
  };

  function marginLabel(margin={}){
    if(margin.status!=='AVAILABLE')return '<span class="muted">Pricing incomplete</span>';
    const range=margin.min_percent===margin.max_percent?`${margin.average_percent}%`:`${margin.min_percent}%–${margin.max_percent}%`;
    return `<b>${safe(range)}</b><div class="muted">Modeled from catalog MAP/MSRP and wholesale</div>`;
  }
  function buyerLabel(buyer){
    if(!buyer)return '<span class="muted">No category buyer saved</span>';
    const contacts=[buyer.email?`<a href="mailto:${safe(buyer.email)}">${safe(buyer.email)}</a>`:'',buyer.phone?`<a href="tel:${safe(buyer.phone)}">${safe(buyer.phone)}</a>`:'',buyer.linkedin?`<a href="${safe(buyer.linkedin)}" target="_blank" rel="noopener noreferrer">Profile</a>`:''].filter(Boolean).join(' · ');
    return `<b>${safe(buyer.name)}</b><div class="muted">${safe(buyer.title||'')}</div>${buyer.department?`<div class="muted">${safe(buyer.department)}</div>`:''}${buyer.ownership_confirmed?`<div class="pill">${safe(buyer.category_scope||'Category aligned')}</div>`:'<div class="muted">Category ownership not confirmed</div>'}${contacts?`<div class="contactLinks">${contacts}</div>`:''}`;
  }
  function competitionLabel(landscape={}){
    if(!landscape.total_count)return '<span class="muted">No relevant competitive products saved</span>';
    const products=(landscape.products||[]).slice(0,3).map(product=>`<li><b>${safe([product.brand,product.name].filter(Boolean).join(' · '))}</b><div class="muted">${product.in_store?'In store':''}${product.in_store&&product.online?' + ':''}${product.online?'Online':''}${!product.in_store&&!product.online?'Channel not confirmed':''}${product.price_text?` · ${safe(product.price_text)}`:''}</div></li>`).join('');
    return `<b>${Number(landscape.total_count)||0} relevant product${Number(landscape.total_count)===1?'':'s'}</b><div class="muted">${Number(landscape.in_store_count)||0} in store · ${Number(landscape.online_count)||0} online</div>${products?`<ul class="l36-plan-steps">${products}</ul>`:''}`;
  }
  function revenuePlanHtml(){
    const analysis=state?.marketOpportunity,plan=analysis?.executive_plan;if(!analysis||!plan)return '';
    const rows=accounts(),shown=rows.slice(0,25),duration=Number(analysis.processing?.duration_ms)||0;
    return `<section class="card" style="margin-bottom:14px"><div class="workspaceTop"><div><div class="eyebrow">EXECUTIVE REVENUE PLAN</div><h2 style="margin:5px 0">${Number(plan.target_account_count)||0} prioritized target account${Number(plan.target_account_count)===1?'':'s'}</h2><p class="muted">Built in one server request${duration?` · ${duration} ms server processing`:''} · standard plan paid-provider calls: 0</p></div><div class="workspaceActions"><button class="btn" onclick="openMarketReport()">Preview Full Analysis</button><button class="btn secondary" onclick="runDeepMarketAnalysis()" data-capability="DEEP_MARKET_ANALYSIS">Research Gaps</button></div></div><div class="stats l36-plan-summary"><div class="card stat"><small>Category Buyers Confirmed</small><strong>${Number(plan.accounts_with_confirmed_category_buyer)||0}</strong></div><div class="card stat"><small>Competitive Landscape</small><strong>${Number(plan.accounts_with_competitive_landscape)||0}</strong></div><div class="card stat"><small>Margin Estimate Available</small><strong>${Number(plan.accounts_with_margin_estimate)||0}</strong></div><div class="card stat"><small>Modeled Annual Opportunity</small><strong>${money(analysis.summary?.base_manufacturer_revenue)}</strong></div></div><div class="tableWrap"><table class="table l36-plan-table"><thead><tr><th>Target Account</th><th>Buyer</th><th>Competitive Landscape</th><th>Estimated Retailer Margin</th><th>Executive Next Action</th><th></th></tr></thead><tbody>${shown.map(account=>`<tr><td><b>${safe(account.name)}</b><div class="muted">Fit ${Number(account.fit_score)||0} · ${money(account.base_manufacturer_revenue)} modeled annual opportunity</div></td><td>${buyerLabel(account.primary_buyer)}</td><td>${competitionLabel(account.competitive_landscape)}</td><td>${marginLabel(account.estimated_retailer_margin)}</td><td><span class="l36-plan-action">${safe(account.executive_action_plan?.next_action||'Review account plan')}</span><ol class="l36-plan-steps">${(account.executive_action_plan?.actions||[]).slice(0,3).map(action=>`<li>${safe(action.action)}</li>`).join('')}</ol></td><td><button class="btn ghost" onclick="openAccount360('${safe(account.organization_id)}')">Open Account</button></td></tr>`).join('')}</tbody></table></div>${rows.length>shown.length?`<p class="muted">Showing the first ${shown.length} targets here for speed. The complete ${rows.length}-account model remains in the full table and export below.</p>`:''}</section>`;
  }

  const baseResults=window.renderMarketResults;
  if(typeof baseResults==='function')window.renderMarketResults=function(){return `${revenuePlanHtml()}${baseResults()}`};

  const baseRun=window.runMarketOpportunity;
  if(typeof baseRun==='function')window.runMarketOpportunity=async function(){
    const button=document.getElementById('l36BuildRevenuePlanBtn');
    if(button){button.disabled=true;button.textContent='Building Revenue Plan…';button.setAttribute('aria-busy','true')}
    try{return await baseRun()}finally{if(button){button.disabled=false;button.textContent='Build Revenue Plan';button.removeAttribute('aria-busy')}if(typeof applyCapabilityUi==='function')applyCapabilityUi(document.getElementById('marketResults')||document)}
  };

  const baseSnapshot=window.marketReportSnapshotPayload;
  if(typeof baseSnapshot==='function')window.marketReportSnapshotPayload=function(){
    const snapshot=baseSnapshot(),reportContext=typeof marketReportContext==='function'?marketReportContext():state?.marketOpportunity,source=typeof marketReportContextAccounts==='function'?marketReportContextAccounts():typeof marketAccounts==='function'?marketAccounts(true):accounts(),byOrganization=new Map(source.map(account=>[String(account.organization_id||''),account]));
    return {...snapshot,revenue_plan:reportContext?.executive_plan||null,accounts:(snapshot.accounts||[]).map((account,index)=>{const plan=byOrganization.get(String(account.organization_id||''))||source.find(candidate=>candidate.name===account.name&&candidate.domain===account.domain)||source[index],landscape=plan?.competitive_landscape;return {...account,estimated_retailer_margin:plan?.estimated_retailer_margin||null,executive_action_plan:plan?.executive_action_plan||null,primary_buyer:plan?.primary_buyer||null,competitive_landscape:landscape||null,competitive_assortment:Array.isArray(landscape?.products)?landscape.products:account.competitive_assortment}})};
  };

  const baseReportHtml=window.buildMarketReportHtml;
  if(typeof baseReportHtml==='function')window.buildMarketReportHtml=function(){
    const source=typeof marketReportContextAccounts==='function'?marketReportContextAccounts():typeof marketAccounts==='function'?marketAccounts(true):accounts();let accountIndex=0;
    return baseReportHtml().replace(/<p><b>Competitive offerings found:<\/b>[\s\S]*?<\/p>/g,original=>{
      const account=source[accountIndex++]||{};if(!account.competitive_landscape)return original;
      const products=account.competitive_landscape.products||[],margin=account.estimated_retailer_margin||{},actions=account.executive_action_plan?.actions||[],competitive=products.length?products.slice(0,12).map(product=>`${safe([product.brand,product.name].filter(Boolean).join(' '))}${product.price_text?` (${safe(product.price_text)})`:''} [${product.in_store&&product.online?'in store + online':product.in_store?'in store':product.online?'online':'channel not confirmed'}]`).join('; '):'No category-relevant competitive products saved.',marginText=margin.status==='AVAILABLE'?(margin.min_percent===margin.max_percent?`${margin.average_percent}%`:`${margin.min_percent}%–${margin.max_percent}%`):'';
      return `<p><b>Relevant competitive products:</b> ${competitive}</p>${marginText?`<p><b>Estimated retailer margin:</b> ${safe(marginText)} modeled from catalog MAP/MSRP and wholesale; not a negotiated or verified margin.</p>`:''}${actions.length?`<h4>Executive Actions</h4><ul>${actions.map(action=>`<li>${safe(action.action||action)}</li>`).join('')}</ul>`:''}`;
    });
  };

  const observer=new MutationObserver(()=>{if(document.getElementById('l36RevenueProductSearch'))window.l36FilterRevenueProducts()});
  observer.observe(document.getElementById('content')||document.body,{childList:true,subtree:true});
})();
