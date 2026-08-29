V9.8.2 Runtime Compatibility Fix

Replace:
api/portfolio.js
api/catalog-website.js

Purpose:
1. Portfolio remains readable even before optional V9.8 join tables are migrated.
2. Website discovery no longer fails merely because catalog_import_runs has not been created yet.
3. Import-run tracking is recorded when the V9.8 migration exists; otherwise discovery returns results with tracking status UNAVAILABLE_UNTIL_V9_8_MIGRATION.
4. Safe server logging exposes the actual error message without logging credentials.

This is a compatibility repair, not a substitute for running the V9.8 database migration.
