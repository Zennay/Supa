# Supa M3 — één echte offline keten tot de volledige boodschappenmand

**Status:** product-core ontwikkelhulpmiddel, alleen historische/sanitized M1-captures. Geen live scraper, geen retailerprijs van vandaag, geen automatische geldbesparing of toestemming.

## Wat er nu werkt

Nieuwe uitvoerbare entrypoint: `scripts/retailer-private-m3-full-basket-preflight.mjs`. Het gebruikt **de zes echte, reeds opgeslagen en door adapters gevalideerde** PLUS- en DekaMarkt-vormen (product, catalogus, aanbiedingen). Daarop volgt een inerte, begrensde snapshot, de bestaande zes-adapterbroncontrole, de veilige privé-catalogus en het canonieke M3 weekmandje met **11 behoeften × 2 winkels = 22 handmatige review-rijen**.

Draai lokaal met Node 22+:

```bash
node --experimental-strip-types scripts/retailer-private-m3-full-basket-preflight.mjs
```

De publieke stdout bevat uitsluitend totalen: bronnen, historische observaties en conflicten, hoeveel van de 22 plannerbehoeften een *voorstel voor handmatige controle* krijgen, resterende onvervulde rijen en dat de release altijd op **HOLD** staat. Geen prijzen, productnamen, URLs, SHA's, winkelbezoeken of persoonsdata.

## Wat de controle expliciet weigert

- Minder dan alle zes historische bronvormen, afgewezen adapters, dubbele bronvormen, foutieve aantallen of valse gebruiksrechten.
- Programmatic getter-/Proxy- of revoked Proxy-invoer, ongeldige opties, onbekende argumenten en buitensporig grote primitieve data.
- URL-bronnen met mixed-case of %-encoded `access_token` parameters.
- Tegenstrijdige tellingen tussen de catalogus, gezondheidscontrole en de exact 22 M3-winkelbehoeften.
- Iedere intentie om een historische prijs in een actueel winkeladvies te veranderen.

## Betekenis van het resultaat

Een succesvolle run bewijst **uitsluitend** dat de offline keten op bekende historische fixtures consistent is en een handmatige productreview kan voorbereiden. Een planner-'suggestie' is geen geverifieerd identiek product, geen schapbeschikbaarheid en geen actuele aanbieding. Zowel `fullBasketFieldComparisonVerified`, `actualRetailerPriceOrStockVerified` en `retailerReuseRightsVerified` blijven **false**, ongeacht de technische uitkomst.

M3 kan pas extern worden afgesloten nadat schriftelijke PLUS/Deka-bronrechten [#74](https://github.com/Zennay/Supa/issues/74), een echte menselijke **zelfde 11×2 mand binnen 24 uur** [#78](https://github.com/Zennay/Supa/issues/78), veldbron-SHA [#205](https://github.com/Zennay/Supa/issues/205), de permanente betrouwbare M3 VPS-validatie [#2833](https://github.com/Zennay/Supa/issues/2833) en de gescopeerde zCloud-writer-coördinatie bevestigd zijn.

**Geen** externe fetch, proxyverzoek, CAPTCHA, scraper scheduler, prijspublicatie of productie-deploy wordt door dit nieuwe commando uitgevoerd.
