# SUPA — zes supermarktadapters: privé gezondheidsrapport

De zelfstandige product-core operatorcontrole `scripts/retailer-private-adapter-health.mjs` brengt de **bestaande zes echt beoordeelde historische M1-evidencevormen** samen: PLUS en DekaMarkt, elk product, catalogus en aanbiedingen. Hij voert de bestaande offline adapters uit, valideert hun normalisatie, legt het resultaat naast de universele producthistorie en produceert uitsluitend **telling-gebaseerde** opvolgacties voor menselijke review.

## Direct uitvoeren (geen netwerk)

```sh
node --experimental-strip-types scripts/retailer-private-adapter-health.mjs
node --experimental-strip-types --test tests/product-retailer-private-adapter-health-20261015.test.mjs
```

De CLI leest alleen de zes exact gelimiteerde bestanden onder `fixtures/m1/`. Hij heeft geen URL-/HTML-padparameters, gebruikt geen browser, proxy of fetch, en schrijft geen publiek productbestand of database. De JavaScript-API `evaluatePrivateAdapterHealth(batch, { referenceTime, maxAgeHours })` is bedoeld voor bestaande *in-memory* output van `ingestReviewedBatch`, niet voor niet-gecontroleerde retailer-JSON. De standaard leeftijdsgrens is 24 uur, uitsluitend een **referentie voor dataset-review** en nooit bewijs dat actuele prijzen beschikbaar zijn; `referenceTime` kan expliciet worden gezet voor reproduceerbare historische tests.

## Betekenis van de uitvoer

- `byShape.plus:product` tot `byShape.dekamarkt:offers`: bron-/observatieaantallen, afwijzingen, ouderdom en ontbrekende prijs/verpakking/beschikbaarheid per historische bronvorm.
- `sixShapeCoverageComplete`: er zijn ten minste zes geaccepteerde adapterbronnen, met elke van de zes typen aanwezig en zonder weigeringen. Dit betekent **geen** complete actuele supermarktdekking; er kunnen slechts enkele historische testartikelen zijn.
- `inconsistentProducts`: hoeveel unieke historische productidentiteiten onderling afwijkende feiten tonen, via de bestaande universele catalogus; conflicten worden nooit automatisch gladgestreken.
- `staleSources` en `historicalFreshnessWithinWindow`: zijn lokale capture-tijdstempels ouder dan de opgegeven auditklok? Dit is een operatorsignaal, **geen** productprijskeurmerk.
- `operatorActions`: concrete reviewcategorieën voor gemiste vormen, adapters die afzien van verwerking, oude captures, tegenstrijdige feiten of onbekende prijzen; daarnaast altijd bronrechten en echte M3-veldvergelijking.

Het rapport bevat geen productnaam, prijsbedrag, SHA, URL of individuele bronidentiteit. De uitgang is onvoorwaardelijk `humanReviewRequired:true`, `permissionVerified:false`, `productionEnabled:false`, `livePricesAvailable:false`, `publicSavingsClaimEligible:false`, `externalRequests:0`. Bij ongeldige provenance, onmogelijke tijd of tegenstrijdige batchsamenvatting wordt geen rapport gepubliceerd.

**Niet opgelost:** live pagina's ophalen, HTML naar officiële productbewijzen omzetten zonder menselijke review, licentierechten, volledige actuele winkelassortimenten, aanbiedingen rechtstreeks aan gebruikers adviseren of besparingen claimen. PLUS is nog `permission_required`; DekaMarkt is nog `unresolved` volgens de canonieke M1-rechtenpoort. M3 #74 (schriftelijke rechten), #78 (echte 11×2 waarnemingen), #205 (broncode-SHA) en #2833 (permanente runner) blijven onafhankelijke releasevoorwaarden.
