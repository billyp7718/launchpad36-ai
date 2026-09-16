(()=>{
  if(window.__L36_PITCH_DECK_BUILDER__)return;
  window.__L36_PITCH_DECK_BUILDER__=true;

  const PPTX_CDN='https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const esc2=s=>typeof window.esc==='function'?esc(s):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
  const clean=s=>String(s??'').trim();
  const slug=s=>clean(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'pitch-deck';
  const lines=s=>clean(s).split(/\n|\r|;/).map(x=>x.trim()).filter(Boolean);
  const deckKey=id=>`l36-pitch-deck:${id}`;

  function currentWorkspace(id){return (state.workspaces||[]).find(x=>String(x.id)===String(id))||null}
  function scenario(w){return w?.scenario||{}}
  function assortment(w){const s=scenario(w);return s.proposed_assortment||s.account?.product_contributions||[]}
  function brands(w){return [...new Set(assortment(w).map(x=>clean(x.brand_name)).filter(Boolean))]}
  function buyer(w){const s=scenario(w);return s.assigned_buyer||(w.buyers||[])[0]||{}}
  function comparisonRows(w){return (w.competitive_offerings||[]).slice(0,12)}
  function storageDefaults(w){const s=scenario(w),a=s.account||{},bs=brands(w);return {
    title:`${bs[0]||'Brand'} x ${w.account_name||a.name||'Account'}`,
    subtitle:'Retail Partnership Proposal',
    primary_brand:bs[0]||'',
    presenter:'',
    presenter_title:'',
    brand_story:'',
    brand_proof_points:'',
    account_objectives:'',
    category_opportunity:a.fit_reason||'',
    key_differentiators:'',
    merchandising_recommendation:'',
    promotional_plan:'',
    launch_timing:'',
    requested_action:'Review proposed assortment and align on a pilot / launch path.',
    buyer_message:'',
    custom_notes:'',
    include_revenue:true,
    include_competition:true,
    include_buyers:true
  }}
  function loadInputs(w){let saved={};try{saved=JSON.parse(localStorage.getItem(deckKey(w.id))||'{}')}catch{}return {...storageDefaults(w),...saved}}
  function saveInputs(id,data){try{localStorage.setItem(deckKey(id),JSON.stringify(data))}catch{}}
  function readForm(id){
    const g=x=>document.getElementById(x), data={
      title:g('pdTitle')?.value||'', subtitle:g('pdSubtitle')?.value||'', primary_brand:g('pdBrand')?.value||'',
      presenter:g('pdPresenter')?.value||'', presenter_title:g('pdPresenterTitle')?.value||'',
      brand_story:g('pdBrandStory')?.value||'', brand_proof_points:g('pdProof')?.value||'', account_objectives:g('pdObjectives')?.value||'',
      category_opportunity:g('pdCategoryOpportunity')?.value||'', key_differentiators:g('pdDifferentiators')?.value||'',
      merchandising_recommendation:g('pdMerchandising')?.value||'', promotional_plan:g('pdPromo')?.value||'', launch_timing:g('pdTiming')?.value||'',
      requested_action:g('pdAsk')?.value||'', buyer_message:g('pdBuyerMessage')?.value||'', custom_notes:g('pdNotes')?.value||'',
      include_revenue:Boolean(g('pdRevenue')?.checked), include_competition:Boolean(g('pdCompetition')?.checked), include_buyers:Boolean(g('pdBuyers')?.checked)
    };saveInputs(id,data);return data
  }

  function showBuilder(w){
    if(!w)return toast('Opportunity not found');
    const d=loadInputs(w),bs=brands(w),s=scenario(w),a=s.account||{},items=assortment(w);
    const html=`<div class="pageHead"><div><div class="eyebrow">ACCOUNT PITCH</div><h2>Build Pitch Deck</h2><p>Create an editable PowerPoint using the opportunity data plus your account-specific sales story.</p></div><span class="sourceTag">${esc2(w.account_name||a.name||'ACCOUNT')}</span></div>
      <div class="callout"><b>Opportunity data already included</b><p class="muted">Account profile, route to market, ${items.length} proposed SKU${items.length===1?'':'s'}, fit/evidence data, revenue model, buyer data, and competitive assortment when available.</p></div>
      <div class="formGrid" style="margin-top:14px">
        <div class="field"><label>Presentation title</label><input id="pdTitle" value="${esc2(d.title)}"></div>
        <div class="field"><label>Subtitle</label><input id="pdSubtitle" value="${esc2(d.subtitle)}"></div>
        <div class="field"><label>Primary brand</label><select id="pdBrand">${(bs.length?bs:['']).map(b=>`<option value="${esc2(b)}" ${b===d.primary_brand?'selected':''}>${esc2(b||'Brand')}</option>`).join('')}</select></div>
        <div class="field"><label>Presenter</label><input id="pdPresenter" value="${esc2(d.presenter)}" placeholder="Name"></div>
        <div class="field"><label>Presenter title</label><input id="pdPresenterTitle" value="${esc2(d.presenter_title)}" placeholder="Title / company"></div>
        <div class="field"><label>Launch timing</label><input id="pdTiming" value="${esc2(d.launch_timing)}" placeholder="e.g. Q1 2027 / Holiday reset"></div>
        <div class="field full"><label>Brand story / positioning</label><textarea id="pdBrandStory" rows="4" placeholder="What should the buyer know about the brand?">${esc2(d.brand_story)}</textarea></div>
        <div class="field full"><label>Brand proof points</label><textarea id="pdProof" rows="4" placeholder="One proof point per line: awards, growth, distribution, reviews, warranty, installed base…">${esc2(d.brand_proof_points)}</textarea></div>
        <div class="field full"><label>Account objectives</label><textarea id="pdObjectives" rows="4" placeholder="What matters to this retailer? Margin, category growth, traffic, basket size, differentiation…">${esc2(d.account_objectives)}</textarea></div>
        <div class="field full"><label>Category opportunity / whitespace</label><textarea id="pdCategoryOpportunity" rows="4">${esc2(d.category_opportunity)}</textarea></div>
        <div class="field full"><label>Key product differentiators</label><textarea id="pdDifferentiators" rows="4" placeholder="One differentiator per line">${esc2(d.key_differentiators)}</textarea></div>
        <div class="field full"><label>Merchandising recommendation</label><textarea id="pdMerchandising" rows="4" placeholder="In-store placement, online content, display, attachment strategy…">${esc2(d.merchandising_recommendation)}</textarea></div>
        <div class="field full"><label>Promotional / launch plan</label><textarea id="pdPromo" rows="4" placeholder="Launch promo, digital support, training, co-op, review strategy…">${esc2(d.promotional_plan)}</textarea></div>
        <div class="field full"><label>Buyer-specific message</label><textarea id="pdBuyerMessage" rows="3" placeholder="Optional message tailored to the buyer or merchant">${esc2(d.buyer_message)}</textarea></div>
        <div class="field full"><label>Requested action / close</label><textarea id="pdAsk" rows="3">${esc2(d.requested_action)}</textarea></div>
        <div class="field full"><label>Additional notes</label><textarea id="pdNotes" rows="3" placeholder="Optional information to include in the appendix / next steps">${esc2(d.custom_notes)}</textarea></div>
      </div>
      <div class="channelOptions" style="margin-top:14px">
        <label><input id="pdRevenue" type="checkbox" ${d.include_revenue?'checked':''}> Include revenue model</label>
        <label><input id="pdCompetition" type="checkbox" ${d.include_competition?'checked':''}> Include competitive landscape</label>
        <label><input id="pdBuyers" type="checkbox" ${d.include_buyers?'checked':''}> Include buyer / stakeholder slide</label>
      </div>
      <div class="workspaceActions" style="margin-top:16px"><button class="btn dark" onclick="l36GeneratePitchDeck('${esc2(w.id)}')">Generate PowerPoint</button><button class="btn secondary" onclick="closeModal()">Cancel</button></div>`;
    const host=document.getElementById('modal'),card=document.getElementById('modalCard')||host?.querySelector('.modalCard');if(!host||!card)return toast('Pitch builder could not be opened');card.innerHTML=html;host.classList.add('show');
  }
  window.l36OpenPitchDeck=id=>showBuilder(currentWorkspace(id));

  async function ensurePptx(){
    if(window.PptxGenJS)return window.PptxGenJS;
    await new Promise((resolve,reject)=>{const old=document.querySelector('script[data-l36-pptx]');if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return}const s=document.createElement('script');s.src=PPTX_CDN;s.async=true;s.dataset.l36Pptx='1';s.onload=resolve;s.onerror=()=>reject(new Error('PowerPoint library could not be loaded'));document.head.appendChild(s)});
    if(!window.PptxGenJS)throw new Error('PowerPoint library did not initialize');return window.PptxGenJS
  }

  const C={navy:'071A39',navy2:'0D2E5D',blue:'2F6FED',ink:'14283F',muted:'71869E',line:'DCE7F2',bg:'F5F8FC',white:'FFFFFF',teal:'20A39E',green:'18795A'};
  function addHeader(slide,title,kicker='LAUNCHPAD36 ACCOUNT PITCH'){
    slide.background={color:C.white};slide.addText(kicker,{x:.65,y:.38,w:5.9,h:.24,fontFace:'Aptos',fontSize:9,bold:true,color:C.blue,charSpacing:1.6,margin:0});slide.addText(title,{x:.65,y:.72,w:12,h:.58,fontFace:'Aptos Display',fontSize:27,bold:true,color:C.navy,margin:0,breakLine:false});slide.addShape('line',{x:.65,y:1.42,w:12,h:0,line:{color:C.line,width:1}})
  }
  function addFooter(slide,w){slide.addText(`${w.account_name||''}  •  Launchpad36`,{x:.65,y:7.12,w:8,h:.2,fontFace:'Aptos',fontSize:8,color:C.muted,margin:0});slide.addText(new Date().toLocaleDateString(),{x:11.3,y:7.12,w:1.35,h:.2,fontFace:'Aptos',fontSize:8,color:C.muted,align:'right',margin:0})}
  function addBullets(slide,arr,x,y,w,h,size=17){const vals=(arr||[]).filter(Boolean).slice(0,8);if(!vals.length){slide.addText('Add account-specific content in the pitch builder.',{x,y,w,h,fontFace:'Aptos',fontSize:size,color:C.muted,italic:true,margin:.03});return}const runs=[];vals.forEach((t,i)=>runs.push({text:String(t),options:{bullet:{indent:size},breakLine:i<vals.length-1}}));slide.addText(runs,{x,y,w,h,fontFace:'Aptos',fontSize:size,color:C.ink,breakLine:false,margin:.05,paraSpaceAfterPt:10,valign:'top'})}
  function addMetric(slide,label,value,x,y,w=2.7){slide.addShape('roundRect',{x,y,w,h:.95,rectRadius:.08,fill:{color:C.bg},line:{color:C.line,width:1}});slide.addText(label.toUpperCase(),{x:x+.16,y:y+.13,w:w-.32,h:.18,fontFace:'Aptos',fontSize:8,bold:true,color:C.muted,charSpacing:1.1,margin:0});slide.addText(String(value),{x:x+.16,y:y+.39,w:w-.32,h:.36,fontFace:'Aptos Display',fontSize:20,bold:true,color:C.navy,margin:0,fit:'shrink'})}
  function addTitleSlide(pptx,w,d){const s=scenario(w),a=s.account||{},slide=pptx.addSlide();slide.background={color:C.navy};slide.addShape('rect',{x:0,y:0,w:13.333,h:7.5,fill:{color:C.navy},line:{color:C.navy}});slide.addShape('rect',{x:9.55,y:0,w:3.8,h:7.5,fill:{color:C.navy2,transparency:5},line:{color:C.navy2}});slide.addShape('rect',{x:9.55,y:5.8,w:3.8,h:1.7,fill:{color:C.blue},line:{color:C.blue}});slide.addText(d.primary_brand||brands(w)[0]||'BRAND',{x:.75,y:.65,w:6.5,h:.32,fontFace:'Aptos',fontSize:12,bold:true,color:'85B5FF',charSpacing:1.5,margin:0});slide.addText(d.title||`${d.primary_brand||'Brand'} x ${w.account_name||a.name||'Account'}`,{x:.75,y:1.45,w:8.2,h:1.35,fontFace:'Aptos Display',fontSize:34,bold:true,color:C.white,margin:0,fit:'shrink'});slide.addText(d.subtitle||'Retail Partnership Proposal',{x:.78,y:3.05,w:7.6,h:.5,fontFace:'Aptos',fontSize:18,color:'B6C9E1',margin:0});slide.addText([d.presenter,d.presenter_title].filter(Boolean).join(' · ')||'Prepared with Launchpad36',{x:.78,y:6.45,w:7.9,h:.35,fontFace:'Aptos',fontSize:11,color:'B6C9E1',margin:0});slide.addText(w.account_name||a.name||'Target Account',{x:9.95,y:6.28,w:2.95,h:.55,fontFace:'Aptos Display',fontSize:22,bold:true,color:C.white,align:'right',margin:0,fit:'shrink'})}
  function accountSlide(pptx,w,d){const s=scenario(w),a=s.account||{},slide=pptx.addSlide();addHeader(slide,`Why ${w.account_name||a.name||'this account'}`);addMetric(slide,'Fit Score',Number(a.fit_score)||0,.7,1.75);addMetric(slide,'Store / Location Count',Number(s.volume_model?.store_count||a.footprint)||0,3.55,1.75);addMetric(slide,'Route',String(w.route_to_market||'').replaceAll('_',' '),6.4,1.75);addMetric(slide,'Evidence',String(a.evidence_status||'REVIEW').replaceAll('_',' '),9.25,1.75);slide.addText('Account objectives',{x:.72,y:3.05,w:5.5,h:.35,fontFace:'Aptos Display',fontSize:20,bold:true,color:C.navy,margin:0});addBullets(slide,lines(d.account_objectives),.72,3.48,5.65,2.7,16);slide.addText('Category opportunity / whitespace',{x:6.75,y:3.05,w:5.7,h:.35,fontFace:'Aptos Display',fontSize:20,bold:true,color:C.navy,margin:0});addBullets(slide,lines(d.category_opportunity||a.fit_reason),6.75,3.48,5.65,2.7,16);addFooter(slide,w)}
  function brandSlide(pptx,w,d){const slide=pptx.addSlide();addHeader(slide,d.primary_brand?`${d.primary_brand}: the brand case`:'The brand case');slide.addShape('roundRect',{x:.7,y:1.75,w:5.8,h:4.75,rectRadius:.08,fill:{color:C.navy},line:{color:C.navy}});slide.addText('POSITIONING',{x:1.0,y:2.05,w:1.8,h:.2,fontFace:'Aptos',fontSize:9,bold:true,color:'85B5FF',charSpacing:1.3,margin:0});slide.addText(d.brand_story||'Add the brand story in the pitch builder.',{x:1.0,y:2.48,w:5.15,h:3.25,fontFace:'Aptos Display',fontSize:24,bold:true,color:C.white,margin:0,fit:'shrink',valign:'mid'});slide.addText('Proof points',{x:6.9,y:1.95,w:5.5,h:.35,fontFace:'Aptos Display',fontSize:22,bold:true,color:C.navy,margin:0});addBullets(slide,lines(d.brand_proof_points),6.9,2.48,5.6,3.9,17);addFooter(slide,w)}
  function differentiatorSlide(pptx,w,d){const slide=pptx.addSlide();addHeader(slide,'Why the assortment wins');const items=assortment(w),points=lines(d.key_differentiators);slide.addText('Key differentiators',{x:.72,y:1.78,w:5.4,h:.35,fontFace:'Aptos Display',fontSize:22,bold:true,color:C.navy,margin:0});addBullets(slide,points,.72,2.25,5.4,3.9,17);slide.addText('Proposed assortment snapshot',{x:6.45,y:1.78,w:5.9,h:.35,fontFace:'Aptos Display',fontSize:22,bold:true,color:C.navy,margin:0});items.slice(0,6).forEach((p,i)=>{const y=2.3+i*.66;slide.addShape('roundRect',{x:6.45,y,w:5.75,h:.52,rectRadius:.04,fill:{color:i%2?C.white:C.bg},line:{color:C.line,width:1}});slide.addText([p.brand_name,p.product_name].filter(Boolean).join(' · '),{x:6.62,y:y+.08,w:3.55,h:.2,fontFace:'Aptos',fontSize:11,bold:true,color:C.ink,margin:0,fit:'shrink'});slide.addText(p.sku||'',{x:10.25,y:y+.08,w:1.0,h:.2,fontFace:'Aptos',fontSize:9,color:C.muted,margin:0,align:'right'});slide.addText(p.retail_price?money(p.retail_price):'',{x:11.25,y:y+.08,w:.78,h:.2,fontFace:'Aptos',fontSize:10,bold:true,color:C.blue,margin:0,align:'right'})});addFooter(slide,w)}
  function assortmentSlides(pptx,w){const items=assortment(w);for(let offset=0;offset<items.length;offset+=8){const slide=pptx.addSlide();addHeader(slide,offset?'Proposed assortment — continued':'Proposed assortment');const rows=items.slice(offset,offset+8);const headers=['Brand / Product','SKU','Role','Retail','Dealer Cost','Monthly Units'];const xs=[.7,5.15,6.45,7.75,9.05,10.65],ws=[4.25,1.15,1.1,1.05,1.4,1.55];headers.forEach((h,i)=>slide.addText(h.toUpperCase(),{x:xs[i],y:1.75,w:ws[i],h:.25,fontFace:'Aptos',fontSize:8,bold:true,color:C.muted,charSpacing:.8,margin:0}));rows.forEach((p,i)=>{const y=2.12+i*.57;slide.addShape('rect',{x:.65,y:y-.07,w:12,h:.5,fill:{color:i%2?C.white:C.bg},line:{color:i%2?C.white:C.bg}});const vals=[[p.brand_name,p.product_name].filter(Boolean).join(' · '),p.sku||'',p.role||'',p.retail_price?money(p.retail_price):'',p.dealer_cost?money(p.dealer_cost):'',String(Number(p.monthly_sales_volume)||0)];vals.forEach((v,j)=>slide.addText(v,{x:xs[j],y,w:ws[j],h:.24,fontFace:'Aptos',fontSize:j===0?10:9,bold:j===0,color:j===3?C.blue:C.ink,margin:0,fit:'shrink',align:j>=3?'right':'left'}))});addFooter(slide,w)}}
  function competitionSlide(pptx,w){const rows=comparisonRows(w),slide=pptx.addSlide();addHeader(slide,'Competitive landscape');if(!rows.length){slide.addText('No attributable competitive assortment is currently saved for this opportunity.',{x:.75,y:2.1,w:11.8,h:.5,fontFace:'Aptos',fontSize:18,color:C.muted,margin:0});addFooter(slide,w);return}rows.slice(0,8).forEach((p,i)=>{const col=i%2,row=Math.floor(i/2),x=.75+col*6.1,y=1.8+row*1.18;slide.addShape('roundRect',{x,y,w:5.65,h:.92,rectRadius:.05,fill:{color:C.bg},line:{color:C.line,width:1}});slide.addText(`${p.brand||''} ${p.name||p.product_name||''}`.trim(),{x:x+.16,y:y+.13,w:4.0,h:.25,fontFace:'Aptos',fontSize:12,bold:true,color:C.navy,margin:0,fit:'shrink'});slide.addText([p.category,p.price_text,p.availability].filter(Boolean).join(' · '),{x:x+.16,y:y+.48,w:5.15,h:.2,fontFace:'Aptos',fontSize:9,color:C.muted,margin:0,fit:'shrink'})});addFooter(slide,w)}
  function financialSlide(pptx,w){const s=scenario(w),a=s.account||{},items=assortment(w),base=Number(a.base_manufacturer_revenue||s.volume_model?.annual_manufacturer_revenue)||0,slide=pptx.addSlide();addHeader(slide,'Commercial opportunity');addMetric(slide,'Annual Manufacturer Revenue',money(base),.75,1.85,3.65);addMetric(slide,'Low Scenario',money(a.low_manufacturer_revenue||base*.65),4.62,1.85,2.5);addMetric(slide,'High Scenario',money(a.high_manufacturer_revenue||base*1.35),7.35,1.85,2.5);addMetric(slide,'Proposed SKUs',items.length,10.08,1.85,2.35);slide.addText('Revenue model inputs',{x:.75,y:3.15,w:5.0,h:.35,fontFace:'Aptos Display',fontSize:22,bold:true,color:C.navy,margin:0});addBullets(slide,[`Store / location count: ${Number(s.volume_model?.store_count||a.footprint)||1}`,`Route to market: ${String(w.route_to_market||'').replaceAll('_',' ')}`,`Revenue basis: dealer cost × monthly units × 12 × locations`,`Evidence status: ${String(a.evidence_status||'REVIEW_REQUIRED').replaceAll('_',' ')}`],.75,3.62,5.6,2.3,16);slide.addText('Important',{x:7.0,y:3.15,w:4,h:.35,fontFace:'Aptos Display',fontSize:22,bold:true,color:C.navy,margin:0});slide.addText('This is an assumption-backed sales model, not a forecast. Final volumes, pricing, margins, placement, and timing should be validated with the account.',{x:7.0,y:3.62,w:5.25,h:1.7,fontFace:'Aptos',fontSize:16,color:C.ink,margin:.03,breakLine:false});addFooter(slide,w)}
  function executionSlide(pptx,w,d){const slide=pptx.addSlide();addHeader(slide,'Recommended retail execution');slide.addText('Merchandising',{x:.72,y:1.8,w:3.7,h:.35,fontFace:'Aptos Display',fontSize:21,bold:true,color:C.navy,margin:0});addBullets(slide,lines(d.merchandising_recommendation),.72,2.25,3.65,3.6,15);slide.addText('Promotion & support',{x:4.78,y:1.8,w:3.7,h:.35,fontFace:'Aptos Display',fontSize:21,bold:true,color:C.navy,margin:0});addBullets(slide,lines(d.promotional_plan),4.78,2.25,3.65,3.6,15);slide.addText('Launch timing',{x:8.85,y:1.8,w:3.7,h:.35,fontFace:'Aptos Display',fontSize:21,bold:true,color:C.navy,margin:0});addBullets(slide,[d.launch_timing||'Align timing with the account reset / launch calendar.'],8.85,2.25,3.65,1.2,15);slide.addText('Buyer message',{x:8.85,y:3.8,w:3.7,h:.35,fontFace:'Aptos Display',fontSize:21,bold:true,color:C.navy,margin:0});addBullets(slide,lines(d.buyer_message),8.85,4.25,3.65,1.7,15);addFooter(slide,w)}
  function buyerSlide(pptx,w){const b=buyer(w),slide=pptx.addSlide();addHeader(slide,'Buyer & stakeholder alignment');slide.addShape('roundRect',{x:.75,y:1.85,w:4.0,h:3.8,rectRadius:.07,fill:{color:C.navy},line:{color:C.navy}});slide.addText(b.name||'Buyer not yet assigned',{x:1.05,y:2.25,w:3.4,h:.7,fontFace:'Aptos Display',fontSize:25,bold:true,color:C.white,margin:0,fit:'shrink'});slide.addText(b.title||b.category||'Decision-maker research needed',{x:1.05,y:3.12,w:3.4,h:.65,fontFace:'Aptos',fontSize:15,color:'B6C9E1',margin:0,fit:'shrink'});slide.addText([b.email,b.phone].filter(Boolean).join('\n')||'Direct contact not verified',{x:1.05,y:4.15,w:3.4,h:.65,fontFace:'Aptos',fontSize:12,color:C.white,margin:0});slide.addText('Account stakeholders',{x:5.35,y:1.85,w:6.3,h:.4,fontFace:'Aptos Display',fontSize:23,bold:true,color:C.navy,margin:0});const people=(w.buyers||[]).slice(0,5);addBullets(slide,people.map(x=>`${x.name} — ${x.title||x.category||'Role'}`),5.35,2.42,6.2,2.7,16);slide.addText('Use verified buyer information only; confirm current ownership before outreach.',{x:5.35,y:5.55,w:6.2,h:.4,fontFace:'Aptos',fontSize:11,color:C.muted,italic:true,margin:0});addFooter(slide,w)}
  function closeSlide(pptx,w,d){const slide=pptx.addSlide();slide.background={color:C.navy};slide.addText('THE ASK',{x:.78,y:.75,w:2,h:.25,fontFace:'Aptos',fontSize:10,bold:true,color:'85B5FF',charSpacing:1.5,margin:0});slide.addText(d.requested_action||'Align on the next step.',{x:.78,y:1.45,w:10.9,h:1.7,fontFace:'Aptos Display',fontSize:34,bold:true,color:C.white,margin:0,fit:'shrink'});const next=[w.next_action,d.launch_timing?`Target timing: ${d.launch_timing}`:'',d.custom_notes].filter(Boolean);addBullets(slide,next,.82,3.55,8.2,2.2,17);slide.addShape('roundRect',{x:9.65,y:4.7,w:2.85,h:1.15,rectRadius:.06,fill:{color:C.blue},line:{color:C.blue}});slide.addText('NEXT STEP',{x:9.9,y:4.93,w:2.35,h:.2,fontFace:'Aptos',fontSize:9,bold:true,color:C.white,charSpacing:1.1,margin:0,align:'center'});slide.addText('MOVE TO ACTION',{x:9.9,y:5.2,w:2.35,h:.28,fontFace:'Aptos Display',fontSize:16,bold:true,color:C.white,margin:0,align:'center'})}

  window.l36GeneratePitchDeck=async function(id){
    const w=currentWorkspace(id);if(!w)return toast('Opportunity not found');const d=readForm(id),button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Generate PowerPoint');if(button){button.disabled=true;button.textContent='Building deck…'}
    try{const Pptx=await ensurePptx(),pptx=new Pptx();pptx.layout='LAYOUT_WIDE';pptx.author=d.presenter||'Launchpad36';pptx.company='Launchpad36';pptx.subject=`${w.account_name||'Account'} opportunity pitch`;pptx.title=d.title||`${d.primary_brand||'Brand'} x ${w.account_name||'Account'}`;pptx.lang='en-US';pptx.theme={headFontFace:'Aptos Display',bodyFontFace:'Aptos',lang:'en-US'};
      addTitleSlide(pptx,w,d);accountSlide(pptx,w,d);brandSlide(pptx,w,d);differentiatorSlide(pptx,w,d);assortmentSlides(pptx,w);if(d.include_competition)competitionSlide(pptx,w);if(d.include_revenue)financialSlide(pptx,w);executionSlide(pptx,w,d);if(d.include_buyers)buyerSlide(pptx,w);closeSlide(pptx,w,d);
      const name=`${slug(d.primary_brand||'brand')}-${slug(w.account_name||'account')}-pitch-deck.pptx`;await pptx.writeFile({fileName:name});toast('Pitch deck generated');
    }catch(e){console.error('pitch deck generation failed',e);toast(e.message||'Pitch deck could not be generated')}finally{if(button){button.disabled=false;button.textContent='Generate PowerPoint'}}
  };

  function addPitchAction(id){const card=document.getElementById('modalBody')||document.getElementById('modalCard')||document.querySelector('#modal .modalCard');if(!card||card.querySelector('.l36-pitch-deck-actions'))return;const w=currentWorkspace(id);if(!w)return;const wrap=document.createElement('div');wrap.className='callout l36-pitch-deck-actions';wrap.style.margin='14px 0';wrap.innerHTML=`<b>Account Pitch Deck</b><p class="muted">Turn this opportunity into an editable PowerPoint. Add your brand story, retailer objectives, differentiators, merchandising plan, promotion, launch timing, buyer message, and requested action before generating.</p><div class="workspaceActions"><button class="btn dark" onclick="l36OpenPitchDeck('${esc2(id)}')">Build Pitch Deck</button></div>`;const crm=card.querySelector('.l36-crm-actions');if(crm)crm.insertAdjacentElement('beforebegin',wrap);else{const anchor=card.querySelector('.callout');if(anchor)anchor.insertAdjacentElement('afterend',wrap);else card.appendChild(wrap)}}
  const base=window.openOpportunityWorkspace;if(typeof base==='function')window.openOpportunityWorkspace=function(id){base(id);setTimeout(()=>addPitchAction(id),90)};
})();