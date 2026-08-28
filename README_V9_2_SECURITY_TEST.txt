Launchpad36 AI V9.2 — Security + Controlled Agent Test

Purpose
- Close unauthenticated access to tenant/business-data APIs before loading test data.
- Restore CRON-to-agent internal authentication.
- Add a controlled QA seed so the production pipeline can be tested without representing demo products as real customer data.

Security changes
- accounts, products, buyers, competitive-products, opportunities, crm-status now require admin authentication for GET and POST.
- current-products, decision-makers, competitors, assortment-gap require internal authentication (admin session, ADMIN_SECRET bearer, or CRON_SECRET bearer).
- intelligence-agent and executive-auditor accept internal authentication so weekly refresh can call them securely.
- AI Gateway supports AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.
- products POST now preserves manufacturer_id and brand_id.

New endpoints
POST /api/test-seed
  Admin-only. Creates Launchpad36 QA Manufacturer, one QA brand, one QA TV-mount product with three QA-only SKUs, and five real retailer account identities/domains. The QA product data is explicitly synthetic and must never be presented as commercial market truth.

GET /api/security-self-test
  Admin-only. Returns DB object counts and V9.2 security test status.

Recommended production validation after deployment
1. Unauthenticated GET /api/accounts => 401.
2. Unauthenticated GET /api/products => 401.
3. Unauthenticated GET /api/current-products?... => 401.
4. ADMIN_SECRET bearer GET /api/security-self-test => 200.
5. ADMIN_SECRET bearer POST /api/test-seed => 200.
6. Run current-products for one seeded retailer with ADMIN_SECRET bearer; save evidence before judging intelligence quality.
7. Run intelligence-agent with account_id + manufacturer_id.
8. Confirm account_intelligence + intelligence_runs persistence.
9. Run executive-auditor on the same account/manufacturer.
10. Confirm executive_audits persistence and that auditor did not mutate intelligence records.

Important
V9.2 is an admin-isolated production QA foundation, not the final multi-user tenant architecture. External manufacturer onboarding still requires per-user authentication, manufacturer membership resolution, and hard tenant scoping on every business-data query.
