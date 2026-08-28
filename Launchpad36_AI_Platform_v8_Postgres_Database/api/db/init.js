
import { db } from '../../lib/db.js';
import fs from 'node:fs';
import path from 'node:path';
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const secret=process.env.ADMIN_SECRET||'';
  if(!secret || req.headers.authorization!==`Bearer ${secret}`) return res.status(401).json({error:'Unauthorized'});
  try{
    const sql=db();
    const schema=fs.readFileSync(path.join(process.cwd(),'database','schema.sql'),'utf8');
    await sql.unsafe(schema);
    res.status(200).json({initialized:true});
  }catch(e){res.status(500).json({error:e.message})}
}
