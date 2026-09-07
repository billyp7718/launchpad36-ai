import { db } from './_db.js';
import { requireAdmin } from './_auth.js';

const CHANNELS=[
  ['national_retail','National Retail'],['regional_retail','Regional Retail'],['independent_retail','Independent Retail'],
  ['convenience_travel','Convenience & Travel'],['12v','12V / Automotive Specialty'],['ci','CI / Custom Integration'],
  ['ecommerce','E-commerce / Marketplace'],['distribution','Distribution']
];

const ORGANIZATIONS=[
  ['Wawa','wawa.com',['convenience_travel','regional_retail']],['Sheetz','sheetz.com',['convenience_travel','regional_retail']],
  ['7-Eleven','7-eleven.com',['convenience_travel','national_retail']],['Circle K','circlek.com',['convenience_travel','national_retail']],
  ["Casey's",'caseys.com',['convenience_travel','regional_retail']],['QuikTrip','quiktrip.com',['convenience_travel','regional_retail']],
  ['RaceTrac','racetrac.com',['convenience_travel','regional_retail']],['Murphy USA','murphyusa.com',['convenience_travel','national_retail']],
  ["Love's Travel Stops",'loves.com',['convenience_travel','national_retail']],['Pilot Flying J','pilotflyingj.com',['convenience_travel','national_retail']],
  ['TravelCenters of America','ta-petro.com',['convenience_travel','national_retail']],['Buc-ee’s','buc-ees.com',['convenience_travel','regional_retail']],
  ['Maverik','maverik.com',['convenience_travel','regional_retail']],['Kwik Trip','kwiktrip.com',['convenience_travel','regional_retail']],
  ['Cumberland Farms','cumberlandfarms.com',['convenience_travel','regional_retail']],['Rutter’s','rutters.com',['convenience_travel','regional_retail']],
  ['Royal Farms','royalfarms.com',['convenience_travel','regional_retail']],['Thorntons','mythorntons.com',['convenience_travel','regional_retail']],
  ['Hudson','hudsongroup.com',['convenience_travel','national_retail']],['Paradies Lagardère','paradieslagardere.com',['convenience_travel','national_retail']],
  ['InMotion','inmotionstores.com',['convenience_travel','national_retail','ce']],['WHSmith North America','whsmithnorthamerica.com',['convenience_travel','national_retail']],
  ['Crutchfield','crutchfield.com',['12v','ecommerce','national_retail']],['Sonic Electronix','sonicelectronix.com',['12v','ecommerce']],
  ['Car Toys','cartoys.com',['12v','regional_retail']],['Audio Express','audioexpress.com',['12v','regional_retail']],
  ['Tint World','tintworld.com',['12v','national_retail']],['Freeman’s Car Stereo','freemanscarstereo.com',['12v','regional_retail']],
  ['Starpower','star-power.com',['ci','regional_retail','specialty_av']],['Audio Advice','audioadvice.com',['ci','specialty_av','ecommerce']],
  ['World Wide Stereo','wwstereo.com',['ci','specialty_av','ecommerce']],['ListenUp','listenup.com',['ci','regional_retail','specialty_av']],
  ['Gramophone','gramophone.com',['ci','regional_retail','specialty_av']],['Bjorn’s','bjorns.com',['ci','regional_retail','specialty_av']],
  ['Definitive','definitive.com',['ci','regional_retail','specialty_av']]
];

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res))return;
  const sql=db();
  try{
    for(const [code,name] of CHANNELS)await sql`insert into channels(code,name) values(${code},${name}) on conflict(code) do update set name=excluded.name,active=true`;
    let added=0,updated=0;
    for(const [name,domain,channels] of ORGANIZATIONS){
      const existing=(await sql`select id,channel_codes from retail_organizations where lower(name)=lower(${name}) limit 1`)[0];
      if(existing){
        const merged=[...new Set([...(existing.channel_codes||[]),...channels])];
        await sql`update retail_organizations set domain=case when coalesce(domain,'')='' then ${domain} else domain end,channel_codes=${merged},source_url=case when coalesce(source_url,'')='' then ${'https://'+domain} else source_url end,updated_at=now() where id=${existing.id}`;
        updated++;
      }else{
        await sql`insert into retail_organizations(name,domain,organization_type,channel_codes,coverage,ecommerce,verification_status,source_url,confidence) values(${name},${domain},'retailer',${channels},'United States',${channels.includes('ecommerce')},'DISCOVERY_CANDIDATE',${'https://'+domain},70)`;
        added++;
      }
    }
    return res.status(200).json({synced:true,channels:CHANNELS.length,organizations:ORGANIZATIONS.length,added,updated});
  }catch(e){console.error('channel universe sync failed',{message:e?.message||String(e)});return res.status(500).json({error:'Expanded channel universe could not be synchronized'})}
}
