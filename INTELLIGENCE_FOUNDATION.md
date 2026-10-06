# Launchpad36 Intelligence Foundation

This change introduces the first implementation slice of the Launchpad36 commercial-intelligence architecture: field-level evidence history, deterministic Trust Scores, and canonical product identity. It is intentionally a foundation, not a replacement for the existing account, buyer, opportunity, or catalog workflows.

## Data safety

The migration in `api/db-init-intelligence-foundation.js` is additive and repeatable. It:

- adds optional product-identifier columns with `ADD COLUMN IF NOT EXISTS`;
- creates new tables and indexes with `IF NOT EXISTS`;
- adds append-only protections to evidence observations, retailer-listing observations, identity-match decisions, and Trust Score evaluations;
- does not drop tables or columns, truncate data, delete rows, reseed data, or convert historical values;
- keeps the mutable current-value projection separate from immutable evidence history.

Existing tenant-private brands, products, opportunity workspaces, and analyses remain under the existing owner/team/tenant visibility rules. Shared retailer listings are public commercial observations, while canonical manufacturer products and product-match decisions remain tenant scoped.

## Evidence states

Important fields can explicitly carry one of these states:

- `VERIFIED`
- `MODELED`
- `USER_ENTERED`
- `NEEDS_RESEARCH`
- `STALE`
- `CONFLICTING`

A modeled or lower-confidence observation cannot overwrite a current verified value. New evidence is appended, and the deterministic current-value projection changes only when the promotion rules allow it.

## Canonical product identity

Manufacturer products and retailer listings remain separate records. Matching prioritizes exact UPC/GTIN/EAN identifiers, then manufacturer SKU/MPN/model plus brand. Similar names alone never authorize an automatic link. Conflicts remain visible and require review.

## Trust Score

`api/_trust-score.js` calculates an explainable 0–100 score from source authority, freshness, source agreement, product/account matching, buyer-role/category confidence, in-store evidence, and revenue-assumption completeness. Conflicts and unsupported claims reduce the score. Every persisted evaluation retains its factors, reasons, missing evidence, conflicts, recommended verification actions, and algorithm version.

## Deployment sequence

1. Deploy the application code to Preview.
2. Run the full regression and browser smoke tests.
3. With an authenticated Administrator session, use **System Status → Initialize Missing Schema**, or POST to `/api/db-init-intelligence-foundation` using existing protected administrator authentication.
4. Run System Status again and confirm all foundation tables are present.
5. Exercise field evidence, Trust Score, and product-identity APIs with tenant-scoped test data before production promotion.

No new environment variables are introduced. Existing database and authentication configuration is used server-side; provider credentials are never sent to the browser.

## API surface

- `GET/POST /api/field-evidence`
- `GET/POST /api/trust-score`
- `GET/POST /api/product-identity`
- `POST /api/db-init-intelligence-foundation` (Administrator only)

The next implementation slice should connect existing research/import workflows to these observation APIs, then add Revenue Missions and durable refresh orchestration after this schema and trust layer are reviewed.
