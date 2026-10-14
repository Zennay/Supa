# SUPA future M5 — pure inspected JSON-script physical HTML budget (14 October 2026)

## Background and impact
SUPA is still **M3 ACTIVE**, not M5. The genuine same-demand PLUS 11 + DekaMarkt 11 within 24h observation in [issue #78](https://github.com/Zennay/Supa/issues/78) has not been supplied. No retailer source reuse, M5 selector activation, beta release or savings claim is authorized.

The frozen parent [product DRAFT #2269](https://github.com/Zennay/Supa/pull/2269) at exact hosted-green `1468d2a64c9f6d9019f212f0a0ea656c449fe9eb` validates each application/json script's count/type, but the **exported pure** `captureShape()` accepted a descriptor claiming far more than the **8 MiB total captured HTML** capacity or an aggregate of 128 bodies each individually close to 8 MiB. It also accepted a descriptor ID longer than the captured document itself. Such in-memory forged M1 inspected metadata cannot arise from one real SHA-verified capture and should not appear as trusted future M5 selector-drift evidence.

## Corrected contract
- Preserve existing `MAX_CAPTURE_HTML_BYTES = 8*1024*1024` used by the offline captured-HTML reader; **do not create a second competing resource cap**.
- Every `applicationJsonScripts[].bytes` must remain a safe nonnegative integer **no greater than the full HTML cap**, and the total of all the validated script bodies must also remain below or at that cap. Bounded addition avoids precision/overflow ambiguity.
- A nonnull script `id` must be a string with UTF-16 length no greater than the maximum HTML byte count; a string extracted from bounded UTF-8 HTML cannot be longer in JS code units than its original byte budget. Existing null and empty IDs are unaffected. This intentionally permits conservative `==8 MiB` in-memory descriptor boundary; actual HTML has enclosing tags and the canonical disk capture gate is stricter in practice.
- Refuse impossible pure inspections via the preexisting fixed `Invalid or unbounded inspected HTML shape` error before returning comparison metadata, with no source labels, URLs, or paths echoed. The normal M1 HTML parsing, capture SHA, P1/P2/P3 human actions, private source tokens and rights/production/M5=false gates remain unchanged.

## Verification
The new `tests/product-m5-script-budget-20261014.test.mjs` has 12 invented in-memory and real `inspectHtml` integration tests: one +1 byte, two individually valid bodies exceeding budget in aggregate, 128-body overflow and exactly bounded positive, exact cap plus one byte, impossible oversize descriptor ID, legal null/empty/loose-boundary ID, scalar bounds, unchanged pure input, bad shape refusing a comparison and true tiny invented M1 HTML → M5 P3 review. No network, cookies, retailer URLs, actual prices, physical field evidence or P1 deployment.

This is a three-path **product-core-only isolated child**, [issue #2273](https://github.com/Zennay/Supa/issues/2273). The QA worker independently owns the summary-only CLI #2270/#2271; no modifications to its branches or #2269 original source. Run and verify *exact-head* GitHub CI: `npm ci`, `npm audit --audit-level=high`, all Node tests, M1 benchmark/permission and TypeScript/Vite production build before claiming accepted tests.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently verified zCloud SQLite task scope/write claim+lease, original product+QA review, current-main/trusted VPS as applicable, authentic M3 #78 observations and explicit human releasego.
