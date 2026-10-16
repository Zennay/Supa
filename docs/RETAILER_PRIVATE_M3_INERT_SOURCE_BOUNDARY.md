# Supa M3 — veilige in-process broninvoer (product-core, 16 oktober)

## Probleem en herstel

De [daadwerkelijk bevestigde QA-fout #3119](https://github.com/Zennay/Supa/issues/3119)
betreft uitsluitend `assessPrivateM3RetailerIngestion(permissionGate,batch,options)`.
Normaal leest de operator-CLI gecontroleerde JSON, waarin getters en JavaScript
Proxies niet kunnen voorkomen. Een programmeur kan de geëxporteerde functie
echter ook direct met actieve JavaScript-objecten aanroepen. De oorspronkelijke
[zeven QA-tests #3118](https://github.com/Zennay/Supa/pull/3118)
lieten vijf gevallen falen: getter op bronlijst, Proxy op batch, getter op
observaties, getter op opnametijd en Proxy op bronrechten.

Deze productwijziging plaatst een **begrensde, onafhankelijke en onveranderlijke
kopie van alle bronrechten én de hele ingelezen batch** vóórdat bestaande
validaties bronvelden uitlezen. De functie
`snapshotInertPrivateM3Sources` in
[`retailer-private-m3-inert-source-boundary.mjs`](../scripts/retailer-private-m3-inert-source-boundary.mjs)
mag alléén eigen, gewone gegevens beschouwen: geen accessors/getters,
Proxies, sparse arrays, symbols, niet-JSON typen, cycli of ongecontroleerde
objectprototypes. Ongebruikelijk grote invoer wordt vroeg afgewezen met
maximale 32 diepteniveaus, 50.000 nodes, 10.000 array-items, 2.048
objectvelden en 100.000 tekens per string.

De bron wordt zonder wijzigingen gekopieerd, de kopie wordt diep bevroren,
en **daarna** krijgen bestaande canonieke onderdelen de kopie. Die blijven
volledig verantwoordelijk voor echte bronrechten, herkomst, geldige
tijdstippen, kosten, verpakkingen, 6–32 bronopnames, dubbele records en
aanbiedingen. Een onveranderlijke kopie is géén bewijs dat supermarktgegevens
waar, actueel of herbruikbaar zijn.

## Controles

```bash
node --experimental-strip-types --test tests/product-m3-inert-source-boundary-20261016.test.mjs
node --experimental-strip-types scripts/retailer-private-m3-ingestion-preflight.mjs \
  --at 2026-10-16T00:00:00.000Z
npm test
npm run build
```

De zeven eigenaarstests gebruiken de echte historisch gereviewde PLUS/Deka
zes-bron-fixtures en uitsluitend synthetische in-memory modificaties.
Daarbovenop hoort de onafhankelijke oorspronkelijke QA-suite **byte-identiek**
herhaald te worden; een groene eigenaarstest is daarvoor niet genoeg.

## Wat niet verandert

- Geen HTML-download, browser, crawler, supermarktnetwerk of CAPTCHA-omzeiling.
- Geen wijziging in de al geverifieerde historische bronbestanden of
  de aparte QA-owner branches.
- Geen toestemming voor live opvang, actuele prijzen/voorraad, openbare
  besparingen of een productiescheduler.
- `releaseDecision:hold`, `permissionVerified:false`,
  `productionEnabled:false`, `currentStockCoverageVerified:false` en
  `publicSavingsClaimEligible:false` blijven verplicht.

Ook na een technische merge blijven schriftelijke rechten
[#74](https://github.com/Zennay/Supa/issues/74), menselijke identieke
11×2 winkelmandopnames [#78](https://github.com/Zennay/Supa/issues/78),
echt vastgelegde veld-SHA [#205](https://github.com/Zennay/Supa/issues/205)
en de vertrouwde runner [#2833](https://github.com/Zennay/Supa/issues/2833)
onafhankelijk open.
