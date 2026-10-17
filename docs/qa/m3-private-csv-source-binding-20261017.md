# Supa M3 — privé CSV exact vergelijken met het oorspronkelijke rapport

Deze **optionele, volledig lokale** QA-controle verbindt twee artefacten: (1) het oorspronkelijke private comparison JSON uit de M3-productvergelijking en (2) het daarvan gemaakte private comparison CSV. De bestaande CSV-preflight rekent bedragen en verpakkingen na, maar herkent geen gewijzigde productnaam zolang de bedragen intern kloppen. Deze tool genereert de verwachte CSV opnieuw in geheugen uit het meegegeven JSON-rapport en vergelijkt die byte-voor-byte met de lokale CSV.

## Gebruik

Beide bestanden moeten privéschrijfbaar zijn met bestandsrechten 0600. Bewaar de bestanden in een eigen, vertrouwde directory. Geef uitsluitend lokale paden door; upload niets.

```sh
node --experimental-strip-types scripts/qa-m3-private-csv-report-binding-20261017.mjs \
  /prive/map/m3-private-product-comparison.json \
  /prive/map/m3-private-product-comparison.csv
```

Een geldige combinatie levert exitcode 0 en alleen veilige aantallen/booleans op, waaronder `sourceBound:true`, `privateOnly:true`, `verifiedRetailerObservations:false` en `publicSavingsClaimEligible:false`. Bij afwijkingen verschijnt alleen `M3 private CSV/source binding refused` op stderr en geen brondata op stdout. De tool schrijft niets en doet geen netwerkverzoeken.

De afzonderlijke formule-, geld- en fysieke-verpakkingscontroles draaien ook. Elke afwijking in productnamen, fysieke hoeveelheden, bedragen, winkelvolgorde, tekst of bytes (UTF-8 BOM en CRLF) is onacceptabel.


## Optionele controle tegen het oorspronkelijke veldformulier

De standaardmodus hierboven blijft ongewijzigd. Als het originele privé-M3-veldformulier lokaal beschikbaar is, kun je ook de product- en prijscijfers in de JSON-vergelijking **opnieuw via de bestaande M3-converter projecteren** en met het rapport en de CSV vergelijken:

```sh
node --experimental-strip-types scripts/qa-m3-private-csv-report-binding-20261017.mjs \
  /prive/map/m3-private-product-comparison.json \
  /prive/map/m3-private-product-comparison.csv \
  --sheet /prive/map/m3-original-field-sheet.json
```

Ook het veldformulier moet een owner-owned, regulier, single-link 0600-bestand van maximaal 2 MiB zijn, zonder symlinkouders. Bij een positieve uitkomst verschijnt aanvullend `sheetProjectionConsistent:true`; de 11 fysieke vereisten en de PLUS/Deka-product- en prijsgegevens zijn dan consistent met wat **de huidige converter** uit dat formulier projecteert. Eén ontbrekende prijs of gewijzigde productnaam in een veldregel wordt geweigerd.

**Essentiële beperking:** niet alle oorspronkelijke velden (zoals participantKey, studieschema of administratieve notities) worden door de M3 productvergelijking bewaard. Deze extra check kan dus **niet** bewijzen dat die niet-geprojecteerde metadata ongewijzigd is, geen fysieke prijswaarneming bevestigen en geen originele code-SHA van veldwerk vastpinnen. [#205](https://github.com/Zennay/Supa/issues/205) blijft OPEN. De standaard 2-artefactmodus blijft compatibel.

## Beveiligingsgrenzen

- JSON maximaal 2 MiB, CSV maximaal 1 MiB, strikte UTF-8; twee verschillende paden.
- Alleen owner-owned, gewone single-link 0600-bestanden; geen symlinks, hardlinks of symlinked bovenliggende directories. De directory zelf moet in eigen beheer zijn.
- Eén bestandsdescriptor per bron met vóór- en na-controle van inode, eigenaar, rechten, grootte, links en stat-tijdstempels.
- De vergelijking is **geen digitale handtekening**. Als beide artefacten gezamenlijk worden vervalst, kan de binding nog steeds slagen. Ze bewijst enkel consistentie van twee lokale artefacten, geen onafhankelijke echte winkelprijs, origineel bronbewijs, toestemming of publieke besparing.
- Dit vervangt niet de originele exporterreparatie van P1 [#3854](https://github.com/Zennay/Supa/issues/3854); de reeds bestaande optionele formulepreflight blijft deel van de check.

**M3 blijft ACTIVE/HOLD:** echte gelijktijdige PLUS/Deka-veldobservaties [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke rechten [#74](https://github.com/Zennay/Supa/issues/74), broncode-SHA [#205](https://github.com/Zennay/Supa/issues/205) en permanente self-hosted gate [#2833](https://github.com/Zennay/Supa/issues/2833).

## Zelf testen

```sh
node --experimental-strip-types --test tests/qa-m3-private-csv-report-binding-20261017.test.mjs
```

Alle tests gebruiken fictieve prijzen, namen en lokaal gegenereerde bestanden; geen retailer HTTP of echte persoonsgegevens.
