import { db, upsertBuyer } from './_db.js';
import { requireInternal } from './_auth.js';
import { persistEvidence } from './_evidence.js';

function origin(req){const proto=req.headers['x-forwarded-proto']||'https';const host=req.headers['x-forwarded-host']||req.headers.host;return `${proto}://${host}`}
function normalizeTitle(t=''){return String(t).replace(/\s+/g,' ').trim()}
function roleScore(title=''){
  const t=title.toLowerCase();
  if(/chief merchant|chief merchandising/.test(t))return 95;
  if(/vice president|vp/.test(t)&&/merch|category|buy|retail/.test(t))return 90;
  if(/director/.test(t)&&/merch|category|buy/.test(t))return 85;
  if(/senior buyer|category manager|merchant/.test(t))return 82;
  if(/\bbuyer\b/.test(t))return 78;
  if(/merch|category/.test(t))return 65;
  return 35;
}
function status(conf,sourceCount,ageDays){
  if(conf>=85&&sourceCount>=2&&ageDays<=180)return 'Verified Current';
  if(conf>=70&&ageDays<=365)return 'Likely Decision Maker';
  if(sourceCount>=1)return 'Publicly Listed';
  return 'Stale / Unverified';
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireInternal(req,res))return;
  const sql=db(),accountId=req.body?.account_id,manufacturerId=req.body?.manufacturer_id||null;
  if(!accountId)return res.status(400).json({error:'account_id is required'});
  try{
    const account=(await sql`select * from accounts where id=${accountId}`)[0];
    if(!account)return res.status(404).json({error:'Account not found'});
    const auth=req.headers.authorization||'',base=origin(req);
    const r=await fetch(`${base}/api/decision-makers?domain=${encodeURIComponent(account.domain||'')}&account=${encodeURIComponent(account.name)}`,{headers:{authorization:auth}});
    if(!r.ok)return res.status(502).json({error:'decision-maker discovery failed',status:r.status});
    const data=await r.json(),now=Date.now(),results=[];
    for(const p of (data.people||[])){
      if(!p.name||!p.title||!p.source_url)continue;
      const verifiedAt=p.verified_at||new Date().toISOString();
      const ageDays=Math.max(0,Math.floor((now-new Date(verifiedAt).getTime())/86400000));
      const sources=[p.source_url].filter(Boolean);
      const rs=roleScore(p.title);
      const confidence=Math.min(95,Math.round((Number(p.confidence)||60)*.65+rs*.35));
      const buyerStatus=status(confidence,sources.length,ageDays);
      const record=await upsertBuyer({account_id:account.id,name:p.name,title:normalizeTitle(p.title),email:p.email||'',phone:p.phone||'',linkedin:p.linkedin||'',category:p.category||account.category||'',source:p.source_label||'Public business source',source_url:p.source_url,confidence,verified_at:verifiedAt,status:buyerStatus,notes:`L36 buyer intelligence role_score=${rs}`});
      const evidence=await persistEvidence({manufacturer_id:manufacturerId,account_id:account.id,evidence_type:'buyer',entity_key:`${p.name}|${p.title}`,payload:{...p,role_score:rs,buyer_status:buyerStatus},source_url:p.source_url,source_type:'public_professional_source',observed_at:verifiedAt,confidence});
      results.push({buyer_id:record?.id||null,name:p.name,title:p.title,status:buyerStatus,confidence,role_score:rs,source_url:p.source_url,evidence_id:evidence?.id||null,linkedin:p.linkedin||''});
    }
    return res.status(200).json({version:'9.5',account:{id:account.id,name:account.name,domain:account.domain},buyer_intelligence:results.sort((a,b)=>b.confidence-a.confidence),linkedin_policy:{mode:'verification_enrichment_only',bulk_scraping:false,private_contact_inference:false},interpretation:results.length?'Candidate decision-makers were found from attributable public sources. LinkedIn may be used separately to verify/enrich named candidates.':'No attributable buyer candidates were found. This does not prove no relevant buyer exists.'});
  }catch(e){return res.status(500).json({error:e.message})}
}
