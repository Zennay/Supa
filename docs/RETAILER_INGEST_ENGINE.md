# SUPA — gedeelde retailer-ingestion (offline, voorbereid voor productie)

## Huidige implementatie

De zes bestaande en door de M1-bronbewijslijn beoordeelde **PLUS**- en **DekaMarkt**-parsers zijn samengebracht in één echte, uitvoerbare batch-engine: `scripts/retailer-reviewed-ingest-engine.mjs`.

Deze module accepteert **product**, **catalogus** en **aanbiedingen** voor beide ketens via hun eigen versiegebonden bronbewijs. De engine controleert soort, winkel, veilig bron-ID, oorspronkelijke parserbewijsregels, identiteit, herkomst-URL, observatietijd, SHA-256, dubbele records en canonieke prijs-/verpakkingseenheden. Een ontbrekende of tegenstrijdige bron wordt geweigerd en mag geen geobserveerde prijs voorstellen.

```bash
node --experimental-strip-types scripts/retailer-reviewed-ingest-engine.mjs
node --experimental-strip-types --test tests/retailer-reviewed-ingest-engine.test.mjs
```

De CLI leest exact zes gecontroleerde repositoryfixtures met een limiet van 1 MiB per bestand. Hij voert **geen HTTP-aanvragen** uit en geeft uitsluitend aantallen en status terug; geen producten, individuele prijzen, bron-URL's of persoonlijke gegevens. De functie `ingestReviewedBatch(records)` geeft gestructureerde gevalideerde `RawProductObservation`-records terug voor toekomstig intern ingestwerk, maar schakelt **geen** retailerproductie in.

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
