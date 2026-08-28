
import { db } from '../../lib/db.js';
export default async function handler(req,res){
  try{
    const sql=db();
    const result=await sql`select current_database() as database, now() as server_time`;
    const tables=await sql`select count(*)::int as count from information_schema.tables where table_schema='public' and table_name in ('accounts','buyers','products','product_variants','competitive_products','retail_observations','opportunity_scores','refresh_runs','change_events')`;
    res.status(200).json({connected:true,database:result[0].database,server_time:result[0].server_time,core_tables:tables[0].count});
  }catch(e){res.status(503).json({connected:false,error:e.message})}
}
