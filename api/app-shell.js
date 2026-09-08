import fs from 'fs';
import path from 'path';

export default function handler(req,res){
  try{
    const root=process.cwd();
    const htmlPath=path.join(root,'index.html');
    const channelUiPath=path.join(root,'channel-ui.js');
    const buyerUiPath=path.join(root,'buyer-contact-ui.js');
    let html=fs.readFileSync(htmlPath,'utf8');
    const channelUi=fs.readFileSync(channelUiPath,'utf8');
    const buyerUi=fs.readFileSync(buyerUiPath,'utf8');
    html=html.replace('</body>',`<script>${channelUi}</script><script>${buyerUi}</script></body>`);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store, max-age=0');
    return res.status(200).send(html);
  }catch(e){
    console.error('app shell failed',{message:e?.message||String(e)});
    return res.status(500).send('Launchpad36 AI could not load');
  }
}
