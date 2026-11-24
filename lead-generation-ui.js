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
      this.targets=[];this.query='';this.focus='';this.note='';this.coverage='';this.busy=false;this.recipients=null;this.emailComposer=false;this.emailSubject='';this.emailMessage='';this.completedTargets=0;this.totalTargets=0;
      this.onclick=event=>{
        const action=event.target.closest('button')?.dataset.action;
        if(action==='cancel') this.cancel();
        else if(action && !this.busy) this.run(action);
      };
      this.onchange=event=>{
        const {row,person}=event.target.dataset;
        if(event.target.dataset.recipient!==undefined){const recipient=this.recipients?.find(item=>item.email===event.target.dataset.recipient);if(recipient)recipient.selected=event.target.checked;return}
        if(row!==undefined && person!==undefined) this.targets[row].contacts[person].selected=event.target.checked;
        else if(row!==undefined) this.targets[row].selected=event.target.checked;
      };
      this.oninput=event=>{
        if(event.target.name==='query') this.query=event.target.value;
        if(event.target.name==='focus') this.focus=event.target.value;
        if(event.target.name==='emailSubject') this.emailSubject=event.target.value;
        if(event.target.name==='emailMessage') this.emailMessage=event.target.value;
      };
      this.onkeydown=event=>{if(event.key==='Enter' && !this.busy && event.target.name==='query') this.run('search')};
      this.draw();
    }
    async request(body,endpoint='/api/lead-generation'){
      const section_key=this.getAttribute('section-key');
      const response=await fetch(endpoint+(body?'':'?section_key='+encodeURIComponent(section_key)),body?{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,section_key}),signal:this.abortController?.signal
      }:{signal:this.abortController?.signal});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||'Request failed.');
      return data;
    }
    draw(){
      const button=(action,label)=>`<button type="button" class="btn secondary" data-action="${action}" ${this.busy?'disabled':''}>${label}</button>`;
      const targets=this.targets.flatMap((t,i)=>{
        const contacts=t.contacts||[],rows=contacts.length?contacts:[null];
        return rows.map((contact,j)=>`<tr><td>${j===0?`<input type="checkbox" aria-label="Select ${escape(t.name)}" data-row="${i}" ${t.selected?'checked':''}>`:''}${contact?`<label><input type="checkbox" aria-label="Select ${escape(contact.name)}" data-row="${i}" data-person="${j}" ${contact.selected?'checked':''}></label>`:''}</td><td><strong>${escape(t.name)}</strong><br>${escape(t.region)}</td><td>${escape(t.channel||t.account_category?.replaceAll('_',' '))}</td><td>${contact?`${escape(contact.name)}<br>${escape(contact.title)}`:escape(t.status||'Decision makers not researched')}</td><td>${escape(contact?.responsibility_scope||'')}</td><td>${escape(contact?.email||'')}</td><td>${escape(contact?.phone||'')}</td><td>${source(t.source_url)}${contact?.source_url?` · ${source(contact.source_url)}`:''}${contact?.contact_source_url?` · ${source(contact.contact_source_url)}`:''}</td></tr>`);
      }).join('');
      this.innerHTML=`<div class="pageHead"><div><h1>Lead Generation</h1><p>Find organizations in a market, then identify who handles a specific responsibility.</p></div></div>
      <fieldset style="border:0;padding:0;min-width:0" ${this.busy?'disabled':''}><div class="card"><label class="field">Target market or business channel<input name="query" maxlength="500" value="${escape(this.query)}" placeholder="e.g. independent pet retailers in the Southeast"></label>
      <p class="muted">Search any industry or channel. Try convenience-store distributors in Texas, hotel groups in Florida, or police departments in NJ.</p>
      ${button('search','Find targets')} ${button('list','View mass email list')}</div>
      ${targets?`<div class="card"><p>${this.targets.length} targets · ${escape(this.coverage)}</p>
      ${button('all','Select all targets')} ${button('none','Clear selection')} ${button('more','Find more targets')}
      <label class="field">Decision-maker responsibility<input name="focus" maxlength="240" value="${escape(this.focus)}" placeholder="e.g. category buying, procurement, or drug prevention programs"></label>
      ${button('research','Find decision makers')} ${button('accounts','Add to account list')} ${button('recipients','Add to mass email list')} ${button('export','Export selected CSV')}
      <div style="overflow:auto;max-height:60vh"><table><thead><tr><th>Select</th><th>Target</th><th>Channel</th><th>Decision maker</th><th>Responsibility</th><th>Email</th><th>Phone</th><th>Sources</th></tr></thead><tbody>${targets}</tbody></table></div></div>`:''}
      ${this.recipients?`<div class="card"><h2>Mass email list</h2><p>${this.recipients.length} unique recipients in this section · ${this.recipients.filter(c=>c.selected).length} selected</p>${this.recipients.length?`${button('all-recipients','Select all emails')} ${button('none-recipients','Clear email selection')} ${button('compose','Compose email')} ${button('export-list','Export recipients CSV')}`:''}
      <div style="overflow:auto;max-height:35vh"><table><thead><tr><th>Send</th><th>Account</th><th>Contact</th><th>Email</th></tr></thead><tbody>${this.recipients.map(c=>`<tr><td><input type="checkbox" aria-label="Select ${escape(c.email)} for mass email" data-recipient="${escape(c.email)}" ${c.selected?'checked':''}></td><td>${escape(c.account)}</td><td>${escape(c.name)} · ${escape(c.title)}</td><td>${escape(c.email)}</td></tr>`).join('')}</tbody></table></div>
      ${this.emailComposer?`<div class="formGrid" style="margin-top:16px"><label class="field">Subject<input name="emailSubject" maxlength="180" value="${escape(this.emailSubject)}"></label><label class="field full">Message<textarea name="emailMessage" rows="8" maxlength="20000">${escape(this.emailMessage)}</textarea></label></div><p class="muted">Each recipient receives a separate email. Other recipients will not see their addresses.</p>${button('send-email',`Send to ${this.recipients.filter(c=>c.selected).length} recipients`)} ${button('close-composer','Close composer')}`:''}</div>`:''}</fieldset>
      ${this.busy?'<button type="button" class="btn secondary" data-action="cancel">Cancel</button>':''}
      <p class="muted">General web searches and decision-maker research use the configured OpenAI API. Decision-maker research runs once per selected target and may incur usage charges.</p><p role="status" aria-live="polite">${escape(this.note)}</p>`;
    }
    cancel(){
      if(!this.busy)return;
      this.cancelRequested=true;
      this.note=this.totalTargets?`Canceling after ${this.completedTargets} of ${this.totalTargets} targets…`:'Canceling…';
      this.abortController?.abort();
      this.draw();
    }
    async run(action){
      this.busy=true;
      this.cancelRequested=false;
      this.abortController=new AbortController();
      this.draw();
      let completed=0;
      try{
        const selected=this.targets.filter(t=>t.selected);
        if(action==='all'||action==='none'){this.targets.forEach(t=>t.selected=action==='all');return}
        if(action==='list'){this.recipients=(await this.request()).recipients.map(c=>({...c,selected:true}));this.emailComposer=false;this.note='';return}
        if(action==='all-recipients'||action==='none-recipients'){this.recipients?.forEach(c=>c.selected=action==='all-recipients');return}
        if(action==='compose'){if(!this.recipients?.some(c=>c.selected))throw new Error('Select at least one email address.');this.emailComposer=true;return}
        if(action==='close-composer'){this.emailComposer=false;return}
        if(action==='export-list'){exportRows(this.recipients,'mass-email-recipients');return}
        if(action==='send-email'){
          const recipients=this.recipients.filter(c=>c.selected);
          if(!recipients.length)throw new Error('Select at least one email address.');
          if(!this.emailSubject.trim()||!this.emailMessage.trim())throw new Error('Enter an email subject and message.');
          this.totalTargets=recipients.length;this.completedTargets=0;
          let sent=0;
          for(const recipient of recipients){
            if(this.cancelRequested)break;
            this.note=`Sending ${sent+1} of ${recipients.length}: ${recipient.email}`;this.draw();
            await this.request({to:recipient.email,subject:this.emailSubject,message:this.emailMessage},'/api/lead-generation-email');
            sent++;this.completedTargets=sent;
          }
          this.note=this.cancelRequested?`Canceled after ${sent} of ${recipients.length} emails. The in-progress message may still be delivered.`:`Sent ${sent} email${sent===1?'':'s'}.`;
          return;
        }
        if(action==='search'||action==='more'){
          const query=action==='more'?this.lastQuery:this.query.trim();
          if(!query) throw new Error('Enter a target market or channel.');
          this.note='Searching public sources…';this.draw();
          const prior=action==='more'?this.targets:[];
          const data=await this.request({action:'discover',query,exclude:prior.map(t=>t.name)});
          this.targets=[...prior,...data.targets.map(t=>({...t,search_category:query,selected:false,contacts:[]}))];
          this.query=this.lastQuery=query;this.coverage=data.coverage;
          this.note=data.targets.length?'Select targets to research or save.':'No additional source-backed matches found.';return;
        }
        if(!selected.length) throw new Error('Select at least one target.');
        if(action==='research'&&!this.focus.trim()) throw new Error('Enter the responsibility to research.');
        if(action==='export'){
          const rows=selected.flatMap(t=>{
            const contacts=t.contacts.filter(c=>c.selected);
            return (contacts.length?contacts:[{}]).map(c=>({account:t.name,region:t.region,category:t.account_category,channel:t.channel,category_searched:t.search_category,website:t.website,account_source:t.source_url,name:c.name,title:c.title,responsibility:c.responsibility_scope,email:c.email,phone:c.phone,person_source:c.source_url,contact_source:c.contact_source_url}));
          });
          exportRows(rows,'lead-generation');return;
        }
        let eligible=0,failures=0;
        this.completedTargets=0;
        this.totalTargets=selected.length;
        for(const t of selected){
          if(!this.isConnected||this.cancelRequested) break;
          this.note=`Processing ${completed+1} of ${selected.length}: ${t.name}`;this.draw();
          const contacts=t.contacts.filter(c=>c.selected && (action!=='recipients'||c.email));
          if(action==='research'){
            try{
              const data=await this.request({action,target:t,focus:this.focus});
              t.contacts=data.contacts.map(c=>({...c,selected:true}));
              t.status=t.contacts.length?'Review contacts':'No sourced decision maker found';
            } catch(error){if(this.cancelRequested)break;t.status=error.message;failures++}
          }else if(action==='accounts'||contacts.length){
            await this.request({action,target:{name:t.name,channel:t.channel,website:t.website,source_url:t.source_url,account_category:t.account_category,search_category:t.search_category,region:t.region},contacts});
            if(action==='accounts') window.dispatchEvent(new Event('l36-lead-accounts-saved'));
            eligible+=contacts.length;
          }
          completed++;
          this.completedTargets=completed;
        }
        if(this.cancelRequested)this.note=`Canceled after ${completed} of ${selected.length} targets. The in-progress request may still finish.`;
        else if(action==='recipients'){this.recipients=(await this.request()).recipients;this.note=`${eligible} selected public email addresses processed. ${this.recipients.length} unique recipients on the list.`}
        else this.note=action==='accounts'?`${completed} accounts saved or already on file.`:`Researched ${completed} targets. ${failures} failed.`;
      }catch(error){
        if(this.cancelRequested)this.note=this.totalTargets?`Canceled after ${this.completedTargets} of ${this.totalTargets}. The in-progress request may still finish.`:'Canceled. The in-progress request may still finish.';
        else if(action==='send-email'&&this.completedTargets)this.note=`${this.completedTargets} emails sent before sending stopped. ${error.message}`;
        else this.note=(completed?completed+' targets processed. ':'')+error.message;
      }
      finally{this.busy=false;this.abortController=null;if(this.isConnected)this.draw()}
    }
  }
  customElements.define('l36-leads',LeadGeneration);
})();
