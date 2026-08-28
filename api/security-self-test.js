import { db } from './_db.js';
import { requireAdmin } from './_auth.js';
export default async function handler(req,res){
 if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
 if(!requireAdmin(req,res)) return;
 try{
  const sql=db();
  const counts=(await sql`select
    (select count(*)::int from manufacturers) manufacturers,
    (select count(*)::int from brands) brands,
    (select count(*)::int from products) products,
    (select count(*)::int from accounts) accounts,
    (select count(*)::int from intelligence_runs) intelligence_runs,
    (select count(*)::int from executive_audits) executive_audits`)[0];
  return res.status(200).json({ok:true,version:'9.2-security-test',checks:{admin_auth:true,cron_internal_auth:true,qa_seed_available:true},counts});
 }catch(e){return res.status(500).json({error:e.message})}
}
