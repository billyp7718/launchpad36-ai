import fs from 'fs';
import path from 'path';

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
    let html=fs.readFileSync(htmlPath,'utf8');
    const channelUi=fs.readFileSync(channelUiPath,'utf8');
    const buyerUi=fs.readFileSync(buyerUiPath,'utf8');
    const workflowUi=fs.readFileSync(workflowUiPath,'utf8');
    const buyerCoverageUi=fs.readFileSync(buyerCoverageUiPath,'utf8');
    const routeFitUi=fs.readFileSync(routeFitUiPath,'utf8');
    const buyerRetryUi=fs.readFileSync(buyerRetryUiPath,'utf8');
    const deepBuyerUi=fs.readFileSync(deepBuyerUiPath,'utf8');
    const deepBuyerUiV2=fs.readFileSync(deepBuyerUiV2Path,'utf8');
    html=html.replace('</body>',`<script>${channelUi}</script><script>${buyerUi}</script><script>${workflowUi}</script><script>${buyerCoverageUi}</script><script>${routeFitUi}</script><script>${buyerRetryUi}</script><script>${deepBuyerUi}</script><script>${deepBuyerUiV2}</script></body>`);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store, max-age=0');
    return res.status(200).send(html);
  }catch(e){
    console.error('app shell failed',{message:e?.message||String(e)});
    return res.status(500).send('Launchpad36 AI could not load');
  }
}
