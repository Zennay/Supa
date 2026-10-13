# Newest M5 owner-source frozen replay — 2026-10-13

## Evidence ownership

- Original independent QA acceptance [PR #2129](https://github.com/Zennay/Supa/pull/2129), original SHA `7222fa0b7837fae4d0495631999be0b53d186a95`, seven-case test blob `b876440b57d7b462aa6d4a3e21d5936d98084f11`.
- Product owner [DRAFT #2126](https://github.com/Zennay/Supa/pull/2126) has since advanced **without editing the pure selector comparison validator**, adding a CLI generic private error boundary and two actual CLI tests; latest frozen parent SHA `53f52a8dcb65a751ff5701ac2cb79de8e28430a2`.
- Own QA base `qa/frozen-m5-owner-cli-53f52a8d-20261013`; independent QA branch adds only renamed byte-for-byte original QA seven-case test and this evidence document. No modifications to original product, original QA, other owner branch, workflows, main or actual field records.
- The imported test retains exactly the original **Git blob SHA**, confirming no loosened assertions. Same 3 valid positives and 4 expected source integrity RED controls from [issue #2128](https://github.com/Zennay/Supa/issues/2128): ill-formed UTF-16 source ID collision, forged verified schema-org status, and two impossible unavailable-capture metadata combinations.

## Acceptance and safety

Hosted CI must be checked on immutable head; verify that all four formerly RED cases remain exactly RED, three original positives remain GREEN, and no new unrelated failures occur after owner CLI correction. Existing owner 682/682 PASS confirms only the product-owner original tests, not this independent source contract. If repaired source appears later, independently replay same unmodified QA file on its own frozen corrected parent and require all seven green.

No actual web requests or scraping. Fictional M1 capture records and not production-approved. Milestone M3 ACTIVE, real [field #78](https://github.com/Zennay/Supa/issues/78) open, M4/M5 ineligible. **DRAFT / HOLD / NO MERGE / NO DEPLOY**, requiring zCloud independent task claim/write lease, original owner review, applicable permanent VPS evidence, latest-main integration and human release authorization.
