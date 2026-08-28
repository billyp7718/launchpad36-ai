import crypto from 'crypto';

const COOKIE='l36_session';
const TTL=60*60*8;

function b64url(v){return Buffer.from(v).toString('base64url')}
function sign(value,secret){return crypto.createHmac('sha256',secret).update(value).digest('base64url')}
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('='); if(i<0) continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function safeEqual(a,b){
  const aa=Buffer.from(String(a)), bb=Buffer.from(String(b));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
export function createSessionCookie(){
  const secret=process.env.ADMIN_SECRET||'';
  if(!secret) throw new Error('ADMIN_SECRET is not configured');
  const exp=Math.floor(Date.now()/1000)+TTL;
  const payload=b64url(JSON.stringify({role:'admin',exp}));
  const token=`${payload}.${sign(payload,secret)}`;
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`;
}
export function clearSessionCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}
export function isAdmin(req){
  const secret=process.env.ADMIN_SECRET||''; if(!secret) return false;
  const token=parseCookies(req)[COOKIE]||''; const [payload,sig]=token.split('.');
  if(!payload||!sig||!safeEqual(sig,sign(payload,secret))) return false;
  try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); return data.role==='admin' && Number(data.exp)>Math.floor(Date.now()/1000)}catch{return false}
}
export function requireAdmin(req,res){
  if(!process.env.ADMIN_SECRET){res.status(503).json({error:'ADMIN_SECRET is not configured'});return false}
  if(!isAdmin(req)){res.status(401).json({error:'Admin session required'});return false}
  return true;
}
export function verifySecret(candidate){
  const secret=process.env.ADMIN_SECRET||''; if(!secret) return false;
  return safeEqual(candidate||'',secret);
}
