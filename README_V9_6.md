# Launchpad36 AI V9.6 — Channel & Competitive Intelligence Engine

Overlay release. Add `api/channel-competitive-intelligence.js` to the existing repo.

## Purpose
Separates web assortment from physical-store evidence and compares manufacturer SKUs against detected competitive offerings.

## Channel semantics
- ONLINE_CONFIRMED: online transaction/shipping signal.
- IN_STORE_SIGNAL: pickup/store signal was observed.
- OMNICHANNEL_SIGNAL: both online and pickup/store signals.
- ONLINE_DETECTED_IN_STORE_UNKNOWN: product detected online, but physical-store evidence is insufficient.

A pickup signal is not treated as national physical distribution. Store/ZIP-specific evidence is required before calling a SKU "in-store confirmed."

## Comparison semantics
Uses manufacturer variant MSRP/MAP/attributes already stored in Launchpad36 and retailer observations from the Evidence Acquisition Engine. Missing features remain UNKNOWN. No LLM-created specs.

## Next UI overlay
The Account Detail UI should render four channel tabs (Online, In-Store, Omnichannel, Unknown), a SKU-vs-competitor matrix, price whitespace, and "Why pitch this SKU?" only after sufficient evidence exists.
