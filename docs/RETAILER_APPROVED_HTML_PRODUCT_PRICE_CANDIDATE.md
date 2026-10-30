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

## Nieuwe tweede schakel: veilige privé-prijsarchivering

`scripts/retailer-approved-private-price-snapshot-store.mjs` exporteert `writePrivateRetailerPriceSnapshot([result, ...], 'pad/review-20261016.json')`. De functie valideert iedere kandidaat opnieuw op originele bronhash, retailer-URL, tijdstip, EUR-centen, fysieke verpakking, `available`, ingest-contract en alle **niet-publiceerbaar**-velden. Ook `review_required` blijft expliciet bewaard, maar **zonder verzonnen prijs**. Zowel positieve als afgewezen captures bewaren in het afgeschermde reviewbestand de **exact oorspronkelijke productpagina-URL, UTC-brontijd en HTML-SHA-256**. Het archief weigert een afwijkende of niet-canonieke HTTPS-retailerroute en eist bij een productobservatie dat de bron-URL exact gelijk is aan de bij die observatie gevalideerde herkomst-URL; de privé-URL komt nooit in de statusuitvoer. Daarmee kan een reviewer ook bij ontbrekende prijs of voorraad terug naar het concrete bronartikel. Het resultaat is een exclusief aangemaakt lokaal JSON-bestand met bestandsrechten `0600`, geen overschrijven en geen automatische productdatabase-publicatie. Een symlink in de doelmap, duplicaat-snapshot, Proxy/getter of gemanipuleerde `productionEnabled` wordt vóór bestandswijziging afgewezen.

```js
import { captureApprovedProductPriceCandidate } from './scripts/retailer-approved-html-product-price-candidate.mjs'
import { writePrivateRetailerPriceSnapshot } from './scripts/retailer-approved-private-price-snapshot-store.mjs'

const candidate = await captureApprovedProductPriceCandidate({
  source, permissionGate, grant, fetchFn, capturedAt,
})
const outcome = await writePrivateRetailerPriceSnapshot(
  [candidate], '/eigen-beveiligde-map/nieuwe-review.json')
```

Dit is een *operator-/bewijsarchief*, nog niet de voor Supa-gebruikers zichtbare prijsdatabase. Het gebruikt **geen betaalde API** en haalt geen site op zonder afzonderlijk bewezen expliciete bronrechten. `verifiedCurrentCheckoutPrices: 0` blijft altijd zo. Uiteindelijk kunnen maximaal 22 afzonderlijk toegestane producten uit dezelfde plan-/prijscontext privé worden beoordeeld; die 22 zijn nog niet automatisch live opgehaald.

### Eén aanroep voor de complete privé-scraperroute

`captureAndArchiveApprovedRetailerProduct(captureOptions, privateOutputFile)` in `scripts/retailer-approved-price-archive-run.mjs` voert de bestaande bronrechtentoets, exacte ene HTML-capture, PLUS Schema.org / Deka Nuxt-prijscontrole, versheid/pack/voorraad en exclusieve privé-archivering direct achter elkaar uit. De aanroeper geeft expliciet een toegestane `fetchFn`, beoordeelde bron-URL, echte bronrechten en nieuwe bestandsnaam. De functie retourneert **alleen** status/aantallen; geen prijs, URL of lokaal uitvoerpad. De huidige checked-in PLUS/Deka-rechtenregistratie weigert dit vóór netwerk én vóór file writes.

```js
import { captureAndArchiveApprovedRetailerProduct } from './scripts/retailer-approved-price-archive-run.mjs'

const status = await captureAndArchiveApprovedRetailerProduct({
  source, permissionGate, grant, fetchFn, capturedAt,
}, '/eigen-beveiligde-map/nieuwe-review.json')
```

Dit is nu technisch een complete **één-product, toestemminggebonden capture→prijs→privé-archief**-pipeline. Er is **nog geen** automatisch dagproces, periodieke databankmigratie of betrouwbare vergelijking van 22 actuele echte productwaarnemingen.

## Onafhankelijke HTML-parserbeveiliging

De nieuwe `scripts/retailer-approved-html-script-evidence.mjs` herkent exact het HTML-attribuut `type` bij JSON-LD en `id` bij `__NUXT_DATA__`. `data-type`, `data-id`, `aria-id`, neptekst *binnen andere attribuutwaarden* en dubbele echte sleutels worden **niet** als gezaghebbende bronmetadata vertrouwd. Dit is een afzonderlijke beveiliging van **deze PR's eigen prijsroute** en verandert niet de parallel ontwikkelde offline binder van een andere worker ([QA-issue #3358](https://github.com/Zennay/Supa/issues/3358)).

## Herhaalbare tests

```bash
node --experimental-strip-types --test tests/product-retailer-approved-html-price-candidate-20261016.test.mjs
node --experimental-strip-types --test tests/product-retailer-approved-deka-nuxt-price-candidate-20261016.test.mjs
node --experimental-strip-types --test tests/product-retailer-approved-html-script-evidence-20261016.test.mjs
node --experimental-strip-types --test tests/product-retailer-approved-private-price-snapshot-store-20261016.test.mjs
node --experimental-strip-types --test tests/product-retailer-approved-price-archive-run-20261016.test.mjs
npm test
npm run m1:source-permission-gate
npm run build
```

De tests geven **uitsluitend fictieve in-memory HTML + fictieve toestemming**, dus nul echte externe requests. Ze testen beide retailers, centbedragen, g/ml-verpakkingen, hash, meervoudige Product-nodes, oude snapshots, onbekende voorraad, foutieve bron, misvormde JSON, echte check-in-rights-denial, 403/429, onjuiste content-type en het ontbreken van retries.

Dit maakt de ontbrekende **capture → productgegevens → prijsvalidatie**-schakel concreet uitvoerbaar. Er volgt pas na afzonderlijke bronrechten en review een dagverversing, productie-database-write, PWA-integratie en M3 live kassabonvergelijking. De bestaande verkennende 22 regels uit [issue #78](https://github.com/Zennay/Supa/issues/78#issuecomment-6210818832) blijven bruikbaar als zoek-/reviewlijst maar zijn geen actuele observaties.


## Offline herinspectie van reeds toegestane private HTML-snapshots

De bestaande eenpagina-downloader bewaart uitsluitend na aparte bronrechtentoets
`capture.html` en `capture.html.manifest.json` met echte capture-URL, UTC, bytes
en SHA-256. De nieuwe replay **voert geen HTTP-verzoek uit** en kan de echte
bronrechtentoets bij capture nooit achteraf vervangen:

```bash
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs   /private/capture.html /private/nieuwe-review.json
```

Het `0600`-reviewbestand bevat uitsluitend lokaal een niet-publiceerbare
`RawProductObservation`-kandidaat (indien exact herleidbaar) en ongoedgekeurde
DOM-selectorvoorstellen. De uitvoer weigert gewijzigde HTML, foutieve/te
ruime toegang, symlinks, niet-canonieke source-URL en bestaande reviewbestanden.
`permissionVerifiedForThisReplay`, `readyForIngestion`,
`verifiedCurrentCheckoutPrice`, `productionEnabled` en `published` blijven
**false**; zelfs een herkenbare productprijs blijft menselijke review vereisen.
De tests gebruiken expliciet synthetische HTML en fictieve in-memory toestemming;
de huidige PLUS/DekaMarkt-bronrechten staan live-ophalen nog niet toe.


Selectorwijzigingen tussen twee afzonderlijk opgeslagen bronmomenten kunnen
rechtstreeks en volledig offline via hetzelfde manifest-gecontroleerde pad:

```bash
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs   --drift /private/voor.html /private/na.html
```

De uitvoer bestaat uitsluitend uit geaggregeerde aantallen en `reviewRequired`;
de parser promoot geen CSS-selector, doet geen HTTP en maakt geen winkelprijs
beschikbaar voor gebruikers. De bestaande `retailer-private-selector-drift.mjs`
is de validator van die verschillen.

### Geen script-bewijs uit verborgen HTML

De prijs-/Nuxt-brug doorloopt uitsluitend echte HTML-`script`-tags. Een
`<script>` in een HTML-comment, een `template`, `noscript`, `textarea`,
`svg`, `style`, `title`, `xmp`, `iframe` of in een geciteerd HTML-attribuut is
geen live productbewijs. Malformeerde inert-containergrenzen en een externe
`src` die een relevante JSON-LD/Nuxt-tag nabootst, worden fail-closed
geweigerd. Synthetische positieve en negatieve contracttests bewijzen dat
gewone PLUS-JSON-LD en Deka Nuxt corroboratie werkzaam blijven; er is geen
nieuwe echte bronpagina gecaptured of winkelprijs gepubliceerd.

### Offline prijs- en verpakkingsdrift: alleen dezelfde bron en artikelidentiteit

De `--drift`-bediening vergelijkt voortaan alleen snapshots van **dezelfde
oorspronkelijke product-URL**; de URL-identiteit staat uitsluitend als
SHA-256-fingerprint in het private reviewrecord. Bij verwisselde artikelen
(inclusief gewijzigde productnaam bij hetzelfde source-ID), onbeschikbare
producten of ontbrekende prijs-/packbewijzen wordt de geldvergelijking
`null` (onbekend), nooit `0` (geen verschil). Voor een daadwerkelijk
vergelijkbaar artikel worden alleen geaggregeerde 0/1-tellingen voor gewijzigde
prijs of verpakking getoond. Eurobedragen, oorspronkelijke URLs en HTML blijven
buiten stdout en elk resultaat blijft menselijke review vereisen. Dit is
een historische bronkandidaatvergelijking, niet een actuele kassaprijs.

### Tot 22 bestaande private HTML-opnamen in één reviewbestand

Voor een reeds rechtmatig en afzonderlijk gemaakte lokale snapshot per artikel
biedt dezelfde offline CLI nu een **batch**-actie voor maximaal 22 verschillende
producten (PLUS en/of DekaMarkt); de bestaande bronregistergate mag hiermee
niet worden overgeslagen tijdens de oorspronkelijke capture:

```bash
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs \
  --batch /private/nieuw-reviewpakket.json \
  /private/plus-artikel.html /private/deka-artikel.html
```

Elke HTML+manifestcombinatie wordt zelfstandig gecontroleerd (SHA, UTC, URL
en fysieke private bestandsrechten). Een dubbele product-URL per retailer
wordt geweigerd, ook als dezelfde pagina onder een andere datum is vastgelegd.
Een artikel zonder bewezen beschikbaarheid blijft `unverified_product`
met `observation:null` en wordt nooit als prijs-kandidaat meegeteld.
Het archief wordt eenmaal exclusief met `0600` aangemaakt. In stdout staan
alleen aantallen kandidaten en onbesliste records per keten, nooit individuele
producten, bedragen of URLs. De synthetische end-to-endtests gebruiken
speciaal fictieve toestemming; dit activeert geen live retailercapture of
publicatie.
