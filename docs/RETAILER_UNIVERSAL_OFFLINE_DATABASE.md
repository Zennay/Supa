# SUPA P1 — één universele lokale retailer-database (SQLite v1)

Dit is een werkende **offline-import met echte tabellen**, niet een productiedienst. Hij verwerkt uitsluitend het uniforme `RawProductObservation`-batchformaat van de door de parallelle [zes-adapter-engine PR #2895](https://github.com/Zennay/Supa/pull/2895) beoordeelde PLUS/DekaMarkt-captures. **Geen HTTP**, proxy, browser, API-token, scraping of activering van retailerrechten.

## Structuur

`schema/retailer-universal-offline.v1.sql` bevat vier relationele tabellen: `retailer_sources`, `products`, `source_snapshots`, `price_observations`, plus `metadata`. Een product-identiteit (`retailer_id + source_product_id`) wordt maar één keer opgeslagen; verschillende captures houden elk hun oorspronkelijke prijs, verpakking, beschikbaarheid, actievoorwaarden, URL, UTC-tijd en SHA-256. Zo wordt een verlopen aanbieding niet stilzwijgend de 'huidige' productprijs. Een index op `products.search_name` ondersteunt matching/search, zonder onbetrouwbare voorspellingen over SKU-identiteit tussen ketens. Bij strijdige namen voor hetzelfde retailer-SKU stopt de import volledig.

## Uitvoeren

Wanneer `retailer-reviewed-ingest-engine.mjs` van de productworker gemerged is, serialiseer dan binnen een **afgeschermde lokale omgeving** zijn resultaat van `ingestReviewedBatch(records)` naar een eigen privé-JSON; dit bestand heeft velden `summary` en `results` (met de zes bronadapter-outputs) en claimt nergens `permissionVerified:true` of `productionEnabled:true`. De importer is vervolgens:

```bash
python3 scripts/retailer-import-universal-sqlite.py \
  --input private-reviewed-six-adapters.json \
  --out private-retailer-observations.db
```

De importer verifieert de zes exacte bronsoorten, EUR-prijzen in integer centen, SKU's, pack units, timestamps (niet toekomstig), toegestane URL-hosts, SHA-256, dubbele records, aanbiedingen en onveranderlijke productidentiteiten. De database wordt met `0600` aangemaakt, nooit overschreven; foutieve imports laten geen halve database achter. Hij print alleen aantallen, geen producten of prijzen.

**Bewust geen actuele-prijzen-view:** ook een technisch geldig oud capture is géén winkelprijs van vandaag. Externe rechten en hernieuwde bronwaarnemingen moeten apart bewezen worden. PLUS blijft `permission_required`, DekaMarkt `unresolved`, beide `production_enabled=0` en `public_savings_claim_eligible=false`.

## Tests

`tests/qa-retailer-universal-snapshot-sqlite-20261015.test.mjs` draait offline met Node 22 en Python 3 `sqlite3`; test echte DB-aanmaak, zes gecapturede broncontexten → vier synthetische productidentiteiten en zes prijswaarnemingen, non-overwrite, transactie-rollback, geldigheid van aanbiedingen, onmogelijke datums, spoofed URLs, valse toestemming en conflicterende bronnen. Daardoor is de opslaglaag losgekoppeld van de HTML-selectors en heeft iedere supermarkt straks **één universeel datamodel**.

Pas ná geldige toestemming [#74](https://github.com/Zennay/Supa/issues/74), echte veldbewijzen [#78](https://github.com/Zennay/Supa/issues/78), bronintegriteit [#205](https://github.com/Zennay/Supa/issues/205), freshnesschecks en formele release-/VPS-gates komt publicatie of periodieke data-acquisitie in aanmerking.
