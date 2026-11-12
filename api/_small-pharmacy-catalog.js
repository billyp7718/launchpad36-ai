import { createHash } from 'node:crypto';

export const SMALL_PHARMACY_CATALOG_VERSION='2026-11-11-v1';
const observedAt='2026-11-11T00:00:00.000Z';
const channels=['independent_pharmacy','pharmacy','drug'];
const categories=['Pharmacy','OTC Health','Wellness','Personal Care','Home Health'];

const buyer=(name,title,source_url,overrides={})=>({
  name,title,department:'Pharmacy Operations',category_scope:'',subcategory_scope:'',buyer_role:'EXECUTIVE',
  public_profile_url:'',source_url,category_evidence_url:'',source_type:'trade_publication',
  observed_at:observedAt,last_verified_at:observedAt,identity_confidence:85,category_confidence:0,
  employment_verification_status:'VERIFIED',category_verification_status:'UNCONFIRMED',...overrides
});
const pharmacy=(name,domain,headquarters,footprint,source_url,buyers,overrides={})=>({
  name,domain,website:`https://${domain}`,headquarters,footprint,source_url,
  organization_type:footprint===1?'independent_pharmacy':'small_pharmacy_chain',
  channel_codes:channels,categories,coverage:'United States',region:'United States',ecommerce:true,
  confidence:90,verification_status:'VERIFIED',last_verified_at:observedAt,buyers,...overrides
});

export const SMALL_PHARMACY_CATALOG=[
  pharmacy('Kinney Drugs','kinneydrugs.com','Gouverneur, NY',97,'https://chaindrugreview.com/spirit-of-ownership-sets-kinneys-culture-apart/',[
    buyer('Katie Niles, PharmD','Vice President of Merchandising and Marketing','https://massmarketretailers.com/katie-niles/',{department:'Merchandising & Marketing',category_scope:'Pharmacy, Front-End Retail & Digital',subcategory_scope:'Health & Wellness; OTC; General Merchandise',buyer_role:'MERCHANDISING_LEADER',category_evidence_url:'https://massmarketretailers.com/katie-niles/',identity_confidence:92,category_confidence:90,category_verification_status:'VERIFIED'})
  ]),
  pharmacy('Thrifty White Pharmacy','thriftywhite.com','Maple Grove, MN',90,'https://chaindrugreview.com/thrifty-white-expands-clinical-services-and-community-impact/',[
    buyer('Tanya Schmidt','Vice President of Central Operations','https://ptcb.org/employer-stories/thrifty-white-pharmacy/',{public_profile_url:'https://www.linkedin.com/in/tanya-schmidt-453196133',department:'Central Pharmacy Operations',buyer_role:'EXECUTIVE',identity_confidence:88})
  ]),
  pharmacy('Lewis Drug','lewisdrug.com','Sioux Falls, SD',61,'https://www.lewisdrug.com/about',[
    buyer('Erin Bronemann','Category Manager','https://www.linkedin.com/in/erin-bronemann-b4454135a',{public_profile_url:'https://www.linkedin.com/in/erin-bronemann-b4454135a',department:'Merchandising',buyer_role:'UNCONFIRMED',source_type:'public_professional',identity_confidence:72,employment_verification_status:'PROBABLE'})
  ]),
  pharmacy('Discount Drug Mart','discount-drugmart.com','Medina, OH',78,'https://discount-drugmart.com/our-store/about-us/',[
    buyer('Todd Bahler','Vice President of Marketing and Grocery Buyer','https://www.cleveland.com/entertainment/2026/01/neo-consumers-are-replacing-sugary-sodas-alcohol-with-wellness-drinks.html',{public_profile_url:'https://www.linkedin.com/in/todd-bahler-62338618b',department:'Marketing & Grocery',category_scope:'Grocery & Wellness Beverages',subcategory_scope:'Functional Beverages; Grocery',buyer_role:'DIRECT_BUYER',category_evidence_url:'https://www.cleveland.com/entertainment/2026/01/neo-consumers-are-replacing-sugary-sodas-alcohol-with-wellness-drinks.html',identity_confidence:90,category_confidence:92,category_verification_status:'VERIFIED'})
  ]),
  pharmacy('Hartig Drug','hartigdrug.com','Dubuque, IA',24,'https://www.hartigdrug.com/about',[
    buyer('Charlie Hartig','Chief Executive Officer','https://digitaledition.chaindrugreview.com/article/Hartig+Drug/4965674/844922/article.html',{public_profile_url:'https://www.linkedin.com/in/charleshartig',identity_confidence:92})
  ]),
  pharmacy('Hayat Pharmacy','hayatrx.com','Milwaukee, WI',17,'https://www.hayatrx.com/',[
    buyer('Hashim Zaibak','Founder and Pharmacy Owner','https://ncpa.org/leadership-team',{identity_confidence:92})
  ]),
  pharmacy('Good Day Pharmacy','gooddaypharmacy.com','Loveland, CO',10,'https://www.gooddaypharmacy.com/locations',[
    buyer('Vicki Einhellig','Chief Executive Officer','https://www.ipcrx.com/pharmacy-blog/ipc-updates/women-in-pharmacy-good-day-pharmacys-ceo/',{identity_confidence:78,employment_verification_status:'PROBABLE'})
  ]),
  pharmacy('Moose Pharmacy','moosepharmacy.com','Concord, NC',7,'https://www.moosepharmacy.com/locations',[
    buyer('Ashley Moose, PharmD','Co-Owner and Pharmacy Manager','https://www.moosepharmacy.com/locations/monroe',{public_profile_url:'https://www.linkedin.com/in/ashley-moose-1971b89a',identity_confidence:92})
  ]),
  pharmacy('Condo Pharmacy','condopharmacy.com','Plattsburgh, NY',1,'https://www.condopharmacy.com/',[
    buyer('Steve Moore','Pharmacy Owner','https://ncpa.org/leadership-team',{identity_confidence:90})
  ],{ecommerce:false}),
  pharmacy('The Pharmacy at Wellington','thepharmacyatwellington.com','Little Rock, AR',1,'https://thepharmacyatwellington.com/about/',[
    buyer('Brittany Sanders, PharmD','Managing Partner and Pharmacist','https://thepharmacyatwellington.com/about/',{public_profile_url:'https://www.linkedin.com/in/brittany-sanders-pharm-d-237291123',identity_confidence:95})
  ]),
  pharmacy('Love Oak Pharmacy','loveoak.com','Eastland, TX',1,'https://www.loveoak.com/our-love-story',[
    buyer('Benjamin McNabb, PharmD','Co-Owner and Pharmacist','https://www.loveoak.com/our-love-story',{public_profile_url:'https://www.linkedin.com/in/benjamin-mcnabb',identity_confidence:95})
  ]),
  pharmacy('Tamarack Pharmacy','tamarackpharmacy.com','Spokane, WA',1,'https://tamarackpharmacy.com/about-us/',[
    buyer('Erik Nelson','Pharmacist and Owner','https://tamarackpharmacy.com/about-us/',{identity_confidence:95})
  ])
];

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export function smallPharmacyCatalogHash(value=SMALL_PHARMACY_CATALOG){return createHash('sha256').update(JSON.stringify(stable({version:SMALL_PHARMACY_CATALOG_VERSION,records:value}))).digest('hex')}
export function validateSmallPharmacyCatalog(rows=SMALL_PHARMACY_CATALOG){
  const errors=[],domains=new Set(),names=new Set();
  for(const row of rows){
    const domain=String(row.domain||'').toLowerCase(),name=String(row.name||'').toLowerCase();
    if(!name||!domain)errors.push(`${row.name||'Unnamed pharmacy'} requires a name and domain`);
    if(names.has(name)||domains.has(domain))errors.push(`${row.name} duplicates another pharmacy`);names.add(name);domains.add(domain);
    if(!Number.isInteger(row.footprint)||row.footprint<1||row.footprint>100)errors.push(`${row.name} must have between 1 and 100 locations`);
    if(!/^https:\/\//.test(row.source_url||''))errors.push(`${row.name} requires an attributable location-count source`);
    if(!row.channel_codes?.includes('independent_pharmacy'))errors.push(`${row.name} is missing the independent pharmacy channel`);
    if(!row.buyers?.length)errors.push(`${row.name} requires at least one public decision-maker record`);
    for(const contact of row.buyers||[]){
      if(!contact.name||!contact.title||!/^https:\/\//.test(contact.source_url||''))errors.push(`${row.name} has an incomplete decision-maker record`);
      if(contact.email||contact.phone||contact.public_email||contact.public_phone)errors.push(`${row.name} must not include inferred contact details`);
      if(contact.category_verification_status==='VERIFIED'&&(!contact.category_scope||!contact.category_evidence_url))errors.push(`${row.name} has verified category ownership without evidence`);
    }
  }
  return errors;
}
