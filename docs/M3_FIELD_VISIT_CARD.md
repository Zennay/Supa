# M3 veldkaart — PLUS + DekaMarkt

This is a **printable companion, not collected evidence**. The card obtains its 11 ingredient requirements from the same `buildObservationSheet()` source used by Supa's current M3 collector. It never inserts prices, availability, store observations, timestamps or participants.

## Create a blank card

From a fresh `main` checkout, record the exact Git commit/workflow ID that will be used for the genuine M3 field visit, as required by [the observed study contract](M3_OBSERVED_BASKET_STUDY.md) and [issue #78](https://github.com/Zennay/Supa/issues/78).

```bash
# Print/display the identical demand for both retailers.
node --experimental-strip-types scripts/m3-field-visit-card.mjs

# Or prepare individual store cards without changing the canonical demand.
node --experimental-strip-types scripts/m3-field-visit-card.mjs --store plus
node --experimental-strip-types scripts/m3-field-visit-card.mjs --store dekamarkt

# Optional: save a blank PRINT COPY to the git-ignored local artifacts directory.
mkdir -p artifacts/m3
node --experimental-strip-types scripts/m3-field-visit-card.mjs > artifacts/m3/blank-field-card.txt
```

Printing/saving this text does **not** produce observation evidence. Only human-confirmed observations should populate the JSON sheet. Do not commit a hand-filled card, receipt, name, email or account ID; these may reveal participant/store-visit details.

## Invulvelden en echte M3-gegevens

De veldkaart is bewust leeg. De officiële converter verwacht **afzonderlijke velden**; schrijf geen twee waarden samen in één notitie:

- **Studie:** `studyId`, pseudonieme `participantKey`, `population` (doelgroep), `region`, `weekStart` en één gedeelde `priceContext`.
- **Per winkel:** werkelijke `store.name`, een **unieke, zelfgekozen** `store.id` (geen klantnummer), `observedAt` met datum/tijd/tijdzone, `source`, een eigen `evidenceId` en afzonderlijke `provenanceNote` (wat/waar/hoe waargenomen). Gebruik niet dezelfde winkel- of bewijs-ID voor beide winkels.
- **Per productregel:** kies beschikbaarheid expliciet. Bij **ja** noteer een herkenbare productnaam, inhoud met eenheid, het aantal artikelen **in één verkooppakket** (`packCount`; 1 bij enkelpak) en de geobserveerde prijs **per verkooppakket** in EUR. Dit aantal is **niet** het aantal aan te schaffen verpakkingen: de converter leidt dat af uit de plannerbehoefte. Bij **nee/onbekend** blijven product- en prijsvelden leeg; hergebruik geen oude informatie.
- **Belangrijk verschil:** **nee** betekent dat onbeschikbaarheid daadwerkelijk is waargenomen (`available: false`). **Onbekend** betekent nog niet gemeten (`available: null`) en houdt de officiële observatie onvolledig; de converter accepteert dit niet als afgeronde regel. Zet onbekend **nooit** om naar nee om de conversie te laten slagen. De uitkomst `unknown` van een beoordeelde volledige week is iets anders dan een ongemeten winkelregel.

Het veld **Filiaal of bestelcontext** is alleen extra context voor de herkomstnotitie; het vervangt de afzonderlijke winkelnaam en winkel-ID niet. De veldkaart kan niet vaststellen of een waarneming werkelijk plaatsvond of of de aanbieder toestemming voor hergebruik gaf.

## During the visit

1. Use baseline = **PLUS**, candidate = **DekaMarkt**, and the **same 11 requirements** for both. Do not swap retailer sides or improvise replacement demand.
2. Decide on a single price context *before collecting*: in-store or online-order, not a mixture. Record the real store/order context, source and timestamp including timezone.
3. Record every actual package, quantity, multiplier, EUR price and availability. Explicitly unavailable/unknown items stay unknown; prices are **never** filled from a guess or stale unrelated page.
4. Keep visits within **24 hours** of one another. The card does not itself validate the time window, consent or source rights.

## After the visit

Transfer the observations to the actual canonical sheet (or use the app's **Meten** flow) before using the guarded converter and assessment:

```bash
npm run m3:create-observation-sheet -- --output artifacts/m3/observation-sheet.json
npm run m3:build-observed-study -- artifacts/m3/observation-sheet.json --output artifacts/m3/study.json
npm run m3:assess-observed-week -- artifacts/m3/study.json --output artifacts/m3/report.json
```

**Fill and review** the observation-sheet JSON between the first and second commands. The generator is intentionally no-clobber; do not overwrite a partly completed genuine record. A successful converter/assessor is a technical gate, not proof of actual source provenance. Better/same/worse/unknown all remain valid results; no report automatically authorizes a public savings claim.

M3 is **ACTIVE** until [human field evidence #78](https://github.com/Zennay/Supa/issues/78) is genuinely closed. M4 recruitment remains ineligible until that gate is explicitly accepted.
