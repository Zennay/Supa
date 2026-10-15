# Onafhankelijke QA — SHA-gebonden selectorvoorstellen zijn geen DOM-bewijs

**Datum:** 15 oktober 2026. **Reikwijdte:** uitsluitend het offline
`proposeRetailerSelectors(source, html)`-proces, niet de productie-adapters,
live scraping, productprijzen, rechten of de alternatieve selector-discovery API.

De huidige statische bronreview onderdrukt *afgesloten* `script`,
`template` en HTML-commentaar voor CSS-kandidaattelling. Als zo'n
inert blok echter onvolledig eindigt, kan een naïeve tagscan het
letterlijk aanwezige tekstfragment alsnog tellen alsof het tot de zichtbare
product-DOM behoort. Voor winkelprijs/voorraad-aanbiedingsvoorstellen is
dit onjuist: de parser mag geen selectie suggereren uit een onzeker,
niet-afgesloten inert fragment. Daarnaast maakt een SHA-256 van HTML
een capture-**inhoud** verifieerbaar, maar geen in de **toekomst** opgegeven
`capturedAt` tot een waarneming.

## Regressieproof

```sh
node --experimental-strip-types --test tests/qa-retailer-snapshot-structural-trust-20261015.test.mjs
```

- Positief: geldige lokale PLUS HTML met zichtbare structurele klassennamen
  plus correct gesloten inert `script`, `template` en commentaar;
  geen verborgen selector, productnaam, prijs of ongeoorloofde publicatie.
- Negatief: onafgesloten JSON-script met schijn-aanbiedingsklasse.
- Negatief: onafgesloten template met schijn-prijsklasse.
- Negatief: onafgesloten HTML-commentaar met schijn-voorraadklasse.
- Negatief: SHA-consistente fictieve HTML met capture-klok in 2035.

**Acceptatie:** elk van de vier negatieve inputs wordt met een generieke
`Offline selector review refused` fout geweigerd. Geen productprijs,
SKU, credential of URL mag door die fout worden onthuld. Laat een
anderhalf-HTML- of browserinterpretatieconflict niet alsnog tot
`UNVERIFIED_PROPOSAL` leiden. De bestaande volledige reguliere HTML
moet blijven werken en alle selectors blijven uitdrukkelijk ongeverifieerd.

Deze acceptatie staat op een aparte, add-only QA branch en mag bij
verwachte RED niet worden gemerged. De product-core owner neemt de
implementatiebeslissing. Herhaal dezelfde oorspronkelijke tests op diens
reparatie-SHA, met hosted npm-suite, M1 rechten, audit en build.

Nooit een live retailer-HTTP-aanvraag uitvoeren of oude historisch
vastgelegde prijzen als actuele aanbiedingen presenteren. M3 blijft
afhankelijk van werkelijk 11×PLUS/11×Deka veldbewijs (#78),
bronrechten (#74), code-pin (#205) en de permanente VPS-gate (#2833).
