# SUPA — offline CSS-selectorwijzigingen herkennen (nog geen scraper-autorisatie)

Met `scripts/retailer-private-selector-drift.mjs` kunnen twee veilig opgeslagen resultaten van `proposeOfflineRetailerSelectors` worden vergeleken. Dit is een echte uitvoerbare **review- en driftcontrole op historische HTML-snapshots**, niet een browserselector die automatisch in een live scraper wordt geplaatst.

## Gebruik

Voer vóór en na een *toegestane/geverifieerde* offline HTML-capture de reeds bestaande `retailer-inspect-snapshot-cli.mjs` uit, met een betrouwbare bron-URL, UTC-tijdstempel, SHA-256 en lokaal HTML-bestand. Bewaar de JSON-uitvoer in twee verschillende operator-beheerde privébestanden (`umask 077`, bestandsmodus `0600`).

```sh
node scripts/retailer-private-selector-drift.mjs --before private/old-proposals.json --after private/new-proposals.json
```

Er worden **geen webverzoeken** uitgevoerd. De lezer weigert symlinks, ongeldige bronidentiteiten en toekomst-/teruglopende observatietijd, openbare of grotere JSON-bestanden, ongeldige selectors en tegenstrijdige snapshots met dezelfde SHA. De geproduceerde JSON bevat enkel tellingen van verschenen, verdwenen en in aantal gewijzigde CSS-voorstellen per semantisch veld, plus veranderingen in gestructureerde metadata zoals JSON-LD/Nuxt/Next. Geen CSS-namen, HTML, prijzen, producten, bron-URL's, SHA's of persoonlijke gegevens staan in uitvoer of foutmelding.

De uitvoer blijft altijd `reviewRequired:true`, `permissionVerified:false`, `automatedSelectorPromotion:false`, `productionEnabled:false`, `publicSavingsClaimEligible:false`. HTML dat verandert zónder selectorverandering is apart zichtbaar (`htmlBytesDiffer:true` zonder selectorverschil). Als dezelfde SHA onverenigbare selectors bevat, wordt de hele vergelijking geweigerd; een latere identieke snapshot blijft driftvrij.

## Controle van historische opnamedatums

De vergelijking accepteert uitsluitend **fysiek geldige UTC-brontijden** met 0–3 fractiecijfers en een correcte, exacte datum/tijd bij terugvertaling uit UTC. Een syntactisch ogende datum zoals `2026-02-30T12:00:00Z`, `1900-02-29T12:00:00Z`, `2026-04-31T12:00:00Z` of `24:00` wordt volledig geweigerd, zowel als historische basis als als nieuw snapshot. Javascript `Date.parse` zou sommige daarvan stilzwijgend verschuiven, waardoor er anders een onjuiste, aan SHA gekoppelde opnamegeschiedenis zou ontstaan. Geldige schrikkeldagen (zoals 2000 en 2024) en bestaande momentopnames met 1–3 millisecondecijfers blijven bruikbaar.

Dit is uitsluitend een controle van de herkomstclaim in **eerder opgeslagen privé-JSON**. De comparator voert zelf geen HTML-capture uit en kan de oorspronkelijke winkeldata of auteursrechten niet onafhankelijk bewijzen. Bij ongeldige input wordt niets als CSS, product of besparing gepubliceerd; de uitvoer blijft een menselijke beoordelingsmelding zonder brongegevens.

**Wat drift niet bewijst:** dat een CSS selector werkelijk een artikel, prijs of beschikbaarheid in de browser oplevert. Productieadapters moeten nog per keten gevalideerd worden, alleen met expliciet geautoriseerde data en tegen de geschreven rechtenregisters. De M3-releasevoorwaarden [#74](https://github.com/Zennay/Supa/issues/74), [#78](https://github.com/Zennay/Supa/issues/78), [#205](https://github.com/Zennay/Supa/issues/205), [#2833](https://github.com/Zennay/Supa/issues/2833) blijven open.

Tests: `node --experimental-strip-types --test tests/product-retailer-private-selector-drift-20261015.test.mjs`, met werkelijk geproduceerde offline proposal-objecten en lokale 0600 JSON-bestanden.
