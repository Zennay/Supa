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

## Repeated capture drift detection

M1 requires repeated acquisition to fail visibly when a source changes. After two inspected capture artifacts are available, compare them with:

```bash
npm run m1:compare-captures -- <baseline-capture-dir> <current-capture-dir>
```

The command writes `drift.json` into the current capture directory. It separates ordinary content churn (for example a different HTML hash caused by changed prices/offers) from changes that require review:

- a source being added or removed;
- capture success changing;
- redirect/final URL changing;
- JSON-LD / application-json / framework structure changing;
- the conservative Schema.org Product extraction contract changing.

Volatile HTML hashes and application-json byte counts alone do **not** count as structural breakage. Structural/source-contract changes set `reviewRequired: true` and the CLI exits non-zero so a future repeated-ingestion job can fail visibly instead of silently trusting stale extraction assumptions.

## Capture freshness evidence

Every capture now emits `freshness.json` with:

- capture age per source;
- configured maximum snapshot age (24 hours for the current M1 evidence policy);
- HTTP status and capture success;
- ETag / Last-Modified presence where the source supplies them;
- informational age of Last-Modified when parseable;
- explicit fresh / stale / failed state;
- SHA-256 linkage back to the captured snapshot.

Run manually with:

```bash
npm run m1:evaluate-freshness -- <capture-directory> [--max-age-hours 24]
```

The freshness gate is deliberately conservative about what HTTP metadata proves. A recent capture can pass without ETag or Last-Modified, but missing upstream validators are recorded explicitly. Conversely, a recent Last-Modified header does not rescue an old local capture. The current M1 policy treats capture age as the operational freshness gate; source headers are supporting evidence only.

## Machine-readable M1 evidence gate

After capture, inspection, freshness evaluation and candidate export, the workflow now runs:

```bash
npm run m1:evidence-summary -- <capture-directory>
```

This writes `evidence-summary.json` and cross-checks the evidence bundle by source ID. It only reports `adapterEvidenceReady: true` when:

- all six bounded AH/PLUS sources are represented consistently across manifest, inspection and freshness reports;
- each successful source has verified integrity and a fresh snapshot;
- both supermarkets retain product + catalog + offers coverage;
- each product page has an explicit sanitized decision: candidate or abstention;
- no evidence document silently adds, removes or loses a source.

A Product abstention is valid evidence: it means the generic parser did not guess. It does **not** prove a source-specific adapter can already extract the product. When the evidence bundle is structurally complete, the next action becomes review of the exact live product candidates/raw captures followed by AH/PLUS-specific adapter implementation.

The command exits non-zero when the evidence bundle is not adapter-ready, making an incomplete live artifact a visible M1 failure rather than a manual interpretation problem.

## Reviewed live-fixture promotion

Live product candidates are **not** committed as fixtures automatically. After a capture artifact is inspected, promotion requires an explicit review file whose provenance matches the sanitized candidate exactly.

Run:

```bash
npm run m1:promote-reviewed -- <capture-dir> <review.json> [output-dir]
```

A version-1 review file contains an `approvals` array. Every promoted approval must match the candidate's source ID, supermarket, final URL, captured-at timestamp and SHA-256 exactly, and must include `decision: "promote"`, a non-empty reviewer identifier and a valid review timestamp. Review chronology is part of the trust contract: `reviewedAt` may not predate the captured source evidence, and implausibly future-dated reviews are rejected (with only a small clock-skew tolerance). The tool also rejects abstentions, stale review files whose provenance no longer matches the candidate, and overwriting an existing reviewed fixture with different provenance.

Promoted fixtures contain only the structured candidate observation, exact source provenance and review metadata; raw HTML is never copied into the fixture. This creates a deliberate trust boundary between short-retention capture evidence and versioned regression evidence.

Example review shape (values must come from the inspected live artifact, never from this documentation):

```json
{
  "version": 1,
  "approvals": [
    {
      "id": "<source-id>",
      "supermarket": "<ah-or-plus>",
      "url": "<exact-final-url>",
      "capturedAt": "<exact-capture-timestamp>",
      "sha256": "<exact-capture-sha256>",
      "decision": "promote",
      "reviewer": "<reviewer-id>",
      "reviewedAt": "<review-timestamp>",
      "notes": "<why this candidate is acceptable regression evidence>"
    }
  ]
}
```

## Reviewed-fixture adapter boundary

Promoted live fixtures now pass through a supermarket-specific adapter boundary before they can be consumed as trusted observations. `ahReviewedFixtureAdapter` only accepts reviewed AH product fixtures; `plusReviewedFixtureAdapter` only accepts reviewed PLUS product fixtures.

The boundary deliberately does **not** contain selectors or extraction guesses. It verifies that:

- fixture version/type is the reviewed-live product format;
- the source is a product page for the expected supermarket;
- the observation passes the raw ingestion trust contract;
- source ID/provenance and observation provenance match exactly for supermarket, kind, URL, captured-at and SHA-256;
- reviewer identity and review timestamp are present and valid;
- review chronology is sane: review occurs at/after capture and is not implausibly future-dated;
- cross-supermarket fixture reuse is rejected.

This separates two concerns: live HTML extraction remains source-specific work derived only from observed AH/PLUS captures, while downstream normalization/matching can already rely on a strict reviewed-fixture trust boundary. Once the live capture lands, promoted fixtures can therefore plug into the source-specific adapter regression lane without weakening provenance guarantees.
