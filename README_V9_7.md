# Launchpad36 AI V9.7 — Intelligence Control Center

Upload/replace these files in the repository root:
- `index.html`
- `api/market-intelligence.js`

The existing `api/channel-competitive-intelligence.js` remains in place.

Changes:
- Removes the eight-box workflow from Account Detail.
- Adds Run Account Intelligence, Run Market Intelligence, Run Channel Intelligence, and Refresh Buyer Intelligence.
- Adds a real Market Intelligence endpoint based only on supplied attributable observations.
- Keeps Channel Intelligence separate from Market Intelligence.
- Filters QA-only manufacturer variants out of market/channel comparison payloads in the UI.
- Account Intelligence can refresh both market and channel outputs.
- No missing evidence is interpreted as absence.

After upload, let Vercel deploy and test with Best Buy / TV mounts.
