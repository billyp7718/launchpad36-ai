import fs from 'fs';
import path from 'path';
import { db } from './_db.js';
import { seedHighEndAudio } from './_high-end-audio-seed.js';
import { seedAceHardware } from './_ace-hardware-seed.js';

export default async function handler(req,res){
  try{
    try{await seedHighEndAudio(db())}catch(seedError){console.error('high-end audio seed failed',{message:seedError?.message||String(seedError)})}
    try{await seedAceHardware(db())}catch(seedError){console.error('Ace Hardware seed failed',{message:seedError?.message||String(seedError)})}
    const htmlPath=path.join(process.cwd(),'index.html');
    let html=fs.readFileSync(htmlPath,'utf8');
    const scripts=[
      '/executive-workflow-ui.js',
      '/buyer-coverage-ui.js',
      '/route-fit-ui.js',
      '/deep-buyer-search-ui-v3.js',
      '/buyer-category-intelligence-ui.js',
      '/assortment-intelligence-ui.js',
      '/opportunity-alerts-ui.js',
      '/multi-user-ui.js',
      '/phase2-tenancy-ui.js',
      '/crm-export-ui.js',
      '/user-login-recovery-ui.js',
      '/commercial-ui-polish.js',
      '/retail-industry-news-ui.js',
      '/market-opportunity-controls-ui.js',
      '/pitch-deck-ui.js'
    ].map(src=>`<script src="${src}" defer></script>`).join('');
    const marker='</body>';
    const index=html.lastIndexOf(marker);
    if(index<0)throw new Error('Document body close tag not found');
    html=html.slice(0,index)+scripts+html.slice(index);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store, max-age=0');
    return res.status(200).send(html);
  }catch(e){
    console.error('app shell failed',{message:e?.message||String(e)});
    return res.status(500).send('Launchpad36 AI could not load');
  }
}
