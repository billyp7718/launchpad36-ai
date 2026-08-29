import crypto from 'crypto';

const COOKIE='l36_session';
const TTL=60*60*8;
function b64url(v){return Buffer.from(v).toString('base64url')}
function sign(value,secret){return crypto.createHmac('sha256',secret).update(value).digest('base64url')}
function parseCookies(req){const out={};for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i<0)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function safeEqual(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
function bearer(req){const auth=String(req.headers.authorization||'');return auth.startsWith('Bearer ')?auth.slice(7):''}
export function createSessionCookie(data={}){const secret=process.env.ADMIN_SECRET||'';if(!secret)throw new Error('ADMIN_SECRET is not configured');const exp=Math.floor(Date.now()/1000)+TTL;const payload=b64url(JSON.stringify({role:data.role||'admin',tenant_id:data.tenant_id||null,user_id:data.user_id||null,exp}));const token=`${payload}.${sign(payload,secret)}`;return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`}
export function clearSessionCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}
export function sessionData(req){const secret=process.env.ADMIN_SECRET||'';if(!secret)return null;const token=parseCookies(req)[COOKIE]||'';const [payload,sig]=token.split('.');if(!payload||!sig||!safeEqual(sig,sign(payload,secret)))return null;try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(Number(data.exp)<=Math.floor(Date.now()/1000))return null;return data}catch{return null}}
export function isAdmin(req){return sessionData(req)?.role==='admin'}
export function isAdminBearer(req){const secret=process.env.ADMIN_SECRET||'';return Boolean(secret)&&safeEqual(bearer(req),secret)}
export function isCron(req){const secret=process.env.CRON_SECRET||'';return Boolean(secret)&&safeEqual(bearer(req),secret)}
export function requireAdmin(req,res){if(!process.env.ADMIN_SECRET){res.status(503).json({error:'ADMIN_SECRET is not configured'});return false}if(!isAdmin(req)&&!isAdminBearer(req)){res.status(401).json({error:'Admin authentication required'});return false}return true}
export function requireInternal(req,res){if(isAdmin(req)||isAdminBearer(req)||isCron(req))return true;res.status(401).json({error:'Internal authentication required'});return false}
export function verifySecret(candidate){const secret=process.env.ADMIN_SECRET||'';if(!secret)return false;return safeEqual(candidate||'',secret)}
