const clean=value=>String(value??'').trim().toLowerCase();

export function buyerReportDeliveryConfig(env=process.env){
  const requested=clean(env.BUYER_INTELLIGENCE_EMAIL_DELIVERY_MODE);
  const providerPresent=Boolean(env.RESEND_API_KEY&&env.REPORT_FROM_EMAIL);
  const siteDelivery=requested==='site'||requested==='resend'||(!requested&&providerPresent);
  if(!siteDelivery)return {
    mode:'external',
    enabled:false,
    configured:true,
    missing:[],
    detail:'Weekly buyer intelligence report delivery is handled outside Launchpad36; no site email credential is required'
  };
  const missing=[];
  if(!env.CRON_SECRET)missing.push('CRON_SECRET');
  if(!env.RESEND_API_KEY)missing.push('RESEND_API_KEY');
  if(!env.REPORT_FROM_EMAIL)missing.push('REPORT_FROM_EMAIL');
  if(!(env.BUYER_INTELLIGENCE_REPORT_TENANT_ID||env.BUYER_INTELLIGENCE_SERVICE_TENANT_ID))missing.push('BUYER_INTELLIGENCE_REPORT_TENANT_ID or BUYER_INTELLIGENCE_SERVICE_TENANT_ID');
  return {
    mode:'site',
    enabled:true,
    configured:missing.length===0,
    missing,
    detail:missing.length?`Site email delivery is missing: ${missing.join(', ')}`:'Monday 9:00 AM Eastern site email delivery is configured'
  };
}
