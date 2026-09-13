(()=>{
 if(window.__L36_COMMERCIAL_UI_POLISH__)return;window.__L36_COMMERCIAL_UI_POLISH__=true;
 const style=document.createElement('style');style.textContent=`
 :root{--l36-shadow:0 14px 36px rgba(7,26,57,.08);--l36-shadow-lg:0 24px 60px rgba(7,26,57,.12)}
 body{background:linear-gradient(180deg,#f7f9fc 0,#f3f7fb 100%)}
 .app{grid-template-columns:264px minmax(0,1fr)}
 .side{background:linear-gradient(180deg,#06172f 0%,#082854 56%,#0b3266 100%);padding:22px 16px;box-shadow:10px 0 32px rgba(7,26,57,.08)}
 .brand{gap:12px;padding:0 5px 20px;border-bottom:1px solid rgba(255,255,255,.11)}
 .brand img{width:70px;height:46px;border-radius:12px;padding:5px;box-shadow:0 7px 22px rgba(0,0,0,.16)}
 .brand b{font-size:13px;letter-spacing:.075em}.brand small{margin-top:3px;color:#9bb8da}
 .nav{gap:5px;margin-top:20px}.nav button{position:relative;padding:12px 13px;border-radius:12px;font-size:12px;letter-spacing:.005em;color:#a9bfd7;transition:background .18s ease,color .18s ease,transform .18s ease}.nav button:hover{transform:translateX(2px);background:rgba(255,255,255,.085)}.nav button.active{background:linear-gradient(90deg,rgba(75,135,239,.22),rgba(255,255,255,.07));color:#fff;box-shadow:inset 3px 0 #70a3ff}
 .nav button.l36-admin-nav{margin-top:10px;border-top:1px solid rgba(255,255,255,.08);border-radius:0 0 12px 12px;padding-top:16px}.nav button.l36-admin-nav:after{content:'ADMIN';float:right;font-size:7px;letter-spacing:.12em;color:#8eb7ef;background:rgba(111,163,255,.12);border:1px solid rgba(111,163,255,.2);padding:3px 5px;border-radius:999px}
 .top{height:72px;background:rgba(255,255,255,.94);border-bottom:1px solid #e2eaf3;box-shadow:0 4px 18px rgba(7,26,57,.035);padding:0 30px}
 .content{padding:30px;max-width:1500px}
 .pageHead{margin-bottom:20px}.pageHead h1,.hero h1{letter-spacing:-.035em}.pageHead h1{font-size:32px}.pageHead p{font-size:12px;max-width:820px}
 .hero{border-radius:22px;padding:32px;background:linear-gradient(125deg,#071d3e 0%,#0c3267 52%,#104887 100%);box-shadow:var(--l36-shadow-lg);border:1px solid rgba(255,255,255,.08)}
 .card{border-radius:16px;border-color:#e0e8f1;box-shadow:var(--l36-shadow);background:rgba(255,255,255,.985);padding:19px}.card:hover{border-color:#d3deea;box-shadow:0 18px 42px rgba(7,26,57,.095)}
 .callout{border-radius:15px;border-color:#d8e5f4;background:linear-gradient(135deg,#f4f8fe,#fff);box-shadow:0 8px 24px rgba(25,75,130,.04)}
 .btn{border-radius:10px;box-shadow:0 6px 16px rgba(47,111,237,.13);transition:transform .16s ease,box-shadow .16s ease,filter .16s ease}.btn:hover:not([disabled]){transform:translateY(-1px);filter:saturate(1.06);box-shadow:0 9px 20px rgba(47,111,237,.17)}.btn.secondary,.btn.ghost,.btn.danger{box-shadow:none}
 .tableWrap{border-radius:13px}.table{font-size:11px}.table th{background:#f7f9fc;color:#617890;padding:11px 10px}.table td{padding:13px 10px}.table tbody tr:hover{background:#f6f9fd}
 .pill,.badge,.sourceTag{letter-spacing:.02em}.modalCard{border-radius:22px;box-shadow:0 30px 80px rgba(4,18,38,.22)}
 .metric,.item,.targetProductOption,.comparisonProductOption{border-color:#e2e9f1}.item{background:#fff}.stats{gap:14px}.stat strong{letter-spacing:-.03em}
 .l36-commercial-note{font-size:10px;color:#637c95;line-height:1.55;margin:7px 0 0}.l36-admin-only{display:none!important}
 @media(max-width:760px){.app{grid-template-columns:1fr}.content{padding:18px}.top{padding:0 16px}.side{box-shadow:none}.nav button.l36-admin-nav{margin-top:0;border-top:0;padding-top:12px}.nav button.l36-admin-nav:after{display:none}}
 `;document.head.appendChild(style);
 const admin=()=>['owner','admin'].includes(String(window.__L36_PROFILE__?.user?.role||'').toLowerCase());
 const navButton=label=>[...document.querySelectorAll('.nav button')].find(b=>b.textContent.trim()===label);
 function cleanTechnicalCopy(){
  document.querySelectorAll('p').forEach(p=>{
   const t=p.textContent||'';
   if(t.includes('It checks every selected product against source-backed competitive offerings')){
    p.textContent='Research competitive assortment and commercial fit across priority accounts.';p.className='l36-commercial-note';
   }
   if(t.includes('Email waterfall: saved/public')){
    p.textContent='Research current buyer and contact information across available verified sources.';p.className='l36-commercial-note';
   }
  });
 }
 function applyAdminNav(){
  const system=navButton('System Status');
  if(system)system.style.display=admin()?'':'none';
  let users=document.getElementById('l36UsersNav');
  if(admin()){
   if(!users){users=document.createElement('button');users.id='l36UsersNav';users.className='l36-admin-nav';users.textContent='User Management';users.onclick=()=>{const w=document.getElementById('l36WorkspaceBtn');if(w)w.click();else if(window.toast)toast('Workspace administration is still loading');};const nav=document.querySelector('.nav');if(nav)nav.appendChild(users)}
   users.style.display='';
  }else if(users)users.style.display='none';
 }
 const originalShow=window.show;
 if(typeof originalShow==='function')window.show=function(name,...rest){if(name==='System Status'&&!admin()){if(window.toast)toast('System Status is available to administrators only');return originalShow.call(this,'Dashboard',...rest)}return originalShow.call(this,name,...rest)};
 function polish(){cleanTechnicalCopy();applyAdminNav()}
 const observer=new MutationObserver(polish);observer.observe(document.documentElement,{childList:true,subtree:true});
 let tries=0;const timer=setInterval(()=>{polish();if(window.__L36_PROFILE__||++tries>40)clearInterval(timer)},150);polish();
})();
