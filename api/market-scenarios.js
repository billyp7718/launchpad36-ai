import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';

const clean=(value,max=180)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const ROUTES=new Set(['retail','direct_b2b','distributor_dealer','mixed']);

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;const sql=db();
  try{
    if(req.method==='GET'){
      const rows=await sql`select id,name,route_to_market,product_ids,assumptions,result_snapshot,created_at,updated_at from market_opportunity_scenarios where manufacturer_id=${tenant.tenant_id} order by updated_at desc limit 100`;
      return res.status(200).json({scenarios:rows});
    }
    if(req.method==='DELETE'){
      const id=clean(req.query?.id||req.body?.id,80);if(!id)return res.status(400).json({error:'Scenario id is required'});
      const row=(await sql`delete from market_opportunity_scenarios where id=${id} and manufacturer_id=${tenant.tenant_id} returning id`)[0];if(!row)return res.status(404).json({error:'Saved scenario was not found'});
      return res.status(200).json({deleted:true,id:row.id});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const name=clean(req.body?.name),result=req.body?.result_snapshot,route=clean(req.body?.route_to_market||result?.assumptions?.route_to_market,40).toLowerCase(),productIds=[...new Set((req.body?.product_ids||result?.selected_products?.map(p=>p.id)||[]).map(String).filter(Boolean))].slice(0,100);
    if(!name)return res.status(400).json({error:'Scenario name is required'});if(!ROUTES.has(route))return res.status(400).json({error:'Scenario route is not supported'});if(!result||typeof result!=='object'||Array.isArray(result))return res.status(400).json({error:'A completed market analysis is required'});
    const id=clean(req.body?.id,80),row=id
      ?(await sql`update market_opportunity_scenarios set name=${name},route_to_market=${route},product_ids=${sql.json(productIds)},assumptions=${sql.json(result.assumptions||{})},result_snapshot=${sql.json(result)},updated_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id} returning *`)[0]
      :(await sql`insert into market_opportunity_scenarios(manufacturer_id,name,route_to_market,product_ids,assumptions,result_snapshot) values(${tenant.tenant_id},${name},${route},${sql.json(productIds)},${sql.json(result.assumptions||{})},${sql.json(result)}) returning *`)[0];
    if(!row)return res.status(404).json({error:'Saved scenario was not found'});return res.status(id?200:201).json({scenario:row});
  }catch(error){
    console.error('market scenario operation failed',{message:error?.message||String(error)});
    if(error?.code==='42P01')return res.status(409).json({error:'Market scenario storage is not initialized. Run the System Status database update.',code:'SCHEMA_REQUIRED'});
    return res.status(500).json({error:'Market scenario operation could not be completed'});
  }
}
