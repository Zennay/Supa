# SUPA P1 — zes echte historische parser-fixtures → één SQLite-database

Deze tool verbindt de inmiddels **gemergde** [PLUS/DekaMarkt zes-adapter-engine #2895](https://github.com/Zennay/Supa/pull/2895) met de **gemergde** universele SQLite-opslag [#2898](https://github.com/Zennay/Supa/pull/2898). Alle historische gegevens komen uit de gecontroleerde, oorspronkelijke M1-fixturebestanden. Geen fictieve records worden als winkelprijzen geïntroduceerd; het is uitsluitend een offline regressie- en databasevormtest.

```bash
node --experimental-strip-types scripts/retailer-build-reviewed-universal-sqlite.mjs \
  --out private-retailer-reviewed.db
```

De keten voert in één opdracht uit:
1. lees exact zes eerder beoordeelde, bron- en SHA-gebonden M1-fixtures;
2. laat PLUS-product/catalogus/aanbiedingen en DekaMarkt-product/catalogus/aanbiedingen ieder door hun eigen bronadapter gaan;
3. weiger ontbrekende, afwijkende of niet-geaccepteerde bronnen — geen stille selectie van goedkoopste record;
4. schrijf de eigen-structuur `RawProductObservation` veilig naar tijdelijke private JSON (`0600`);
5. gebruik Python `sqlite3` voor nieuwe private SQLite (`0600`) met retailergebaseerde unieke product-ID's, aparte snapshothashes en **alle oorspronkelijke prijswaarnemingen** in hele centen;
6. verwijder de tijdelijke bron-JSON ook na fouten.

De CLI toont alleen anonieme aantallen en status; geen prijs, URL of producttekst. In de integratietest ontstaan **13 unieke producten, zes bron-snapshots en zestien feitelijke historische adapterwaarnemingen**, inclusief meerdere waarnemingen van hetzelfde product zonder verlies van prijshistorie.

**Geen actuele-prijzen-view** of automatische beste deal: M1-fixtures zijn oud. PRODUCTIE `false`, rechten `unresolved`/`permission_required`, publieke besparingsclaim `false`. Live updates volgen pas na bronlicenties, status- en validiteitscontrole, reviewed selectors, fingerprint/driftchecks en de definitieve M3-/VPS-releasegate.

Toekomstige goedgekeurde retailers kunnen dezelfde databasetabellen gebruiken met een gereviewde registermigratie en winkeladapter; de bronselectors blijven per keten verschillend. Dat maakt matching mogelijk op één gestandaardiseerde laag, niet door alle supermarkten met dezelfde CSS-selectors te behandelen.
