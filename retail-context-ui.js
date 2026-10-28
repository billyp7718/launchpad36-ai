(()=>{
  if(window.__L36_RETAIL_CONTEXT_UI__)return;
  const css=`
  .l36-context-card{margin-top:12px;border:1px solid #cfe0f2;background:linear-gradient(145deg,#f8fbff,#fff);border-radius:15px;padding:14px}
  .l36-context-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:10px}
  .l36-context-grid>div{border:1px solid #dce7f2;border-radius:10px;padding:10px;background:#fff}
  .l36-context-list{margin:6px 0 0;padding-left:18px}
  .l36-context-list li{margin:4px 0}
  .l36-meeting-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  @media(max-width:760px){.l36-context-grid{grid-template-columns:1fr}}
  `;const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);

  const list=value=>String(value||'').split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
  const fmtDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'Unconfirmed'};
  const currentOrg=()=>state.__account360?.org||null;

  function briefHtml(data){
    const b=data?.meeting_brief||{},buyer=b.buyer||{},opp=b.opportunity||{},prior=b.prior_objections||[],questions=b.recommended_questions||[],assort=b.proposed_assortment||[];
    return `<div class="eyebrow">BUYER MEETING INTELLIGENCE</div><h2>${esc(b.organization?.name||'Buyer Meeting Brief')}</h2>
      <p class="muted">Prepared from the current account, buyer, assortment, opportunity and prior feedback context. Verify material facts before presenting them externally.</p>
      <div class="l36-context-grid">
        <div><div class="label">Buyer</div><b>${esc(buyer.name||'Unconfirmed')}</b><p class="muted">${esc(buyer.title||'Title unconfirmed')}<br>${esc(buyer.category_scope||'Category unconfirmed')}</p></div>
        <div><div class="label">Modeled Opportunity</div><b>${money(opp.modeled_revenue||0)}</b><p class="muted">${esc(opp.next_action||'No next action saved')}</p></div>
        <div><div class="label">Evidence</div><b>${Number(b.evidence_posture?.trust_score)||0} / 100</b><p class="muted">${esc(String(b.evidence_posture?.trust_level||'Needs research').replaceAll('_',' '))}</p></div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="card"><h3>Proposed assortment</h3>${assort.length?`<ul class="l36-context-list">${assort.slice(0,10).map(x=>`<li><b>${esc([x.brand,x.product].filter(Boolean).join(' '))}</b>${x.sku?` · ${esc(x.sku)}`:''}${x.annual_revenue?` · ${money(x.annual_revenue)} modeled`:''}</li>`).join('')}</ul>`:'<p class="muted">No proposed SKU mix is saved for this opportunity.</p>'}</div>
        <div class="card"><h3>Prior buyer objections</h3>${prior.length?`<ul class="l36-context-list">${prior.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">No prior structured objections recorded.</p>'}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Questions to advance the account</h3><ol class="l36-context-list">${questions.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div>`;
  }

  function feedbackForm(data){
    const b=data?.meeting_brief||{},buyer=b.buyer||{},opp=b.opportunity||{};
    return `<div class="card" style="margin-top:12px"><h3>Record Buyer Feedback</h3><p class="muted">Saving feedback adds to the account knowledge timeline. It does not automatically email the buyer or change the CRM opportunity.</p>
      <div class="formGrid">
        <div class="field"><label>Meeting date/time</label><input id="bmMeetingAt" type="datetime-local"></div>
        <div class="field"><label>Buyer</label><input value="${esc(buyer.name||'Unconfirmed')}" disabled></div>
        <div class="field full"><label>Buyer feedback</label><textarea id="bmFeedback" rows="3" placeholder="What did the buyer say about the assortment, price, timing, channel, or requirements?"></textarea></div>
        <div class="field full"><label>Meeting notes</label><textarea id="bmNotes" rows="3" placeholder="Additional meeting context"></textarea></div>
        <div class="field"><label>Objections (comma separated)</label><input id="bmObjections" placeholder="Price point, margin, feature gap"></div>
        <div class="field"><label>Requested changes (comma separated)</label><input id="bmChanges" placeholder="Add lower-price SKU, revise launch timing"></div>
        <div class="field"><label>Accepted SKUs</label><input id="bmAccepted" placeholder="SKU-100, SKU-200"></div>
        <div class="field"><label>Rejected SKUs</label><input id="bmRejected" placeholder="SKU-300"></div>
        <div class="field"><label>Rollout scope</label><select id="bmRollout"><option value="">Not specified</option><option value="online_only">Online only</option><option value="pilot">Store pilot</option><option value="regional">Regional</option><option value="national">National</option></select></div>
        <div class="field"><label>Follow-up date</label><input id="bmFollowUp" type="date"></div>
        <div class="field full"><label>Next action</label><input id="bmNextAction" value="${esc(opp.next_action||'')}" placeholder="Send revised assortment and schedule follow-up"></div>
      </div>
      <div class="l36-meeting-actions"><button class="btn dark" data-capability="APP_WRITE" onclick="saveBuyerMeetingFeedback()">Save Feedback</button><button class="btn secondary" onclick="openAccount360('${esc(b.organization?.id||'')}','activity')">Back to Account 360</button></div>
    </div>`;
  }

  window.openBuyerMeetingIntelligence=async function(orgId){
    const id=orgId||currentOrg()?.id;if(!id)return toast('Open an account first');
    const mc=$('modalCard');mc.className='modalCard accountResearchModal';mc.innerHTML='<div class="empty">Preparing buyer meeting intelligence…</div>';$('modal').classList.add('show');
    try{
      const data=await api(`/api/retail-context?organization_id=${encodeURIComponent(id)}`);
      state.__retailContext=data;mc.innerHTML=`<div class="workspaceTop"><div></div><button class="btn secondary" onclick="openAccount360('${esc(id)}')">Back to Account</button></div>${briefHtml(data)}${feedbackForm(data)}`;
      applyCapabilityUi(mc);
    }catch(error){mc.innerHTML=`<h3>Buyer Meeting Intelligence could not load</h3><p class="muted">${esc(error.message)}</p><button class="btn secondary" onclick="openAccount360('${esc(id)}')">Back to Account</button>`}
  };

  window.saveBuyerMeetingFeedback=async function(){
    const data=state.__retailContext||{},brief=data.meeting_brief||{},orgId=brief.organization?.id||currentOrg()?.id;if(!orgId)return toast('Account context is unavailable');
    if(!can('APP_WRITE'))return capabilityNotice('APP_WRITE');
    const meetingLocal=$('bmMeetingAt')?.value||'',meeting_at=meetingLocal?new Date(meetingLocal).toISOString():new Date().toISOString();
    const body={organization_id:orgId,opportunity_id:brief.opportunity?.id||null,buyer_id:brief.buyer?.id||null,meeting_at,buyer_feedback:$('bmFeedback')?.value||'',notes:$('bmNotes')?.value||'',objections:list($('bmObjections')?.value),requested_changes:list($('bmChanges')?.value),accepted_skus:list($('bmAccepted')?.value),rejected_skus:list($('bmRejected')?.value),rollout_scope:$('bmRollout')?.value||'',follow_up_date:$('bmFollowUp')?.value||null,next_action:$('bmNextAction')?.value||''};
    try{
      const result=await api('/api/buyer-meeting-feedback',{method:'POST',body:JSON.stringify(body)});
      const recs=result.recommendations||[];$('modalCard').innerHTML=`<div class="eyebrow">BUYER FEEDBACK SAVED</div><h2>Account knowledge updated</h2><p class="muted">No outbound communication or CRM stage change was made automatically.</p><div class="card"><h3>Recommended next actions</h3><ul class="l36-context-list">${recs.map(r=>`<li><b>${esc(r.type)}</b> — ${esc(r.action)} ${r.approval_required?'<span class="badge">APPROVAL REQUIRED</span>':''}</li>`).join('')}</ul></div><div class="l36-meeting-actions"><button class="btn dark" onclick="openBuyerMeetingIntelligence('${esc(orgId)}')">View Updated Brief</button><button class="btn secondary" onclick="openAccount360('${esc(orgId)}','activity')">Back to Account 360</button></div>`;toast('Buyer feedback saved');
    }catch(error){toast(error.message)}
  };

  async function populateContextActivity(orgId){
    const host=document.getElementById('l36RetailContextActivity');if(!host)return;
    try{
      const data=await api(`/api/retail-context?organization_id=${encodeURIComponent(orgId)}`),feedback=data.meeting_feedback||[],timeline=data.timeline||[],relationships=data.relationships||[],latest=feedback[0];
      host.innerHTML=`<div class="l36-context-card"><div class="eyebrow">RETAIL ACCOUNT KNOWLEDGE</div><h3 style="margin:4px 0">Relationship & Buyer Feedback Context</h3><div class="l36-context-grid"><div><div class="label">Buyer Meetings</div><b>${feedback.length}</b><p class="muted">${latest?`Latest: ${esc(fmtDate(latest.meeting_at))}`:'No structured meeting feedback yet'}</p></div><div><div class="label">Context Events</div><b>${timeline.length}</b><p class="muted">Append-only account history</p></div><div><div class="label">Active Relationships</div><b>${relationships.length}</b><p class="muted">Tenant-scoped commercial relationships</p></div></div>${latest?`<p><b>Latest buyer feedback:</b> ${esc(latest.buyer_feedback||latest.notes||'No narrative feedback')}</p><p class="muted">Next action: ${esc(latest.next_action||'Not set')}</p>`:''}<div class="l36-meeting-actions"><button class="btn dark" onclick="openBuyerMeetingIntelligence('${esc(orgId)}')">Prepare / Record Buyer Meeting</button></div></div>`;
    }catch(error){host.innerHTML=`<div class="warning">Retail context could not load: ${esc(error.message)}</div>`}
  }

  const baseRender=window.renderAccount360;
  if(typeof baseRender==='function')window.renderAccount360=function(tab='overview'){
    baseRender(tab);const d=state.__account360;if(!d?.org)return;
    const root=$('modalCard'),top=root?.querySelector('.workspaceTop');
    if(top&&!document.getElementById('l36PrepareBuyerMeeting')){
      const wrap=document.createElement('div');wrap.className='l36-meeting-actions';wrap.innerHTML=`<button id="l36PrepareBuyerMeeting" class="btn ghost" onclick="openBuyerMeetingIntelligence('${esc(d.org.id)}')">Prepare Buyer Meeting</button>`;top.appendChild(wrap);
    }
    if(tab==='activity'&&root&&!document.getElementById('l36RetailContextActivity')){
      const host=document.createElement('div');host.id='l36RetailContextActivity';host.innerHTML='<div class="empty">Loading retail account knowledge…</div>';root.appendChild(host);populateContextActivity(d.org.id);
    }
  };

  window.__L36_RETAIL_CONTEXT_UI__=true;
})();
