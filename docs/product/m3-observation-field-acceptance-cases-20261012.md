# M3 observation collector — scenario matrix

DRAFT/HOLD. Synthetic acceptance examples only; no retailer prices or evidence.

| Case | Input | Expected UI | Stored semantics |
| --- | --- | --- | --- |
| Piece singular | demand 1 piece | nodig: 1 stuk | requirement unit remains piece |
| Piece plural | demand 2 piece | nodig: 2 stuks | requirement unit remains piece |
| Negative demand | demand -1 piece | nodig: ? stuks | must not present negative purchase need |
| Unknown demand | null/NaN/Infinity | nodig: ? stuks | no invented numeric value |
| Zero demand | 0 piece | nodig: 0 stuks | zero preserved, not unknown |
| Fractional demand | 1.5 piece | exact fraction visible | no implicit rounding |
| Piece pack selector | packUnit piece | visible option stuk | submit value remains piece |
| Empty 11+11 | both shops unobserved | separate missing statuses | savings unknown, null totals, no public claim |
| Unavailable product | explicitly unavailable | niet beschikbaar | not equivalent to unobserved |
| Partial basket | one missing price | incomplete comparison | no total savings claim |
| Equal basket | complete synthetic matched basket | equal outcome | no real-world claim |
| Shop identity | swapped shop on edit | confirmation requires review | preserve canonical shop identity |

## Testing order
1. Unit-level copy helpers, including negative and nonfinite values.
2. Real ObservationView SSR output for both shops and selector option.
3. Interaction test that submits canonical values and checks validation/error focus.
4. End-to-end synthetic converter/assessor path with no public savings eligibility.
5. Permanent Firefox/mobile and independent release checks only after owner integration.

## Constraints
Do not edit ObservationView owner #522, original pending PRs, real retailer observations, or main without independent zCloud claim/lease and explicit release approval. Human M3 issue #78 remains open.
