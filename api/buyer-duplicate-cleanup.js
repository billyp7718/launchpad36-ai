import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { CAPABILITIES, requireCapability } from './_permissions.js';

const clean=value=>String(value??'').trim().toLowerCase();
const nameKey=value=>clean(value).replace(/[^a-z0-9]+/g,'');
const profileKey=value=>clean(value).split(/[?#]/,1)[0].replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');

function completeness(b){
  const fields=['title','department','category_scope','subcategory_scope','buyer_role','email','phone','linkedin','source_url','source','notes','category_evidence_url','employment_evidence_url'];
  return fields.reduce((n,k)=>n+(String(b[k]||'').trim()?1:0),0)+
    Number(b.identity_confidence||0)/100+Number(b.category_confidence||0)/100+
    (b.category_verification_status==='VERIFIED'?4:0)+(b.employment_verification_status==='VERIFIED'?4:0);
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(!requireCapability(tenant,res,CAPABILITIES.BUYER_INTELLIGENCE_ADMIN))return;
  const sql=db();
  try{
    const result=await sql.begin(async tx=>{
      await tx`alter table buyers add column if not exists merged_into_buyer_id uuid references buyers(id) on delete restrict`;
      await tx`alter table buyers add column if not exists merged_at timestamptz`;
      const rows=await tx`select b.* from buyers b where b.merged_into_buyer_id is null order by b.account_id,b.updated_at desc`;
      const groups=new Map();
      for(const b of rows){
        const identity=profileKey(b.linkedin)?'profile:'+profileKey(b.linkedin):nameKey(b.name)?'name:'+nameKey(b.name):'';
        if(!identity)continue;
        const key=String(b.account_id)+'|'+identity;
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(b);
      }
      let merged=0,groupsMerged=0;
      const details=[];
      for(const [key,group] of groups){
        if(group.length<2)continue;
        group.sort((a,b)=>completeness(b)-completeness(a)||new Date(b.updated_at||0)-new Date(a.updated_at||0));
        const [winner,...losers]=group;
        let current=winner;
        for(const loser of losers){
          const updated=(await tx`update buyers set
            name=case when length(trim(coalesce(name,'')))>=length(trim(coalesce(${loser.name},''))) then name else ${loser.name} end,
            title=coalesce(nullif(title,''),${loser.title}),
            email=coalesce(nullif(email,''),${loser.email}),
            phone=coalesce(nullif(phone,''),${loser.phone}),
            linkedin=coalesce(nullif(linkedin,''),${loser.linkedin}),
            category=coalesce(nullif(category,''),${loser.category}),
            department=coalesce(nullif(department,''),${loser.department}),
            category_scope=coalesce(nullif(category_scope,''),${loser.category_scope}),
            subcategory_scope=coalesce(nullif(subcategory_scope,''),${loser.subcategory_scope}),
            buyer_role=case when buyer_role in('','UNCONFIRMED') then ${loser.buyer_role} else buyer_role end,
            source=coalesce(nullif(source,''),${loser.source}),
            source_url=coalesce(nullif(source_url,''),${loser.source_url}),
            employment_evidence_url=coalesce(nullif(employment_evidence_url,''),${loser.employment_evidence_url}),
            category_evidence_url=coalesce(nullif(category_evidence_url,''),${loser.category_evidence_url}),
            email_source_url=coalesce(nullif(email_source_url,''),${loser.email_source_url}),
            email_evidence_quote=coalesce(nullif(email_evidence_quote,''),${loser.email_evidence_quote}),
            email_source_type=coalesce(nullif(email_source_type,''),${loser.email_source_type}),
            email_verification_status=case when email_verification_status in('','NOT_FOUND') then ${loser.email_verification_status} else email_verification_status end,
            email_last_verified=coalesce(email_last_verified,${loser.email_last_verified}),
            confidence=greatest(coalesce(confidence,0),coalesce(${loser.confidence},0)),
            identity_confidence=greatest(coalesce(identity_confidence,0),coalesce(${loser.identity_confidence},0)),
            category_confidence=greatest(coalesce(category_confidence,0),coalesce(${loser.category_confidence},0)),
            employment_verification_status=case when employment_verification_status in('','UNCONFIRMED') then ${loser.employment_verification_status} else employment_verification_status end,
            category_verification_status=case when category_verification_status in('','UNCONFIRMED') then ${loser.category_verification_status} else category_verification_status end,
            verified_at=coalesce(verified_at,${loser.verified_at}),
            last_verified_at=coalesce(last_verified_at,${loser.last_verified_at}),
            category_last_verified=coalesce(category_last_verified,${loser.category_last_verified}),
            employment_last_verified=coalesce(employment_last_verified,${loser.employment_last_verified}),
            observed_at=greatest(coalesce(observed_at,'-infinity'::timestamptz),coalesce(${loser.observed_at},'-infinity'::timestamptz)),
            notes=case when coalesce(notes,'')='' then coalesce(${loser.notes},'') when coalesce(${loser.notes},'')='' or position(${loser.notes} in notes)>0 then notes else notes||E'\n\n'||${loser.notes} end,
            updated_at=now()
            where id=${winner.id} returning *`)[0];
          if(!updated)throw new Error('Buyer merge winner could not be updated');
          current=updated;
          await tx`update buyers set merged_into_buyer_id=${winner.id},merged_at=now(),status='Merged',updated_at=now() where id=${loser.id} and merged_into_buyer_id is null`;
          await tx`update buyer_intelligence_import_items set buyer_id=${winner.id} where buyer_id=${loser.id}`;
          await tx`update buyer_intelligence_audit_events set buyer_id=${winner.id} where buyer_id=${loser.id}`;
          merged++;
        }
        groupsMerged++;
        details.push({account_id:winner.account_id,buyer:winner.name,merged:losers.map(x=>x.id),kept:winner.id});
      }
      await tx`create unique index if not exists buyers_active_linkedin_identity_uq on buyers(account_id,lower(regexp_replace(trim(trailing '/' from linkedin),'^https?://(www\\.)?',''))) where merged_into_buyer_id is null and coalesce(linkedin,'')<>''`;
      return {groups_merged:groupsMerged,buyers_merged:merged,details};
    });
    return res.status(200).json({ok:true,...result});
  }catch(error){
    console.error('buyer duplicate cleanup failed',{message:error?.message||String(error)});
    return res.status(500).json({error:'Buyer duplicate cleanup failed; no partial merges were committed'});
  }
}
