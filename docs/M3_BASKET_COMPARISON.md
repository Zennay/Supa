# M3 full-basket comparison contract

M3 asks whether SUPA produces trustworthy financial value. This first increment
defines when two one-store baskets are comparable before any savings number may
be claimed.

## Baseline

The baseline is a complete one-store basket generated for the same selected meal
demand as the candidate basket. Recipe estimates are not a baseline.

A comparison is claimable only when both baskets:

- contain no unresolved ingredient lines;
- cover the same ingredient ids;
- carry the same required amount and unit for every ingredient;
- select the same number of meals;
- have internally consistent line counts and totals.

If any of those checks fail, the outcome is `unknown` and no delta/savings
number is exposed.

## Outcomes

- `better`: candidate full-basket total is lower than the baseline.
- `same`: totals are equal.
- `worse`: candidate full-basket total is higher than the baseline.
- `unknown`: the comparison is incomplete or not equivalent.

Line-level deltas are retained for a claimable comparison so later M3 work can
separate pack-size, offer and planning effects rather than hiding them in one
headline number.

## Explanation boundary

A claimable line delta proves only **where** the candidate basket total differs
from the baseline for the same ingredient demand. Product copy may state that a
specific candidate line is a bounded euro amount higher or lower and may rank
the largest absolute contributors.

A line delta does **not** by itself prove **why** the difference exists. Do not
label a delta as a pack-size, offer, planning, unit-price or reuse effect unless
the separate savings-attribution contract has explicit evidence for that cause.
If causal evidence is absent, keep the explanation descriptive rather than
inferential.

For `unknown` or otherwise non-claimable comparisons, suppress both the overall
financial delta and any line-level financial breakdown. Do not use a partial
line breakdown to imply a savings result that the full-basket gate rejected.

## Evidence boundary

The regression fixtures prove calculation behavior only. They are not evidence
of real supermarket savings. Real observed weekly baskets, a declared time
window and production-source permission remain required before a public savings
claim.
