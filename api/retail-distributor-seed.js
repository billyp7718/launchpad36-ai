import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

const d=(name,domain,channels,categories)=>({name,domain,channels,categories});

export const RETAIL_DISTRIBUTORS=[
  d('TD SYNNEX','tdsynnex.com',['distribution','consumer_electronics','ce','ecommerce'],['Consumer Electronics','Computers','Mobile','Gaming','Pro AV','Networking','Smart Home']),
  d('Ingram Micro','ingrammicro.com',['distribution','consumer_electronics','ecommerce'],['Consumer Electronics','Computers','Mobile','Gaming','Pro AV','Networking','Smart Home']),
  d('D&H Distributing','dhdistributing.com',['distribution','consumer_electronics','ce','ecommerce'],['Consumer Electronics','Computers','Gaming','Home Electronics','Networking','Smart Home','Sports & Recreation']),
  d('Petra Industries','petra.com',['distribution','consumer_electronics','ce','ecommerce','automotive'],['Consumer Electronics','Audio','Mobile Accessories','Smart Home','Appliances','Automotive Electronics','Outdoor','Office']),
  d('Exertis Almo','exertisalmo.com',['distribution','consumer_electronics','specialty_av','ecommerce'],['Pro AV','Displays','Audio','Appliances','Consumer Electronics','Digital Signage','Hospitality']),
  d('ADI Global Distribution','adiglobaldistribution.us',['distribution','specialty_av','consumer_electronics'],['Pro AV','Audio','Video','Smart Home','Security','Networking','Automation']),
  d('Arrow Electronics','arrow.com',['distribution','ecommerce'],['Computers','Components','Networking','Displays','Embedded Technology','IoT']),
  d('Avnet','avnet.com',['distribution','ecommerce'],['Computers','Components','Displays','Embedded Technology','IoT','Networking']),
  d('ScanSource','scansource.com',['distribution','specialty_av','ecommerce'],['Pro AV','Communications','Mobility','Point of Sale','Security','Networking']),
  d('ASI Corporation','asipartner.com',['distribution','consumer_electronics','ecommerce'],['Computers','Components','Gaming','Displays','Networking','Accessories']),
  d('Ma Labs','malabs.com',['distribution','consumer_electronics','ecommerce'],['Computers','Components','Gaming','Displays','Networking','Accessories']),
  d('BlueStar','bluestarinc.com',['distribution','ecommerce'],['Point of Sale','Mobility','Digital Signage','RFID','Networking','Displays']),
  d('JB&A Distribution','jbanda.com',['distribution','specialty_av','ecommerce'],['Pro AV','Audio','Video','Broadcast','Storage','Digital Signage']),
  d('Starin','starin.biz',['distribution','specialty_av'],['Pro AV','Audio','Video','Collaboration','Digital Signage','Unified Communications']),
  d('Midwich US','midwich.us',['distribution','specialty_av'],['Pro AV','Audio','Video','Displays','Digital Signage','Broadcast']),
  d('Herman ProAV','hermanproav.com',['distribution','specialty_av'],['Pro AV','Audio','Video','Cables','Connectivity','Infrastructure']),
  d('Wesco','wesco.com',['distribution','specialty_av'],['Pro AV','Security','Networking','Connectivity','Electrical','Infrastructure']),
  d('Snap One','snapone.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('WAVE Electronics','wave-electronics.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('Volutone','volutone.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('21st Century Distributing','21stcenturydist.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('Mountain West Distributors','mwd1.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('Davis Distribution Systems','davisdistribution.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('Ultimate Integration','uisupplies.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('Electronic Custom Distributors','ecdcom.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation','TV Mounts']),
  d('Blackwire Designs','blackwiredesigns.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Automation','Control Systems']),
  d('Skywalker AV Supply','skywalker.com',['distribution','specialty_av','ecommerce'],['Audio','Video','TV Mounts','Cables','Connectivity','Networking','Security']),
  d('DOW Technologies','dowtechnologies.com',['distribution','specialty_av','automotive','dealer'],['Audio','Video','Automotive Electronics','Smart Home','Networking','Security']),
  d('Pioneer Music Company','pioneermusiccompany.com',['distribution','specialty_av','dealer'],['Audio','Video','Smart Home','Networking','Security','Automation']),
  d('C&E Marketing','cemarketing.com',['distribution','consumer_electronics','specialty_av'],['Audio','Video','Consumer Electronics','Smart Home','Headphones','Accessories']),
  d('Sierra Select Distributors','sierraselect.com',['distribution','consumer_electronics','specialty_av'],['Audio','Video','Consumer Electronics','Smart Home','Networking','Automation']),
  d('Audio America','audioamerica.com',['distribution','consumer_electronics','specialty_av'],['Audio','Video','Consumer Electronics','Smart Home','Automotive Electronics']),
  d('Specialty Marketing','specialtymarketing.com',['distribution','consumer_electronics','specialty_av'],['Audio','Video','Consumer Electronics','Smart Home','Networking']),
  d('Hypercel','hypercel.com',['distribution','consumer_electronics','ecommerce'],['Mobile Accessories','Audio','Charging','Wearables','Consumer Electronics']),
  d('Mobileistic','mobileistic.com',['distribution','consumer_electronics','ecommerce'],['Mobile Accessories','Audio','Charging','Wearables','Consumer Electronics']),
  d('DGL Group','dglusa.com',['distribution','consumer_electronics','ecommerce'],['Consumer Electronics','Audio','Mobile Accessories','Smart Home','Personal Care','Outdoor']),
  d('PCS Wireless','pcsww.com',['distribution','consumer_electronics','ecommerce'],['Mobile Phones','Tablets','Wearables','Mobile Accessories','Consumer Electronics']),
  d('Alliance Corporation','alliancecorporation.ca',['distribution','consumer_electronics'],['Wireless','Mobile Accessories','Networking','IoT','Communications']),
  d('Tessco Technologies','tessco.com',['distribution','consumer_electronics','ecommerce'],['Wireless','Mobile Accessories','Networking','IoT','Communications']),
  d('Essendant','essendant.com',['distribution','office','ecommerce'],['Office Products','Office Furniture','Technology','Breakroom','Janitorial','Industrial Supplies']),
  d('S.P. Richards','sprichards.com',['distribution','office','ecommerce'],['Office Products','Office Furniture','Technology','Breakroom','Janitorial']),
  d('Supplies Network','suppliesnetwork.com',['distribution','office','ecommerce'],['Office Technology','Printers','Imaging','Office Supplies','IT Accessories']),
  d('Climatic Home Products','climatic.com',['distribution','appliances','ecommerce'],['Major Appliances','Outdoor Appliances','Home Products','Consumer Electronics']),
  d('Meyer Distributing','meyerdistributing.com',['distribution','automotive','ecommerce'],['Automotive Accessories','Towing','RV','Powersports','Outdoor','Truck Accessories']),
  d('Keystone Automotive Operations','keystoneautomotive.com',['distribution','automotive','ecommerce'],['Automotive Accessories','Performance Parts','RV','Truck Accessories','Wheels & Tires']),
  d('Turn 14 Distribution','turn14.com',['distribution','automotive','ecommerce'],['Automotive Performance','Powersports','Wheels & Tires','Truck Accessories']),
  d('Western Power Sports','wps-inc.com',['distribution','automotive','ecommerce'],['Powersports','Motorcycle Accessories','Outdoor','Apparel','Parts']),
  d('Parts Unlimited','parts-unlimited.com',['distribution','automotive','ecommerce'],['Powersports','Motorcycle Accessories','Audio','Apparel','Parts']),
  d('NPW Companies','npwcompanies.com',['distribution','automotive','ecommerce'],['Automotive Parts','Performance Parts','Truck Accessories','Tools','Accessories']),
  d('Parts Authority','partsauthority.com',['distribution','automotive','ecommerce'],['Automotive Parts','Tools','Accessories','Chemicals','Shop Equipment'])
];

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  const sql=db();let imported=0;
  try{
    for(const row of RETAIL_DISTRIBUTORS){
      await sql`insert into retail_organizations(name,domain,organization_type,channel_codes,categories,coverage,region,footprint,ecommerce,verification_status,source_url,confidence,updated_at)
        values(${row.name},${row.domain},'distributor',${row.channels},${row.categories},'US retail and reseller channels','United States',0,true,'DISCOVERY_CANDIDATE',${`https://${row.domain}`},60,now())
        on conflict(lower(name)) do update set domain=excluded.domain,organization_type='distributor',channel_codes=excluded.channel_codes,categories=excluded.categories,coverage=excluded.coverage,region=excluded.region,ecommerce=excluded.ecommerce,source_url=excluded.source_url,updated_at=now()`;
      imported++;
    }
    return res.status(200).json({version:'9.8.3',imported,total:RETAIL_DISTRIBUTORS.length,status:'DISCOVERY_CANDIDATE',buyer_data:'Use account-level buyer research by selected category; named contacts are saved only with attributable evidence.'});
  }catch(error){console.error('retail distributor seed failed',{message:error?.message||String(error)});return res.status(500).json({error:'Retail distributor accounts could not be added'})}
}
