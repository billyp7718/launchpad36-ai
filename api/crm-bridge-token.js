import crypto from 'crypto';
import { db } from './_db.js';
import { requireAdmin, sessionData } from './_auth.js';
import { resolveTenant } from './_tenant.js';

async function ensure(sql){
  await sql`create table if not exists crm_bridge_tokens(
    id uuid primary key default gen_random_uuid(),
    manufacturer_id uuid not null references manufacturers(id) on delete cascade,
    label text not null default 'Launchpad36 CRM',
    token_hash text not null unique,
    token_prefix text not null,
    active boolean not null default true,
    created_by uuid references manufacturer_members(id) on delete set null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
  )`;
  await sql`create index if not exists crm_bridge_tokens_tenant_idx on crm_bridge_tokens(manufacturer_id,active,created_at desc)`;
}
const hash=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  const sql=db();
  try{
    await ensure(sql);
    if(req.method==='GET'){
      const rows=await sql`select id,label,token_prefix,active,created_at,last_used_at,revoked_at from crm_bridge_tokens where manufacturer_id=${tenant.tenant_id} order by created_at desc`;
      return res.status(200).json({tokens:rows,endpoint:'https://launchpad36-ai.vercel.app/api/crm-bridge-feed'});
    }
    if(req.method==='POST'){
      const action=String(req.body?.action||'create');
      if(action==='revoke'){
        const id=String(req.body?.id||'');
        await sql`update crm_bridge_tokens set active=false,revoked_at=now() where id=${id} and manufacturer_id=${tenant.tenant_id}`;
        return res.status(200).json({revoked:true});
      }
      const token='l36crm_'+crypto.randomBytes(32).toString('base64url');
      const prefix=token.slice(0,14);
      const row=(await sql`insert into crm_bridge_tokens(manufacturer_id,label,token_hash,token_prefix,created_by) values(${tenant.tenant_id},${String(req.body?.label||'Launchpad36 CRM').slice(0,120)},${hash(token)},${prefix},${sessionData(req)?.user_id||null}) returning id,label,token_prefix,created_at`)[0];
      return res.status(201).json({token,...row,endpoint:'https://launchpad36-ai.vercel.app/api/crm-bridge-feed'});
    }
    return res.status(405).json({error:'Method not allowed'});
  }catch(e){console.error('crm bridge token error',{message:e?.message||String(e)});return res.status(500).json({error:'CRM bridge token could not be managed'})}
}
