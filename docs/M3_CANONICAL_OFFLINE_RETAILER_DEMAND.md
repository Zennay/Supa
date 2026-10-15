# SUPA M3 — dezelfde 11 plannerboodschappen in de lokale supermarktvergelijker

Dit is een **uitvoerbare product-coreverbinding**, geen prijswaarneming, geen scraping en geen besparingsbewijs. De M2-weekplanning levert de vastgelegde 11 ingredientbehoeften. De catalogusvergelijker neemt exact dezelfde `id`, `query`, `amount` en `unit` voor beide winkels.

## Eén opdracht om de juiste vraagset te maken

```sh
node --experimental-strip-types scripts/retailer-canonical-m3-demand.mjs --out private-m3-requirements.json
```

De opdracht schrijft alleen de 11 plannerregels naar een **nieuw lokaal bestand met mode 0600**. Een bestaande bestandsnaam wordt niet overschreven; geen `--force`-optie. Zonder `--out` toont de opdracht uitsluitend de elf prijsloze vereisten op standaarduitvoer. De bron is `buildObservationSheet()`, dus er worden geen hoeveelheden overgenomen uit handmatig overgetypte voorbeelden.

## Vergelijk daarna uitsluitend bestaande, rechtmatig verkregen review-evidence

```sh
node --experimental-strip-types scripts/retailer-compare-reviewed-evidence.mjs \
  private-m3-requirements.json plus-reviewed.json dekamarkt-reviewed.json \
  --out private-catalog-comparison.json
```

Deze tweede opdracht gebruikt de bestaande offline gecureerde bronadapter. De bestandsnamen `plus-reviewed.json` en `dekamarkt-reviewed.json` zijn **alleen invoerplaatsen**: de export maakt ze niet, vult geen prijzen in en zoekt geen productpagina's op. Als geschikte bronnen of pakketten ontbreken, moet de volledige winnaar onbekend blijven. Geen bronrechten = geen automatische retailer-HTTP. Geen publieke savingsclaims uit gedateerde of fictieve voorbeelden.

De canonieke echte M3-veldroute blijft **Meten → JSON-observatie → m3:build-observed-study → m3:assess-observed-week** zoals in [issue #78](https://github.com/Zennay/Supa/issues/78). Deze cataloguspreview vervangt geen menselijke PLUS11 + DekaMarkt11 metingen binnen 24 uur en creëert geen toestemming van de winkel.

## Regressiecontract

`tests/product-m3-canonical-demand-retailer-export-20261015.test.mjs` verifieert exact 11 unieke vereisten, byte-voor-byte dezelfde vereistevelden als het M3-formulier, positieve hoeveelheden, afwezigheid van prijzen/deelnemersgegevens, verse output per aanroep, private filepermissies, geweigerde overschrijving en ongeldige CLI-opties. Alle tests gebruiken uitsluitend de lokale, gecontroleerde M2-fixture.
