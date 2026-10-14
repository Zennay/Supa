# Independent offline M5 provenance QA: original-source witness

Frozen original product DRAFT [#2243](https://github.com/Zennay/Supa/pull/2243) `2ad763d96c4f276a138efcece08b96a872026004` and issue [#2247](https://github.com/Zennay/Supa/issues/2247).

One independent **17-case** synthetic test `tests/qa-m5-canonical-origin-independent-20261014.test.mjs` tests forged equal-missing origin in unchanged P3, null/object/array sources, invisible/padded/overlong supermarket fields, bad 129-unit source IDs, malformed unavailable P1, plus valid exactly 128-unit IDs/origin, Unicode downstream IDs, true P1 source drift/P3 unchanged, valid bounded 100+100 union, immutability and manual-only privacy.

At original-source head, **some targeted tests are expected RED** because the pure queue accepted forged origins and oversize IDs. This PR is proof only and **MUST NOT MERGE OR DEPLOY**.

No retailer requests, real prices, human data, product edits, main, other workers, workflows or VPS. Actual Supa M3 ACTIVE; real human [#78](https://github.com/Zennay/Supa/issues/78) 11 PLUS and 11 DekaMarkt same-demand within 24 hours still required. M4/M5 ineligible. Independent zCloud SQLite write scope/lease and original owner/QA review remain release gates.
