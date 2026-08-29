# Launchpad36 AI V9.8.3 — Living Intelligence Foundation

V9.8.3 adds review-gated catalog onboarding and an append-only public commercial-evidence foundation. It does not remove the existing V9.8 portfolio, account-universe, intelligence-agent, or scheduled-refresh behavior.

## Deployment and migration

1. Deploy the branch with the new API routes.
2. Set the server-only Vercel environment variables listed in `.env.example`. Scope production database and secrets to Production; use separate Preview values.
3. `POST /api/db-init-v9-8` once with an authenticated admin request. The migration is repeatable and now creates the `manufacturer_members` case-insensitive email uniqueness rule as an expression index.
4. Configure Firecrawl page monitors for retailer assortment, retailer/company, and public buyer/leadership URLs. Use the URL in `FIRECRAWL_MONITOR_WEBHOOK_URL`, events `monitor.page,monitor.check.completed`, and set `FIRECRAWL_WEBHOOK_SECRET` to the Firecrawl account webhook secret from Advanced settings. The endpoint verifies the documented `X-Firecrawl-Signature: sha256=<hex>` HMAC over the raw request body; query-string secrets and direct signature/secret comparison are not accepted. Save returned monitor IDs and explicit `account_id`/`organization_id` ownership through `/api/monitor-targets`.
5. Run an authenticated smoke check of `/api/living-intelligence-refresh` and `/api/living-intelligence-status`.

## Evidence policy and pipeline

The enforced order is acquisition → change detection → validation → L36 Intelligence Agent proposal → deterministic database update. The immutable `commercial_evidence` and `intelligence_change_events` tables retain source snapshots and changes. Mutable processing state is isolated in `intelligence_change_event_processing`. Only evidence deterministically classified `VERIFIED` can update `current_commercial_truth`. Agent output is stored as a review-required proposal and is never authorized to mutate verified commercial truth.

Acquisition errors, blocked pages, empty search results, weak evidence, and conflicts remain `UNKNOWN`, `REVIEW_REQUIRED`, or `CONFLICTING`; they never prove commercial absence.

Public retailer, assortment, and buyer evidence is global. Manufacturer brands, products/SKUs, targets, opportunities, pricing/cost/MAP, CRM data, catalog import runs, and agent proposals remain manufacturer-scoped. LinkedIn remains verification/enrichment only. The system does not bulk scrape LinkedIn or infer private email addresses or phone numbers.

## Catalog review

Excel, CSV, and fictional demo catalogs all call `/api/catalog-import` first with `mode=review`. The response contains normalized valid rows and a signed review token. Import requires the same reviewed content, `approved=true`, and that token. The 12-row Aurelius Audio catalog is fictional `demo_data` with `source_type=demo` and is not written until approval.

## Monitor tiers

One daily Vercel cron dispatches due `daily`, `weekly`, and `monthly` targets; this keeps the project at two configured cron jobs. Firecrawl webhook deliveries are retained for audit, but a `data.judgment.meaningful` value of `false` prevents commercial evidence, change-event, proposal, and truth processing. Credentials are never stored in source or monitor rows.
