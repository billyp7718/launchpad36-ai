import { db } from './_db.js';
import { requireInternal } from './_auth.js';
import { scanOpportunityAlerts } from './_opportunity-alerts.js';

export async function runOpportunityAlertRefresh(sql){const manufacturers=await sql`select distinct manufacturer_id from opportunity_workspaces where manufacturer_id is not null limit 100`;const results=[];for(const row of manufacturers){try{results.push({manufacturer_id:row.manufacturer_id,...await scanOpportunityAlerts({manufacturerId:row.manufacturer_id,limit:200,sql})})}catch(e){results.push({manufacturer_id:row.manufacturer_id,error:String(e.message||e)})}}return {status:'COMPLETE',manufacturers:results.length,results}}

export default async function handler(req,res){if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});if(!requireInternal(req,res))return;const sql=db();try{return res.status(200).json(await runOpportunityAlertRefresh(sql))}catch(e){console.error('opportunity alert refresh failed',{message:e?.message||String(e)});return res.status(500).json({error:'Opportunity alert refresh failed'})}}
