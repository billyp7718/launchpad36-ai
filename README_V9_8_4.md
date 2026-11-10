# Launchpad36 V9.8.4 — Large-Scale Buyer Research Runner

V9.8.4 adds a tenant-scoped, non-mutating research runner to Buyer Intelligence Updates. It inventories the existing public Account Universe, prioritizes organizations with no buyer coverage, researches one organization per protected worker tick, and checkpoints all progress in separate staging tables.

## Safety model

- Research never inserts, updates, or deletes `retail_organizations`, `accounts`, or `buyers`.
- Candidate evidence, source URLs, classifications, and research events are append-only.
- A partial or failed public-page request is recorded for retry without losing prior checkpoints.
- A partial unique index prevents overlapping active jobs for the same tenant.
- Zero-Paid-API Mode is enabled by default. The bulk runner directly checks permitted public account pages and never calls OpenAI, Apollo, Firecrawl, paid search, or contact-enrichment APIs.
- `robots.txt`, access restrictions, authentication barriers, CAPTCHAs, safe page limits, minimum intervals, retry count, and cancellation state are respected and persisted.
- Administrators can opt into a 30-day recurring refresh after the initial job. It is off by default so deployment cannot unexpectedly start a production run.
- LinkedIn and other public professional profiles are verification/enrichment sources only. The runner never infers personal email addresses or phone numbers.
- Completed candidates are sent to `/api/buyer-intelligence-import` as immutable dry-run previews of at most 250 records.
- Only an authenticated Administrator can commit a preview produced by the large-scale runner. No preview is committed automatically.

## Required server-only environment

No research-provider credential is required for the bulk runner. It uses the existing protected application values:

- `DATABASE_URL`
- `ADMIN_SECRET`
- `CRON_SECRET`
- `BUYER_INTELLIGENCE_SERVICE_SECRET`
- `BUYER_INTELLIGENCE_SERVICE_TENANT_ID`

Values must be stored in Vercel and must never be returned to the browser or committed to source control.

`OPENAI_API_KEY` and `APOLLO_API_KEY` remain optional for the separate, user-initiated per-account Deep Search workflow. They are never used by Zero-Paid-API bulk research. Direct public HTTP access still uses Vercel hosting/runtime resources, and external email delivery may retain its existing provider cost.

## Deployment and operation

1. Deploy the code and run the authenticated, repeatable `POST /api/db-init-v9-8` migration.
2. Confirm `/api/system-status` reports the Buyer Research Runner as `CONFIGURED` or `WORKING`.
3. In Buyer Intelligence Updates, start the all-account research job. The inventory snapshot is ordered so accounts with zero buyers are processed first.
4. The protected `/api/buyer-research-runner-tick` cron processes one ready account per invocation using direct public sources. Pause, resume/retry, and cancellation preserve completed research.
5. Review every generated preview batch in Buyer Intelligence Updates. An Administrator must explicitly approve each batch before any existing buyer data can change.
6. After validating the first run, optionally enable automatic 30-day zero-paid refreshes. A new cycle is not started while a prior job or approval queue remains open.

The migration adds tenant settings and cost/source telemetry with `IF NOT EXISTS` guards. It contains no table or column drops, truncation, destructive deletes, reseeding, or conversion of historical buyer category data.
