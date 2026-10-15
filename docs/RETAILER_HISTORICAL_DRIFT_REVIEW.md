# SUPA — historische cataloguswijzigingen veilig vergelijken (privé)

De [zes bestaande offline PLUS/DekaMarkt-adapters](../scripts/retailer-reviewed-ingest-engine.mjs) leveren het universele interne catalogusformaat. De product-core-module `scripts/retailer-private-catalog-drift.mjs` vergelijkt **twee afzonderlijk opgeslagen, strikt privé beoordeelde catalogi**.

Dit is daadwerkelijk uitvoerbare snapshot-versiecontrole, geen claim dat Supa al live winkelprijzen mag hergebruiken. De controle leest uitsluitend door een operator gekozen lokale JSON-bestanden en doet **nul netwerkverzoeken**. De bronnen blijven onder de expliciete rechtenblokkade (`productionEnabled:false`).

## Workflow

1. Bouw een eerste catalogus met `node --experimental-strip-types scripts/retailer-private-catalog-store.mjs --output private/before.json`.
2. Maak op een later tijdstip alleen na toegestane/gecontroleerde offline-ingestie een **tweede** privésnapshot, bijvoorbeeld `private/after.json`. Bestaande bestanden worden nooit overschreven.
3. Vergelijk: `node --experimental-strip-types scripts/retailer-private-catalog-drift.mjs --before private/before.json --after private/after.json`.

De twee bronbestanden moeten reguliere, niet-gesymlinkte, exclusief privé `0600` JSON-bestanden van maximaal 8 MiB zijn. De tool controleert bestanden en directorycomponenten opnieuw vóór het openen en weigert veiligheidsfouten zonder bronpad of inhoud in de foutmelding. Deze pathname-controle is **geen hard garantie tegen gelijktijdige vijandige directory-renames**: gebruik uitsluitend een door de operator gecontroleerde privé-map.

Ook als een vergelijker een verschil waarneemt, worden **geen individuele producten, prijzen, aanbiedingen, bron-URL's, SHA's of deelnemersgegevens afgedrukt**. De uitvoer bevat alleen getelde veranderingen over beide winkels samen en uitgesplitst naar PLUS en DekaMarkt.

## Interpretatie van de aantallen

- `newCaptureEvents`: extra fysieke snapshotwaarnemingen, ook als HTML, inhoud en SHA exact gelijk zijn maar een nieuwe opnametijd/bron-URL hebben.
- `repeatedCaptureEvents`: dezelfde eerder bekende, ongewijzigde opname.
- `missingCaptureEventsInCandidateDataset`: historische opname ontbreekt in de nieuwe **dataset** — niet noodzakelijk verdwenen bij een supermarkt.
- `newProductIdsInDataset` en `missingProductIdsInCandidateDataset`: verschillen in **dekking van twee offline bronnen**. Dit zegt niets over winkelassortiment of beschikbaarheid.
- `factSetChangesNeedingReview`: gewijzigde set historische productfeiten voor dezelfde winkel-SKU. Dit is een signaal voor menselijke beoordeling, geen automatisch aanvaarde prijswijziging.
- `inconsistentProductHistories`: interne conflicten van bronwaarnemingen in de kandidaatcatalogus.

Direct aangeleverde data moeten voldoen aan een strikt privé-contract met veilige bron-URL, geldige UTC-opnametijd, exacte bronidentiteiten, geldbedragen in veilige gehele centen, integriteitscontroles op alle aantallen en ongewijzigde permissie-/publicatievlaggen. Een identieke fysieke capture-identiteit met herschreven feiten wordt geweigerd.

Gebruik `node --experimental-strip-types --test tests/product-retailer-private-catalog-drift-20261015.test.mjs` voor echte oude zes-bron-regressies, synthetic-only gewijzigde latere capture- en beschikbaarheidsvarianten, veranderde bronset, secret-/timestamp-/rights-negatieven en twee echte 0600 JSON-bestanden via de CLI.

## Geen financiële of bronvrijgave

Een bronverschil activeert nooit automatisch publieke prijzen, actuele voorraadinformatie, algemene spaarclaims of M4. De bestaande externe M3-gates blijven afzonderlijk: menselijke identieke 11×PLUS en 11×DekaMarkt waarnemingen binnen 24 uur [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke bronrechten [#74](https://github.com/Zennay/Supa/issues/74), broncode-SHA [#205](https://github.com/Zennay/Supa/issues/205), trusted VPS-gate [#2833](https://github.com/Zennay/Supa/issues/2833).
