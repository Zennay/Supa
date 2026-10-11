# Additional supermarket research — AH, Dirk, Hoogvliet, Jumbo

**Scope:** separate product-core feasibility only, NOT a production scraper, a confirmed DOM parser, or live-price evidence. Supa M3's canonical PLUS + DekaMarkt 11-demand real field study is unchanged ([#78](https://github.com/Zennay/Supa/issues/78)).

## Public research targets

| Store | Exact starting URL | Kind |
| --- | --- | --- |
| AH | https://www.ah.nl/producten/product/wi1525/halfvolle-melk | Product |
| Dirk | https://www.dirk.nl/boodschappen | Catalog |
| Dirk detail | https://www.dirk.nl/boodschappen/zuivel-kaas/boter-margarine/1%20de%20beste%20halvarine/113861 | Product |
| Hoogvliet | https://www.hoogvliet.com/product/melkan-magere-melk | Product |
| Jumbo | https://www.jumbo.com/producten/jumbo-halfvolle-melk-500ml-753539PAK | Product |

The URLs were found on public indexed retailer pages. **No new site-specific CSS selector, current price, or 2026-10-11 DOM snapshot has yet been verified by this repository.** The earlier AH VPS route returned 403; that denial is not a prompt to switch IP addresses.

## Bounded capture on a permitted host

Before collection, check each retailer's terms and robots rules and obtain any needed authorization. No automatic crawler runs by default.

Run: `node scripts/m1-multistore-research.mjs --list`

**Registered URL identity:** `--list` is the reviewed allowlist of exactly five source IDs and exact HTTPS URLs shown above, not a discovery endpoint. On the staged immutable-catalog repair [#1306](https://github.com/Zennay/Supa/issues/1306), both the exported list **and each entry's ID, store, kind and URL** are frozen so another import in the same process cannot retarget a permitted source to a different page—even on the same retailer host. This runtime guard is defense-in-depth, **not** retailer consent or an exception to the manual terms/robots review. Do not patch around it with dynamic URLs or substitute captures; any new registered source requires an explicit reviewed code change and new source-use approval before requesting it. Do not treat a passing synthetic catalog test as actual retailer HTML/DOM/price or M3 savings evidence.

After confirming capture is allowed, opt in to **one registered source**:

```sh
SUPA_RESEARCH_APPROVED=1 node scripts/m1-multistore-research.mjs --capture dirk-boodschappen
```

The tool uses curl (required on the host), never logs in, follows no redirects, never crawls discovered links, downloads at most 5 MiB in 20 seconds, and does not retry denial responses (403/429) or malformed pages. It accepts only HTTP 200 HTML from the exact pinned HTTPS host. Each accepted response is saved in the private and already Git-ignored `artifacts/m1-multistore-research/<source-id>/` folder along with capture time, SHA-256, MIME, byte count, declared source and egress mode. **Do not commit raw captures or real participant/source secrets.** Product pricing is not parsed or inferred by this capture.

### Optional fixed, authorized egress proxy

If your organization has an **approved** HTTP(S) outbound proxy for permitted requests, configure it explicitly before the *first* request:

```sh
SUPA_RESEARCH_APPROVED=1 \
SUPA_RESEARCH_PROXY_URL=http://127.0.0.1:3128 \
node scripts/m1-multistore-research.mjs --capture hoogvliet-magere-melk
```

This is **one fixed credential-free proxy**, not a rotating pool, IP-ban bypass, retry fallback, anonymity mechanism, or geo/CAPTCHA evasion. Do **not** reattempt denied pages through it. The full proxy address is never included in capture metadata. Ordinary environment `HTTP_PROXY`, `ALL_PROXY`, credentials, browser accounts and hidden curl config are not used automatically.

### Capture safety boundaries (offline M1, not evidence)

The approved, single-source research path is intentionally bounded and fails closed:

- **Response headers:** at most **64 KiB of raw bytes**, including UTF-8 multibyte data. Larger `curl --dump-header` files are refused **before being loaded**. Multiple `Content-Type` headers, even if identical or capitalized differently, are rejected rather than selecting the first MIME value. Only unambiguous HTTP 200 HTML is accepted.
- **Response body:** at most **5 MiB**, with a 20-second total request limit and no redirect following, retry, dynamic hostname selection or automatic egress fallback. A denied/oversized/non-HTML response creates **no approved snapshot**; do not retry from a rotated proxy or alternate address.
- **Private output paths:** only the registered source can be written beneath the requested capture root. Existing path ancestors may not be symlinks. Already-existing output/source directories must be owner-private (no group/other bits); the writer creates new private directories as `0700`, and HTML/JSON snapshots with exclusive `0600` file creation. It refuses shared roots instead of quietly changing their permissions.
- **Verification remains separate:** saving private HTML+metadata and matching SHA-256 does not establish retailer permission, browser-DOM identity, reliable prices or any M3 savings claim. Synthetic local-curl tests are not field evidence. The follow-up snapshot **reader** private-mode repair is separately staged in [issue #1258](https://github.com/Zennay/Supa/issues/1258) and must not be assumed deployed merely because the writer enforces private paths.

These are pathname and file-mode checks, not a guarantee against arbitrary concurrent filesystem races. Keep captures inside owner-controlled directories, do not commit them, and stop on any safety error.

### Interrupted or failed capture writes (staged #1272)

The separate [partial-pair repair (#1272)](https://github.com/Zennay/Supa/issues/1272) reserves HTML and metadata with owner-only **exclusive** file handles. During an ordinary handled write/collision failure, it closes the handles and removes **only new files opened in that attempt**. A collision with a pre-existing capture remains an error: old HTML/JSON must never be deleted or overwritten, and no automatic retry is permitted.

This is **not** a crash-atomic filesystem transaction. Forced termination, power loss, storage failure, or concurrent filesystem mutation can still leave incomplete pairs. If private research output contains HTML without matching metadata, a mismatched stem, or metadata without HTML: **stop**. Do not ingest, publish, or treat either file as permission/price/selector evidence. Inspect the owner-private directory offline, retain audit/provenance records where appropriate, and manually resolve the orphan only after identifying which local run created it. Never point a recovery script at an untrusted or shared path, and never use another retailer request or proxy to repair a local snapshot.

A complete matching pair is still **research-only** and requires separate manual DOM/source-permission review. Nothing in this staged repair or its synthetic tests changes the genuine 11-demand PLUS + DekaMarkt M3 field-evidence requirement [#78](https://github.com/Zennay/Supa/issues/78).

## Derive selectors from an actual visible DOM

Public HTML responses can differ from JavaScript-rendered product pages. On a retailer page that the user can normally view with permission, open **Firefox Developer Tools → Web Console**, enable the multiline editor, and run the complete contents of `scripts/m1-dom-candidate-probe.js`. This *local browser-only* probe inspects existing HTML elements and prints counts of CSS candidates actually seen for product links, names, prices, pack-size hints and offers, plus observed tag/class combinations. It sends no requests and does **not** copy text, prices, URLs, cookies, identifiers or account data.

Every candidate includes `semanticVerified: false`: a CSS match alone does not prove a trustworthy product name, actual price, pack unit, retailer, offer, availability, price context or source permission. Promote an adapter **only after** checking a genuine retained page snapshot (and its provenance) and recording reviewer-approved, regression-tested selectors. Fail closed when markup changes, sources refuse requests, product identity is ambiguous or permission is missing.

This experiment deliberately does **not** change current `src/data/ingestion.ts`, production source gates, basket comparison or M3 claims. Recommended sequence: capture approved HTML privately → inspect a rendered DOM → review and sanitize actual candidate elements → implement and test source-specific adapters on a separate reviewed branch.

## Tests

`node --test tests/m1-multistore-research.test.mjs`

Synthetic local curl and DOM stubs exercise success, host/proxy constraints and HTTP403 denial, but **cannot stand in for live supermarket evidence**.
