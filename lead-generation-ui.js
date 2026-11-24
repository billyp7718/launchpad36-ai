(()=>{
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const source = url => /^https?:\/\//i.test(url||'') ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">Source</a>` : '';
  function exportRows(rows, name) {
    const columns=Object.keys(rows[0]);
    const quote=value=>{
      let text=String(value??'');
      if (/^\s*[=+@-]|^[\r\n\t]/.test(text)) text="'"+text;
      return '"'+text.replaceAll('"','""')+'"';
    };
    const csv=[columns,...rows.map(row=>columns.map(key=>row[key]))].map(row=>row.map(quote).join(',')).join('\r\n');
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
    link.download=name+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  class LeadGeneration extends HTMLElement {
    connectedCallback(){
      this.targets=[];this.query='';this.focus='';this.note='';this.coverage='';this.busy=false;this.recipients=null;
      this.onclick=event=>{
        const action=event.target.closest('button')?.dataset.action;
        if(action && !this.busy) this.run(action);
      };
      this.onchange=event=>{
        const {row,person}=event.target.dataset;
        if(row!==undefined && person!==undefined) this.targets[row].contacts[person].selected=event.target.checked;
        else if(row!==undefined) this.targets[row].selected=event.target.checked;
      };
      this.oninput=event=>{
        if(event.target.name==='query') this.query=event.target.value;
        if(event.target.name==='focus') this.focus=event.target.value;
      };
      this.onkeydown=event=>{if(event.key==='Enter' && !this.busy && event.target.name==='query') this.run('search')};
      this.draw();
    }
    async request(body){
      const section_key=this.getAttribute('section-key');
      const response=await fetch('/api/lead-generation'+(body?'':'?section_key='+encodeURIComponent(section_key)),body?{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,section_key})
      }:{});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Request failed.');
      return data;
    }
    draw(){
      const button=(action,label)=>`<button type="button" class="btn secondary" data-action="${action}" ${this.busy?'disabled':''}>${label}</button>`;
      const targets=this.targets.map((t,i)=>`<tr><td><input type="checkbox" aria-label="Select ${escape(t.name)}" data-row="${i}" ${t.selected?'checked':''}></td><td><strong>${escape(t.name)}</strong><br>${escape(t.region)} · ${source(t.source_url)}</td><td>${escape(t.channel||t.account_category?.replaceAll('_',' '))}</td><td>${escape(t.status||'')}${(t.contacts||[]).map((c,j)=>`<div><label><input type="checkbox" data-row="${i}" data-person="${j}" ${c.selected?'checked':''}> ${escape(c.name)} · ${escape(c.title)}</label><br>${escape(c.responsibility_scope)} · ${source(c.source_url)}<br>${escape([c.email,c.phone].filter(Boolean).join(' · '))} ${source(c.contact_source_url)}</div>`).join('')}</td></tr>`).join('');
      this.innerHTML=`<div class="pageHead"><div><h1>Lead Generation</h1><p>Find organizations in a market, then identify who handles a specific responsibility.</p></div></div>
      <fieldset style="border:0;padding:0;min-width:0" ${this.busy?'disabled':''}><div class="card"><label class="field">Target market or business channel<input name="query" maxlength="500" value="${escape(this.query)}" placeholder="Police departments in NJ"></label>
      ${button('search','Find targets')} ${button('list','View mass email list')}</div>
      ${targets?`<div class="card"><p>${this.targets.length} targets · ${escape(this.coverage)}</p>
      ${button('all','Select all targets')} ${button('none','Clear selection')} ${button('more','Find more targets')}
      <label class="field">Decision-maker responsibility<input name="focus" maxlength="240" value="${escape(this.focus)}" placeholder="Who runs drug prevention programs?"></label>
      ${button('research','Find decision makers')} ${button('accounts','Add to account list')} ${button('recipients','Add to mass email list')} ${button('export','Export selected CSV')}
      <div style="overflow:auto;max-height:60vh"><table><thead><tr><th>Select</th><th>Target</th><th>Channel</th><th>Decision makers</th></tr></thead><tbody>${targets}</tbody></table></div></div>`:''}
      ${this.recipients?`<div class="card"><h2>Mass email list</h2><p>${this.recipients.length} unique recipients in this section</p>${this.recipients.length?button('export-list','Export recipients CSV'):''}
      <div style="overflow:auto;max-height:35vh"><table><tbody>${this.recipients.map(c=>`<tr><td>${escape(c.account)}</td><td>${escape(c.name)}</td><td>${escape(c.email)}</td></tr>`).join('')}</tbody></table></div></div>`:''}</fieldset>
      <p class="muted">General web searches and decision-maker research use the configured OpenAI API. Decision-maker research runs once per selected target and may incur usage charges.</p><p role="status" aria-live="polite">${escape(this.note)}</p>`;
    }
    async run(action){
      this.busy=true;
      let completed=0;
      try{
        const selected=this.targets.filter(t=>t.selected);
        if(action==='all'||action==='none'){this.targets.forEach(t=>t.selected=action==='all');return}
        if(action==='list'){this.recipients=(await this.request()).recipients;this.note='';return}
        if(action==='export-list'){exportRows(this.recipients,'mass-email-recipients');return}
        if(action==='search'||action==='more'){
          const query=action==='more'?this.lastQuery:this.query.trim();
          if(!query) throw new Error('Enter a target market or channel.');
          this.note='Searching public sources…';this.draw();
          const prior=action==='more'?this.targets:[];
          const data=await this.request({action:'discover',query,exclude:prior.map(t=>t.name)});
          this.targets=[...prior,...data.targets.map(t=>({...t,selected:false,contacts:[]}))];
          this.query=this.lastQuery=query;this.coverage=data.coverage;
          this.note=data.targets.length?'Select targets to research or save.':'No additional source-backed matches found.';return;
        }
        if(!selected.length) throw new Error('Select at least one target.');
        if(action==='research'&&!this.focus.trim()) throw new Error('Enter the responsibility to research.');
        if(action==='export'){
          const rows=selected.flatMap(t=>{
            const contacts=t.contacts.filter(c=>c.selected);
            return (contacts.length?contacts:[{}]).map(c=>({account:t.name,region:t.region,category:t.account_category,channel:t.channel,website:t.website,account_source:t.source_url,name:c.name,title:c.title,responsibility:c.responsibility_scope,email:c.email,phone:c.phone,person_source:c.source_url,contact_source:c.contact_source_url}));
          });
          exportRows(rows,'lead-generation');return;
        }
        let eligible=0,failures=0;
        for(const t of selected){
          if(!this.isConnected) return;
          this.note=`Processing ${completed+1} of ${selected.length}: ${t.name}`;this.draw();
          const contacts=t.contacts.filter(c=>c.selected && (action!=='recipients'||c.email));
          if(action==='research'){
            try{
              const data=await this.request({action,target:t,focus:this.focus});
              t.contacts=data.contacts.map(c=>({...c,selected:true}));
              t.status=t.contacts.length?'Review contacts':'No sourced decision maker found';
            } catch(error){t.status=error.message;failures++}
          }else if(action==='accounts'||contacts.length){
            await this.request({action,target:{name:t.name,channel:t.channel,website:t.website,source_url:t.source_url,account_category:t.account_category,region:t.region},contacts});
            if(action==='accounts') window.dispatchEvent(new Event('l36-lead-accounts-saved'));
            eligible+=contacts.length;
          }
          completed++;
        }
        if(action==='recipients'){this.recipients=(await this.request()).recipients;this.note=`${eligible} selected public email addresses processed. ${this.recipients.length} unique recipients on the list.`}
        else this.note=action==='accounts'?`${completed} accounts saved or already on file.`:`Researched ${completed} targets. ${failures} failed.`;
      }catch(error){this.note=(completed?completed+' targets processed. ':'')+error.message}
      finally{this.busy=false;if(this.isConnected)this.draw()}
    }
  }
  customElements.define('l36-leads',LeadGeneration);
})();
