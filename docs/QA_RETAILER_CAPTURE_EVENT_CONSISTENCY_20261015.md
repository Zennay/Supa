# Offline QA: één fysieke supermarktbron kan geen twee waarheden hebben

Deze extra onafhankelijke poort valideert de **zes bestaande beoordeelde historische PLUS/DekaMarkt adapters** zonder websites aan te roepen of prijzen uit te geven. De universele catalogus kan een bron opnieuw zien; een ongewijzigde herhaling is idempotent, maar één identieke fysieke opname met tegenstrijdige producten of prijzen is nooit twee aparte betrouwbare bronwaarnemingen.

## Uitvoerbare module

```sh
node --experimental-strip-types scripts/qa-retailer-reviewed-event-consistency.mjs
node --experimental-strip-types --test tests/qa-retailer-reviewed-event-consistency-20261015.test.mjs
```

De CLI leest uitsluitend de zes ingebouwde offline M1-bewijzen. Het in-memory API `auditPrivateRetailerCaptureEvents(batch, { asOf })` accepteert reeds door `ingestReviewedBatch` genormaliseerde data. Geen pad-, URL-, proxy-, inlog- of crawlerargumenten.

De fysieke opname-identiteit is **retailer + bronsoort + HTTPS bron-URL + capture-tijdstip + SHA-256**. Een herhaald event mag alleen de exact dezelfde verzameling SKU's en dezelfde productfeiten bevatten (naam, centen of null, valuta, verpakking, voorraad, aanbieding en geldigheid). Een ontbrekende of toegevoegde SKU, prijs-, aanbieding- of voorraadwijziging onder exact dezelfde identiteit maakt de gehele audit ongeldig. Een **nieuwe opnametijd** met verder dezelfde SHA is een ander legitiem historisch event. SKU's tussen PLUS en DekaMarkt blijven altijd gescheiden.

De toegangsgrenzen omvatten ook: originele samenvattingstellingen per retailer, alle toestemming-/publicatievlaggen letterlijk false, canonieke winkel/bronsoort, veilige integercenten, passende retailerhost zonder tokens/credentials, niet-toekomstige geldige UTC-klok en maximaal 32 bronresultaten met 256 producten per resultaat. Onzekere prijzen (`null`) kunnen geldig zijn; dat is nooit hetzelfde als 0 euro.

## Privacy en betekenis

Resultaten geven uitsluitend aggregaten: aantal resultaten, unieke fysieke opnames, idempotente herhalingen, waarnemingen, winkelgebonden productidentiteiten en gevallen voor menselijke review. **Geen** individuele prijs, product, bron-URL, SHA of identifier verschijnt in CLI, API-rapport of foutmelding. Uitvoer blijft altijd `permissionVerified:false`, `productionEnabled:false`, `publicSavingsClaimEligible:false`, `livePricesAvailable:false` en `externalRequests:0`.

Dit is **bronmetadata-/catalogusconsistentie**, niet opnieuw hashen van originele ruwe HTML. Het bevestigt niet dat historische data actueel of publiek herbruikbaar zijn en vervangt niet de afzonderlijke SQLite bronparity, officiële licenties of menselijke basket-audit.

M3 blijft extern in HOLD: schriftelijke licenties (#74), echte identieke 11 PLUS + 11 Deka producten binnen 24 uur (#78), originele source/code-SHA (#205), permanente betrouwbare VPS-gate (#2833).