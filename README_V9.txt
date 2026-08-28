Launchpad36 AI V9 — Database-First Retail Revenue Intelligence

What changed in V9
- Neon is the system of record for Accounts, Products/SKUs, Buyers and saved opportunity scores.
- No localStorage dependency for core records.
- Account Intelligence is rendered natively in one workflow: Detected Products -> Competitors -> Assortment Gaps -> Decision Makers -> Online Strategy -> In-Store Strategy -> Recommended SKU -> Pipeline.
- Adds secure admin write sessions. ADMIN_SECRET is submitted only to /api/session over HTTPS, then exchanged for an HttpOnly, Secure, SameSite=Strict cookie valid for 8 hours. The secret is not put into client-side storage.
- POST writes to /api/accounts, /api/products, /api/buyers and /api/opportunities require an authenticated admin session.
- Existing DATABASE_URL, ADMIN_SECRET and CRON_SECRET remain the required production environment variables.
- Existing weekly refresh and intelligence endpoints remain available.

Deploy
1. Back up the current repo/production deployment.
2. Replace the repo contents with this package or merge these files carefully.
3. Commit to main; Vercel Git integration should deploy automatically.
4. Verify /api/db-status.
5. Open the app, click Admin Unlock, enter the existing ADMIN_SECRET, and add a test account/product/buyer.

Important
- V9 is still a single-admin beta, not a multi-user SaaS authentication system.
- Public retailer discovery endpoints use best-effort public-site fetching and must retain source/provenance semantics.
- 'Detected on Retailer Site' is intentionally different from confirmed in-stock/current assortment.
