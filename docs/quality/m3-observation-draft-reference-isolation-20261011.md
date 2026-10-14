# M3 field-sheet mutable reference isolation — quality contract (2026-10-11)

## Scope and trust boundary

M3 field collection uses a canonical four-meal / eleven-ingredient plan and
two *independent* blank store observations (baseline **PLUS** and candidate
**DekaMarkt**). The sheet is a **collection template**, not observed evidence.
Its two store forms and their canonical requirements must never share writable
JavaScript objects. Otherwise editing one store could silently alter the other
store's quantity, availability, price or product attribution before export.

This contract is intentionally narrower than the ongoing M3 timestamp precision
issue (#1513), comparator cross-basket atomicity issue (#1508), and genuine
field-observation gate (#78). It does not test arbitrary hostile JavaScript
Proxies or resolve either of those other issues.

## Executable acceptance

- `tests/m3-observation-draft-side-isolation.test.mjs`: all reachable
  mutable objects under `baseline`, `candidate` and `requirements`
  are disjoint. Explicit mutation of PLUS labels, requirement amounts,
  prices, products and store identity cannot alter DekaMarkt or the
  authoritative requirements.
- The same suite proves that changing a canonical requirement object in the
  sheet cannot silently rewrite either store's snapshotted demand.
- `tests/m3-observation-draft-replay-isolation.test.mjs`: consecutive
  `buildObservationSheet()` calls must produce identical blank JSON but
  different writable instances; edits of one template cannot taint a later
  collection.
- The replay suite proves JSON draft restoration creates fresh nested objects,
  keeps PLUS edits separate from DekaMarkt, cannot mutate the serialized
  original and does not promote the restored template to observed evidence.

## Release and evidence boundary

These are synthetic object-isolation regressions; they contain no genuine
retailer prices, checkout information, receipt, permitted live source, or
measured saving. They neither establish M3 readiness nor close #78.
Do not merge/deploy without owner coordination, exact-head green hosted CI,
applicable permanent VPS/browser evidence, and review against the then-current
`main`. This standalone QA branch changes only new test and policy files;
production source, existing tests, workflows and field evidence remain intact.
