import fs from 'fs';
import path from 'path';

const safeScript = source => String(source || '').replace(/<\/script/gi, '<\\/script');

export default function handler(req,res){
  try{
    const root=process.cwd();
    const htmlPath=path.join(root,'index.html');
    const channelUiPath=path.join(root,'channel-ui.js');
    const buyerUiPath=path.join(root,'buyer-contact-ui.js');
    const workflowUiPath=path.join(root,'executive-workflow-ui.js');
    const buyerCoverageUiPath=path.join(root,'buyer-coverage-ui.js');
    const routeFitUiPath=path.join(root,'route-fit-ui.js');
    const buyerRetryUiPath=path.join(root,'buyer-retry-ui.js');
    const deepBuyerUiPath=path.join(root,'deep-buyer-search-ui.js');
    const deepBuyerUiV2Path=path.join(root,'deep-buyer-search-ui-v2.js');
    const deepBuyerUiV3Path=path.join(root,'deep-buyer-search-ui-v3.js');
    let html=fs.readFileSync(htmlPath,'utf8');
    const scripts=[
      channelUiPath,
      buyerUiPath,
      workflowUiPath,
      buyerCoverageUiPath,
      routeFitUiPath,
      buyerRetryUiPath,
      deepBuyerUiPath,
      deepBuyerUiV2Path,
      deepBuyerUiV3Path
    ].map(file=>safeScript(fs.readFileSync(file,'utf8')));
    const injected=scripts.map(source=>`<script>${source}</script>`).join('');
    html=html.replace('</body>',`${injected}</body>`);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store, max-age=0');
    return res.status(200).send(html);
  }catch(e){
    console.error('app shell failed',{message:e?.message||String(e)});
    return res.status(500).send('Launchpad36 AI could not load');
  }
}
