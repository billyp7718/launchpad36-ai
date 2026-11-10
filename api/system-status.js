import { db } from './_db.js';
import { resolveInternalTenant } from './_tenant.js';
import { buyerReportDeliveryConfig } from './_buyer-report-delivery.js';

const REQUIRED_TABLES = [
  'manufacturers',
  'accounts',
  'products',
  'evidence_sources',
  'commercial_evidence',
  'intelligence_change_events',
  'intelligence_change_event_processing',
  'monitor_targets',
  'opportunity_workspaces',
  'sell_in_scenarios',
  'market_opportunity_scenarios',
  'market_analysis_report_snapshots',
  'refresh_runs',
  'entity_field_observations',
  'current_entity_field_values',
  'canonical_products',
  'canonical_product_identifiers',
  'retailer_product_listings',
  'retailer_listing_observations',
  'product_identity_matches',
  'l36_trust_evaluations',
  'revenue_missions',
  'revenue_mission_opportunities',
  'revenue_mission_events',
  'buyer_intelligence_import_runs',
  'buyer_intelligence_import_items',
  'buyer_intelligence_audit_events',
  'buyer_intelligence_rate_limits',
  'buyer_intelligence_report_deliveries',
  'buyer_research_settings',
  'buyer_research_jobs',
  'buyer_research_job_accounts',
  'buyer_research_candidates',
  'buyer_research_events',
  'buyer_research_preview_batches',
  'buyer_research_preview_items'
];

function component(name, status, detail, extra = {}) {
  return { name, status, detail, ...extra };
}

async function count(sql, table) {
  const allowed = new Set(REQUIRED_TABLES);
  if (!allowed.has(table)) return null;
  const rows = await sql.unsafe(`select count(*)::int as count from ${table}`);
  return rows[0]?.count ?? 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await resolveInternalTenant(req, res)) return;

  const components = [];
  const version = process.env.npm_package_version || '9.8.4';
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local/unknown';
  components.push(component('Application', 'WORKING', `Version ${version}`, { commit }));

  if (!process.env.DATABASE_URL) {
    components.push(component('Database', 'NOT_CONFIGURED', 'DATABASE_URL is not configured'));
    return res.status(200).json({ version, commit, overall_status: 'NOT_READY', checked_at: new Date().toISOString(), components });
  }

  try {
    const sql = db();
    const database = await sql`select current_database() as database, now() as server_time`;
    components.push(component('Database', 'WORKING', 'Connection successful', {
      database: database[0]?.database,
      server_time: database[0]?.server_time
    }));

    const tableRows = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_name = any(${REQUIRED_TABLES})
    `;
    const present = new Set(tableRows.map(row => row.table_name));
    const missing = REQUIRED_TABLES.filter(table => !present.has(table));
    if (present.has('monitor_targets')) {
      const columns = await sql`select column_name from information_schema.columns where table_schema='public' and table_name='monitor_targets'`;
      if (!columns.some(row => row.column_name === 'category_focus')) missing.push('monitor_targets.category_focus');
    }
    const organizationTable = (await sql`select to_regclass('public.retail_organizations') as name`)[0]?.name;
    if (organizationTable) {
      const columns = await sql`select column_name from information_schema.columns where table_schema='public' and table_name='retail_organizations'`;
      if (!columns.some(row => row.column_name === 'headquarters')) missing.push('retail_organizations.headquarters');
    }
    components.push(component(
      'Schema',
      missing.length ? 'FAILED' : 'WORKING',
      missing.length ? `Missing ${missing.length} required table(s)` : 'All required V9.8.4 tables are present',
      { present: REQUIRED_TABLES.filter(table => present.has(table)), missing }
    ));

    const counts = {};
    for (const table of REQUIRED_TABLES) {
      if (present.has(table)) counts[table] = await count(sql, table);
    }

    const firecrawlConfigured = Boolean(process.env.FIRECRAWL_API_KEY);
    components.push(component(
      'Optional Web Crawler',
      firecrawlConfigured ? 'CONFIGURED' : 'OPTIONAL',
      firecrawlConfigured
        ? 'Firecrawl is available for background monitoring; zero-paid bulk buyer research does not call it'
        : 'Firecrawl is optional for background monitoring and is not used by zero-paid bulk buyer research'
    ));

    const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
    components.push(component(
      'OpenAI Research',
      openaiConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      openaiConfigured ? 'Responses API web research is available for user-initiated per-account Deep Search only' : 'OPENAI_API_KEY is missing for optional per-account Deep Search'
    ));

    const apolloConfigured = Boolean(process.env.APOLLO_API_KEY);
    components.push(component(
      'Buyer Enrichment',
      apolloConfigured ? 'CONFIGURED' : 'OPTIONAL',
      apolloConfigured ? 'Optional Apollo enrichment is available for per-account Deep Search only' : 'Optional per-account enrichment is not configured; zero-paid bulk research is unaffected'
    ));

    const ingestionConfigured=Boolean(process.env.BUYER_INTELLIGENCE_SERVICE_SECRET&&process.env.BUYER_INTELLIGENCE_SERVICE_TENANT_ID);
    components.push(component(
      'Buyer Intelligence Ingestion',
      ingestionConfigured?'CONFIGURED':'NOT_CONFIGURED',
      ingestionConfigured?'Scoped service authentication is configured':'BUYER_INTELLIGENCE_SERVICE_SECRET and BUYER_INTELLIGENCE_SERVICE_TENANT_ID are required'
    ));

    const buyerReport=buyerReportDeliveryConfig();
    components.push(component(
      'Buyer Intelligence Weekly Report',
      buyerReport.configured?'CONFIGURED':'NOT_CONFIGURED',
      buyerReport.detail,
      {delivery_mode:buyerReport.mode,schedule:buyerReport.enabled?'Mondays at 9:00 AM America/New_York':'External',recipient_configured:buyerReport.enabled&&Boolean(process.env.BUYER_INTELLIGENCE_REPORT_TO||'Billp@launchpad36.com'),missing:buyerReport.missing}
    ));

    const researchTables=['buyer_research_settings','buyer_research_jobs','buyer_research_job_accounts','buyer_research_candidates','buyer_research_events','buyer_research_preview_batches','buyer_research_preview_items'];
    const researchSchemaReady=researchTables.every(table=>present.has(table));
    let latestResearch=null;
    if(researchSchemaReady){
      const rows=await sql`select id,status,research_mode,requested_accounts,accounts_completed,candidates_found,verified_candidates,duplicate_candidates,conflicting_candidates,preview_batches,public_pages_fetched,robots_blocked_accounts,external_api_cost_cents,checkpoint_at,created_at from buyer_research_jobs order by created_at desc limit 1`;
      latestResearch=rows[0]||null;
    }
    components.push(component(
      'Buyer Research Runner',
      !researchSchemaReady?'FAILED':latestResearch?.status==='FAILED'?'DEGRADED':latestResearch?'WORKING':'CONFIGURED',
      !researchSchemaReady?'Buyer research staging schema is incomplete':latestResearch?`Zero-paid public-source job: ${latestResearch.status}; ${latestResearch.accounts_completed || 0}/${latestResearch.requested_accounts || 0} accounts checkpointed`:'Zero-paid, non-mutating research is configured and awaiting an administrator start',
      {latest_job:latestResearch,zero_paid_api_mode:true,estimated_external_api_cost_cents:0,preview_only:true,direct_buyer_mutation:false,paid_deep_search_separate:true}
    ));

    let targetCount = 0;
    let targetFailures = 0;
    let lastTargetCheck = null;
    if (present.has('monitor_targets')) {
      const targetHealth = await sql`
        select count(*) filter (where state='active')::int as targets,
          count(*) filter (where coalesce(last_error, '') <> '')::int as failures,
          max(last_check_at) as last_check
        from monitor_targets
        where state='active'
      `;
      targetCount = targetHealth[0]?.targets ?? 0;
      targetFailures = targetHealth[0]?.failures ?? 0;
      lastTargetCheck = targetHealth[0]?.last_check ?? null;
    }
    components.push(component(
      'Monitoring',
      !present.has('monitor_targets') ? 'FAILED' : targetCount === 0 ? 'NOT_CONFIGURED' : targetFailures ? 'DEGRADED' : 'READY',
      targetCount === 0 ? 'No active monitoring targets exist' : `${targetCount} target(s); ${targetFailures} with errors`,
      { targets: targetCount, targets_with_errors: targetFailures, last_check: lastTargetCheck }
    ));

    const evidenceCount = counts.commercial_evidence ?? 0;
    components.push(component(
      'Evidence',
      !present.has('commercial_evidence') ? 'FAILED' : evidenceCount ? 'WORKING' : 'NO_DATA',
      evidenceCount ? `${evidenceCount} evidence observation(s) stored` : 'No commercial evidence has been stored',
      { observations: evidenceCount }
    ));

    const changeCount = counts.intelligence_change_events ?? 0;
    components.push(component(
      'Change Detection',
      !present.has('intelligence_change_events') ? 'FAILED' : changeCount ? 'WORKING' : 'UNPROVEN',
      changeCount ? `${changeCount} change event(s) recorded` : 'No change event has been demonstrated',
      { change_events: changeCount }
    ));

    let lastRefresh = null;
    if (present.has('refresh_runs')) {
      const rows = await sql`
        select job_type, status, started_at, finished_at, errors
        from refresh_runs
        order by started_at desc
        limit 1
      `;
      lastRefresh = rows[0] || null;
    }
    components.push(component(
      'Scheduled Refresh',
      !lastRefresh ? 'UNPROVEN' : lastRefresh.status === 'completed' ? 'WORKING' : 'DEGRADED',
      !lastRefresh ? 'No refresh run has been recorded' : `Last run: ${lastRefresh.status}`,
      { last_run: lastRefresh }
    ));

    let retailerDiscovery = null;
    if (present.has('refresh_runs')) {
      const rows = await sql`select job_type,status,accounts_processed,started_at,finished_at,errors from refresh_runs where job_type='weekly-retailer-discovery' order by started_at desc limit 1`;
      retailerDiscovery = rows[0] || null;
    }
    components.push(component(
      'Retailer Discovery',
      !openaiConfigured ? 'NOT_CONFIGURED' : retailerDiscovery?.status === 'failed' ? 'DEGRADED' : retailerDiscovery ? 'WORKING' : 'CONFIGURED',
      !openaiConfigured ? 'OPENAI_API_KEY is required' : retailerDiscovery ? `Last run: ${retailerDiscovery.status}; ${retailerDiscovery.accounts_processed || 0} account(s) added or enriched` : 'Weekly Monday discovery is configured and awaiting its first run',
      { last_run: retailerDiscovery, schedule: 'Mondays at 13:00 UTC' }
    ));

    const blocking = components.some(item => ['FAILED', 'NOT_CONFIGURED'].includes(item.status));
    const proven = components.every(item => ['WORKING', 'READY', 'CONFIGURED'].includes(item.status));
    return res.status(200).json({
      version,
      commit,
      overall_status: blocking ? 'NOT_READY' : proven ? 'OPERATIONAL' : 'PARTIALLY_READY',
      checked_at: new Date().toISOString(),
      counts,
      components
    });
  } catch (error) {
    components.push(component('Database', 'FAILED', error.message));
    return res.status(200).json({
      version,
      commit,
      overall_status: 'NOT_READY',
      checked_at: new Date().toISOString(),
      components
    });
  }
}
