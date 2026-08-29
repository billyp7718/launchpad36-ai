# V9.6.1 UI Overlay

1. Put `apply_v9_6_1.py` in the repository root next to `index.html`.
2. Run: `python3 apply_v9_6_1.py`
3. Review `index.html`.
4. Commit the updated `index.html`. The patch script itself does not need to remain in production.

Adds:
- Channel tabs: All / Online / In-Store / Omnichannel / Unknown
- Evidence counts and explicit in-store warning
- Direct manufacturer SKU vs retailer-product matrix
- Price delta and observed price whitespace
- Missing feature specs remain UNKNOWN
- `runIntel()` now invokes `/api/channel-competitive-intelligence`

This does not claim national in-store assortment from pickup evidence.
