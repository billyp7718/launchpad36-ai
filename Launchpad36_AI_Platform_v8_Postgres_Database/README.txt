Launchpad36 AI Platform v3

Core capabilities:
- Unlimited retailer/distributor/dealer/e-commerce/buying-group accounts
- National, regional and local coverage
- Account detail drill-downs
- Buyer/contact database
- Multiple products/SKUs/price points
- Excel/XLSX/XLS/CSV import for accounts, buyers, products and opportunities
- Retail + distribution opportunity scoring
- Pipeline
- CRM integration workspace for HubSpot, Salesforce, Pipedrive and Zoho

CRM note: live OAuth connections require provider-specific OAuth app credentials. The UI and secure server-side configuration status endpoint are included; authorization callbacks are not activated until credentials are supplied.

V4: Decision Maker Discovery from public corporate/business pages; separate Online/E-commerce vs In-Store strategy sections.


V5 additions:
- Competitor Discovery Agent at retailer/account level.
- Scans public retailer pages for relevant competing brands/products with source URLs.
- Retail Scope dropdown now includes National Retailers, Regional Retailers and Independent Retailers.
- Scope filters also cover national/regional distribution, specialty, e-commerce and buying groups.
- Unlimited account model is preserved; filters do not cap results.

V6 additions: Retail Assortment Gap Engine; exact SKU/price comparisons; gap scores; lead-SKU recommendation; retailer-specific white-space analysis.

V7: restores current competitive products at retail; adds weekly refresh cron orchestration for buyers/products. Persistent weekly updates require a database.


V8 DATABASE BUILD
=================
Production-ready Postgres persistence layer added.

Required environment variables:
- DATABASE_URL : Postgres connection string (Neon via Vercel Marketplace is recommended)
- ADMIN_SECRET : secret used to initialize schema via POST /api/db/init
- CRON_SECRET  : secret for the weekly Vercel Cron refresh

Initialization:
1. Provision Postgres and connect it to the Vercel project.
2. Add DATABASE_URL, ADMIN_SECRET, CRON_SECRET to Vercel environment variables.
3. Deploy.
4. POST /api/db/init with Authorization: Bearer <ADMIN_SECRET>.
5. Open Integrations and use CHECK DATABASE.
6. Use MIGRATE BROWSER DATA once to move existing localStorage accounts/buyers/products into Postgres.

Persistent entities:
manufacturers, products, product_variants, accounts, buyers, competitive_products,
retail_observations, opportunity_scores, refresh_runs, change_events.

Weekly refresh:
The existing Vercel Cron calls /api/weekly-refresh weekly. V8 now persists buyer and competitive-product results, plus historical observations and refresh-run audit data.
