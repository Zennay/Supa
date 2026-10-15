# SUPA — historische adaptergezondheid vergelijken zonder data te publiceren

`scripts/retailer-private-adapter-health-trend.mjs` vergelijkt twee al bestaande **geaggregeerde privé-gezondheidsrapporten** uit `retailer-private-adapter-health.mjs`. Het doel: regressies in de interne PLUS/DekaMarkt-ingestie en normalisatie herkennen, niet winkelprijzen of externe assortimentwijzigingen bewijzen.

## Uitvoerbare privé-operatie

Schrijf twee afzonderlijke gezondheidsrapporten lokaal weg met `umask 077` (elk bestand `0600`):

```sh
umask 077
node --experimental-strip-types scripts/retailer-private-adapter-health.mjs > before.json
# Na een onafhankelijke nieuwe review van de gecureerde ingestiebron:
node --experimental-strip-types scripts/retailer-private-adapter-health.mjs > after.json
node scripts/retailer-private-adapter-health-trend.mjs --before before.json --after after.json
node --experimental-strip-types --test tests/product-retailer-private-adapter-health-trend-20261015.test.mjs
```

**Let op:** de huidige standaard health-CLI gebruikt de zes **vaste historische fixtures**. Voor echte nieuwe vergelijkingen moet de door de adapter-API gecontroleerde dataset eerst veranderd/uitgebreid zijn; twee identieke fixture-runs leveren alleen nulverschillen of natuurlijke veroudering op, géén bewijs van nieuwe winkelwaarnemingen. De afgedrukte `historicalFreshnessWithinWindow` is altijd een lokale datasetleeftijd, geen live-prijsstempel.

Een geldige operatorrun vergelijkt dezelfde `maxAgeHours`-grens, precies dezelfde schema- en privacycontracten, en leest uitsluitend reguliere 0600 JSON-bestanden tot 64 KiB. Symlinks, afwijkende tellingsvelden, onverwachte extra data en inconsistent opgetelde bronvormen worden geweigerd. Er zijn géén netwerkcalls.

## Wat de uitvoer zegt

`newlyMissingShapes` en `recoveredShapes` beschrijven ontbrekende of teruggekeerde adapter-bronvormen **in de aangeleverde privédataset**. `perShape` toont uitsluitend verschillen in aantallen geaccepteerde bronnen, geweigerde bronnen, observaties, verouderde captures en onbekende prijsvelden. `reviewSignals` meldt onder andere minder geaccepteerde bronnen, meer afwijzingen, ouder wordende captures of meer interne feitenconflicten. De functie geeft nooit een productnaam, bron-URL, prijsbedrag, SHA of SKU terug.

**Interpretatie:** minder waarnemingen is niet hetzelfde als minder voorraad of een door de supermarkt verwijderd artikel. Ander extractievenster, veranderende rechten of een afwijkend reviewsample kunnen ook de oorzaak zijn. Vergelijkbare bronpopulaties en expliciete code-/capturepins zijn nodig om echte dekking te interpreteren. Alle uitvoer blijft `humanReviewRequired:true`, `permissionVerified:false`, `productionEnabled:false`, `livePricesAvailable:false`, `publicSavingsClaimEligible:false` en `externalRequests:0`.

De externe M3-releasevoorwaarden blijven onveranderd: schriftelijke rechten #74, menselijke echte gelijk-tijdige PLUS/DekaMarkt 11×2 basket #78, broncodepin #205, permanente VPS runner #2833.
