# Onafhankelijke QA: fysieke bronbedekking voor PLUS/DekaMarkt-matchvoorstellen

De nieuwe private productmatching levert uitsluitend **niet-geverifieerde matchvoorstellen** op basis van naam en fysieke verpakking. Deze aanvullende **offline kwaliteitscontrole** vraagt of een voorgesteld paar ook steun krijgt van meerdere, afzonderlijke soorten historische bronopnames voor **beide** winkels, plus tijdstempels die zinvol met elkaar te vergelijken zijn.

## Uitvoeren

```sh
node --experimental-strip-types scripts/qa-retailer-cross-store-source-coverage.mjs
node --experimental-strip-types --test tests/qa-retailer-cross-store-source-coverage-20261015.test.mjs
```

De CLI gebruikt alleen de zes historisch beoordeelde M1-fixtures en geeft uitsluitend geaggregeerde aantallen. De pure API `auditPrivateCrossStoreEvidence(catalog, { asOf, maxCrossStoreSkewHours, maxAgeHours })` accepteert alleen de al door de product-module streng gecontroleerde, private universele catalogus.

## Wat telt als sterkere historische onderbouwing?

Per voorgesteld PLUS↔DekaMarkt-paar moeten aan **beide kanten minimaal twee verschillende bronsoorten** aanwezig zijn uit `product`, `catalog` of `offers`. Alle betrokken historische captures moeten binnen het geconfigureerde vergelijkingsvenster (standaard 24 uur) liggen. Dit is geen claim dat de artikelen identiek zijn of dat prijzen actueel zijn, maar een bruikbaar prioriteitssignaal voor menselijke review.

De volgende aggregaten blijven nadrukkelijk afzonderlijk: kandidaten met te weinig onafhankelijke bronsoorten, kandidaten met uiteenlopende capturetijden, historisch door meerdere bronsoorten ondersteunde kandidaten, en daarvan welke inmiddels ouder zijn dan de auditklok. Een pakketverschil, inhoudsconflict, onvoldoende bron of toekomstige opname wordt nooit omgezet in geverifieerde productmatching. Onbekend blijft onbekend.

De CLI drukt **geen** product-IDs, naam, SHA, URL, prijs, offertekst of private paden af. Elk positief historisch geval houdt `humanReviewRequired:true`, `verifiedEquivalentProducts:0`, `verifiedPriceComparisons:0`, `permissionVerified:false`, `productionEnabled:false`, `livePricesAvailable:false` en `publicSavingsClaimEligible:false`.

Deze QA-poort **wijzigt de product-core matching niet**, raakt geen actieve andere branches en maakt geen retailerrequests. Hij is bedoeld als offline human-reviewprioritering. Echte M3-besparingsclaims vereisen nog steeds schriftelijke PLUS/Deka-rechten (#74), 11+11 echte vergelijkbare mandwaarnemingen binnen 24 uur (#78), SHA-provenance (#205) en betrouwbare VPS-validatie (#2833).