Launchpad36 V9.8.1 Website Import Fix

Replace:
api/catalog-website.js

Fixes:
- Accepts bare domains such as ergoav.com
- Accepts www.ergoav.com
- Accepts full HTTPS URLs and product/category paths
- Automatically normalizes missing protocol to HTTPS
- Restricts discovery to HTTP/HTTPS vendor sites
- Returns clearer validation/discovery error codes
- Preserves UNKNOWN semantics when no product pages are discovered

After replacing the file, redeploy Vercel and retry Vendor Website discovery.
