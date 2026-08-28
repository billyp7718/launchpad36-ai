import { requireInternal } from './_auth.js';

const BRANDS=['Best Buy essentials','SANUS Elite','Sanus','Rocketfish','Insignia','Mount-It!','Perlesmith','Sony','Samsung','LG','Bose','Sonos','JBL','Klipsch','KEF','Polk Audio','Bowers & Wilkins','Yamaha','Denon','Marantz','SVS','Audioengine','Sennheiser','Marshall','Vizio','Chief','Kanto','Ergotron','Humanscale','FlexiSpot','Vari','UPLIFT','Branch'];

const ADAPTERS={
  'bestbuy.com': {
    routes:{
      'tv mounts':[
        'https://www.bestbuy.com/site/tv-stands-mounts/tv-mounts/abcat0106004.c?id=abcat0106004',
        'https://www.bestbuy.com/site/searchpage.jsp?browsedCategory=abcat0106004&id=pcat17071&st=categoryid%24abcat0106004'
      ],
      'audio':['https://www.bestbuy.com/site/audio/audio/abcat0200000.c?id=abcat0200000'],
      'office':['https://www.bestbuy.com/site/home-office-furniture/home-office-desks/abcat0809001.c?id=abcat0809001']
    }
  }
};

function safeDomain(x){const d=String(x||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)?d:''}
function text(h=''){return h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim()}
function same(u,d){try{const h=new URL(u).hostname.replace(/^www\./,'').toLowerCase();return h===d||h.endsWith('.'+d)}catch{return false}}
function categoryList(raw){return String(raw||'').split('|').map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,8)}
function statusFor(attempts,items){if(items.length) return attempts.some(a=>a.ok)?'SUCCESS':'PARTIAL'; if(attempts.some(a=>a.blocked))return 'BLOCKED'; if(attempts.some(a=>a.ok))return 'NO_RESULTS'; return 'ERROR'}
async function page(u){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);
  try{
    const r=await fetch(u,{headers:{'user-agent':'Mozilla/5.0 (compatible; Launchpad36AI/1.0; retail-evidence-collector)','accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:c.signal});
    const ct=r.headers.get('content-type')||'';
    const body=(ct.includes('text/html')||ct.includes('application/xhtml'))?await r.text():'';
    const blocked=r.status===403||r.status===429||/access denied|captcha|robot check|verify you are human/i.test(body.slice(0,100000));
    return {requested_url:u,url:r.url,status:r.status,ok:r.ok&&!!body&&!blocked,blocked,content_type:ct,html:body.slice(0,1500000),error:''};
  }catch(e){return {requested_url:u,url:u,status:0,ok:false,blocked:false,content_type:'',html:'',error:e.name==='AbortError'?'timeout':e.message}}
  finally{clearTimeout(t)}
}
function routes(domain,cats){
  const out=[];
  const adapter=ADAPTERS[domain];
  if(adapter){
    for(const c of cats.length?cats:['tv mounts']){
      for(const [key,vals] of Object.entries(adapter.routes||{})) if(c.includes(key)||key.includes(c)) out.push(...vals);
    }
  }
  const q=encodeURIComponent((cats[0]||'audio').replace(/\s+/g,' '));
  out.push(`https://${domain}/search?q=${q}`,`https://www.${domain}/search?q=${q}`);
  return [...new Set(out)].slice(0,8);
}
function parseItems(p){
  const t=text(p.html), lower=t.toLowerCase(), items=[], seen=new Set();
  for(const brand of BRANDS){
    let start=0;
    while(items.length<80){
      const i=lower.indexOf(brand.toLowerCase(),start); if(i<0)break; start=i+brand.length;
      const sn=t.slice(Math.max(0,i-80),Math.min(t.length,i+520));
      const price=(sn.match(/\$\s?\d{1,5}(?:,\d{3})*(?:\.\d{2})?/g)||[])[0]||'';
      const product=sn.replace(/\s+/g,' ').trim().slice(0,300);
      if(!price || product.length<25) continue;
      const key=(brand+'|'+product.slice(0,140)+'|'+price).toLowerCase(); if(seen.has(key))continue; seen.add(key);
      items.push({brand,product,price,availability:/add to cart|in stock|available|pickup|ships/i.test(sn)?'Offer/action detected on retailer page':'Availability not confirmed',source_url:p.url,source_type:'retailer_category_page',acquisition_method:'retailer_adapter_html',observed_at:new Date().toISOString(),confidence:85});
    }
  }
  return items;
}

export default async function handler(req,res){
  if(!requireInternal(req,res))return;
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const domain=safeDomain(req.query.domain),account=String(req.query.account||domain),cats=categoryList(req.query.categories);
  if(!domain)return res.status(400).json({error:'Valid retailer domain required'});
  const attempts=[],items=[],seen=new Set();
  for(const u of routes(domain,cats)){
    const p=await page(u);
    attempts.push({requested_url:p.requested_url,resolved_url:p.url,http_status:p.status,ok:p.ok,blocked:p.blocked,error:p.error});
    if(!p.ok||!same(p.url,domain))continue;
    for(const x of parseItems(p)){const k=(x.brand+'|'+x.product.slice(0,160)+'|'+x.price).toLowerCase();if(!seen.has(k)){seen.add(k);items.push(x)}}
    if(items.length>=60)break;
  }
  const collector_status=statusFor(attempts,items);
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({
    account,domain,categories:cats,collector_status,
    products:items.slice(0,60),
    acquisition:{
      adapter:ADAPTERS[domain]?'retailer_specific':'generic',
      attempts,
      successful_pages:attempts.filter(x=>x.ok).map(x=>x.resolved_url),
      failure_is_negative_evidence:false,
      interpretation:collector_status==='NO_RESULTS'?'Pages were retrieved but no supported product observations were extracted. This is NOT evidence that the retailer lacks the category or product.':collector_status==='BLOCKED'?'Retailer access was blocked. No assortment conclusion may be drawn.':collector_status==='ERROR'?'Collector failed. No assortment conclusion may be drawn.':'Attributable retailer observations were extracted.'
    },
    method:'v9.4-retail-evidence-acquisition'
  });
}
