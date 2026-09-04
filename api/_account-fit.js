const clean=value=>String(value??'').trim().toLowerCase();

const CATEGORY_CONCEPTS={
  audio:['audio','speaker','soundbar','amplifier','receiver','subwoofer','headphone','earbud','loudspeaker','home theater','home theatre'],
  mounts:['mount','tv mount','monitor mount','wall mount'],
  displays:['display','television','tv','monitor','projector'],
  furniture:['furniture','desk','standing desk','table','chair'],
  automotive:['automotive','car audio','vehicle'],
  technology:['technology','electronics','consumer electronics','smart home','computer','mobile'],
  appliances:['appliance','washer','dryer','refrigerator','dishwasher'],
  household_cleaning:['household cleaning','cleaning product','cleaning supplies','household supplies','household essentials','household goods','household consumables','consumer packaged goods','cpg','laundry care','dish care','surface cleaner','floor cleaner','bathroom cleaner','all purpose cleaner','multipurpose cleaner','disinfectant','sanitizer','detergent','cleaner','grocery','supermarket','drug','drugstore','pharmacy','general merchandise','mass merchant','big box','discount retail','value retail','dollar store','warehouse club'],
  commercial_av:['commercial av','pro av','digital signage','conference room','collaboration']
};

const CONCEPT_CHANNELS={
  audio:['ce','consumer_electronics','ecommerce','mass','club','department','specialty_av','dealer','distribution'],
  mounts:['ce','consumer_electronics','ecommerce','mass','club','home_improvement','specialty_av','office','dealer','distribution','integrator'],
  displays:['ce','consumer_electronics','ecommerce','mass','club','department','specialty_av','office','dealer','distribution','integrator'],
  furniture:['furniture','office','ecommerce','mass','club','home_improvement','dealer','distribution'],
  automotive:['automotive','ecommerce','mass','club','dealer','distribution'],
  technology:['ce','consumer_electronics','ecommerce','mass','club','department','office','dealer','distribution'],
  appliances:['appliances','ecommerce','mass','club','department','home_improvement','dealer','distribution'],
  household_cleaning:['mass','ecommerce','club','warehouse','department','home_improvement','grocery','supermarket','drug','pharmacy','value','dollar','distribution'],
  commercial_av:['specialty_av','office','dealer','distribution','integrator','enterprise','corporate','hospitality','healthcare','education','government']
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
    const status=clean(row.verification_status||'REVIEW_REQUIRED'),verified=status==='verified';
    const prior=profiles.get(key)||{verified:false,evidence_count:0,verified_terms:[],observed_terms:[],sources:[],latest_verified_at:null,latest_observed_at:null};
    prior.evidence_count+=1;
    const terms=offerings.flatMap(item=>[item.name,item.brand,item.category]).filter(Boolean);
    prior.observed_terms.push(...terms);if(verified){prior.verified=true;prior.verified_terms.push(...terms)}
    if(row.source_url)prior.sources.push(row.source_url);
    const observed=row.last_verified_at||row.observed_at;
    if(verified&&observed&&(!prior.latest_verified_at||new Date(observed)>new Date(prior.latest_verified_at)))prior.latest_verified_at=observed;
    if(row.observed_at&&(!prior.latest_observed_at||new Date(row.observed_at)>new Date(prior.latest_observed_at)))prior.latest_observed_at=row.observed_at;
    profiles.set(key,prior);
  }
  return profiles;
}

export function buyerProfiles(rows=[]){
  const profiles=new Map();
  for(const row of rows){
    const key=String(row.organization_id||'');if(!key)continue;
    const current=profiles.get(key)||[];
    if(current.length<5)current.push({id:row.id,name:row.name,title:row.title,email:row.email||'',phone:row.phone||'',linkedin:row.linkedin||'',category:row.category||'',source_url:row.source_url||'',confidence:Number(row.confidence)||0,verification_status:row.verification_status||row.status||'UNKNOWN',updated_at:row.updated_at||null});
    profiles.set(key,current);
  }
  return profiles;
}

export function evaluateProductAccountFit(product={},org={},evidenceProfile=null){
  const productTerms=[product.name,product.product_family,product.category,...(product.categories||[])].filter(Boolean);
  const accountTerms=(org.categories||[]).filter(Boolean);
  const productConcepts=new Set(categoryConcepts(productTerms)),accountConcepts=new Set(categoryConcepts(accountTerms));
  const channelOverlap=(product.channels||[]).map(clean).filter(Boolean).filter(x=>(org.channel_codes||[]).map(clean).includes(x));
  const exact=specificMatch(productTerms,accountTerms),related=[...productConcepts].filter(x=>accountConcepts.has(x)&&CATEGORY_CONCEPTS[x]).length;
  const verifiedTerms=evidenceProfile?.verified_terms||[],observedTerms=evidenceProfile?.observed_terms||[],verifiedExact=specificMatch(productTerms,verifiedTerms),verifiedConcepts=new Set(categoryConcepts(verifiedTerms)),verifiedRelated=[...productConcepts].filter(x=>verifiedConcepts.has(x)&&CATEGORY_CONCEPTS[x]).length;
  const observedExact=specificMatch(productTerms,observedTerms),observedConcepts=new Set(categoryConcepts(observedTerms)),observedRelated=[...productConcepts].filter(x=>observedConcepts.has(x)&&CATEGORY_CONCEPTS[x]).length;
  const accountChannels=(org.channel_codes||[]).map(clean),suitableChannels=[...new Set([...productConcepts].flatMap(concept=>CONCEPT_CHANNELS[concept]||[]))],routeMatches=accountChannels.filter(channel=>suitableChannels.includes(channel));
  const furnitureOnly=accountConcepts.has('furniture')&&!accountConcepts.has('audio')&&!accountConcepts.has('technology')&&!accountConcepts.has('displays')&&!accountConcepts.has('mounts');
  if(furnitureOnly&&(productConcepts.has('audio')||productConcepts.has('technology')||productConcepts.has('displays')||productConcepts.has('mounts')))return {qualified:false,score:0,tier:'INCOMPATIBLE_VERTICAL',reason:'Furniture-focused account has no relevant electronics assortment signal',evidence_status:'INCOMPATIBLE',evidence_count:evidenceProfile?.evidence_count||0};
  if(evidenceProfile?.verified&&(verifiedExact||verifiedRelated))return {qualified:true,score:verifiedExact?95:85,tier:'VERIFIED_ASSORTMENT_FIT',reason:'Verified assortment evidence confirms this product category',evidence_status:'VERIFIED',evidence_count:evidenceProfile.evidence_count||0,evidence_sources:evidenceProfile.sources||[],last_verified_at:evidenceProfile.latest_verified_at};
  if(observedExact||observedRelated)return {qualified:true,score:observedExact?78:68,tier:'OBSERVED_ASSORTMENT_FIT',reason:'Recent account product evidence matches this category; human verification is still required',evidence_status:'OBSERVED_REVIEW_REQUIRED',evidence_count:evidenceProfile?.evidence_count||0,evidence_sources:evidenceProfile?.sources||[],last_observed_at:evidenceProfile?.latest_observed_at||null};
  if(exact)return {qualified:true,score:80,tier:'SPECIFIC_CATEGORY_FIT',reason:'Specific product and account categories align; assortment verification remains required',evidence_status:'PROFILE_ONLY',evidence_count:evidenceProfile?.evidence_count||0};
  if(related)return {qualified:true,score:55,tier:'RELATED_CATEGORY_FIT',reason:'Related category profile aligns; assortment verification is required',evidence_status:'PROFILE_ONLY',evidence_count:evidenceProfile?.evidence_count||0};
  if(routeMatches.length)return {qualified:true,score:42,tier:'CATEGORY_CHANNEL_CANDIDATE',reason:`${routeMatches.join(', ')} is a viable route for this product category; confirm the account assortment before outreach`,evidence_status:'RESEARCH_REQUIRED',evidence_count:evidenceProfile?.evidence_count||0};
  if(channelOverlap.length)return {qualified:false,score:0,tier:'CHANNEL_ONLY',reason:'Channel alignment alone is insufficient without category or assortment fit',evidence_status:'INSUFFICIENT',evidence_count:evidenceProfile?.evidence_count||0};
  return {qualified:false,score:0,tier:accountTerms.length?'NO_CATEGORY_FIT':'INSUFFICIENT_DATA',reason:accountTerms.length?'No relevant category or verified assortment signal':'Account has no category or verified assortment profile',evidence_status:evidenceProfile?.verified?'VERIFIED_NO_MATCH':'INSUFFICIENT',evidence_count:evidenceProfile?.evidence_count||0};
}
