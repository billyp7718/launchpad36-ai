import { db } from './_db.js';
import { resolveTenant } from './_tenant.js';
import { generateMarketAnalysisPdf,MAX_REPORT_ATTACHMENT_BYTES } from './_market-report.js';
import { loadReportSnapshot } from './market-report-snapshots.js';

export default async function handler(req,res){
  const tenant=await resolveTenant(req,res);if(!tenant)return;
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{
    const row=await loadReportSnapshot(db(),tenant.tenant_id,req.query?.snapshot_id);if(!row)return res.status(404).json({error:'Saved market analysis snapshot was not found'});
    const pdf=await generateMarketAnalysisPdf(row.report_snapshot);if(pdf.length>MAX_REPORT_ATTACHMENT_BYTES)return res.status(413).json({error:'The generated PDF exceeds the safe attachment size. Reduce the number of included accounts and try again.'});
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${row.filename}"`);res.setHeader('Content-Length',String(pdf.length));res.setHeader('Cache-Control','private, no-store');return res.status(200).send(pdf);
  }catch(error){console.error('[market-report-pdf] failed',{message:error?.message||String(error)});return res.status(500).json({error:'The Full Market Analysis PDF could not be generated'})}
}
