# SUPA product-core — echte universele SQLite-opslag → dynamische plannerreview

**Dit is een volledig offline end-to-end koppeling met de opgeslagen gegevens, geen nog te bouwen concept.** Hij hergebruikt de zes bestaande, beoordeelde PLUS/DekaMarkt-testcapturen, schrijft die via de bestaande importer naar een **tijdelijke lokale SQLite v1-database**, leest deze *read-only* terug en koppelt de werkelijk opgeslagen productnamen/verpakkingen via de bestaande productmatching-engine aan de ingrediëntenbehoeften van een zelfgekozen planweek.

## Direct testen

Vanaf de repositoryroot met de gepinde Node-versie en Python 3 met ingebouwde `sqlite3`:

```sh
node --experimental-strip-types scripts/retailer-private-sqlite-planner-review.mjs --days Ma,Do
```

De resultaten zijn **uitsluitend aantallen**: zes historische bronnen, aantal opgeslagen producten, twee geplande dagen, vijf samengevoegde ingrediëntbehoeften, tien retailerspecifieke reviewrijen, hoeveel daarvan mogelijk bij een historisch artikel passen en hoeveel nog onopgelost zijn.

Zonder `--days` worden alle vier de standaarddagen genomen: elf unieke boodschappenbehoeften en twee winkels geven 22 reviewrijen. Andere recepten/plannen kunnen intern via `buildDynamicReviewedWeek` door dezelfde consumer verwerkt worden, maar zijn **geen live retailerbronnen of M3-bewijs**.

## Beveiliging en juistheid

De Node-run bouwt een nieuwe private database onder een tijdelijke 0700-map op basis van uitsluitend de zes meegeleverde offline bronbestanden. Een beperkte Python-reader opent die database met SQLite `mode=ro&immutable=1`, `query_only` en `trusted_schema=OFF`. Hij weigert symbolische links, group/world-leesbare bronbestanden, afwijkende originele tabel- en retailerrechtenmetadata, onbekende bronhosts, ongeldige SKU's en onveilige bronclaims. Zonder succesvolle provenance-/rights-gates is er geen projectie naar de matching-engine. De SQL-query heeft een vast schema, geen dynamische gebruikers-SQL.

Het interne process-kanaal bevat uitsluitend **historische productnaam, hoeveelheid, beschikbaarheid en snapshot-SHA** voor matching. Geldbedragen, aanbiedingsprijzen, bron-URL's, klant-/deelnemercodes en credentials verlaten de SQL-reader niet. Verschillende historische prijzen voor hetzelfde product worden intern slechts gebruikt om `review-required` vast te stellen: SUPA kiest nooit stilzwijgend de laagste of recentste. De laatste Node-output bevat alleen totalen en zet `productionEnabled:false`, `livePricesAvailable:false`, `publicSavingsClaimEligible:false`, `externalRequests:0`. De tijdelijke private database wordt altijd na afloop verwijderd.

Dit is **geen geldige live supermarktdata-import** of automatisch invullen van `ObservationSheet`: handmatige observatie, actuele product-/packcontrole en schriftelijke bronrechten ontbreken nog. Het blijven open [#74](https://github.com/Zennay/Supa/issues/74), [#78](https://github.com/Zennay/Supa/issues/78), [#205](https://github.com/Zennay/Supa/issues/205) en [#2833](https://github.com/Zennay/Supa/issues/2833). Andere workers kunnen onafhankelijk verder aan toestemming, adapters en QA; deze product-code wijzigt hun bestanden niet.
