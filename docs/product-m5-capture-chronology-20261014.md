# Offline capture chronology: product-core guard (#2173)

**Branch scope:** synthetic future-M5 review preparation only. This is not an M5
launch, live supermarket crawler, production permission, or observed M3 savings.

## Historical evidence contract

- Every `success: true` result in the M1 capture manifest needs a real
  `capturedAt` calendar instant: `YYYY-MM-DDTHH:mm:ss[.S|.SS|.SSS]Z`, or
  the same form with a numeric `±HH:mm` UTC offset (maximum ±14:00).
  Invalid months/days, overflowed dates, missing offsets, leap seconds and
  over-precision are rejected rather than silently normalized.
- For an ID captured successfully in both directories, the baseline instant
  must be **strictly earlier** than the current instant after applying the
  declared offsets. Two different spellings of the same instant are not
  historical evidence. If *any* source fails chronology, no review queue is
  published. All comparisons stay manual-only and `m5Eligible: false`.
- A failed capture (`success: false`) is not a verified measurement;
  the existing `unavailable` → P1 behavior remains usable even when no
  successful `capturedAt` exists. Failures do not become P2 or P3.
- The checks run on bounded local manifests *before* source HTML inspection.
  The CLI catches errors and emits the existing generic failure sentence;
  it does not print raw source IDs, paths, timestamps, HTML or URLs.

## Evidence and coordination

The independent original [QA #2174](https://github.com/Zennay/Supa/pull/2174)
contains nine frozen CLI scenarios (three positive, six expected source RED
on the original uncorrected branch). Its original files are not modified here.
New product-core synthetic acceptance tests cover leap day, timezone and
precision boundaries, invalid calendar dates, equal instants and an
unavailable first capture.

This branch is a DRAFT child of frozen [source #2162](https://github.com/Zennay/Supa/pull/2162).
Independent QA must be replayed byte-identically on the corrected source
before any integration decision, alongside exact-head CI, current-main
composition and any applicable trusted runner evidence.

**Release gates remain CLOSED:** live PLUS/DekaMarkt reuse rights are not
granted by this tool. Human [M3 field study #78](https://github.com/Zennay/Supa/issues/78)
still requires the same 11 shopping requirements at each store in one
24-hour context. M4/M5 execution, savings claims, merge and deployment
remain ineligible without their separate human approval and zCloud
preflight/claim/lease/owner gates.
