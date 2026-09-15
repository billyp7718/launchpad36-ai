import { db } from './_db.js';
import { sessionData } from './_auth.js';

const OAI='https://api.openai.com/v1/responses';
const clean=(v,m=1000)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,m);
function outputText(body={}){if(typeof body.output_text==='string')return body.output_text;for(const item of body.output||[])for(const part of item.content||[])if(part.type==='output_text')return part.text||'';return ''}
function sourceUrls(body={}){const out=new Set();const add=u=>{try{const x=new URL(u);x.hash='';out.add(x.href.replace(/\/$/,''))}catch{}};for(const item of body.output||[]){for(const s of item.action?.sources||[])add(s.url);for(const part of item.content||[])for(const a of part.annotations||[]){const c=a.url_citation||a;if(a.type==='url_citation'||a.url_citation)add(c.url)}}return out}
function norm(u=''){try{const x=new URL(u);x.hash='';return x.href.replace(/\/$/,'')}catch{return ''}}
const schema={type:'object',additionalProperties:false,properties:{headline_summary:{type:'string'},stories:{type:'array',minItems:6,maxItems:12,items:{type:'object',additionalProperties:false,properties:{headline:{type:'string'},summary:{type:'string'},why_it_matters:{type:'string'},category:{type:'string'},source_name:{type:'string'},source_url:{type:'string'},published_at:{type:'string'}},required:['headline','summary','why_it_matters','category','source_name','source_url','published_at']}}},required:['headline_summary','stories']};
async function generate(){
 const key=process.env.OPENAI_API_KEY;if(!key)throw new Error('OPENAI_API_KEY is not configured');
 const prompt=`Create a concise U.S. retail-industry executive news brief using the most consequential developments from roughly the last 24-48 hours. Prioritize retailer strategy, store openings/closures, merchandising, consumer electronics, audio/video, appliances, furniture/home, sporting goods, jewelry/accessories, automotive aftermarket, e-commerce/marketplaces, pricing/promotions, distribution, supply chain, retailer earnings, leadership/buyer changes, and major product/vendor moves that could affect manufacturers selling through retail. Exclude generic lifestyle stories and weakly sourced speculation. Return 6-12 distinct stories. Each source_url must exactly match a URL surfaced by web search. Keep each summary to 1-2 sentences and why_it_matters to one sentence written for a sales/revenue leader.`;
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),90000);
 try{
  const r=await fetch(OAI,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:ctl.signal,body:JSON.stringify({model:clean(process.env.OPENAI_RESEARCH_MODEL||'gpt-5.6',80),reasoning:{effort:'medium'},tools:[{type:'web_search',search_context_size:'high',user_location:{type:'approximate',country:'US'}}],tool_choice:'auto',include:['web_search_call.action.sources'],input:prompt,max_output_tokens:5500,text:{format:{type:'json_schema',name:'retail_industry_daily_news',strict:true,schema}}})});
  let b={};try{b=await r.json()}catch{}if(!r.ok)throw new Error(clean(b.error?.message||`OpenAI ${r.status}`,300));
  let parsed={};try{parsed=JSON.parse(outputText(b)||'{}')}catch{throw new Error('News provider returned invalid structured data')}
  const allowed=sourceUrls(b),stories=(parsed.stories||[]).filter(s=>s.headline&&s.source_url&&allowed.has(norm(s.source_url))).slice(0,12);
  if(stories.length<3)throw new Error('Not enough attributable retail news was returned');
  return {headline_summary:clean(parsed.headline_summary,500),stories,generated_at:new Date().toISOString()};
 }finally{clearTimeout(timer)}
}

export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!sessionData(req))return res.status(401).json({error:'Authentication required'});
 const sql=db();
 try{
  await sql`create table if not exists retail_industry_daily_news(day date primary key,payload jsonb not null,generated_at timestamptz not null default now())`;
  const today=(await sql`select current_date::text day`)[0]?.day;
  const cached=(await sql`select payload,generated_at from retail_industry_daily_news where day=current_date limit 1`)[0];
  if(cached)return res.status(200).json({...cached.payload,cached:true,day:today,generated_at:cached.generated_at});
  const payload=await generate();
  await sql`insert into retail_industry_daily_news(day,payload,generated_at) values(current_date,${sql.json(payload)},now()) on conflict(day) do update set payload=excluded.payload,generated_at=excluded.generated_at`;
  return res.status(200).json({...payload,cached:false,day:today});
 }catch(e){console.error('retail industry news failed',{message:e?.message||String(e)});return res.status(500).json({error:clean(e.message||'Retail industry news failed',300)})}
}
