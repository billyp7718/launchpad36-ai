# Launchpad36 AI V9.5.1 — UI & Authentication Repair

## What this fixes
- Startup no longer calls protected business-data endpoints before session authentication is known.
- Locked users see a secure unlock screen instead of a partially broken/read-only application shell.
- Navigation to protected screens prompts for authentication instead of silently failing.
- Successful Admin Unlock now loads protected accounts, products, buyers, and opportunities before entering the application.
- 401 responses reset the UI authentication state instead of leaving stale clickable controls.
- Lock clears commercial data from browser state.
- Account Intelligence remains session protected.
- V9.5 Buyer Intelligence is now wired into Account Detail through **Refresh Buyer Intelligence**.
- Error and loading states are surfaced through existing toast/status UI.

## Deploy
Replace the repository root `index.html` with the `index.html` in this package. Do not move it into `/api`.

## Acceptance test
1. Open the production site in a private/incognito window.
2. Confirm dashboard shows a locked platform and protected navigation prompts for Admin Unlock.
3. Unlock with the current ADMIN_SECRET.
4. Confirm Accounts, Products, Buyers, and Opportunities populate.
5. Test navigation buttons.
6. Open an account and test Run Account Intelligence.
7. Test Refresh Buyer Intelligence.
8. Test Add Account, Add Product, Add Buyer.
9. Test Revenue Pipeline save when intelligence has a valid opportunity.
10. Lock session and confirm commercial data disappears and protected navigation prompts to unlock.

## Security
This repair keeps protected business-data endpoints protected. It does not revert the V9.2 security change by making GET routes public.

## Known scope
This is an admin-session QA repair, not final multi-user/tenant authentication. Production tenant isolation is still required before customer release.
