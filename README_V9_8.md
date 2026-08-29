# Launchpad36 AI V9.8 — Multi-Tenant Retail Intelligence Foundation

This build changes the product architecture rather than adding another account-level patch.

## What changes
- Company/tenant-scoped sessions.
- Unlimited/metered brands, product families, products and SKUs at the data-model level.
- Products can map to multiple categories and multiple channels.
- Catalog import endpoint for Excel/CSV-normalized rows.
- Website product discovery endpoint using Firecrawl; candidates require review before import.
- Shared Retail Account Universe designed for thousands of organizations.
- Find Me Revenue ranks the shared universe against a tenant's product/category/channel portfolio.
- Market and Channel Intelligence are intended as portfolio-level dashboard modules; account detail remains account-specific.
- Buyer Intelligence includes the V9.7.1 cookie-forwarding auth repair.

## Deploy order
1. Upload the full package contents so the /api files replace/add the matching project files.
2. Deploy.
3. POST `/api/db-init-v9-8` with the admin bearer token once.
4. Sign out and back in so the session cookie receives a tenant_id.
5. Import a product catalog.
6. Load/verify Retail Account Universe data.
7. Run Find Me Revenue.

## Important
Retail Account Universe records support `DISCOVERY_CANDIDATE`, `VERIFIED`, and other evidence states. Do not treat unverified discovery rows as proof that an account currently exists, carries a category, or represents whitespace. Acquisition failure is never evidence of absence.

The current admin-secret login is still a controlled-build authentication mechanism. V9.8 establishes tenant-scoped application data, but production customer identity/invitations/RBAC should replace the admin unlock before paid beta.
