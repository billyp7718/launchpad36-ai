import { requireInternal } from './_auth.js';
import { resolveTenant } from './_tenant.js';
import { enrichBuyerContacts } from './_buyer-contact-waterfall.js';

function origin(req){const proto=req.headers['x-forwarded-proto']||'https',host=req.headers['x-forwarded-host']||req.headers.host;return `${proto}://${host}`}
function isStructuredJsonError(payload={}){const src=payload?.research?.buyer_sources?.openai_web_search||{};return src.status==='ERROR'&&/invalid structured json/i.test(String(src.error||''))}

async function withContactWaterfall(payload,organization_id,tenant_id){
  try{
    const contact_enrichment=await enrichBuyerContacts({organizationId:organization_id,tenantId:tenant_id});
    payload.research=payload.research||{};payload.research.buyer_sources=payload.research.buyer_sources||{};
    payload.research.buyer_sources.contact_waterfall={status:contact_enrichment.status,total_buyers:contact_enrichment.total_buyers||0,total_with_email:contact_enrichment.total_with_email||0,emails_added:contact_enrichment.emails_added||0,buyers_added:contact_enrichment.added||0,categories_searched:contact_enrichment.categories_searched||[],apollo:contact_enrichment.apollo||{},public_email:contact_enrichment.public_email||{}};
    payload.buyers=contact_enrichment.buyers||payload.buyers||[];
    return payload;
  }catch(error){
    payload.research=payload.research||{};payload.research.buyer_sources=payload.research.buyer_sources||{};
    payload.research.buyer_sources.contact_waterfall={status:'ERROR',error:String(error?.message||error).slice(0,240)};
    return payload;
  }
}

export default async function handler(req,res){
  if(!requireInternal(req,res))return;
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const organization_id=String(req.body?.organization_id||'').trim();
  if(!organization_id)return res.status(400).json({error:'organization_id is required'});
  const website=String(req.body?.website||'').trim();
  const headers={'content-type':'application/json'};
  if(req.headers.cookie)headers.cookie=req.headers.cookie;
  if(req.headers.authorization)headers.authorization=req.headers.authorization;
  const body={organization_id,website,research_type:'buyer',all_buyers:true};
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await fetch(`${origin(req)}/api/account-research`,{method:'POST',headers,body:JSON.stringify(body)});
      const payload=await r.json().catch(()=>({error:`Buyer research returned HTTP ${r.status}`}));
      if(!r.ok)return res.status(r.status).json(payload);
      last=payload;
      if(!isStructuredJsonError(payload)){
        const enriched=await withContactWaterfall(payload,organization_id,tenant.tenant_id);
        return res.status(200).json({...enriched,retry_attempts:attempt-1,resilient_retry_used:attempt>1});
      }
      console.warn('[buyer-research-resilient] malformed OpenAI structured output; retrying',{organization_id,attempt});
    }catch(error){
      if(attempt===3)return res.status(500).json({error:error?.message||'Buyer research could not be completed'});
    }
  }
  const src=last?.research?.buyer_sources?.openai_web_search||{};
  if(last){
    last.research=last.research||{};
    last.research.buyer_sources=last.research.buyer_sources||{};
    last.research.buyer_sources.openai_web_search={...src,status:'RETRY_EXHAUSTED',error:'OpenAI returned malformed structured output after automatic retries. Previously saved buyer records were preserved.'};
    const enriched=await withContactWaterfall(last,organization_id,tenant.tenant_id);
    return res.status(200).json({...enriched,retry_attempts:2,resilient_retry_used:true});
  }
  return res.status(500).json({error:'Buyer research could not be completed'});
}
