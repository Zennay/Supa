# Supa M3: exact GitHub-native expected-RED CI proof

The six reviewed historical PLUS/DekaMarkt snapshots remain **private, offline test
evidence**, never an external capture authorization. This tool is for the QA1
worker to classify already completed native GitHub Actions logs safely.

## Example: combined source-integrity replay

The independent QA composition is [draft PR #3705](https://github.com/Zennay/Supa/pull/3705)
on product owner #3687, currently at `e898cca6dc4ee2e58afa5de3175223e89a864373`.
GitHub-hosted [run 38976994948](https://github.com/Zennay/Supa/actions/runs/38976994948)
(job `117228727759`) completed **FAILURE**, not SUCCESS.
The full job log reported `# tests 3363`, `# pass 3296`, `# fail 67`,
`# skipped 0`, `# cancelled 0`. Expected QA1 source-integrity regressions:

- Direct universal catalog URL parity: 18 RED (issue #3695)
- Impossible civil UTC lower floor across six adapters: 19 RED (issue #3701)
- Bare listing source URL delimiters: 12 RED (issue #3394)
- Downstream offer/event auditor raw URL: 18 RED, including enclosing failures (issue #3413)

Download the **original complete job log**, then classify it locally without
GitHub credentials, retailer network requests, production data or write access:

```sh
node scripts/qa-native-red-ci-proof.mjs \
  --expected-red=67 \
  --allow=qa-universal-catalog-source-url-parity-20261016.test.mjs \
  --allow=qa-six-adapter-negative-utc-civil-floor-20261016.test.mjs \
  --allow=qa-retailer-bare-url-delimiter-provenance-20261016.test.mjs \
  --allow=qa-retailer-downstream-raw-url-20261016.test.mjs \
  < original-full-github-job.log
```

The verifier binds *each* TAP `not ok` to the full job log's `location`
and an exact, explicit QA-owned file name; it checks TAP arithmetic, precisely
the expected number of failures, no skipped/cancelled/todo cases, and no
independent Actions error. It prints only aggregate counts and refuses
unrecognized failures, missing suites, changed log formats or truncated TAP.
Input is bounded to 12 MiB and the CLI makes no network requests.

**This is classification, not release evidence.** An `expected-qa-red-only`
report explicitly marks source-permission and production build as
`not-proven-by-red-node`, and `productionReady:false`. Separately inspect
the exact source SHA, upstream workflow steps, npm audit, build and the
canonical rights gate in official GitHub Actions. Never infer unexecuted CI
steps from RED Node results. The four original QA test blobs should remain
byte-identical during product-owned RED→GREEN repair. A passing future suite
requires its own full exact-head proof and protected integration lease.

M3 external rights #74, human 11×2 field proof #78, collector SHA #205 and
permanent runner #2833 remain HOLD. No live retailer fetch or public saving.

## Native log completion envelope — QA1 follow-up (17 October 2026)

An allowlisted failure count alone is not sufficient. An incomplete log with
synthetic `not ok` lines and internally consistent totals could previously be
classified as completed exact-hosted CI, even without the final GitHub job exit.
The independent [issue #3746](https://github.com/Zennay/Supa/issues/3746)
and [QA child PR #3745](https://github.com/Zennay/Supa/pull/3745) add
immutable fail-first examples and harden this **QA tooling**, not the product:

1. Require exactly one root `TAP version 13` header, before the single
   top-level `1..N` test plan, with `N` equal to the `# tests` total.
2. Require all six unique TAP summary fields **after** that plan.
3. Require exactly one standard hosted terminal
   `##[error]Process completed with exit code 1.` **after** those summaries.
   Ordinary subsequent GitHub post-step cleanup lines remain allowed.
4. Reject omitted, duplicated, out-of-order or inconsistent envelope fields.
   Continue rejecting non-test Actions errors, missing QA locations and
   unallowlisted failures; never emit positive-looking JSON for a refused CLI.

The parser expects a **single original complete GitHub-native test job log**.
Check the workflow run's verified commit, job ID, outcome and exact PR merge
checkout separately using the GitHub API/UI: the log parser does **not** supply
cryptographic authenticity, identity of the run, source permission, build
success or proof of a genuine retailer observation. No fake storefront prices,
source permission grants, or human field measurements may be created for tests.
The default canonical rights file is still PLUS `permission_required` and
DekaMarkt `unresolved`; production and public savings stay disabled.
