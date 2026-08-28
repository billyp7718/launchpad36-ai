import { requireAdmin } from './_auth.js';
export default function handler(req,res){
 if(!requireAdmin(req,res)) return;
 if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
 const env=process.env;
 const providers={hubspot:['HUBSPOT_CLIENT_ID','HUBSPOT_CLIENT_SECRET'],salesforce:['SALESFORCE_CLIENT_ID','SALESFORCE_CLIENT_SECRET'],pipedrive:['PIPEDRIVE_CLIENT_ID','PIPEDRIVE_CLIENT_SECRET'],zoho:['ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET']};
 const out={}; for(const [k,keys] of Object.entries(providers)) out[k]={configured:keys.every(x=>Boolean(env[x])),missing:keys.filter(x=>!env[x])};
 return res.status(200).json(out);
}
