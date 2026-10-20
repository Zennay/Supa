# SUPA — vier brongebonden HTML-waarnemingen offline samen beoordelen

**Status:** privé, alleen historische/expliciet beoordeelde HTML. **Geen werkende live winkel-scraper, geen bronlicentie en géén complete zes-bronnencatalogus.**

De nieuwe functie `reviewPrivateHtmlRetailerBatch(entries, options)` in `scripts/retailer-private-html-four-source-review.mjs` vormt de ontbrekende tweede stap na de HTML/JSON-LD/Nuxt SHA-binding. Hiermee kunnen vier typen **reeds lokaal verzamelde en onafhankelijk gecontroleerde** waarnemingen in één deterministische offline batch worden verwerkt:

1. PLUS-product-JSON-LD.
2. DekaMarkt-product-Nuxt + JSON-LD.
3. DekaMarkt-catalogus-Nuxt.
4. DekaMarkt-aanbiedingen-Nuxt.

De caller geeft een array met `{ captured, reviewedEvidence }`-paren en optioneel een vaste `referenceTime` en `maxAgeHours`. Elk paar wordt eerst opnieuw getoetst op inerte eigen data, historische HTML/bronhash, winkel/type/URL/capturetijd, geobserveerde gestructureerde inhoud en normalisatie via de bestaande adapter. Een ongeldige, dubbele of ontbrekende bron betekent een **volledig geweigerde** batch. De bestaande adapter-health-engine telt alleen geaccepteerde private bronfeiten en markeert historisch verouderde waarnemingen en bronconflicten.

De **enige publieke returnwaarde van deze in-memory reviewfunctie is een privacyveilige samenvatting** met aantallen en operatoracties. Geen productprijs, ruwe bron-URL, cookies, persoonlijke identificatie, private fysieke bestandslocatie of HTML wordt geretourneerd. Er is geen CLI, geen automatische lokale filesystemread, geen directe request, geen plannerprijs of UI-publicatie.

PLUS-catalogus en PLUS-aanbiedingen worden bewust niet herkend als bewezen HTML-adapters: daarvoor ontbreekt nog de onafhankelijk gecontroleerde binding tussen rendered DOM en de daadwerkelijke HTML-snapshot. Daarom blijft ook bij een geldige batch **`sixSourceCoverageComplete:false`**, en staan beide ontbrekende sourceKinds altijd expliciet in de output. **RightsVerifiedForReuse, publicSavingsClaimEligible, livePricesAvailable en productionEnabled zijn altijd false.** Een fysiek bron- en mensenrechtenbewijs is iets anders dan een lokaal JSON-object met een vlag `permissionVerifiedForThisRequest:true`.

## Herhaalbare lokale test

```sh
node --experimental-strip-types --test tests/product-retailer-private-html-four-source-review-20261016.test.mjs
```

De test gebruikt de vier historische oorspronkelijke M1 gestructureerde adapterfixtures met **zelfgemaakt synthetisch HTML en nieuwe, lokale SHA-berekening**. Dit mag nooit worden voorgesteld als eerder werkelijk vastgelegde HTML van een retailer. De test valideert alleen de softwareverbinding, plus duplicate/poisoning, getters, Proxy, ongeldige tijd en fail-closed operatorstatus.

## Nog nodig

Voor een complete, bruikbare PLUS+Deka ingestie: getoetste PLUS DOM-HTML-kaartkoppeling, formele bronrechten (GitHub #74), afzonderlijk echte menselijke identieke 11+11 winkelmand binnen 24 uur (#78), exacte veldsoftware-SHA (#205), permanent trusted VPS #2833 en de scoped zCloud writerlease voor main. Geen scheduled retailer HTTP, automatische prijsverversing, productie-ui of publiek besparingsverhaal zolang dat ontbreekt.
