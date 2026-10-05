# Basket explanation & trust research — 2026-10-05

## Why this exists

SUPA is still in **M3 — full-basket comparison & real-world savings proof**. This research does not close M3 and does not authorize M4 beta execution.

M4 H3 asks whether savings explanations improve trust in basket recommendations. The existing beta contract already records whether an explanation was viewed before a recommendation decision and whether the recommendation was followed. This note sharpens **what an acceptable explanation should contain** and what SUPA must avoid if it wants trust evidence rather than persuasion evidence.

## Evidence reviewed

### 1. Recommendation explanations can influence choices, not only inform them

Rahman, Siemon & Ruotsalo (International Journal of Human-Computer Studies, 2026) experimentally studied persuasive explanations in recommender systems and reports that explanation wording can influence rational and irrational user choices.

Source:
- https://doi.org/10.1016/j.ijhcs.2025.103720

**SUPA consequence:** H3 must not be framed as "did the explanation make the user follow SUPA?". A high follow rate can be bad evidence if the copy is merely persuasive. Measure understanding, trust and override reasons separately from compliance.

### 2. Price algorithms can reduce trust and increase search effort

Vomberg, Homburg & Sarantopoulos (International Journal of Research in Marketing, 2025) report across multiple studies that algorithmic dynamic pricing can reduce trust and increase price-search duration, with price fairness central to the effect.

Source:
- https://doi.org/10.1016/j.ijresmar.2024.10.006

**SUPA consequence:** unexplained price context, volatile prices or an overconfident "best" label can push users back into manual checking. Explanations should expose the observation context and uncertainty instead of asking users to trust hidden calculations.

### 3. LLM explanations are promising, but evidence is still thin

A 2025 Frontiers review of LLM-generated explanations for recommender systems found only six directly relevant studies in its 2022–2024 search window. The review distinguishes readable natural-language justifications from precise analytic explanations and notes that explainability quality still needs user evaluation.

Source:
- https://doi.org/10.3389/fdata.2024.1505284
- https://www.frontiersin.org/journals/big-data/articles/10.3389/fdata.2024.1505284/full

**SUPA consequence:** do not let an LLM invent the reason a basket won. Generate the factual explanation from the deterministic basket trace first. Natural-language rewriting, if added later, must be constrained to that evidence.

### 4. Current Dutch price evidence shows that "cheapest supermarket" is context-dependent

The Consumentenbond's 30 June 2026 price survey compared 131 budget products across 13 chains using a 6 May 2026 measurement. DekaMarkt was 4% below the study average and PLUS 1% above it, but the comparison excluded offers and standardized pack-size differences. It also notes that some cheapest products were missing online, including at DekaMarkt.

Source:
- https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten

**SUPA consequence:** a broad chain-level ranking is not a valid explanation for one user's basket. SUPA must explain the **observed same-demand basket** with explicit store/order context, pack normalization and unresolved lines. External price surveys are context, not evidence for a specific recommendation.

### 5. Promotions can look cheaper while increasing quantity bought

The Consumentenbond analysed more than 44,000 supermarket offers across eight weeks and reported that 57% were bulk promotions, with 1+1 free the most common form.

Source:
- https://www.consumentenbond.nl/acties-claims/nieuws/2026/bulkaanbiedingen-supermarkt

**SUPA consequence:** "discount" is not enough. An explanation should show required quantity, pack count, effective basket cost and whether the offer creates excess inventory/reuse burden. Cheap unit price and good weekly-plan economics are different claims.

### 6. Unsupported lowest-price claims are a trust risk

The Consumentenbond challenged supermarket "lowest price" claims in 2025–2026 when they were not transparently substantiated and highlighted errors and selective comparison in specific campaigns.

Sources:
- https://www.consumentenbond.nl/acties-claims/nieuws/2025/laagsteprijsclaims-van-supermarkten-update
- https://www.consumentenbond.nl/prijspeiling/consumentenbond-jumbo-te-kort-door-de-bocht-in-paasreclame

**SUPA consequence:** avoid universal language such as "goedkoopste supermarkt", "beste deal" or "je bespaart altijd". Prefer bounded statements such as "voor deze gemeten boodschappenlijst, in deze prijscontext, was basket A €X goedkoper; Y regels waren onzeker/onbeschikbaar".

## H3 product contract

A basket recommendation explanation should answer, in this order:

1. **Outcome** — which basket is better/same/worse/unknown for this observed demand?
2. **Magnitude** — exact comparable basket delta in euros, without converting one observation into a general savings percentage.
3. **Context** — store/order context, observation timestamps and freshness boundary.
4. **Reason** — the largest deterministic contributors: pack size, offer, unit price, required quantity and reuse.
5. **Uncertainty** — unavailable, unmatched, stale or non-comparable lines remain visible.
6. **Trade-off** — any extra quantity, store friction or leftover burden created by the cheaper result.
7. **Control** — the user can choose the other option without being told that overriding is irrational.

## Copy guardrails

Prefer:
- "Voor deze boodschappenlijst is DekaMarkt €3,42 goedkoper in de gemeten winkelcontext."
- "2 van 11 regels zijn onzeker; daarom is het verschil niet volledig zeker."
- "De 1+1-aanbieding verlaagt de prijs per stuk, maar vraagt 2 verpakkingen."
- "PLUS is duurder in deze meting, maar heeft 1 product beschikbaar dat bij DekaMarkt ontbreekt."

Avoid:
- "DekaMarkt is de goedkoopste supermarkt."
- "Slimste keuze."
- "Je bespaart gegarandeerd €3,42."
- "92% goedkoper" style framing without a defensible comparable baseline.
- explanations generated from user-profile guesses rather than the recorded basket trace.

## M4 evidence changes to retain

The existing event contract is sufficient for the first beta. Do **not** add telemetry before M3 closes.

When H3 executes, interpret evidence as a bundle:
- explanation viewed before decision;
- trust rating;
- uncertainty understood;
- recommendation followed/overridden;
- override reason;
- observed basket outcome.

A recommendation being followed is not automatically positive. A participant who understands the uncertainty and deliberately overrides SUPA can be a **successful explanation outcome**.

## Candidate H3 interview prompts after M3 closes

1. "Kun je in je eigen woorden uitleggen waarom SUPA deze optie aanbeveelt?"
2. "Welke informatie maakte je meer of minder zeker?"
3. "Was er iets dat te overtuigend of te stellig voelde?"
4. "Welke onzekerheid zou je vóór je keuze willen zien?"
5. "Als je SUPA negeerde: kwam dat door prijs, moeite, voorkeur, beschikbaarheid, hoeveelheid of vertrouwen?"

These are protocol-review candidates, not authorization to change the locked beta protocol before the M3 gate closes.

## Product/backlog consequence

After PWQ-14/AUD-003 closes, the first explanation implementation should be **trace-derived and compact**:
- deterministic facts first;
- one bounded recommendation sentence;
- visible unresolved-line count;
- expandable price/pack/offer contributors;
- explicit alternative/override.

Do not start with an LLM-generated narrative layer. Add one only if beta evidence shows that the deterministic explanation is understandable but too hard to read, and keep generation constrained to the recorded trace.

## Guardrail

This research:
- does not close AUD-003;
- does not create genuine basket evidence;
- does not justify public savings claims;
- does not enable M4 recruitment or instrumentation;
- does not change the current issue #78 field-run dependency.

The current product-critical action remains one genuine same-demand PLUS + DekaMarkt basket pair within 24 hours in one shared price context, processed through the existing M3 converter and assessment path.
