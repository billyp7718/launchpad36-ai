import { db } from './_db.js';
import { requireInternal } from './_auth.js';

const REQUIRED_TABLES = [
  'manufacturers',
  'accounts',
  'products',
  'evidence_sources',
  'commercial_evidence',
  'intelligence_change_events',
  'intelligence_change_event_processing',
  'monitor_targets',
  'refresh_runs'
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
  if (!requireInternal(req, res)) return;

  const components = [];
  const version = process.env.npm_package_version || '9.8.3';
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
    components.push(component(
      'Schema',
      missing.length ? 'FAILED' : 'WORKING',
      missing.length ? `Missing ${missing.length} required table(s)` : 'All required V9.8.3 tables are present',
      { present: REQUIRED_TABLES.filter(table => present.has(table)), missing }
    ));

    const counts = {};
    for (const table of REQUIRED_TABLES) {
      if (present.has(table)) counts[table] = await count(sql, table);
    }

    const firecrawlConfigured = Boolean(process.env.FIRECRAWL_API_KEY);
    components.push(component(
      'Firecrawl',
      firecrawlConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      firecrawlConfigured ? 'API key is present; a live scrape is still required' : 'FIRECRAWL_API_KEY is missing'
    ));

    const targetCount = counts.monitor_targets ?? 0;
    let targetFailures = 0;
    let lastTargetCheck = null;
    if (present.has('monitor_targets')) {
      const targetHealth = await sql`
        select
          count(*) filter (where coalesce(last_error, '') <> '')::int as failures,
          max(last_check_at) as last_check
        from monitor_targets
      `;
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
