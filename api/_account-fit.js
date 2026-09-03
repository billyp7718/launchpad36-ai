const clean=value=>String(value??'').trim().toLowerCase();

const CATEGORY_CONCEPTS={
  audio:['audio','speaker','soundbar','amplifier','receiver','subwoofer','headphone','earbud','loudspeaker','home theater','home theatre'],
  mounts:['mount','tv mount','monitor mount','wall mount'],
  displays:['display','television','tv','monitor','projector'],
  furniture:['furniture','desk','standing desk','table','chair'],
  automotive:['automotive','car audio','vehicle'],
  technology:['technology','electronics','consumer electronics','smart home','computer','mobile'],
  appliances:['appliance','washer','dryer','refrigerator','dishwasher'],
  commercial_av:['commercial av','pro av','digital signage','conference room','collaboration']
};

export function categoryConcepts(values=[]){
  const out=new Set();
  for(const value of values){
    const term=clean(value);if(!term)continue;out.add(term);
    for(const [concept,aliases] of Object.entries(CATEGORY_CONCEPTS))if(aliases.some(alias=>term.includes(alias)||alias.includes(term)))out.add(concept);
  }
  return [...out];
}

const specificMatch=(a=[],b=[])=>a.some(left=>b.some(right=>{
  left=clean(left);right=clean(right);
  return left&&right&&(left===right||(left.length>4&&right.includes(left))||(right.length>4&&left.includes(right)));
}));

export function evidenceProfiles(rows=[]){
  const profiles=new Map();
  for(const row of rows){
    const key=String(row.organization_id||'');if(!key)continue;
    const offerings=Array.isArray(row.payload?.offerings)?row.payload.offerings:[];
    const prior=profiles.get(key)||{verified:true,evidence_count:0,terms:[],sources:[],latest_verified_at:null};
    prior.evidence_count+=1;
    prior.terms.push(...offerings.flatMap(item=>[item.name,item.brand,item.category]).filter(Boolean));
    if(row.source_url)prior.sources.push(row.source_url);
    const observed=row.last_verified_at||row.observed_at;
    if(observed&&(!prior.latest_verified_at||new Date(observed)>new Date(prior.latest_verified_at)))prior.latest_verified_at=observed;
    profiles.set(key,prior);
  }
  return profiles;
}

export function evaluateProductAccountFit(product={},org={},evidenceProfile=null){
  const productTerms=[product.name,product.product_family,product.category,...(product.categories||[])].filter(Boolean);
  const accountTerms=(org.categories||[]).filter(Boolean);
  const productConcepts=new Set(categoryConcepts(productTerms)),accountConcepts=new Set(categoryConcepts(accountTerms));
  const channelOverlap=(product.channels||[]).map(clean).filter(Boolean).filter(x=>(org.channel_codes||[]).map(clean).includes(x));
  const exact=specificMatch(productTerms,accountTerms),related=[...productConcepts].filter(x=>accountConcepts.has(x)&&CATEGORY_CONCEPTS[x]).length;
  const verifiedTerms=evidenceProfile?.terms||[],verifiedExact=specificMatch(productTerms,verifiedTerms),verifiedConcepts=new Set(categoryConcepts(verifiedTerms)),verifiedRelated=[...productConcepts].filter(x=>verifiedConcepts.has(x)&&CATEGORY_CONCEPTS[x]).length;
  const furnitureOnly=accountConcepts.has('furniture')&&!accountConcepts.has('audio')&&!accountConcepts.has('technology')&&!accountConcepts.has('displays')&&!accountConcepts.has('mounts');
  if(furnitureOnly&&(productConcepts.has('audio')||productConcepts.has('technology')||productConcepts.has('displays')||productConcepts.has('mounts')))return {qualified:false,score:0,tier:'INCOMPATIBLE_VERTICAL',reason:'Furniture-focused account has no relevant electronics assortment signal',evidence_status:'INCOMPATIBLE',evidence_count:evidenceProfile?.evidence_count||0};
  if(evidenceProfile?.verified&&(verifiedExact||verifiedRelated))return {qualified:true,score:verifiedExact?95:85,tier:'VERIFIED_ASSORTMENT_FIT',reason:'Verified assortment evidence confirms this product category',evidence_status:'VERIFIED',evidence_count:evidenceProfile.evidence_count||0,evidence_sources:evidenceProfile.sources||[],last_verified_at:evidenceProfile.latest_verified_at};
  if(exact)return {qualified:true,score:80,tier:'SPECIFIC_CATEGORY_FIT',reason:'Specific product and account categories align; assortment verification remains required',evidence_status:'PROFILE_ONLY',evidence_count:evidenceProfile?.evidence_count||0};
  if(related)return {qualified:true,score:55,tier:'RELATED_CATEGORY_FIT',reason:'Related category profile aligns; assortment verification is required',evidence_status:'PROFILE_ONLY',evidence_count:evidenceProfile?.evidence_count||0};
  if(channelOverlap.length)return {qualified:false,score:0,tier:'CHANNEL_ONLY',reason:'Channel alignment alone is insufficient without category or assortment fit',evidence_status:'INSUFFICIENT',evidence_count:evidenceProfile?.evidence_count||0};
  return {qualified:false,score:0,tier:accountTerms.length?'NO_CATEGORY_FIT':'INSUFFICIENT_DATA',reason:accountTerms.length?'No relevant category or verified assortment signal':'Account has no category or verified assortment profile',evidence_status:evidenceProfile?.verified?'VERIFIED_NO_MATCH':'INSUFFICIENT',evidence_count:evidenceProfile?.evidence_count||0};
}
