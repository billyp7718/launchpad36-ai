LAUNCHPAD36 AI V9.1 — AGENTIC RETAIL REVENUE INTELLIGENCE

Adds:
- L36 Intelligence Agent using Vercel AI Gateway
- Deterministic evidence grounding / confidence verification
- Persistent intelligence runs and account intelligence
- L36 Executive Product Auditor (C-level adversarial product/workflow audit)
- Brand table foundation (manufacturer supports up to 4 brands at application layer)
- Evidence item store
- Secure agent invocation using the existing admin session

REQUIRED ENVIRONMENT
DATABASE_URL
ADMIN_SECRET
CRON_SECRET
AI_GATEWAY_API_KEY
Optional:
L36_AGENT_MODEL (default openai/gpt-5.6-sol)
L36_AUDITOR_MODEL (defaults to L36_AGENT_MODEL)

DATABASE UPGRADE
After deployment, POST /api/db-init-v9-1 with Authorization: Bearer <ADMIN_SECRET> once.

IMPORTANT MULTI-TENANT NEXT STEP
This build establishes manufacturer/brand and agent persistence, but production multi-user authentication and hard tenant scoping must be completed before onboarding external manufacturers. Do not expose manufacturer_id as an authorization mechanism. The authenticated server session must resolve the tenant.

AGENT ENDPOINTS
POST /api/intelligence-agent
body: {"account_id":"UUID","manufacturer_id":"UUID"}

POST /api/executive-auditor
body: {"manufacturer_id":"UUID"} or include account_id for account-level audit.

NEXT BUILD STEP
1. Production multi-user auth + manufacturer membership.
2. Enforce max 4 active brands.
3. Add manufacturer_id tenant scoping to all business tables/APIs.
4. Expand verified Retail Account Universe / Find Me Revenue.
5. Wire account UI to intelligence-agent and Executive Audit dashboard.
