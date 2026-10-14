# M3 field run — one-page operator card

**Purpose:** collect one authentic 11-line PLUS baseline and DekaMarkt candidate basket pair, not a savings advertisement. This card complements (and does not replace) [the canonical study protocol](M3_OBSERVED_BASKET_STUDY.md) and [issue #78](https://github.com/Zennay/Supa/issues/78).

## Before going to the stores

- [ ] Record the **current `main` commit SHA** (or the dispatched workflow run that resolves to it); generate a fresh `supa-m3-field-run-pack` from the existing M3 observed-week report workflow.
- [ ] Pick **one** shared `priceContext`: `in-store` OR `online-order`. Do not mix them.
- [ ] Choose a pseudonymous `studyId` and `participantKey`; record region, population and week start. Do not commit personal information, account numbers or receipt images.
- [ ] Record PLUS as `baseline`, DekaMarkt as `candidate`. Note each store/order context and real observation timestamp. Finish both observations **within 24 hours**.

## Same demand at BOTH stores — do not change quantities

| Requirement | Exact demand | PLUS observed pack, price, availability | DekaMarkt observed pack, price, availability |
| --- | ---: | --- | --- |
| Kippendij | 600 g | | |
| Basmati rijst | 450 g | | |
| Kokosmelk | 400 ml | | |
| Bloemkool | 2 stuks | | |
| Garam masala | 20 g | | |
| Broccoli | 250 g | | |
| Edamame | 150 g | | |
| Teriyaki saus | 60 ml | | |
| Spaghetti | 250 g | | |
| Tomatenblokjes | 400 g | | |
| Griekse yoghurt | 100 g | | |

For **each store and each line**, explicitly mark `available: true` or `false`. If available, capture actual `productName`, `packAmount`, `packUnit` (`g`, `kg`, `ml`, `l`, `piece`), positive integer `packCount` and observed non-negative integer `priceCents` **per pack**. Preserve observed pricing and multipacks; never manufacture missing prices, substitutes or availability. For unavailable products, leave them unavailable.

For each observation also record `evidenceId`, real `observedAt` timestamp, `source` (`manual-cart`, `receipt`, or `consented-export`), `provenanceNote`, `store.id`, and `store.name`. Search snippets and non-store-selected product pages are **not** evidence.

## After collection — deterministic conversion, no improvised calculator

1. Export the completed collector JSON from **Meten**.
2. Run `npm run m3:build-observed-study -- <collector.json> --output evidence/m3/<study>.json`.
3. Run `npm run m3:assess-observed-week -- evidence/m3/<study>.json --output artifacts/m3/<study>-assessment.json`.
4. Retain the privacy-safe assessment and provenance. Report `better`, `same`, `worse` **or** `unknown` without changing the result or turning one observation into a public savings claim.
5. Record the actual validation outcome on [issue #78](https://github.com/Zennay/Supa/issues/78). Only then review M3 closure.

**Stop rules:** missing contextual prices, unmatched availability, price-context mismatch or a >24h gap are *not* reasons to fabricate data. Keep the case incomplete/unknown and document the exact evidence gap. Retailer production reuse remains separately permission-gated.
