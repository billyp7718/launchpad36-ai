(()=>{
 if(window.__L36_LOGIN_RECOVERY__)return;window.__L36_LOGIN_RECOVERY__=true;
 async function call(url,opt={}){const r=await fetch(url,{headers:{'content-type':'application/json',...(opt.headers||{})},credentials:'same-origin',...opt});let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);return b}
 function enhance(){
  document.querySelectorAll('.l36-user-row').forEach(row=>{
   if(row.dataset.loginRecovery==='1')return;
   const toggle=[...row.querySelectorAll('button')].find(b=>String(b.getAttribute('onclick')||'').includes('l36SetUserActive('));
   if(!toggle)return;
   const match=String(toggle.getAttribute('onclick')||'').match(/l36SetUserActive\('([^']+)'/);if(!match)return;
   const memberId=match[1],actions=row.querySelector('.l36-user-actions');if(!actions)return;
   const reset=document.createElement('button');reset.className='btn ghost';reset.textContent='Reset Password';reset.onclick=async()=>{const password=prompt('Enter a new password for this user (8+ characters):');if(password===null)return;if(password.length<8){if(window.toast)toast('Password must be at least 8 characters');return}try{await call('/api/team-admin',{method:'POST',body:JSON.stringify({action:'reset_password',member_id:memberId,password})});if(window.toast)toast('Password reset. User access is on.')}catch(e){if(window.toast)toast(e.message);else alert(e.message)}};actions.appendChild(reset);row.dataset.loginRecovery='1';
  });
 }
 const observer=new MutationObserver(enhance);observer.observe(document.body,{childList:true,subtree:true});enhance();
})();
