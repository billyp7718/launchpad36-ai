const clean=(value,max=240)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const words=value=>new Set(clean(value).toLowerCase().split(/[^a-z0-9]+/).filter(token=>token.length>1));
export function normalizeIdentifier(type,value){const kind=String(type||'').toUpperCase(),raw=clean(value,180).toUpperCase();return ['UPC','GTIN','EAN'].includes(kind)?raw.replace(/\D/g,''):raw.replace(/[^A-Z0-9]/g,'')}
const identifiers=record=>{const out=new Map();for(const [key,value] of Object.entries(record?.identifiers||{})){const type=String(key).toUpperCase(),normalized=normalizeIdentifier(type,value);if(normalized)out.set(type,normalized)}for(const key of ['manufacturer_sku','retailer_sku','upc','gtin','ean','mpn','model']){const value=record?.[key],type=key.toUpperCase();if(value&&normalizeIdentifier(type,value))out.set(type,normalizeIdentifier(type,value))}return out};
const similarity=(left,right)=>{const a=words(left),b=words(right);if(!a.size||!b.size)return 0;const intersection=[...a].filter(value=>b.has(value)).length;return Math.round(intersection/new Set([...a,...b]).size*100)};

export function evaluateProductIdentityMatch(canonical={},listing={}){
  const left=identifiers(canonical),right=identifiers(listing),reasons=[],conflicts=[];let confidence=0,method='INSUFFICIENT_IDENTIFIERS';
  for(const type of ['GTIN','UPC','EAN'])if(left.has(type)&&right.has(type)){if(left.get(type)===right.get(type)){confidence=99;method=`EXACT_${type}`;reasons.push(`Exact ${type} match`)}else conflicts.push(`${type} values conflict`)}
  const brandMatch=normalizeIdentifier('BRAND',canonical.brand_name||canonical.brand)===normalizeIdentifier('BRAND',listing.brand_name||listing.brand);
  for(const [type,score] of [['MANUFACTURER_SKU',96],['MPN',94],['MODEL',88]])if(confidence<score&&left.has(type)&&right.has(type)&&left.get(type)===right.get(type)&&brandMatch){confidence=score;method=`EXACT_${type}_AND_BRAND`;reasons.push(`Exact ${type} and brand match`)}else if(left.has(type)&&right.has(type)&&left.get(type)!==right.get(type))conflicts.push(`${type} values conflict`);
  const nameSimilarity=similarity(canonical.name,listing.product_name||listing.name),categorySimilarity=similarity(canonical.category,listing.category);
  if(!confidence&&brandMatch&&nameSimilarity>=70){confidence=Math.min(64,45+Math.round(nameSimilarity*.15)+Math.round(categorySimilarity*.04));method='NAME_SIMILARITY_REVIEW';reasons.push('Brand and product names are similar, but identifiers are insufficient')}
  if(conflicts.length)confidence=Math.min(confidence||20,20);
  return {product_match_confidence:confidence,product_match_method:method,reasons,conflicts,auto_link_allowed:confidence>=92&&!conflicts.length,verification_status:confidence>=92&&!conflicts.length?'PROBABLE':'NEEDS_RESEARCH'};
}
