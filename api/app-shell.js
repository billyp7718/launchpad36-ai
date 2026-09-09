import fs from 'fs';
import path from 'path';

export default function handler(req,res){
  try{
    const htmlPath=path.join(process.cwd(),'index.html');
    let html=fs.readFileSync(htmlPath,'utf8');
    // Keep the proven static application as the base. Load only the canonical
    // enhancement layers as external files so script contents can never break
    // the HTML parser and superseded v1/v2 overrides are not executed.
    const scripts=[
      '/executive-workflow-ui.js',
      '/buyer-coverage-ui.js',
      '/route-fit-ui.js',
      '/deep-buyer-search-ui-v3.js'
    ].map(src=>`<script src="${src}" defer></script>`).join('');
    html=html.replace('</body>',`${scripts}</body>`);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store, max-age=0');
    return res.status(200).send(html);
  }catch(e){
    console.error('app shell failed',{message:e?.message||String(e)});
    return res.status(500).send('Launchpad36 AI could not load');
  }
}
