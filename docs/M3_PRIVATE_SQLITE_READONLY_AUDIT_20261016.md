# Supa M3 — alleen-lezen audit van historische privé-SQLite

Dit commando controleert een **afgeronde offline database**, zonder productprijzen, namen, URLs, bron-SHA's, winkelbezoeken of persoonsgegevens te publiceren. Het gebruikt geen internet of live supermarktbron.

## Uitvoeren

Na het offline aanmaken van de 0600-database:

```sh
python3 scripts/retailer-audit-private-sqlite.py --db /eigen/private/map/reviewed.db
```

Bij volledige consistentie verschijnt één JSON-rapport met alleen tellingen en `releaseDecision: "hold"`. Bij inconsistentie, onveilig pad of argumentfout geeft het exitcode 2, geen stdout en uitsluitend een vaste foutmelding zonder privéadres.

## Controles

- Regulier bestaand 0600 SQLite-bestand (max. 32 MiB); weigert symlink, hardlink en symlink-ouder.
- Read-only SQLite, integriteitscheck, foreign-keycontrole en exact vijf onveranderde private schema-metadatavelden.
- Twee retailers met echte interne status: PLUS `permission_required`, DekaMarkt `unresolved` en productie bij beide uit.
- Precies zes historische bronvormen: product, catalogus en aanbiedingen per winkel.
- Gelijke bron-, product- en retaileridentiteit; integriteit van bewaarde waarnemingen en uitsluitend eurovaluta.
- Alleen aggregaattellingen en expliciete onwaarheidsflags voor actuele winkelprijzen, bronrechten en besparingsclaims.

De Node-regressietests maken een echte synthetische tijdelijke SQLite op basis van het bestaande schema en demonstreren normale read-only rapportage, falen bij vervalste bronrechten/productie, gekruiste winkelattributie, ontbrekende bronvorm, symlink en corrupte DB. Het commando verandert de bestaande builder of bronadapters van product-PR #3235 niet.

## Nog geen vrijgave

Een geslaagde audit bewijst alleen **consistente historische opslag**; niet actuele prijzen. M3 blijft HOLD voor schriftelijke PLUS/Deka-bronrechten #74, dezelfde echte 11×2 menselijke winkelmand ≤24 uur #78, veldbron-SHA #205, vertrouwde permanente VPS #2833 en geverifieerde zCloud-writerlease. Geen live crawling, prijs- of besparingspublicatie en geen main/deploy door dit commando.
