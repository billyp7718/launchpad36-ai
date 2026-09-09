import fs from 'fs';
import path from 'path';

export default function handler(req,res){
  try{
    const htmlPath=path.join(process.cwd(),'index.html');
    let html=fs.readFileSync(htmlPath,'utf8');
    const scripts=[
      '/executive-workflow-ui.js',
      '/buyer-coverage-ui.js',
      '/route-fit-ui.js',
      '/deep-buyer-search-ui-v3.js',
      '/assortment-intelligence-ui.js',
      '/opportunity-alerts-ui.js',
      '/multi-user-ui.js'
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
