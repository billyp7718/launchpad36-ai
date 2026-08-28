# Launchpad36 AI V9.3 — Evidence & Trust Engine

This is an overlay package for the current V9.2 repository. Copy the files into the existing repository, preserving the `/api` paths.

## What V9.3 fixes

1. Numerical opportunity scores are suppressed when the record is not scorable. `overall_score` and component scores become `null`, and `scoring_status` becomes `NOT_SCORABLE`.
2. Free-form source strings no longer count as grounding. Observed claims must cite exact IDs from the supplied evidence catalog.
3. Trust is split into evidence coverage, source reliability, freshness, total grounding, external grounding, inference confidence, and recommendation confidence.
4. QA-only portfolios fail the commercial scoring gate and cannot produce a recommended SKU.
5. A new `/api/evidence-refresh` route gathers current public retailer/buyer signals and persists normalized `evidence_items` before the Intelligence Agent runs.
6. Weekly refresh now persists normalized evidence for retailer products and public buyer records.
7. The Executive Auditor adds deterministic controls for unsupported scoring, confidence/evidence mismatches, and internal-only grounding.
8. Agent/Auditor preflight blocks execution before creating a run when Gateway authentication is absent.
9. Intelligence verification is stored as a compact summary rather than duplicating all claims in both record and verification payloads.

## Recommended controlled validation order

1. Deploy the overlay.
2. POST `/api/evidence-refresh` for the Best Buy QA account.
3. POST `/api/intelligence-agent` for the same account/manufacturer.
4. Confirm `scoring_status=NOT_SCORABLE`, `overall_score=null`, and all component scores are null while the portfolio remains QA-only.
5. Confirm `trust.external_evidence_count`, `trust.evidence_coverage`, and `trust.external_grounding_score` reflect only sourced external evidence.
6. POST `/api/executive-auditor` and confirm no critical finding remains for unsupported numerical scoring.

## Important architecture note

V9.3 improves evidence and trust controls but does not complete production multi-user tenant isolation. Manufacturer/account tenancy must still be resolved server-side in the next authentication/tenant build.
