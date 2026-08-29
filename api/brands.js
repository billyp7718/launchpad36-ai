import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
export default async function handler(req,res){const t=await resolveTenant(req,res);if(!t)return;const sql=db();try{
 if(req.method==='GET'){const rows=await sql`select * from brands where manufacturer_id=${t.tenant_id} and active=true order by name`;return res.status(200).json({brands:rows})}
 if(req.method==='POST'){const b=req.body||{};if(!String(b.name||'').trim())return res.status(400).json({error:'brand name is required'});const row=(await sql`insert into brands(manufacturer_id,name,website,logo_url,description,active,updated_at) values(${t.tenant_id},${b.name.trim()},${b.website||''},${b.logo_url||''},${b.description||''},true,now()) on conflict(manufacturer_id,name) do update set website=excluded.website,logo_url=excluded.logo_url,description=excluded.description,active=true,updated_at=now() returning *`)[0];return res.status(200).json({brand:row})}
 return res.status(405).json({error:'Method not allowed'});
}catch(e){return res.status(500).json({error:e.message})}}
