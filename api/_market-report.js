import crypto from 'crypto';
import PDFDocument from 'pdfkit';

export const MAX_REPORT_ATTACHMENT_BYTES=8*1024*1024;
const NAVY='#08224b',BLUE='#2f6fed',INK='#14283f',MUTED='#60758d',LINE='#dce7f2',LIGHT='#f3f7fc';
const text=(value,fallback='Not available')=>{const result=String(value??'').replace(/\s+/g,' ').trim();return result||fallback};
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(number(value));
const date=value=>{const parsed=value?new Date(value):null;return parsed&&!Number.isNaN(parsed.valueOf())?parsed.toISOString().slice(0,10):'Not verified'};
const status=value=>text(value,'UNKNOWN').replaceAll('_',' ');
const safeUrl=value=>{try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)?url.toString():''}catch{return ''}};

export function reportFilename(brand,generatedOn=new Date().toISOString()){
  const safe=text(brand,'Portfolio').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70)||'Portfolio';
  return `Launchpad36_Full_Market_Analysis_${safe}_${date(generatedOn)}.pdf`;
}

export function reportSnapshotHash(snapshot,emailHtml=''){
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).update('\0').update(String(emailHtml)).digest('hex');
}

export function validateReportSnapshot(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('The PDF snapshot is missing the market analysis');
  const products=Array.isArray(input.selected_products)?input.selected_products:[];
  const accounts=Array.isArray(input.accounts)?input.accounts:[];
  if(!products.length)throw new Error('The PDF snapshot contains no selected products');
  if(!accounts.length)throw new Error('The PDF snapshot contains no included accounts');
  if(accounts.length>2500)throw new Error('The analysis contains too many accounts to export');
  return {...input,title:text(input.title,'Full Market Analysis').slice(0,180),generated_at:input.generated_at||new Date().toISOString(),brand:text(input.brand||products.map(p=>p.brand_name).filter(Boolean).join(' + '),'Portfolio').slice(0,180),selected_products:products.slice(0,250),accounts};
}

function sourceRows(snapshot){
  const sources=new Map();
  const add=(url,label,evidence='')=>{const normalized=safeUrl(url);if(normalized&&!sources.has(normalized))sources.set(normalized,{url:normalized,label:text(label,normalized),evidence:status(evidence)});};
  for(const account of snapshot.accounts||[]){
    add(account.source_url,`${account.name} account source`,account.verification_status);
    for(const source of account.evidence_sources||[])add(typeof source==='string'?source:source.url||source.source_url,typeof source==='string'?`${account.name} evidence`:source.title||`${account.name} evidence`,typeof source==='string'?account.evidence_status:source.verification_status||account.evidence_status);
    for(const item of account.sku_details||[])for(const source of item.evidence_sources||[])add(typeof source==='string'?source:source.url||source.source_url,typeof source==='string'?`${account.name} assortment evidence`:source.title||`${account.name} assortment evidence`,typeof source==='string'?item.evidence_status:source.verification_status||item.evidence_status);
    for(const item of account.competitive_assortment||[])add(item.source_url,`${account.name}: ${item.brand||''} ${item.name||item.product_name||''}`,item.verification_status);
    for(const buyer of account.buyers||[]){add(buyer.source_url,`${buyer.name} identity/employment`,buyer.verification_status||buyer.employment_verification_status);add(buyer.category_evidence_url,`${buyer.name} category ownership`,buyer.category_verification_status);}
  }
  return [...sources.values()];
}

function createWriter(doc){
  const left=54,right=558,contentWidth=504,bottom=724;
  const reset=()=>{doc.x=left};
  const ensure=height=>{if(doc.y+height>bottom)doc.addPage();reset()};
  const heading=(value,level=2)=>{ensure(level===1?46:34);doc.moveDown(level===1?.9:.65);doc.fillColor(level===1?NAVY:INK).font('Helvetica-Bold').fontSize(level===1?18:13).text(value,left,doc.y,{width:contentWidth});doc.moveDown(.3);reset()};
  const paragraph=(value,options={})=>{const content=text(value,'');if(!content)return;reset();doc.fillColor(options.color||INK).font(options.bold?'Helvetica-Bold':'Helvetica').fontSize(options.size||9.5).text(content,left,doc.y,{width:contentWidth,lineGap:2,...options});doc.moveDown(.45);reset()};
  const labelValue=(label,value)=>{ensure(20);const y=doc.y;doc.font('Helvetica-Bold').fillColor(MUTED).fontSize(8).text(`${label.toUpperCase()}: `,left,y,{continued:true,width:contentWidth}).font('Helvetica').fillColor(INK).text(text(value));doc.moveDown(.25);reset()};
  const table=(headers,rows,widths)=>{
    const drawHeader=()=>{ensure(27);const y=doc.y;let x=left;doc.rect(left,y,contentWidth,22).fill(LIGHT);headers.forEach((header,index)=>{doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7).text(header,x+4,y+6,{width:widths[index]-8,height:14});x+=widths[index]});doc.y=y+22;reset()};
    drawHeader();
    for(const row of rows){const strings=row.map(cell=>text(cell,'')),heights=strings.map((cell,index)=>doc.heightOfString(cell,{width:widths[index]-8,lineGap:1})),height=Math.max(22,...heights.map(value=>value+9));if(doc.y+height>bottom){doc.addPage();drawHeader()}const y=doc.y;let x=left;doc.moveTo(left,y).lineTo(right,y).strokeColor(LINE).stroke();strings.forEach((cell,index)=>{doc.fillColor(INK).font('Helvetica').fontSize(7.5).text(cell,x+4,y+5,{width:widths[index]-8,height:height-7,lineGap:1});x+=widths[index]});doc.y=y+height;}
    doc.moveTo(left,doc.y).lineTo(right,doc.y).strokeColor(LINE).stroke();doc.moveDown(.7);reset();
  };
  return {ensure,heading,paragraph,labelValue,table,left,right,contentWidth,bottom};
}

export async function generateMarketAnalysisPdf(rawSnapshot){
  const snapshot=validateReportSnapshot(rawSnapshot),doc=new PDFDocument({size:'LETTER',margins:{top:58,bottom:54,left:54,right:54},bufferPages:true,info:{Title:snapshot.title,Author:'Launchpad36 AI',Subject:'Full Market Analysis'}}),chunks=[];
  doc.on('data',chunk=>chunks.push(chunk));const completed=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)}),w=createWriter(doc);
  doc.rect(0,0,612,190).fill(NAVY);doc.fillColor('#85b5ff').font('Helvetica-Bold').fontSize(9).text('LAUNCHPAD36 AI',54,48,{characterSpacing:1.5});doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(25).text(snapshot.title,54,76,{width:504});doc.fillColor('#d5e4f7').font('Helvetica').fontSize(10).text(`${snapshot.brand} | Analysis date ${date(snapshot.generated_at)}`,54,136,{width:504});doc.y=214;
  w.heading('Executive Summary',1);w.paragraph(snapshot.executive_summary);w.paragraph('Important classification: opportunity and revenue figures in this report are modeled estimates based on stated assumptions. They are not verified retailer sales.',{bold:true,color:'#8a5a00'});
  const summary=snapshot.summary||{};w.table(['TOTAL OPPORTUNITY','LOW','HIGH','EVIDENCE-BACKED'],[[money(summary.base_manufacturer_revenue),money(summary.low_manufacturer_revenue),money(summary.high_manufacturer_revenue),money(summary.evidence_backed_manufacturer_revenue)]],[126,126,126,126]);

  w.heading('Selected Brand, Products and SKUs');
  w.table(['BRAND / PRODUCT','FAMILY / CATEGORY','SKUS','PRICING BASIS'],snapshot.selected_products.map(product=>[`${text(product.brand_name,'')} ${text(product.name,'')}`.trim(),[product.product_family,product.category].filter(Boolean).join(' / '),(product.skus||product.variants||[]).map(item=>typeof item==='string'?item:item.sku||item.model_number).filter(Boolean).join(', ')||'Unspecified',text(product.pricing_basis||product.wholesale_source,'Catalog or modeled input')]),[150,130,120,104]);

  w.heading('Market Opportunity and Methodology');w.paragraph(snapshot.methodology||'The account-level model combines selected product pricing, route-to-market assumptions, account footprint, probability and fit. Account inclusion and manual adjustments reflect the saved analysis snapshot.');
  const assumptions=snapshot.assumptions||{};w.table(['ASSUMPTION','VALUE'],Object.entries(assumptions).filter(([,value])=>value!==null&&value!==undefined&&typeof value!=='object').map(([key,value])=>[key.replaceAll('_',' '),String(value)]),[220,284]);
  for(const warning of snapshot.warnings||[])w.paragraph(`- ${warning}`,{color:MUTED});

  w.heading('Account-Level Opportunity Model');
  w.table(['ACCOUNT','ANNUAL OPPORTUNITY','FIT','EVIDENCE','CHANNEL'],(snapshot.accounts||[]).map(account=>[account.name,money(account.annual_opportunity),String(number(account.fit_score)),status(account.evidence_status),text(account.channel_findings,'Needs confirmation')]),[150,105,45,90,114]);

  w.heading('Account and SKU Detail',1);
  for(const account of snapshot.accounts||[]){
    w.heading(text(account.name),2);w.labelValue('Annual modeled opportunity',money(account.annual_opportunity));w.labelValue('Fit score',`${number(account.fit_score)} - ${text(account.fit_reason,'No rationale recorded')}`);w.labelValue('Evidence / confidence',`${status(account.evidence_status)} / ${number(account.confidence)}%`);w.labelValue('Last verified',date(account.last_verified_at));w.labelValue('Route to market',text(account.route_to_market));w.labelValue('In-store vs online',text(account.channel_findings,'Needs confirmation'));if(account.opportunity_rationale)w.labelValue('Opportunity rationale',account.opportunity_rationale);if(account.notes)w.labelValue('Additional account input',account.notes);
    const skuRows=(account.sku_details||[]).map(item=>[[item.brand_name,item.product_name].filter(Boolean).join(' '),item.sku||item.model_number,`${number(item.monthly_units_per_store)} / month`,money(item.retail_price),money(item.wholesale_price),text(item.channel,'Needs confirmation'),money(item.annual_opportunity)]);
    if(skuRows.length)w.table(['PRODUCT','SKU','UNITS','RETAIL','WHOLESALE','CHANNEL','ANNUAL'],skuRows,[105,63,58,64,70,76,68]);else w.paragraph('No detailed SKU/account volume plan is saved.',{color:MUTED});
    w.heading('Competitive assortment and placement',2);if((account.competitive_assortment||[]).length)w.table(['COMPETITOR / PRODUCT','PRICE','IN STORE','ONLINE','EVIDENCE'],account.competitive_assortment.map(item=>[[item.brand,item.name||item.product_name].filter(Boolean).join(' '),item.price_text||money(item.price_numeric),item.in_store===true?'Yes':item.in_store===false?'No':'Unknown',item.online===true?'Yes':item.online===false?'No':'Unknown',status(item.verification_status)]),[180,70,65,65,124]);else w.paragraph('No source-backed competitive assortment is saved for this account.',{color:MUTED});
    w.heading('Buyer intelligence',2);if((account.buyers||[]).length)w.table(['BUYER / TITLE','DEPARTMENT','CATEGORY SCOPE','ROLE','IDENTITY','CATEGORY'],account.buyers.map(buyer=>[[buyer.name,buyer.title].filter(Boolean).join(' - '),text(buyer.department,'Unconfirmed'),text(buyer.category_scope||buyer.category,'Unconfirmed'),status(buyer.buyer_role),`${status(buyer.employment_verification_status||buyer.verification_status)} ${number(buyer.identity_confidence)}%`,`${status(buyer.category_verification_status)} ${number(buyer.category_confidence)}%`]),[110,75,105,65,74,75]);else w.paragraph('Buyer intelligence is not available for this account.',{color:MUTED});
  }

  w.heading('Route-to-Market Analysis',1);w.paragraph(snapshot.route_to_market_analysis||`Selected route: ${text(assumptions.route_to_market)}. Placement findings are reported per account and remain unknown where no source-backed channel evidence is available.`);
  w.heading('Evidence, Confidence and Sources',1);w.paragraph('VERIFIED evidence has an attributable source and completed verification. PROBABLE and UNCONFIRMED findings require further validation. Modeled values and assumptions remain estimates regardless of account evidence status.');
  const sources=sourceRows(snapshot);if(sources.length)w.table(['SOURCE','EVIDENCE STATUS'],sources.map((source,index)=>[`${index+1}. ${source.label}\n${source.url}`,source.evidence]),[390,114]);else w.paragraph('No attributable public sources are stored in this snapshot.',{color:MUTED});
  if(snapshot.recommendations){w.heading('Recommendations',1);w.paragraph(snapshot.recommendations)}

  const range=doc.bufferedPageRange();for(let page=range.start;page<range.start+range.count;page++){doc.switchToPage(page);const bottomMargin=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.save();doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(7.5).text('LAUNCHPAD36 AI  |  FULL MARKET ANALYSIS',54,28,{width:390,lineBreak:false});doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`${snapshot.brand}  |  ${date(snapshot.generated_at)}`,390,28,{width:168,align:'right',lineBreak:false});doc.moveTo(54,42).lineTo(558,42).strokeColor(LINE).stroke();doc.moveTo(54,746).lineTo(558,746).strokeColor(LINE).stroke();doc.fillColor(MUTED).text('Confidential commercial planning document',54,754,{width:300,lineBreak:false});doc.text(`Page ${page-range.start+1} of ${range.count}`,408,754,{width:150,align:'right',lineBreak:false});doc.restore();doc.page.margins.bottom=bottomMargin}
  doc.end();return completed;
}

export async function prepareMarketReportAttachment(snapshot,generator=generateMarketAnalysisPdf){
  let pdf;try{pdf=await generator(snapshot)}catch{const error=new Error('The report PDF could not be generated, so no email was sent');error.code='PDF_GENERATION_FAILED';throw error}
  if(!Buffer.isBuffer(pdf)||!pdf.length){const error=new Error('The report PDF could not be generated, so no email was sent');error.code='PDF_GENERATION_FAILED';throw error}
  if(pdf.length>MAX_REPORT_ATTACHMENT_BYTES){const error=new Error('The generated PDF is too large to attach. No email was sent.');error.code='PDF_ATTACHMENT_TOO_LARGE';throw error}
  return pdf;
}
