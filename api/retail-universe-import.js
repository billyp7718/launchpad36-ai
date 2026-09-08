import { db, upsertBuyer } from './_db.js';
import { requireAdmin } from './_auth.js';
import { domainFromWebsite, normalizePublicUrl } from './_url.js';

function list(v){
  if(Array.isArray(v)) return v.map(String).map(x=>x.trim()).filter(Boolean);
  return String(v||'').split(/[|;,]/).map(x=>x.trim()).filter(Boolean);
}
function clean(v){return String(v??'').trim()}
function num(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0}
function bool(v){
  if(typeof v==='boolean') return v;
  const s=clean(v).toLowerCase();
  if(['yes','y','true','1','online','ecommerce'].includes(s)) return true;
  if(['no','n','false','0'].includes(s)) return false;
  return Boolean(v);
}
function pick(r,...keys){for(const k of keys){if(r[k]!==undefined&&r[k]!==null&&String(r[k]).trim()!=='')return r[k]}return ''}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!requireAdmin(req,res)) return;
  const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
  if(!rows.length) return res.status(400).json({error:'rows are required'});

  const sql=db();
  let imported=0,buyersImported=0;
  const errors=[];
  const run=(await sql`insert into retail_universe_import_runs(source_name,rows_seen,status) values(${req.body?.source_name||''},${rows.length},'started') returning id`)[0];

  try{
    for(let i=0;i<rows.length;i++){
      const r=rows[i]||{};
      const name=clean(pick(r,'name','Retailer','Organization'));
      if(!name){errors.push({row:i+2,error:'name required'});continue}

      const rawSource=pick(r,'source_url','Source URL','domain','Domain');
      const sourceUrl=normalizePublicUrl(rawSource);
      const domain=domainFromWebsite(pick(r,'domain','Domain')||sourceUrl);
      const organizationType=clean(pick(r,'organization_type','type','Type'))||'retailer';
      const channels=list(pick(r,'channels','Channels'));
      const categories=list(pick(r,'categories','Categories'));
      const coverage=clean(pick(r,'coverage','Coverage'));
      const region=clean(pick(r,'region','Region'));
      const headquarters=clean(pick(r,'headquarters','Head Office Location','Headquarters'));
      const footprint=num(pick(r,'footprint','Location Count','Locations'));
      const ecommerce=bool(pick(r,'ecommerce','Ecommerce'));
      const confidence=num(pick(r,'confidence','Confidence'));
      const verificationStatus=clean(pick(r,'verification_status','Verification Status'))||'DISCOVERY_CANDIDATE';
      const lastVerified=pick(r,'last_verified','Last Verified')||null;

      const org=(await sql`
        insert into retail_organizations(name,domain,organization_type,channel_codes,categories,coverage,region,headquarters,footprint,ecommerce,verification_status,source_url,last_verified,confidence,updated_at)
        values(${name},${domain},${organizationType},${channels},${categories},${coverage},${region},${headquarters},${footprint},${ecommerce},${verificationStatus},${sourceUrl},${lastVerified},${confidence},now())
        on conflict(lower(name)) do update set
          domain=excluded.domain,
          organization_type=excluded.organization_type,
          channel_codes=excluded.channel_codes,
          categories=excluded.categories,
          coverage=excluded.coverage,
          region=excluded.region,
          headquarters=case when excluded.headquarters<>'' then excluded.headquarters else retail_organizations.headquarters end,
          footprint=case when excluded.footprint>0 then excluded.footprint else retail_organizations.footprint end,
          ecommerce=excluded.ecommerce,
          verification_status=excluded.verification_status,
          source_url=excluded.source_url,
          last_verified=excluded.last_verified,
          confidence=excluded.confidence,
          updated_at=now()
        returning *`)[0];

      const account=(await sql`
        insert into accounts(name,type,coverage,region,domain,category,potential,score,notes,source,organization_id,source_url,confidence,verification_status,updated_at)
        values(${name},${organizationType},${coverage},${region},${domain},${categories[0]||''},0,0,'','account_import',${org.id},${sourceUrl},${confidence},${verificationStatus},now())
        on conflict(lower(name)) do update set
          type=excluded.type,
          coverage=excluded.coverage,
          region=excluded.region,
          domain=excluded.domain,
          category=excluded.category,
          organization_id=excluded.organization_id,
          source_url=excluded.source_url,
          confidence=excluded.confidence,
          verification_status=excluded.verification_status,
          updated_at=now()
        returning *`)[0];

      const buyerName=clean(pick(r,'buyer','Buyer','buyer_name','Buyer Name'));
      const buyerTitle=clean(pick(r,'buyer_title','Buyer Title','title','Title'));
      const buyerEmail=clean(pick(r,'buyer_email','Buyer Email','email','Email'));
      const buyerPhone=clean(pick(r,'buyer_phone','Buyer Phone','phone','Phone'));
      const buyerLinkedin=clean(pick(r,'buyer_linkedin','Buyer LinkedIn','linkedin','LinkedIn'));
      const buyerCategory=clean(pick(r,'buyer_category','Buyer Category'))||categories[0]||'';

      if(buyerName){
        await upsertBuyer({
          account_id:account.id,
          name:buyerName,
          title:buyerTitle,
          email:buyerEmail,
          phone:buyerPhone,
          linkedin:buyerLinkedin,
          category:buyerCategory,
          source:'account_import',
          source_url:sourceUrl,
          confidence,
          verification_status:verificationStatus,
          evidence_type:'buyer'
        });
        buyersImported++;
      }

      imported++;
    }

    await sql`update retail_universe_import_runs set rows_imported=${imported},status='complete',errors=${sql.json(errors)},finished_at=now() where id=${run.id}`;
    return res.status(200).json({version:'9.8',rows_seen:rows.length,rows_imported:imported,buyers_imported:buyersImported,errors});
  }catch(e){
    console.error('retail universe import failed',{message:e?.message||String(e)});
    await sql`update retail_universe_import_runs set rows_imported=${imported},status='failed',errors=${sql.json([...errors,{error:e.message}])},finished_at=now() where id=${run.id}`.catch(()=>{});
    return res.status(500).json({error:e.message});
  }
}
