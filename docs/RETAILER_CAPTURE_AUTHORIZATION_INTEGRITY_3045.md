# Private retailer capture → selector review: authorization and privacy boundary

## Het probleem (onafhankelijke QA #3042 / issue #3045)

De aanvankelijke brug accepteerde objecten met getters. Een getter op `grant.reviewed` kon de (uitsluitend in een test fictief toegestane) retailerbronrechten veranderen **na controle maar vóór** de geïnjecteerde opname. De oorspronkelijke HTML-selectorvoorstellen konden daarnaast een specifieke productidentificatie in een CSS-class of een prijsachtige `data-testid` letterlijk teruggeven.

## Nu uitgevoerd

`captureToPrivateSelectorReview` maakt **vóór** de oorspronkelijke bronrechten-, scope- of netwerkcontroles een volledig nieuwe, losgekoppelde autorisatiesnapshot. De snapshot leest uitsluitend **eigen data-property descriptors**, weigert getters/setters, Proxy-objecten, eigen symbolische velden, ongebruikelijke prototypes, sparse arrays en onbegrensde geneste vormen. Bij weigering wordt `fetchFn` niet aangeroepen. De bestaande `captureApprovedRetailerPage` blijft eigenaar van de inhoudelijke bronrechten-, scope-, robots-, HTTPS-route- en opnamecontroles. De bestaande echte bronrechtenregistratie is onveranderd: PLUS `permission_required`, DekaMarkt `unresolved`.

Een tweede, uitsluitend voor de private brug geldende begrenzing laat uit `proposeOfflineRetailerSelectors` alleen enkele **vooraf benoemde, generieke** HTML/CSS-vormen door, zoals `article.product-card`, `span.price-label` en het statische `a[href^="/product/"]`. Onbekende CSS-classes, numerieke `data-testid`, mogelijke artikelidentificaties en dynamische waarden verlaten de private bron niet. Overige broninformatie blijft offline; geen product- of prijswaarde wordt als geverifieerd aangemerkt. Elke selector blijft `needs-human-review`; `approvedSelectors:0`, `readyForIngestion:false`, `productionEnabled:false`.

## Valideren

```bash
node --experimental-strip-types --test tests/qa-retailer-authorized-capture-immutable-permission-privacy-20261015.test.mjs
node --experimental-strip-types --test tests/product-retailer-inert-capture-privacy-20261015.test.mjs
```

De eerste test is **letterlijk byte-identiek** overgenomen van de QA-worker [PR #3042](https://github.com/Zennay/Supa/pull/3042), zonder zijn branch of test te wijzigen. De tweede test controleert extra nested getters, Proxy, onvolledige array-evidence, veilig gebonden generieke CSS en de private kopie bij muterende testtransporten. Alle mockrechten zijn uitdrukkelijk fictief en alle transporten in-memory. Zonder echte schriftelijke rechten is geen echte externe capture toegestaan; er is geen CLI, standaard netwerkcall, scrapingplanner, publieke actuele prijs of besparingsclaim.
