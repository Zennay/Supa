# SUPA — gedeelde retailer-ingestion (offline, voorbereid voor productie)

## Huidige implementatie

De zes bestaande en door de M1-bronbewijslijn beoordeelde **PLUS**- en **DekaMarkt**-parsers zijn samengebracht in één echte, uitvoerbare batch-engine: `scripts/retailer-reviewed-ingest-engine.mjs`.

Deze module accepteert **product**, **catalogus** en **aanbiedingen** voor beide ketens via hun eigen versiegebonden bronbewijs. De engine controleert soort, winkel, veilig bron-ID, oorspronkelijke parserbewijsregels, identiteit, herkomst-URL, observatietijd, SHA-256, dubbele records en canonieke prijs-/verpakkingseenheden. Een ontbrekende of tegenstrijdige bron wordt geweigerd en mag geen geobserveerde prijs voorstellen.

```bash
node --experimental-strip-types scripts/retailer-reviewed-ingest-engine.mjs
node --experimental-strip-types --test tests/retailer-reviewed-ingest-engine.test.mjs
```

De CLI leest exact zes gecontroleerde repositoryfixtures met een limiet van 1 MiB per bestand. De loader gebruikt nu voor iedere historische bron een met `O_NOFOLLOW` geopende reguliere bestandsdescriptor. Symlinks, hardlink-aliases en gewijzigde dev/inode/grootte/mtime/ctime tussen padinspectie, open en uitlezen worden geweigerd. Ook **symbolische links in alle bovenliggende padcomponenten** worden vóór en ná de bestandslezing geweigerd. De raw JSON-bytes worden vervolgens apart op ondubbelzinnige propertynamen gecontroleerd, inclusief namen die dezelfde sleutel opleveren na Unicode-escapes. Meerdere `source`, `capturedAt`, `sha256` of aanbodprijscent-velden in één object geven een weigering, ook als gewone `JSON.parse` de laatste waarde zou accepteren. De bytes moeten bovendien strikt geldige UTF-8 zijn. Daarmee wordt vermeden dat een lokaal verwisseld of onjuist gecodeerd archief stilzwijgend een brongegeven wordt. Alleen de zes vaste repositorypaden worden door de CLI geladen; er wordt nog steeds geen nieuwe winkel-URL benaderd. Hij voert **geen HTTP-aanvragen** uit en geeft uitsluitend aantallen en status terug; geen producten, individuele prijzen, bron-URL's of persoonlijke gegevens. De functie `ingestReviewedBatch(records)` geeft gestructureerde gevalideerde `RawProductObservation`-records terug voor toekomstig intern ingestwerk, maar schakelt **geen** retailerproductie in.

## Veiligheid bij directe JavaScript-invoer

De ingestie-engine kan ook direct worden aangeroepen met `ingestReviewedEvidence(record)` en `ingestReviewedBatch(records)`. Zulke invoer is niet noodzakelijk afkomstig uit vertrouwde JSON-bestanden. Voordat de zes werkelijke PLUS/DekaMarkt-adapters starten, maakt de engine daarom nu een **afgesloten, recursieve kopie van uitsluitend eigen JSON-data-properties**. `Proxy`-objecten, JavaScript-getters, overgeërfde waarden, symbolen, ongebruikelijke prototypes, cyclische of onbegrensde gegevens en gemanipuleerde batch-arrays worden geweigerd voordat hun onbetrouwbare code kan worden uitgevoerd. De limieten zijn 32 geneste niveaus, 50.000 JSON-nodes, maximaal 16.384 items per interne array en maximaal 4.096 velden per object; een batch blijft 1–32 onafhankelijke captures.

Voor elk record worden supermarkt, capture-vorm, bron-ID, parserinvoer en duplicaatcontrole vanuit **dezelfde vastgepinde bronkopie** gelezen. De hele batch krijgt nu eerst een afzonderlijke **fase 1: alle bronrecords en dubbele capture-ID's vooraf afkeuren**, voordat ook maar één retaileradapter wordt aangeroepen; pas daarna start **fase 2: de zes parsers** op de reeds vastgelegde bronkopieën. Een later onbetrouwbaar record kan daardoor nooit een eerder gedeeltelijk geparsed batchresultaat achterlaten. **Compatibiliteit met bestaande analysetools:** na controle van de adapters wordt iedere geldige `RawProductObservation` als een aparte, bewerkbare privé-resultaatkopie teruggegeven. Die kopie deelt geen bevroren bron-/provenance-object met de vastgepinde parserinvoer. Andere reviewers kunnen hun eigen in-memory controlevormen aanpassen zonder de bronkopie of een volgende ingestierun te wijzigen. Ook een zelf gewijzigde resultaatkopie bewijst uiteraard geen nieuwe echte retailwaarneming. Eén wisselende getter kan daardoor niet eerst een goedgekeurde bronidentiteit leveren en daarna een andere waarde aan een parser of deduplicatie aanbieden. De zes echte historische M1-fixtures en normale JSON-input blijven bruikbaar; de negatieve tests gebruiken uitsluitend kunstmatig gemanipuleerde in-memory objecten, geen actuele supermarktdata.

Dit is geen bronlicentie, scheduler, live fetch of toestemming tot publicatie van prijzen en besparingen. De bestaande `permissionVerified:false` en `productionEnabled:false` zijn ongewijzigd.

## Wat er nog niet is

- **Niet:** alle Nederlandse ketens. De bestaande uitvoerbare M1-adapters zijn voor PLUS en DekaMarkt. Het aparte 17-ketensonderzoeksregister is geen verzameling van 17 scrapers.
- **Niet:** live scraping, dagelijkse data-import, gepubliceerde prijzen, toestemming of openbare besparingsclaims.
- **Niet:** proxy-egress naar supermarkten. `scripts/retailer-proxy-pool.mjs` bevat een kandidaatparser, healthscore, TTL en quarantaine, maar geen geautoriseerde live proxytransportintegratie of scheduler.
- **Niet:** monitoring van echte verzoeken, robots/voorwaarden, brondrift op actuele gekeurde snapshots of VPS-productiedienst.

## Volgende engineeringfase (prioriteit #1)

1. Per bron expliciete, gecontroleerde toestemming / officiële feed- of API-route en robots/voorwaarden bewijzen; de status in `evidence/m1/source-permission-gate.v1.json` blijft tot die tijd `productionEnabled: false`.
2. Een veilige begrensde capturelaag bouwen voor **goedgekeurde bronnen**: exacte domein-/routeallowlist, geen redirects buiten scope, geen credentials of cookies, geen authenticatie-/CAPTCHA-omzeiling, backoff op 403/429, bounded HTML/JSON, controleerbare SHA/timestamp en bescherming tegen SSRF.
3. De capture aan brongebonden extractors koppelen en per keten contractsuites testen; onzekerheid wordt `unknown`, geen gok.
4. Alleen waar een goedgekeurde bron een daadwerkelijk netwerkprobleem kent een eigen health-endpoint-geverifieerde proxyrouter aansluiten; geen gratis publieke proxies voor persoonsgegevens of tegen retailerrestricties.
5. Per keten freshness, foutpercentage, selectordrift, opslag, scheduler en alarmsignalen toevoegen voordat deze live gaat.

## Releasegrens

De bestaande Notion M3-mijlpaal blijft formeel open voor 11 PLUS + 11 DekaMarkt echte menselijke observaties binnen 24 uur (#78); expliciete hergebruiksrechten (#74) en traceerbare code/source-identiteit (#205) zijn andere onafhankelijke openstaande voorwaarden. Dit nieuwe engineeringwerk krijgt hoogste **technische ontwikkelprioriteit**, niet automatisch toestemming om derden te scrapen. Alle nieuwe records zijn zonder rechten en review uitsluitend voor interne, offline, herhaalbare validatie.

## 15 oktober — snapshot-analyse, selectie en universele bronrecords

**Per supermarkt verschillen de HTML-structuren; het datamodel niet.** We scheiden de ketenafhankelijke extractie van het universele gegevenscontract:

```text
Eén door eigenaar goedgekeurde bron-URL
    → HTTPS HTML-snapshot (max 2 MiB, SHA-256, timestamp; fail-closed)
    → offline selector discovery (CSS-kandidaten; nog niet vertrouwd)
    → handmatige selector-/Schema.org-/Nuxt-beoordeling per keten
    → versiegebonden PLUS/DekaMarkt adapter (product/catalogus/aanbieding)
    → RawProductObservation (EUR-centen, pakinhoud, beschikbaarheid, promo, herkomst)
    → universeel privé productregister (retailer-ID + bronproduct-ID)
    → vergelijkings- en matchingdomein, na afzonderlijke vrijgave
```

De daadwerkelijke implementatie bestaat uit:

- `scripts/retailer-approved-snapshot-capture.mjs`: **één** consent-gated en exact op domein/route beperkte HTML-fetch. De fetch moet expliciet worden geïnjecteerd, controleert de bestaande M1-bronrechtenregistratie en een tweede URL-/voorwaarden-/robots-review. Geen impliciete verzoeken, proxy-rotatie, herhaalde crawl of 403/429/CAPTCHA-workaround. De test gebruikt slechts een lokale gesimuleerde Response. Zonder bewijs van rechten werkt deze stap niet op de echte supermarkt.
- `scripts/retailer-offline-selector-discovery.mjs`: onderzoekt alleen al opgeslagen en gecontroleerd aangeboden HTML. Levert CSS-selector**voorstellen** en counts voor product, naam, prijs, verpakking, aanbieding en beschikbaarheid, plus gestructureerde JSON-LD/Next/Nuxt-signalen. Geen machine-learning-gok naar verkoopprijs en geen selector die vanzelf naar productie promoveert. Echte DOM-review blijft nodig: statische tag-analyse is niet hetzelfde als een renderende browser.
- `scripts/retailer-reviewed-ingest-engine.mjs`: gebruikt zes reeds bestaande en aparte PLUS/DekaMarkt-adapters. Afwijkende of onbewezen bronidentiteit wordt geweigerd. Privé aggregate-only diagnostiek:

  ```sh
  node --experimental-strip-types scripts/retailer-reviewed-ingest-engine.mjs
  ```

- `scripts/retailer-universal-catalog.mjs`: groepeert op `retailerId:retailerProductId`, met een volledige per-observatie tijd-/SHA-/bronhistorie. Twee verschillende ketens worden nooit op dezelfde productnaam gefuseerd. Tegenstrijdige bronobservaties krijgen `review-required`; er wordt nooit stilzwijgend de nieuwste of goedkoopste prijs als waarheid gekozen. Alle `publishable`-velden blijven false.
- `scripts/retailer-private-catalog-store.mjs`: bewaart het register optioneel lokaal als een **exclusief aangemaakt privé JSON-bestand** met bestandsrechten 0600. Bestaande bestanden worden niet overschreven. Onder `artifacts/` wordt de uitvoer standaard niet door Git gevolgd; een operator moet zelf expliciet een outputpad aanleveren.

  ```sh
  node --experimental-strip-types scripts/retailer-private-catalog-store.mjs --output artifacts/private-retailer-ingest/catalog.json
  ```

De private JSON-structuur is een **interne opslaglaag**, nog geen draaiende database/server/scheduled crawler. Later kan exact dit gevalideerde contract naar SQLite of PostgreSQL worden gemigreerd zonder ketenafhankelijke selectors in de matching-code te stoppen.

**Waarom geen "download de hele winkel"?** Een complete websitemirror is ongericht, verandert dynamisch en kan gebruiksvoorwaarden, klant-/accountgegevens, robotsregels en rate limits raken. Eerst een per keten toegestane bron/feed en een beperkte gecureerde set URL's vastleggen, dan hiervan versioned snapshots maken. Zo kunnen we betrouwbaar AI-gestuurde selectorvoorstellen beoordelen zonder de onjuiste aanname dat CSS-klassen tussen supermarkten overeenkomen.

**Niet claimen als compleet:** 17-ketensregister is nog een concept in [DRAFT #2090](https://github.com/Zennay/Supa/pull/2090); dat betekent geen 17 actieve extractors. De fysieke PLUS/Deka-productprijs is niet automatisch een rechtmatig herbruikbare datastroom. Notion PWQ-316/317/318/319 zijn door gebruikersprioriteit P1 maar hebben geen bronrechten, live scheduler, werkende publieke API, datalicense of officiële M5-releasego.
