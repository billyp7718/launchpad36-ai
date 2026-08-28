import { requireInternal } from './_auth.js';

const COMMON_BRANDS = [
  'Sony','Samsung','LG','Bose','Sonos','JBL','Klipsch','KEF','Polk Audio','Definitive Technology',
  'Bowers & Wilkins','Bang & Olufsen','Yamaha','Denon','Marantz','Onkyo','Pioneer','SVS','Audioengine',
  'Sennheiser','Marshall','Harman Kardon','Vizio','TCL','Hisense','Roku','Sanus','Rocketfish','Mount-It!',
  "Vogel's",'Peerless-AV','Chief','Kanto','Ergotron','Humanscale','FlexiSpot','Vari','UPLIFT','Branch'
];
function safeDomain(input){
  const d=String(input||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)?d:'';
}
async function fetchPage(url){
  const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),6500);
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 Launchpad36AI/1.0'},redirect:'follow',signal:ctrl.signal});
    if(!r.ok)return null;
    const type=r.headers.get('content-type')||'';
    if(!type.includes('text/html'))return null;
    return {url:r.url,html:(await r.text()).slice(0,800000)};
  }catch{return null}finally{clearTimeout(t)}
}
function text(html=''){return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function sameDomain(url,domain){try{const h=new URL(url).hostname.replace(/^www\./,'').toLowerCase();return h===domain||h.endsWith('.'+domain)}catch{return false}}
export default async function handler(req,res){
 if(!requireInternal(req,res)) return;
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const domain=safeDomain(req.query.domain); const account=String(req.query.account||domain);
  if(!domain)return res.status(400).json({error:'Valid retailer domain required'});
  const cats=String(req.query.categories||'').split('|').filter(Boolean).slice(0,8);
  const seeds=[
    `https://${domain}/search?q=${encodeURIComponent(cats[0]||'audio')}`,
    `https://www.${domain}/search?q=${encodeURIComponent(cats[0]||'audio')}`,
    `https://${domain}/audio`,`https://${domain}/electronics`,`https://${domain}/tv-home-theater`,
    `https://${domain}/office`,`https://${domain}/furniture`
  ];
  const pages=[];
  for(const u of seeds){
    if(pages.length>=5)break;
    const p=await fetchPage(u);
    if(p&&sameDomain(p.url,domain)&&!pages.some(x=>x.url===p.url))pages.push(p);
  }
  const results=[]; const seen=new Set();
  for(const p of pages){
    const t=text(p.html);
    const lower=t.toLowerCase();
    for(const brand of COMMON_BRANDS){
      const idx=lower.indexOf(brand.toLowerCase());
      if(idx<0)continue;
      const snip=t.slice(Math.max(0,idx-120),Math.min(t.length,idx+260));
      const key=brand.toLowerCase();
      if(seen.has(key))continue;seen.add(key);
      const price=(snip.match(/\$\s?\d{1,4}(?:,\d{3})*(?:\.\d{2})?/g)||[]).slice(0,2).join(' – ');
      const rel=Math.min(96,65+(cats.some(c=>snip.toLowerCase().includes(c.toLowerCase()))?20:0));
      results.push({brand,product:snip.slice(0,180),category:cats[0]||'Relevant assortment',price,relevance:rel,source_url:p.url,verified_at:new Date().toISOString().slice(0,10)});
      if(results.length>=30)break;
    }
    if(results.length>=30)break;
  }
  res.setHeader('Cache-Control','public, max-age=900, stale-while-revalidate=43200');
  res.status(200).json({account,competitors:results,checked_pages:pages.map(p=>p.url),method:'public-retailer-assortment'});
}
