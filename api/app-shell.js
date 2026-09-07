import fs from 'fs';
import path from 'path';
export default function handler(req,res){
  try{
    const file=path.join(process.cwd(),'index.html');
    let html=fs.readFileSync(file,'utf8');
    html=html.replace('</body>','<script src="/channel-ui.js"></script></body>');
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.status(200).send(html);
  }catch(e){return res.status(500).send('Launchpad36 AI could not load')}
}
