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

De offline replay houdt een historische opname ouder dan 24 uur nog beschikbaar
voor de originele SHA-gebonden selectorinspectie, maar labelt de prijs als
`unverified_product` en verwijdert de prijsobservatie uit het reviewrecord.
Ook de batch telt zulke historische bronnen niet als nieuwe actuele
prijskandidaten. Dat is bewust strenger dan alleen een aanwezig eurobedrag
controleren; de data worden niet opnieuw opgehaald of ververst.

De directe privé-review en de batch vereisen nu bovendien een **afgeschermde
stagingmap** zonder groeps- of wereldrechten (bijvoorbeeld `0700`).
Een directory waarvan derden de reviewbestandsnamen kunnen bekijken wordt
geweigerd, ook al zou het bestand zelf `0600` hebben. Mocht een write
mislukken, dan verwijdert de cleanup uitsluitend het fysieke bestand dat
deze uitvoering zelf exclusief heeft geopend; een intussen onder dezelfde
naam vervangen bestand van een andere schrijver wordt nooit gewist.

### Controleerbare privé-driftwaarschuwing bewaren

Met `--drift-save` wordt een eerder uitsluitend op stdout weergegeven
driftmelding als nieuw, exclusief `0600` rapport op de lokale operator-
stagingmap opgeslagen. Twee originele HTML+manifestbestanden moeten van
**dezelfde retailer én dezelfde exacte product-URL** komen en een geldige
tijdvolgorde hebben:

```bash
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs \
  --drift-save /private/voor.html /private/na.html /private/nieuwe-drift.json
```

Het privérapport bevat enkel de originele HTML-SHA's, opnametijden, een
SHA-fingerprint van de URL en geaggregeerde selector-, prijs- en
verpakkingswijzigingen. Ook de privérapporten presenteren geen checkoutprijs
of automatisch goedgekeurde selector. De normale CLI-uitvoer bevat uitsluitend
een neutrale status; geen winkel-URL, HTML of prijs wordt gelogd.

Bij een geslaagde `--batch`, single-item review of `--drift-save` geeft
de CLI ook `archiveSha256` terug. Dat is uitsluitend de SHA-256 van de
daadwerkelijk naar een nieuw privébestand geschreven UTF-8 bytes, geen
individuele prijs of bron-URL. Een operator kan het bestand later onafhankelijk
controleren met `sha256sum /private/nieuw-reviewpakket.json`. Deze receipt
bevestigt lokale bestandsintegriteit, **niet** dat de bronrechten, kassaprijs
of menselijke review zijn goedgekeurd.

Voor herinspectie van de originele HTML en manifest gelden dezelfde
privé-mapvoorwaarden als voor de review-uitvoer: de map moet voor andere
gebruikers ontoegankelijk zijn, beide bestanden moeten slechts een fysieke
hardlink hebben en hun mode moet eigenaar-only zijn. Hardlinks of publieke
directorynamen worden geweigerd om dubbele historische herkomstclaims te
voorkomen.

### Geen tegenstrijdige prijs- of productclaims bij Deka Nuxt en JSON-LD

De DekaMarkt-capture en offline privéreplay verifiëren nu beide gestructureerde
bronkanalen wanneer Nuxt aanwezig is. Ook een geldige JSON-LD Offer.price
mag geen afwijkend Nuxt-bedrag, SKU, verpakking of voorraadstatus overschrijven.
Meerdere casevarianten van Price/price met verschillende bedragen, ambigue
priceSpecification of lowPrice leiden tot een onbesliste opname.
Volledig overeenstemmende bronnen blijven alleen een kandidaat voor menselijke
review, nooit een geverifieerde kassaprijs. Tests zijn synthetisch: geen live
webshop, geen productieprijs of verzonnen toestemming.

### Product-, catalogus- en aanbiedingen-HTML: offline selectors van bestaande snapshots

De oorspronkelijke toestemmingstoets en eenpagina-downloader bestaan al voor
product-, catalogus- en aanbiedingenroutes, maar de *productprijskandidaat*
blijft beperkt tot de productroute. De nieuwe private replay ondersteunt nu ook
PLUS en DekaMarkt catalogus/zoeken en aanbiedingen: iedere originele HTML
wordt samen met de 0600 manifest gecontroleerd op originele winkelhost,
exacte soort/URL, UTC, SHA-256 en eigenaar-only map en inode.

De offline operator-CLI kan voor deze twee niet-producttypen uitsluitend
CSS-selectorvoorstellen ter menselijke beoordeling maken en bewaren:

```bash
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs \
  --selectors /private/catalog.html /private/nieuw-catalog-review.json
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs \
  --selector-drift /private/oude-aanbiedingen.html /private/nieuwe-aanbiedingen.html
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs \
  --selector-drift-save /private/oude-aanbiedingen.html /private/nieuwe-aanbiedingen.html \
  /private/nieuwe-drift-review.json
```

Drift accepteert alleen twee bestaande SHA-gecontroleerde HTMLs van dezelfde
winkel, dezelfde paginacategorie en de **identieke URL**. De uitvoer bestaat
uitsluitend uit tellingen; reviewbestanden zijn exclusief 0600 met
archiveSha256-ontvangstbewijs. Geen producten of prijzen worden uit catalogus-
of aanbiedingenpagina's tot een kassaprijs afgeleid; geen selector wordt
geactiveerd. Alle test-HTML is synthetisch en de echte PLUS/Deka-bronrechtengate
blijft uitgeschakeld. Operator heeft nog steeds aantoonbaar retailerbewijs
nodig voordat originele live HTML wordt opgevraagd.

Onbesliste productreviews hebben voortaan een niet-gevoelige reviewReason:
`stale_capture`, `missing_or_conflicting_product_evidence`,
`availability_unconfirmed` of `price_or_physical_pack_missing`. Een privébatch
toont uitsluitend geaggregeerde reviewReasonCounts zodat de operator kan zien
of heropname, voorraadcontrole of bronnenreview zinvol is, zonder artikelprijzen
of URL's via stdout te delen.

### Veilige originele capture-opslag vóór offline review

De bestaande toestemming-gated eenpagina-downloader deelt nu dezelfde
privé-directory-eis met de offline replay. Als een reeds bestaande
HTML-doelmap groeps- of wereldtoegang heeft, wordt de actie vóór het
netwerkverzoek geweigerd; nieuw aangemaakte doelmappen zijn 0700.
De HTML en het manifest blijven exclusief 0600. Mislukt de tweede bestandswrite,
dan worden alleen de fysiek door deze uitvoering aangemaakte originele
inodes opgeruimd: een andere schrijver die een naam intussen heeft vervangen,
of een symlink, wordt nooit verwijderd. Dit maakt de synthetisch geteste
capture → manifest → selector-reviewroute uitvoerbaar zonder die
veiligheidsvoorwaarden te versoepelen. De canonieke PLUS-/Deka-permissiongate
blijft disabled en wordt vóór ieder echt netwerkverzoek toegepast.

### Alleen werkelijke HTML-tags en attributen als selectorbewijs

De selectorvoorstellen gebruiken nu quote-bewuste statische openingstag- en
attribuutparsing in plaats van regex-substrings in willekeurige attribuuttekst.
Aliassen zoals data-class, data-data-testid, aria-itemprop en data-href
kunnen geen geldige class-, data-testid-, itemprop- of href-claim vervalsen.
Een tekst zoals een ingesloten span-tag binnen een geciteerde data-note is
geen zelfstandig DOM-element en mag nooit als selector worden voorgesteld.
Ongebalanceerde of niet-eenduidige HTML-attributen worden fail-closed
geweigerd. Er worden geen scripts uitgevoerd of actuele productprijzen
gepubliceerd; validatie blijft menselijke review vereisen.

### 30 oktober — offline HTML-inspectie: fysieke bronidentiteit en echte DOM-tokenbewijs

De operator-CLI `retailer-inspect-snapshot-cli.mjs` opent de vastgelegde
HTML nu met `O_NOFOLLOW` en `O_NONBLOCK` en controleert dat één regulier,
niet-gehardlinkt fysiek bestand gedurende het lezen dezelfde device-/inode-,
size- en wijzigingsidentiteit houdt. Pas daarna accepteert hij de bestaande
SHA-256 manifestpin. Alias-/symlinkwisselingen worden geweigerd; geen
netwerkrequest of retailertoestemming wordt geïmpliceerd.

De offline selector discovery laat geciteerde `<script>`-/`<template>`-strings,
commentaren, verborgen DOM-markup en externe scripts nooit meetellen als
zichtbaar selector- of JSON-LD-signaal. Geldig JSON-LD binnen een echte HTML
`<head>` blijft juist herkenbaar. Selectors blijven uitsluitend voorstellen
voor menselijke review, zonder automatische publicatie of prijsclaim.

### Inspectie-CLI: nooit unieke CSS-bronidentiteit op stdout

Ook lokale CSS-klassen en `data-testid`-attributen kunnen een unieke SKU,
leveranciersnaam of prijs encoderen. De operatoruitvoer van
`retailer-inspect-snapshot-cli.mjs` filtert daarom op een beperkte set
herkenbare generieke selectorhints. Onbekende of identifier-bevattende
selectoren blijven uitsluitend in de oorspronkelijke privé-HTML voor
menselijke review; alleen hun **aantal** verschijnt op stdout als
`privateSelectorCount`. De invoer blijft SHA-/inode-pinned. Geen individuele
productnaam, prijs of ruwe unieke CSS-token mag als publiek resultaat dienen.

### Snapshotinspectie vereist exclusieve bronmap

De CLI voor SHA-gepinde HTML weigert ook symbolisch gelinkte ouders en
wereld-/groeps-toegankelijke invoermappen. De directe stagingmap hoort
`0700` te zijn, mag tijdens het inspecteren niet van fysiek inode veranderen,
en het geopende bronbestand moet aan de bestaande SHA- en hardlinkregels
blijven voldoen. Dat beschermt de privé-reviewroute onafhankelijk van de
veilige terminalexport.

### Privé HTML-invoer vereist ook filemode 0600

Bij reeds bestaande snapshots is een exclusieve `0700` map niet genoeg als
het daadwerkelijke HTML-bestand ruimere groeps-/wereldrechten heeft. De
inspectie-CLI verifieert daarom `0600`-achtige private bestandsrechten op
hetzelfde geopende bestand zowel vóór als na het lezen, naast het bestaande
SHA-, size- en inodebewijs. `0640` en `0644` worden geweigerd; na veilig
terugzetten van de filemode kan het offline rapport opnieuw worden gemaakt.

### Eén HTML-grens voor prijs- en selectorbewijs

De privé-JSON-LD/Nuxt-prijsroute en de offline selectorontdekking gebruiken
nu dezelfde quote-aware structurele HTML-scanner. `plaintext` consumeert de
resterende HTML uitsluitend als tekst; `noembed` en `noframes` bevatten geen
actieve scripts of selectors. Daardoor kan een gekopieerd Product-script in
fallbacktekst geen heimelijke prijswaarneming of selector worden, terwijl een
los echt script ná een afgesloten fallbackcontainer wel bruikbaar blijft.
De parser voert nooit scripts uit en controleert de precieze Nuxt-JSON
scriptmetadata; echt downloaden/publiceren blijft afhankelijk van de
ongewijzigde afzonderlijke source-rechten- en reviewgates.

### Selectorstabiliteit over 2–8 reeds vastgelegde catalogus-/aanbiedingspagina's

Een operator kan meerdere afzonderlijke goedgekeurd vastgelegde HTML- en
SHA-manifestparen van **één supermarkt én één paginatype** vergelijken:

```bash
node --experimental-strip-types scripts/retailer-replay-private-html-product.mjs \
  --selector-stability /private/nieuw-stability.json \
  /private/catalog1.html /private/catalog2.html
```

De engine herinspecteert *ieder* privébronbestand, weigert dubbele identieke
HTML-opnamen en gemengde retailers/paginatypen, en bewaart uitsluitend in het
exclusief gemaakte `0600`-reviewbestand welke CSS-selectors op **alle**
onderzochte bronopnamen echt zijn aangetroffen. HTML-digests, UTC en gehashte
bron-URL's verbinden voorstellen met de oorspronkelijke bestanden; afwijkende
selectors worden geaggregeerd geteld. Stdout bevat slechts aantallen en SHA
van het private archief. Geen voorgestelde selector wordt automatisch
gepromoveerd, geen prijs gepubliceerd, geen HTTP-verzoek uitgevoerd.

Voor handmatige analyse bevat het **private** reviewarchief naast de stabiele
selectors ook de veranderlijke voorstellen met hun waargenomen frequentie,
plus een per-field overzicht (`product`, `name`, `price`, `pack`, `offer`,
`availability`). Een ontbrekend veld blijft een expliciete nul, nooit een
verzonnen selector. De publiek leesbare CLI-samenvatting houdt alleen
aggregaten bij.

Wanneer HTML-elementtypen tussen opnamen veranderen, bewaart het privéarchief
tevens een afzonderlijke groep **over alle captures aangetroffen klasse-tokens**.
Bijvoorbeeld `article.product-card` en `div.product-card` bewijzen allebei
uitsluitend het bestaan van de klas `product-card`; het nieuwe bredere voorstel
`.product-card` blijft expliciet `needs-human-review`, omdat uniciteit en
DOM-selectie nooit automatisch zijn bewezen. Ook dit voorstel verschijnt niet
als CSS-waarde op stdout en telt nooit als productieadmissie.

Dezelfde private beoordeling geldt ook voor aantoonbaar herhaalde `data-testid`
- en `itemprop`-waarden op verschillende HTML-tags. Een breder attribuutvoorstel
wordt uitsluitend gevormd uit daadwerkelijk gemeten attributen in iedere
opname; ook hier blijven selectoruniciteit en geschiktheid onbewezen en is
een menselijke review verplicht. Dit geldt voor de M1 catalogus-/aanbiedingsroute,
niet voor automatische live prijsverwerking.

### Corroboratie van fysiek gelijke verpakkingen

DekaMarkt Nuxt en dezelfde pagina's Schema.org-product kunnen exact dezelfde
inhoud als `1 liter` en `1000 ml` vermelden. De private prijsbrug vergelijkt
nu de fysieke dimensie en hoeveelheid (eveneens `1 kg` versus `1000 g`)
met identieke multipackaantallen, zonder een verschil in naam, SKU,
beschikbaarheid of onafhankelijke prijscorroboratie te negeren. `750 ml` tegen
`1 liter` en gewicht tegen volume blijven review-weigeringen. Het originele
onafhankelijke QA-scenario uit PR #3572 is 3/3 groen nagebootst op deze code.

### Onvolledige selectorwaarnemingen zijn geen stabiliteitsbewijs

De offline extractor begrenst elk bronrapport op 24 selectorvoorstellen. Bij
meer dan 24 verschillende werkelijk afgeleide kandidaten kan de aanwezigheid
van de overige voorstellen niet uit de beperkte lijst worden vastgesteld.
Daarom weigert het meer-snapshot-stabiliteitsarchief zo'n bron expliciet in
plaats van ontbrekende voorstellen als instabiel of afwezig te classificeren.
De private stabiliteitsroute vraagt hiervoor een afzonderlijk telgegeven op;
de bestaande SHA-pinned v1 drift-json en zijn afgeschermde publicatiecontract
blijven byte-/schema-compatibel.

### HTML-endtags moeten echt geldig zijn

Een ongeldig `</ script>` of `</ template>` sluit volgens de HTML-tokenregels
geen script of template af. De gedeelde scanner herkent nu uitsluitend echte
`</script>` / `</template>`-grenzen, zodat een bedrieglijke ongeldige afsluiter
niet alsnog zichtbare Product-, prijs- of selectorinformatie kan opleveren.
Evenzo wordt `< script>` nooit als JSON-LD-script aangemerkt. Ongeldig
bronscript levert geen prijswaarneming; echt geldig HTML blijft ondersteund.
