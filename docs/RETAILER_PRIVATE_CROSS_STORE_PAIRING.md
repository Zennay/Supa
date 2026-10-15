# SUPA — voorzichtige historische productmatching tussen PLUS en DekaMarkt

De zelfstandige `scripts/retailer-private-cross-store-pairing.mjs` bouwt **alleen privé kandidaat-koppelingen** tussen twee supermarkten op de *bestaande beoordeelde historische* universele productcatalogus. Hiermee kan een operator zien voor welke SKU-identiteiten een exacte naam-/verpakkingsovereenkomst bestaat. Het systeem kiest **nooit** een actuele prijs of automatisch substituut.

## Uitvoeren zonder netwerk

```sh
node --experimental-strip-types scripts/retailer-private-cross-store-pairing.mjs
node --experimental-strip-types --test tests/product-retailer-private-cross-store-pairing-20261015.test.mjs
```

De CLI gebruikt uitsluitend de zes bestaande lokale historische fixture-adapters, het bestaande universele model en de bestaande strenge privécatalogusvalidator. Hij print alleen geaggregeerde aantallen. Geen naam, URL, prijs, hash, SKU of kandidaatpaar wordt naar standaarduitvoer geschreven.

In een **vertrouwde interne context** accepteert de pure functie `proposePrivateCrossRetailerMatches(catalog)` een reeds genormaliseerde privé-catalogus. De retourneerde `candidatePairs` bevatten uitsluitend de PLUS- en DekaMarkt-canonieke productidentiteiten, een uitleg dat dit een historische exact-match kandidaat is, en de expliciete niet-gevalideerde status. Bewaar of deel die interne output niet als publiek productadvies.

## Wat wel en niet matcht

- Alleen producthistorie met intern consistente feiten en geldige privéherkomst; bij een tegenstrijdig prijs-/naam-/verpakkingsverleden wordt niet gematcht.
- Eerst Unicode NFKC, Nederlandse kleine letters, betekenisvolle woordtokens en volgorde-onafhankelijke **exacte naamwoorden**. Één generiek woord is onvoldoende. Dit is **geen fuzzy matching** en kan echte alternatieven missen.
- Fysiek vergelijkbare massa of volume wordt omgezet, bijvoorbeeld 1 kg = 1.000 g of 1 l = 1.000 ml. Massa en volume zijn nooit gelijk. Stuk/pack/unknown zijn expres uitgesloten.
- Bij meerdere artikelen met dezelfde naam+hoeveelheid aan één winkelzijde wordt **geen** willekeurige kandidaat gekozen: `ambiguousGroups` vraagt menselijke beoordeling.
- Aanbiedingen, voorraad, geldwaarden en ouderdom vormen **geen prijsvoordeelbewijs** of automatische match-score. De functie vergelijkt ze niet om een kandidaat te promoten.

Beperkingen: de historische fixtures tonen géén volledig PLUS- of DekaMarkt-assortiment en geen huidige productprijzen. `candidateCount` is uitsluitend een telling binnen die privéset, ook als de waarde 0 is. Alle kandidaten vereisen een mens, schriftelijk geautoriseerde brondata en aanvullend M3-veldwerk voor een publieke besparingsclaim. Bronrechten #74, echte 11×2 menselijke basket #78, code-SHA #205 en permanente runner #2833 blijven onafhankelijke harde vrijgavegrenzen. Er is geen live fetch, crawler, AI-selector-promotie of omzeiling van anti-bot maatregelen.
