# M1 data feasibility — bounded source capture

## Goal

Produce reproducible evidence from real public supermarket pages before any source-specific parser selectors are trusted.

This is a feasibility spike, not a production crawler. It intentionally captures a tiny fixed source set for the two M1 supermarkets selected in the project handoff: Albert Heijn and PLUS.

## Fixed source set

| Supermarket | Kind | URL |
| --- | --- | --- |
| Albert Heijn | product | https://www.ah.nl/producten/product/wi1525/halfvolle-melk |
| Albert Heijn | catalog | https://www.ah.nl/producten |
| Albert Heijn | offers | https://www.ah.nl/bonus |
| PLUS | product | https://www.plus.nl/product/zuivelmeester-halfvolle-melk-pak-1000-ml-579010 |
| PLUS | catalog | https://www.plus.nl/producten |
| PLUS | offers | https://www.plus.nl/aanbiedingen |

## Safety and scope contract

- Public HTTPS pages only.
- No login, cookies, credentials, private APIs or authenticated endpoints.
- No CAPTCHA or anti-bot bypass.
- No link discovery or recursive crawling.
- Only `www.ah.nl` and `www.plus.nl` are accepted, including after redirects.
- Maximum response size is 5 MiB per page.
- One request per fixed source per run.
- Failed/changed sources fail visibly instead of silently substituting guessed data.

## Evidence produced

Every run records:

- requested URL and final URL;
- capture timestamp;
- HTTP status;
- content type;
- ETag/Last-Modified when supplied;
- byte size;
- SHA-256 of the raw response body;
- raw HTML for successful bounded responses;
- a machine-readable manifest including failures.

The GitHub Actions workflow uploads the evidence as a short-retention artifact. Raw live HTML is deliberately not committed to `main` automatically; a parser fixture should only be promoted after inspection and sanitization.

## Next gate

After a successful VPS capture:

1. download/inspect the exact artifact;
2. identify stable structured data or selectors separately for AH and PLUS;
3. sanitize and commit minimal representative fixtures with the capture metadata/hash;
4. implement source-specific adapters against those fixtures;
5. add regression tests for product name, current price, pack/unit, offer mechanics and availability;
6. re-run the live bounded capture to prove at least one end-to-end extraction per source.

A source that blocks or changes materially is evidence for M1; do not work around restrictions by escalating scraping techniques.

## Matching benchmark contract

M1 also requires a reproducible ingredient-to-product matching benchmark before basket calculations can be trusted.

The first benchmark is deliberately a **controlled baseline**, not evidence about live AH/PLUS accuracy yet. It lives in `fixtures/matching/benchmark.v1.json` and covers:

- exact/generic product naming;
- pack-size fit and oversupply;
- mass/volume/piece unit-family mismatches;
- confusing near-neighbours;
- unavailable best candidates;
- ambiguous equal candidates;
- safe abstention when confidence is insufficient.

Run it with:

```bash
npm run m1:matching-benchmark
```

Current safety thresholds are explicit and versioned: at least 90% overall accuracy, at least 85% accepted-match accuracy, 100% correct abstention on gold abstention cases and zero false-positive matches on those cases.

These numbers are only a regression gate for the controlled fixture. They must not be reported as real supermarket matching accuracy. After the VPS source capture is inspected, sanitized AH/PLUS-derived candidates should be added as a new benchmark version and the thresholds re-evaluated against real observed edge cases.

## Automated capture inspection

Every bounded VPS capture is now followed by an integrity/structure inspection before the artifact is accepted.

`npm run m1:inspect-captures -- <capture-directory>`:

- verifies each successful HTML file against the SHA-256 stored in `manifest.json`;
- fails loudly when a captured file is missing or its hash changed;
- records the page title and generic JSON-LD metadata;
- detects generic `application/json` script blocks and framework-level `__NEXT_DATA__` presence without assuming supermarket selectors;
- writes `inspection.json` into the same capture artifact;
- runs even after a partial capture failure so diagnostic evidence remains available.

The inspector does not turn arbitrary markup into product truth. It only reports verifiable structure that can guide the next source-specific adapter decision.

## Schema.org Product fallback

SUPA now has a conservative source-independent parser for standard Schema.org `Product` JSON-LD.

When exactly one usable Product node exists, it may produce a raw product observation for:

- product name;
- stable source identifier from SKU/GTIN when present;
- one unambiguous EUR price;
- explicit availability;
- source snapshot provenance.

It deliberately keeps pack size unknown unless a later source-specific/structured-data path proves it. Multiple Product nodes, non-EUR pricing or otherwise ambiguous data cause abstention rather than guessing. The capture inspector summarizes this parser result automatically when Product JSON-LD is present.

## VPS runner contract

The portfolio execution policy currently advertises the permanent lane with the `self-hosted` label and host `vps-bb300bba`. The M1 workflow therefore uses:

```yaml
runs-on: self-hosted
```

and separately verifies `hostname -s == vps-bb300bba` before doing capture work. Requiring extra undeclared labels would leave valid permanent-runner work queued indefinitely.


## Sanitized candidate export

After integrity inspection, the capture workflow now runs `npm run m1:export-candidates -- <capture-directory>`.

This produces a `sanitized-candidates/` bundle inside the short-retention workflow artifact. A candidate is emitted only when:

- the source is a successful product capture;
- the raw HTML hash was integrity-verified against `manifest.json`;
- the generic Schema.org parser produced one trustworthy observation;
- the observation provenance exactly matches supermarket, source kind, final URL, capture timestamp and SHA-256 from the inspected capture.

The exported candidate contains structured observation data plus provenance only; raw HTML is not copied into the candidate file. Product pages that cannot be interpreted safely are recorded as abstentions in `sanitized-candidates/index.json` rather than guessed into fixtures.

These files are **review candidates**, not automatically committed fixtures. Source-specific AH/PLUS adapters still require inspection of the live artifact and explicit promotion of minimal representative evidence.
