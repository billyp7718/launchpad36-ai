(()=>{
  // Keep buyer contact data visible as first-class fields everywhere buyer tables are rendered.
  window.buyerTableHtml=function(rows,showEvidence=false,editable=true){
    return `<div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Buyer</th><th>Title</th><th>Category</th><th>Email</th><th>Phone</th>${showEvidence?'<th>Evidence</th>':''}<th>Status</th><th>Confidence</th><th>Source</th><th>Edit</th></tr></thead><tbody>${(rows||[]).map(b=>`<tr><td><b>${esc(b.name)}</b>${b.linkedin?`<div class="muted"><a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></div>`:''}</td><td>${esc(b.title||'—')}</td><td>${esc(b.category_scope||b.category||'—')}</td><td>${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'—'}</td><td>${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'—'}</td>${showEvidence?`<td class="muted">${esc(b.evidence_quote||b.notes||'Review source')}</td>`:''}<td><span class="pill">${esc(b.verification_status||b.status||'UNKNOWN')}</span></td><td>${Number(b.confidence)||0}%</td><td>${b.source_url?`<a href="${esc(b.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>`:'—'}</td><td>${b.id?`<button class="btn ghost" onclick="openBuyerEditor('${esc(b.id)}')">Edit</button>`:'—'}</td></tr>`).join('')}</tbody></table></div>`;
  };

  // Split the account-grid buyer summary into Buyer, Email and Phone columns rather than one Contact column.
  window.accountTable=function(rows){return `<div class="tableWrap"><table class="table"><thead><tr><th>Organization</th><th>Head Office</th><th>Business Channels</th><th>Categories</th><th>Locations</th><th>Buyer</th><th>Email</th><th>Phone</th><th>Intelligence</th></tr></thead><tbody>${(rows||[]).map(o=>{const buyer=(o.buyers||[])[0];return `<tr><td><b>${esc(o.name)}</b><div class="muted">${esc(o.organization_type||'retailer')} · ${esc(o.domain||'')}</div><span class="sourceTag">${esc((o.verification_status||'DISCOVERY_CANDIDATE').replaceAll('_',' '))}</span></td><td>${esc(o.headquarters||o.region||'Not researched')}</td><td>${(o.channel_codes||[]).slice(0,4).map(c=>`<span class="badge">${esc(c.replaceAll('_',' '))}</span>`).join(' ')}</td><td>${(o.categories||[]).slice(0,4).map(c=>`<span class="pill">${esc(c)}</span>`).join(' ')}</td><td>${Number(o.footprint)||'—'}</td><td>${buyer?`<b>${esc(buyer.name)}</b><div class="muted">${esc(buyer.title||buyer.category||'')}</div>`:'<span class="muted">Not researched</span>'}</td><td>${buyer?.email?`<a href="mailto:${esc(buyer.email)}">${esc(buyer.email)}</a>`:'—'}</td><td>${buyer?.phone?`<a href="tel:${esc(buyer.phone)}">${esc(buyer.phone)}</a>`:'—'}</td><td><div class="workspaceActions"><button class="btn ghost" onclick="openAccountResearch('${esc(o.id)}')">Research</button><button class="btn dark" onclick="openAccountDataReview('${esc(o.id)}')">Review & Approve</button><button class="btn secondary" onclick="openAccountChannel('${esc(o.id)}')">Channel Intelligence</button><button class="btn secondary" onclick="openEditAccount('${esc(o.id)}')">Edit</button></div></td></tr>`}).join('')}</tbody></table>${rows?.length?'':'<div class="empty"><b>No accounts loaded.</b><p>Import an Excel/CSV account list or add the first account manually.</p><button class="btn" onclick="openAccountImport()">Import Accounts</button></div>'}</div>`};

  // Preserve buyer/contact columns when an uploaded spreadsheet is normalized before POSTing to the importer.
  window.accountRow=function(r={}){
    const value=(...keys)=>{for(const k of keys)if(r[k]!==undefined&&r[k]!==null&&String(r[k]).trim()!=='')return r[k];return ''};
    const list=v=>Array.isArray(v)?v:String(v||'').split(/[,;|]/).map(x=>x.trim()).filter(Boolean);
    return {
      name:String(value('Organization','Name','Retailer','Account','name')).trim(),
      domain:String(value('Domain','Website','domain')).trim().replace(/^https?:\/\//,'').replace(/\/.*$/,''),
      organization_type:String(value('Type','Organization Type','organization_type')||'retailer').trim().toLowerCase(),
      channels:list(value('Channels','Channel','channels')),
      categories:list(value('Categories','Category','categories')),
      coverage:String(value('Coverage','coverage')).trim(),
      region:String(value('Region','region')).trim(),
      headquarters:String(value('Head Office Location','Head Office','Headquarters','HQ','headquarters')).trim(),
      footprint:Number(String(value('Location Count','Locations','Footprint','Stores','footprint')||'').replace(/,/g,''))||0,
      buyer:String(value('Buyer','Buyer Name','buyer','buyer_name')).trim(),
      buyer_title:String(value('Buyer Title','buyer_title')).trim(),
      buyer_email:String(value('Buyer Email','Email','buyer_email')).trim(),
      buyer_phone:String(value('Buyer Phone','Phone','buyer_phone')).trim(),
      buyer_linkedin:String(value('Buyer LinkedIn','LinkedIn','buyer_linkedin')).trim(),
      buyer_category:String(value('Buyer Category','Category Scope','buyer_category')).trim(),
      ecommerce:['yes','y','true','1'].includes(String(value('Ecommerce','E-commerce','ecommerce')).trim().toLowerCase()),
      source_url:String(value('Source URL','Source','source_url')).trim(),
      confidence:Number(value('Confidence','confidence'))||0,
      verification_status:String(value('Verification Status','verification_status')||'DISCOVERY_CANDIDATE').trim()
    };
  };

  // Make the account import dialog explicitly show the buyer fields that will be saved.
  window.openAccountImport=function(){
    $('modalCard').innerHTML=`<h2>Import Account Universe</h2><p class="muted">Upload Excel or CSV. Required: Organization. Supported account fields include Domain, Head Office Location, Location Count, Channels and Categories. Buyer, Buyer Title, Buyer Email and Buyer Phone are imported directly into Buyer Intelligence.</p><div class="uploadBox"><input type="file" id="accountFile" accept=".xlsx,.xls,.csv"><div style="margin-top:12px"><button class="btn" onclick="previewAccountImport()">Preview Accounts</button> <button class="btn secondary" onclick="downloadAccountTemplate()">Download Template</button></div></div><div id="accountImportPreview"></div><div style="margin-top:15px"><button class="btn secondary" onclick="closeModal()">Cancel</button></div>`;
    $('modal').classList.add('show');
  };

  const originalPreviewAccountImport=typeof window.previewAccountImport==='function'?window.previewAccountImport:null;
  if(originalPreviewAccountImport){
    window.previewAccountImport=async function(){
      const f=$('accountFile')?.files?.[0];if(!f){toast('Choose an Excel or CSV file');return}
      try{
        const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}),raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
        pendingAccounts=raw.map(accountRow).filter(x=>x.name);
        const buyerCount=pendingAccounts.filter(x=>x.buyer).length;
        $('accountImportPreview').innerHTML=`<div class="callout" style="margin-top:14px"><b>${pendingAccounts.length} accounts ready for review</b><p class="muted">${buyerCount} row(s) include buyer data. Nothing is saved until you approve.</p><div class="tableWrap"><table class="table"><thead><tr><th>Account</th><th>Locations</th><th>Buyer</th><th>Email</th><th>Phone</th></tr></thead><tbody>${pendingAccounts.slice(0,50).map(x=>`<tr><td><b>${esc(x.name)}</b><div class="muted">${esc(x.domain)}</div></td><td>${x.footprint||'—'}</td><td>${esc(x.buyer||'—')}<div class="muted">${esc(x.buyer_title||'')}</div></td><td>${esc(x.buyer_email||'—')}</td><td>${esc(x.buyer_phone||'—')}</td></tr>`).join('')}</tbody></table></div><button class="btn dark" onclick="commitAccountImport('${esc(f.name)}')">Approve & Import ${pendingAccounts.length} Accounts</button></div>`;
      }catch(e){toast(e.message)}
    };
  }

  // Download an XLSX template that exactly matches the importer, including buyer email and phone.
  window.downloadAccountTemplate=function(){
    if(typeof XLSX==='undefined'){toast('Spreadsheet library is unavailable');return;}
    const headers=[
      'Organization','Domain','Type','Channels','Categories','Coverage','Region',
      'Head Office Location','Location Count','Buyer','Buyer Title','Buyer Email','Buyer Phone',
      'Buyer LinkedIn','Buyer Category','Ecommerce','Source URL','Confidence'
    ];
    const examples=[
      ['Example Retailer','example.com','retailer','mass;ce','Consumer Electronics','National','US','City, ST',100,'Jane Buyer','Category Manager','jane@example.com','555-555-0100','https://www.linkedin.com/in/example','Consumer Electronics','Yes','https://www.example.com',80]
    ];
    const ws=XLSX.utils.aoa_to_sheet([headers,...examples]);
    ws['!cols']=headers.map((h,i)=>({wch:[22,20,12,28,26,18,18,28,14,22,24,28,18,34,24,12,34,12][i]||18}));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Accounts');
    XLSX.writeFile(wb,'launchpad36-account-import-template.xlsx');
  };

  // The existing buyer editor already persists email and phone through /api/buyers PATCH.
  window.__L36_BUYER_PHONE_EMAIL_UI__=true;
})();
