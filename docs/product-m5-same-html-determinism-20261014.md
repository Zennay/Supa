# SUPA future-M5 offline HTML fingerprint determinism — 14 October 2026

## Why this is needed
The exported pure `buildOfflineSelectorReviewQueue()` consumes a report produced by the canonical M5 capture comparer. Current and historical captures with the **same canonical ID, supermarket/kind and verified HTML SHA-256** represent identical HTML bytes. The deterministic M1 inspector and M5 `captureShape()` run at the same version for both sides; they cannot produce two different shape SHA-256 values or Schema.org status classifications for those same bytes. Previously, the pure queue could accept a fictional report claiming `shape_changed` P1 while preserving exactly the same HTML hash and different shape/status values. This admitted an impossible human-review priority instead of signalling corrupted/forged offline input.

## Owner-safe correction
- Frozen upstream product parent: [DRAFT #2248](https://github.com/Zennay/Supa/pull/2248) SHA `baf6d48c133123229cad45d7db6fbbe3e1e8e10f`, which already corrected bounded source IDs and origins.
- Separate product-core child of that SHA. The source-only edit validates that two verified snapshots of the same source and origin with identical HTML SHA-256 cannot have different structural or Schema.org classification fingerprints.
- Reuses the existing generic `Invalid offline capture comparison report` error; never exposes origin labels, capture IDs or paths, and never emits a partial queue.
- True P1 `shape_changed` remains valid **when actual SHA-verified HTML content changes** and shape/schema differs; P2 content-only change, P3 genuinely identical source, origin drift P1, capture failure P1 and no-baseline onboarding P1/P2 remain unchanged.
- Original QA owners, main, M1/M3, UI, workflows, permanent VPS, actual retailer sources and customer data remain untouched.

## Deterministic checks
`node --test tests/product-m5-same-html-determinism-20261014.test.mjs`

Eleven synthetic product tests: forged shape, schema or combined P1 with unchanged HTML; real changed-HTML shape and schema P1; exact same-content P3; changed HTML but stable shape P2; origin P1; failure P1; no-baseline P1/P2; physical 100+100 historical/current union and input immutability. No network, prices, retailer requests or M3 evidence. Run full GitHub hosted `npm test`, `npm audit --audit-level=high`, M1 source-permission and matching checks, and TypeScript/Vite production build on exact final commit. Earlier physically impossible synthetic examples must be corrected on this child only if they fail this stronger invariant; never weaken security contract to satisfy forged examples.

## Release boundary
**M3 ACTIVE** and genuine human [PLUS 11 + DekaMarkt 11 same-demand field study #78](https://github.com/Zennay/Supa/issues/78) is open; M4/M5 are not eligible. This is future offline manual-input correctness only, no selectors, production ingestion, source rights, savings claim or beta. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently verified zCloud SQLite conflict-scope claim/write lease, source and QA review, exact CI and latest-main/trusted runner when applicable, genuine M3 field evidence and explicit human release authorization.
