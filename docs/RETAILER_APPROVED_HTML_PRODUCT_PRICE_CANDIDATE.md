# SUPA — HTML productprijzen uitlezen met de bestaande eigen scraperbasis

Deze toevoeging verbindt de al aanwezige **geautoriseerde één-URL HTML-capture** met de al aanwezige Schema.org Product-parser, strict URL/productselectie en het canonieke prijs-/verpakking-/voorraadrecord. Er wordt geen nieuwe externe prijsleverancier toegevoegd.

## Wat is nu echt gebouwd?

De module `scripts/retailer-approved-html-product-price-candidate.mjs` levert de functie `captureApprovedProductPriceCandidate(options)`. Die accepteert een expliciet geautoriseerde PLUS- of DekaMarkt-productpagina, leest **één** begrensd HTML-antwoord via `captureApprovedRetailerPage`, controleert de ruwe SHA-256 en decodeert aanwezige JSON-LD Product-gegevens. Alle Product-blokken worden gezamenlijk aan de reeds bestaande source-page-selectie aangeboden: de goedkoopste gerelateerde Product-node mag nooit per ongeluk winnen. De uitvoer is een privé, canonieke `RawProductObservation` met hele eurocenten, concrete verpakking, beschikbaarheid en herkomst (URL, capturetijd, SHA-256) of een expliciete review-weigering.

- Geen bewezen geldbedrag of onbekende verpakkingsmaat? **Review vereist**, geen prijs invullen.
- Out-of-stock of onduidelijke beschikbaarheid? **Review vereist**.
- Capture ouder dan 24 uur? **Review vereist**; jongere capture is nog steeds niet automatisch een echte lokale checkoutprijs.
- Meerdere conflicterende Product-nodes, ongeldige JSON-LD, onjuiste Product-URL of onbekende bron? **Review vereist**, geen willekeurig goedkoopste product kiezen.
- Retailsite weigert of rate-limitt? De bestaande capture stopt op 403/429; geen proxy/CAPTCHA/retry.

**DekaMarkt SSR/Nuxt-fallback nu ook echt toegevoegd:** `scripts/retailer-approved-deka-nuxt-product.mjs` leest in *dezelfde* geautoriseerde HTML-capture exact één `__NUXT_DATA__` payload. Product-ID moet overeenkomen met de product-URL én JSON-LD `mpn`; Nuxt-prijs moet in hele centen overeenkomen met dezelfde pagina's expliciete EUR JSON-LD `Price`, en naam/verpakking/voorraad moeten kloppen. Bij verschil of onbekende gegevens blijft de uitkomst `review_required`. De originele uitgebreide historische Deka-parser met aparte GitHub-run/artifactbewijs blijft ongemoeid en wordt niet omzeild met verzonnen run-ID's. De nieuwe brug is op deze manier ook geschikt voor het historische Deka SSR-gegevensformaat, mits de bron echt geautoriseerd en bevestigd is.

## Programmatic contract (alleen bij aantoonbare bronrechten)

```js
import { captureApprovedProductPriceCandidate } from './scripts/retailer-approved-html-product-price-candidate.mjs'

// Geef uitsluitend het werkelijk beoordeelde grant-, rechtenregister- en
// bronrecord door, plus een door de eigenaar toegestane fetch-capability.
// Geen standaard credentials, proxy, cookies, scheduler of automatische fetch.
const result = await captureApprovedProductPriceCandidate({
  source, permissionGate, grant, fetchFn, capturedAt,
})
if (result.status === 'candidate_needs_review') {
  // Alleen privé, uitsluitend na fysieke product-/verpakkingsreview gebruiken.
  // result.observation bevat aantoonbare bron en prijsgegevens.
}
```

Uitvoering van echte PLUS/DekaMarkt-verzoeken is **momenteel expliciet geblokkeerd** door `evidence/m1/source-permission-gate.v1.json`: PLUS is `permission_required`, DekaMarkt `unresolved`, beide `productionEnabled:false`. Er is dus geen werkende publieke live scraper of dagcrontab en dit wijzigingspakket verandert die regels niet. Productiedekking vergt aantoonbaar geldige bronautorisatie en een door zCloud gecoördineerde release.

## Herhaalbare tests

```bash
node --experimental-strip-types --test tests/product-retailer-approved-html-price-candidate-20261016.test.mjs
node --experimental-strip-types --test tests/product-retailer-approved-deka-nuxt-price-candidate-20261016.test.mjs
npm test
npm run m1:source-permission-gate
npm run build
```

De tests geven **uitsluitend fictieve in-memory HTML + fictieve toestemming**, dus nul echte externe requests. Ze testen beide retailers, centbedragen, g/ml-verpakkingen, hash, meervoudige Product-nodes, oude snapshots, onbekende voorraad, foutieve bron, misvormde JSON, echte check-in-rights-denial, 403/429, onjuiste content-type en het ontbreken van retries.

Dit maakt de ontbrekende **capture → productgegevens → prijsvalidatie**-schakel concreet uitvoerbaar. Er volgt pas na afzonderlijke bronrechten en review een dagverversing, database-write, PWA-integratie en M3 live kassabonvergelijking. De bestaande verkennende 22 regels uit [issue #78](https://github.com/Zennay/Supa/issues/78#issuecomment-6210818832) blijven bruikbaar als zoek-/reviewlijst maar zijn geen actuele observaties.
