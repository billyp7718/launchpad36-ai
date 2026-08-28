
const BRANDS=['Sony','Samsung','LG','Bose','Sonos','JBL','Klipsch','KEF','Polk Audio','Bowers & Wilkins','Yamaha','Denon','Marantz','SVS','Audioengine','Sennheiser','Marshall','Vizio','Sanus','Rocketfish','Chief','Kanto','Ergotron','Humanscale','FlexiSpot','Vari','UPLIFT','Branch'];
function safeDomain(x){const d=String(x||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)?d:''}
async function page(u){const c=new AbortController(),t=setTimeout(()=>c.abort(),6500);try{const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0 Launchpad36AI/1.0'},redirect:'follow',signal:c.signal});if(!r.ok||!(r.headers.get('content-type')||'').includes('text/html'))return null;return {url:r.url,html:(await r.text()).slice(0,900000)}}catch{return null}finally{clearTimeout(t)}}
function txt(h=''){return h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function same(u,d){try{const h=new URL(u).hostname.replace(/^www\./,'').toLowerCase();return h===d||h.endsWith('.'+d)}catch{return false}}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const d=safeDomain(req.query.domain),account=String(req.query.account||d);
 if(!d)return res.status(400).json({error:'Valid retailer domain required'});
 const cats=String(req.query.categories||'').split('|').filter(Boolean).slice(0,8),q=encodeURIComponent(cats[0]||'audio');
 const seeds=[`https://${d}/search?q=${q}`,`https://www.${d}/search?q=${q}`,`https://${d}/audio`,`https://${d}/electronics`,`https://${d}/tv-home-theater`,`https://${d}/office`,`https://${d}/furniture`];
 const pages=[];for(const u of seeds){if(pages.length>=6)break;const p=await page(u);if(p&&same(p.url,d)&&!pages.some(x=>x.url===p.url))pages.push(p)}
 const items=[],seen=new Set(),today=new Date().toISOString().slice(0,10);
 for(const p of pages){const t=txt(p.html),l=t.toLowerCase();for(const brand of BRANDS){const i=l.indexOf(brand.toLowerCase());if(i<0)continue;const sn=t.slice(Math.max(0,i-180),Math.min(t.length,i+420));const price=(sn.match(/\$\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/g)||[])[0]||'';const key=(brand+'|'+price+'|'+p.url).toLowerCase();if(seen.has(key))continue;seen.add(key);items.push({brand,product:sn.slice(0,220),price,availability:/in stock|available|ships|pickup/i.test(sn)?'Availability indicated on retailer page':'Availability not confirmed',source_url:p.url,verified_at:today});if(items.length>=40)break}if(items.length>=40)break}
 res.setHeader('Cache-Control','public, max-age=900, stale-while-revalidate=43200');
 res.status(200).json({account,products:items,checked_pages:pages.map(p=>p.url),method:'public-current-retailer-assortment'});
}
