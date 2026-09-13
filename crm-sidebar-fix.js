(()=>{
 if(window.__L36_CRM_SIDEBAR_FIX__)return;window.__L36_CRM_SIDEBAR_FIX__=true;
 function add(){const nav=document.querySelector('.nav');if(!nav||document.getElementById('l36CrmNav'))return;const b=document.createElement('button');b.id='l36CrmNav';b.textContent='CRM';b.onclick=()=>{if(typeof window.l36OpenCrmSettings==='function')window.l36OpenCrmSettings();else if(window.toast)toast('CRM is still loading')};const opp=[...nav.querySelectorAll('button')].find(x=>x.textContent.trim()==='Opportunities');if(opp)opp.insertAdjacentElement('afterend',b);else nav.appendChild(b)}
 const observer=new MutationObserver(add);observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(add,200);setTimeout(add,800);add();
})();
