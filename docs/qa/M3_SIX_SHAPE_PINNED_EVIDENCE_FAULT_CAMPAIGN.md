# M3 reviewed retailer evidence — independent six-shape fault campaign

This suite exercises the **actual six historical PLUS/DekaMarkt M1 source kinds** end to end through the SHA manifest builder, strict replay, reviewed ingestion engine and universal catalog. It is **offline, private QA**, not current price evidence, a retailer license, a field-observation substitute or authorization to publish/schedule live scraping.

## Run on a clean checkout

```sh
node --version # Use project-supported Node 24 with native TS stripping
node --experimental-strip-types --test tests/qa-m3-six-shape-pinned-evidence-fault-campaign-20261017.test.mjs
```

The test loads the checked-in authentic **previously reviewed historical** six-source evidence files, then creates restricted temporary 0700 directories with 0600 capture files. Each scenario is isolated; private directories are removed in `finally`, including intentional error paths. None of the test fixtures should be described as fresh actual shelf prices.

## Independent scenario inventory (240)

| Evidence boundary | Distinct scenarios | Assertion |
| --- | ---: | --- |
| Six-source file permutation | 96 | Full actual manifest build and strict replay produce deterministic identical six-shape privacy-safe aggregate counts; no external fetch. |
| Post-pin byte corruption | 42 | Seven bytes/UTF-8 corruption methods × each of six capture files; **both** public aggregate replay and privileged in-process batch load must refuse. |
| Manifest per-capture poisoning | 42 | Seven attacks × six captures: fabricated SHA, altered source kind, swapped file, traversal, reserved manifest file, uppercase SHA and unexpected field are rejected. |
| Manifest root permission/schema tampering | 10 | Unsupported schema/mode, unauthorized production/public flags, extra proof field, missing/duplicated/wrong-type source list fail closed. |
| Valid manifest entry ordering | 24 | Same pinned source bytes reordered/reversed produce exactly the same private aggregate, preserving source-independent semantics. |
| File access policy failures | 18 | For each of six capture files, weakened group/world access and disallowed alias/path are refused before trust. |
| Complete privileged six-kind ingest→catalog | 1 | Real in-memory catalog remains nonpublishable, denied retailer rights, no trusted current price. |
| Full one-command operator pipeline | 1 | Real staged ingest, original manifest immutable on re-run, all six raw fixture file digests unchanged, no price/product/URL evidence on stdout. |
| Malformed UTF-8 before pin | 6 | Each malformed source is refused without leaving a partial pinned manifest. |
| **Total** | **240** | Ten top-level native test methods, each with a transparent deterministic scenario counter. |

**Important counts:** 240 refers to independently executed file/data scenario instances, **not** 240 Node test methods; 10 are the real native test methods. The comparison baseline is the actual 6-shape original fixture replay, not hard-coded fake monetary results.

## Release and ownership boundaries

This new coverage complements but **does not close** M3 #74, #78, #205 and #2833. It does not edit approved source records, mutate product/core parsers, the source-permission register, M3 workflow YAML or other workers' QA branches.

The full official native test/audit/matching/real denied-rights/build CI must be green on the **exact PR head** before any authorized merge; merged tests should be rerun on the merged `main` SHA. A successful quality test can never change `productionReady:false`.

If a new malformed fixture unexpectedly passes, freeze the fail-first regression on its own QA branch, open a P1/P2 source-owner issue and **do not repair source code in the QA lane**. No live retailer HTTP, CAPTCHAs, credentialed routes or private endpoints are part of these tests.
