(()=>{
  const originalBuyerTable=typeof window.buyerTableHtml==='function'?window.buyerTableHtml:null;

  window.buyerTableHtml=function(rows,showEvidence=false,editable=true){
    return `<div class="tableWrap" style="margin-top:10px"><table class="table"><thead><tr><th>Buyer</th><th>Title</th><th>Category</th><th>Email</th><th>Phone</th>${showEvidence?'<th>Evidence</th>':''}<th>Status</th><th>Confidence</th><th>Source</th><th>Edit</th></tr></thead><tbody>${(rows||[]).map(b=>`<tr><td><b>${esc(b.name)}</b>${b.linkedin?`<div class="muted"><a href="${esc(b.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn</a></div>`:''}</td><td>${esc(b.title||'—')}</td><td>${esc(b.category_scope||b.category||'—')}</td><td>${b.email?`<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`:'—'}</td><td>${b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'—'}</td>${showEvidence?`<td class="muted">${esc(b.evidence_quote||b.notes||'Review source')}</td>`:''}<td><span class="pill">${esc(b.verification_status||b.status||'UNKNOWN')}</span></td><td>${Number(b.confidence)||0}%</td><td>${b.source_url?`<a href="${esc(b.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>`:'—'}</td><td><button class="btn ghost" onclick="openBuyerEditor('${esc(b.id)}')">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  };

  const originalOpenBuyerEditor=typeof window.openBuyerEditor==='function'?window.openBuyerEditor:null;
  if(originalOpenBuyerEditor){
    window.openBuyerEditor=function(buyerId){
      return originalOpenBuyerEditor(buyerId);
    };
  }

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

  window.__L36_BUYER_PHONE_EMAIL_UI__=true;
})();
