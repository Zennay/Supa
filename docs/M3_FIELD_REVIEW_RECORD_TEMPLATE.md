# M3 field observation — reviewer decision record (blank template)

**Status:** unfilled review form. This document is **not** observed evidence, a collection sheet, or proof of savings. Use it *after* an authentic field observation is processed by the canonical tools described in [issue #78](https://github.com/Zennay/Supa/issues/78) and `docs/M3_OBSERVED_BASKET_STUDY.md`. Never fill missing facts with examples or assumptions.

## Reproducibility identifiers

| Field | Recorded value |
| --- | --- |
| Study ID (pseudonymous) | NOT RECORDED |
| Main revision used for collection (40-char SHA) | NOT RECORDED |
| Field-run workflow run ID / artifact ID (if used) | NOT RECORDED |
| Region (non-identifying) | NOT RECORDED |
| Population / weekStart (YYYY-MM-DD) | NOT RECORDED |
| Shared priceContext (`in-store` or `online-order`) | NOT RECORDED |
| PLUS baseline store/order context and observedAt (timezone included) | NOT RECORDED |
| DekaMarkt candidate store/order context and observedAt (timezone included) | NOT RECORDED |
| Elapsed hours between observations (<=24 required) | NOT EVALUATED |
| Privacy-safe collector export reference | NOT RECORDED |
| Privacy-safe canonical study path + hash | NOT RECORDED |
| Assessment artifact path + hash | NOT RECORDED |
| Tool revision and exact build/assess commands | NOT RECORDED |

## Eleven fixed demand lines

Use the immutable quantities below for **both** stores. Each row's per-store status must reflect the *actual* observation (`observed`, `unavailable`, or `incomplete`). Provide genuine product/pack/price provenance in the collector JSON, **not** personal receipt images or identifiers here.

| Requirement | Fixed quantity | PLUS line status / evidenceId | DekaMarkt line status / evidenceId | Discrepancy or uncertainty |
| --- | --- | --- | --- | --- |
| Kippendij | 600 g | NOT RECORDED | NOT RECORDED | |
| Basmati rijst | 450 g | NOT RECORDED | NOT RECORDED | |
| Kokosmelk | 400 ml | NOT RECORDED | NOT RECORDED | |
| Bloemkool | 2 piece | NOT RECORDED | NOT RECORDED | |
| Garam masala | 20 g | NOT RECORDED | NOT RECORDED | |
| Broccoli | 250 g | NOT RECORDED | NOT RECORDED | |
| Edamame | 150 g | NOT RECORDED | NOT RECORDED | |
| Teriyaki saus | 60 ml | NOT RECORDED | NOT RECORDED | |
| Spaghetti | 250 g | NOT RECORDED | NOT RECORDED | |
| Tomatenblokjes | 400 g | NOT RECORDED | NOT RECORDED | |
| Griekse yoghurt | 100 g | NOT RECORDED | NOT RECORDED | |

## Reviewer gates — no silent acceptance

For each gate enter **PASS / UNKNOWN / REJECT**, cite the exact sanitized input or assessment field, and give a reason when not PASS. A `PASS` requires inspectable evidence, not a generated fixture.

| Gate | Decision | Evidence pointer / reason |
| --- | --- | --- |
| Two genuine store/order contexts, PLUS baseline and DekaMarkt candidate | NOT REVIEWED | |
| Identical fixed demand across both observations | NOT REVIEWED | |
| One priceContext and <=24-hour timestamp interval | NOT REVIEWED | |
| Each of 11 lines explicitly available/unavailable at both stores | NOT REVIEWED | |
| Available lines have authentic product, pack unit/amount/count and priceCents | NOT REVIEWED | |
| Complete source provenance without search snippets or inferred prices | NOT REVIEWED | |
| Converter ran successfully on the real collector export | NOT REVIEWED | |
| Assessment ran successfully on the resulting real study | NOT REVIEWED | |
| Assessment outcome reproduced from committed tool revision and sanitized inputs | NOT REVIEWED | |
| Data retention and privacy boundaries met | NOT REVIEWED | |

## Canonical outcome

- **Raw assessor outcome** (`better` / `same` / `worse` / `unknown`): NOT ASSESSED.
- **Whole-basket price delta and baseline**, only if emitted by the canonical assessor: NOT ASSESSED.
- **Partial or missing coverage and explanation**: NOT ASSESSED.
- **Reviewer conclusion** (`ACCEPT REAL FIELD EVIDENCE`, `REVIEW INCOMPLETE`, or `REJECT`): REVIEW INCOMPLETE.
- **Reviewer/date (role or pseudonym, no identifying account data)**: NOT RECORDED.
- **Issue #78 follow-up / concrete defect link if any**: NOT RECORDED.

**Decision rule:** a negative or unknown result must be preserved, not massaged into savings. This record alone never authorizes closing issue #78; closure additionally requires accepted real inputs and canonical reproducible assessment. Do not publish savings claims from one observed basket. Production automated retailer-data reuse requires separate permission.
