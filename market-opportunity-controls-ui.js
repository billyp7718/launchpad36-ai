(()=>{
  if(window.__L36_MARKET_OPPORTUNITY_CONTROLS__)return;
  window.__L36_MARKET_OPPORTUNITY_CONTROLS__=true;

  const css=document.createElement('style');
  css.textContent=`
    .l36-market-brand-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .l36-market-brand-controls select{border:1px solid #d6e1ed;border-radius:10px;padding:9px 11px;background:#fff;color:#18324e;min-width:180px}
    .l36-account-exclude-btn{width:28px;height:28px;border-radius:999px;border:1px solid #f0cccc;background:#fff3f3;color:#a53333;font-weight:900;font-size:15px;line-height:1;cursor:pointer;margin-left:8px;vertical-align:middle}
    .l36-account-exclude-btn:hover{background:#ffe5e5}
    .l36-account-restore-btn{border:1px solid #cddbef;background:#edf4ff;color:#235ca8;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:850;cursor:pointer;margin-left:8px}
  `;
  document.head.appendChild(css);

  function products(){try{return state?.portfolio?.products||[]}catch{return []}}
  function brandForProductId(id){const p=products().find(x=>String(x.id)===String(id));return String(p?.brand_name||'').trim()}
  function productLabels(){return [...document.querySelectorAll('label.productChoice')].filter(label=>label.querySelector('.moProduct'))}

  function applyBrandFilter(){
    const select=document.getElementById('moBrandFilter');
    if(!select)return;
    const brand=select.value;
    productLabels().forEach(label=>{
      const input=label.querySelector('.moProduct');
      const matches=!brand||brandForProductId(input?.value)===brand;
      label.style.display=matches?'flex':'none';
    });
  }

  window.l36FilterMarketBrand=applyBrandFilter;
  window.l36SelectMarketBrand=function(){
    const brand=document.getElementById('moBrandFilter')?.value||'';
    productLabels().forEach(label=>{
      const input=label.querySelector('.moProduct');
      if(input&&(!brand||brandForProductId(input.value)===brand))input.checked=true;
    });
    if(window.toast)toast(brand?`Selected all ${brand} products`:'Selected all products');
  };
  window.l36ClearMarketBrand=function(){
    const brand=document.getElementById('moBrandFilter')?.value||'';
    productLabels().forEach(label=>{
      const input=label.querySelector('.moProduct');
      if(input&&(!brand||brandForProductId(input.value)===brand))input.checked=false;
    });
    if(window.toast)toast(brand?`Cleared ${brand} products`:'Cleared all products');
  };

  function enhanceBrandControls(){
    if(document.getElementById('moBrandFilter')){applyBrandFilter();return}
    const picker=document.querySelector('.productPicker .moProduct')?.closest('.productPicker');
    if(!picker)return;
    const card=picker.closest('.card');
    const toolbar=card?.querySelector('.toolbar');
    if(!toolbar)return;
    const brands=[...new Set(products().map(p=>String(p.brand_name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    if(brands.length<1)return;
    const controls=document.createElement('div');
    controls.className='l36-market-brand-controls';
    controls.innerHTML=`<select id="moBrandFilter" onchange="l36FilterMarketBrand()"><option value="">All Brands</option>${brands.map(b=>`<option value="${String(b).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')}">${String(b).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</option>`).join('')}</select><button class="btn ghost" type="button" onclick="l36SelectMarketBrand()">Select Brand</button><button class="btn secondary" type="button" onclick="l36ClearMarketBrand()">Clear Brand</button>`;
    toolbar.prepend(controls);
  }

  async function persistIncluded(index,include){
    let source,x,w;
    try{
      source=state?.marketOpportunity?.account_opportunities?.[index];
      x=source&&typeof marketAccount==='function'?marketAccount(source):null;
      w=x?.workspace;
    }catch{}
    if(!source||!w){if(window.toast)toast('This account scenario must be saved before it can be excluded');return}
    const adj=x.account_adjustment||{};
    try{
      await api('/api/opportunities',{method:'POST',body:JSON.stringify({
        id:w.id,
        status:w.status,
        account_adjustment:{
          manual_annual_revenue:adj.manual_annual_revenue??null,
          include_in_report:include,
          rationale:adj.rationale||'',
          notes:adj.notes||''
        }
      })});
      if(typeof loadOpportunityWorkspaces==='function')await loadOpportunityWorkspaces(false);
      const target=document.getElementById('marketResults');
      if(target&&typeof renderMarketResults==='function')target.innerHTML=renderMarketResults();
      if(window.toast)toast(include?'Account restored to analysis':'Account removed from analysis');
    }catch(e){if(window.toast)toast(e.message||'Account update failed')}
  }
  window.l36SetMarketAccountIncluded=persistIncluded;

  function enhanceAccountRows(){
    const headings=[...document.querySelectorAll('h3')];
    const heading=headings.find(h=>h.textContent.trim()==='Account Opportunity Model');
    const table=heading?.closest('.card')?.querySelector('table.table');
    if(!table)return;
    const rows=[...table.querySelectorAll('tbody tr')];
    let data=[];
    try{data=typeof marketAccounts==='function'?marketAccounts():[]}catch{}
    rows.forEach((tr,index)=>{
      const cell=tr.querySelector('td');
      if(!cell||cell.querySelector('.l36-account-exclude-btn,.l36-account-restore-btn'))return;
      const included=data[index]?.account_adjustment?.include_in_report!==false;
      const btn=document.createElement('button');
      if(included){
        btn.className='l36-account-exclude-btn';
        btn.type='button';
        btn.textContent='×';
        btn.title='Remove this account from the analysis';
        btn.setAttribute('aria-label','Remove this account from the analysis');
        btn.onclick=()=>persistIncluded(index,false);
      }else{
        btn.className='l36-account-restore-btn';
        btn.type='button';
        btn.textContent='Restore';
        btn.title='Restore this account to the analysis';
        btn.onclick=()=>persistIncluded(index,true);
      }
      cell.querySelector('b')?.insertAdjacentElement('afterend',btn);
    });
  }

  function enhance(){enhanceBrandControls();enhanceAccountRows()}
  const observer=new MutationObserver(()=>requestAnimationFrame(enhance));
  observer.observe(document.body,{childList:true,subtree:true});
  enhance();
})();
