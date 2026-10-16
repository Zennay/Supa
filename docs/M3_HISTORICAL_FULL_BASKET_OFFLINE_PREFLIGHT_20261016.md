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

## Nieuwe integratie: alleen na deze controle een privédatabase schrijven

De bestaande uitvoerbare offline SQLite-builder `scripts/retailer-build-reviewed-universal-sqlite.mjs` gebruikt nu **dezelfde zes-bron→catalogus→11×2 plannercontrole vóór aanmaken van de database**. Dit is functionele toelating op de echte, historische archieffacts, geen alleenstaande losse checklist:

```bash
node --experimental-strip-types scripts/retailer-build-reviewed-universal-sqlite.mjs --out /beveiligd/lokaal/pad/reviewed.db
```

De bestaande SQLite-beveiliging (nieuwe file, 0600 rechten, geen overschrijven, atomische Python-import en lokale opslag van herkomst en historische observaties) blijft intact. De geaggregeerde JSON CLI-uitvoer vermeldt nu ook `canonicalPlannerNeeds: 11`, `twoStoreReviewRows: 22` en `fullBasketFieldComparisonVerified: false`.

Ook rechtstreekse JavaScript-aanroepen van de geëxporteerde SQLite-builder-CLI krijgen een inerte, begrensde kopie van `argv` vóór het lezen van `length` of de outputlocatie; een actieve/revoked Proxy of gespoofde array wordt geweigerd **vóór iedere bestandsmutatie**.

Nieuwe tests gebruiken de echte zes M1-captures, bouwen daadwerkelijk een 0600-SQLite bestand, bewijzen no-overwrite en controleren zowel een echt Node-subproces als niet uitvoerbare Proxy-argumenten. Hieruit volgt nooit een toestemming om de private SQLite-bron als actuele winkelprijzendatabase te gebruiken.

## Onafhankelijke exportpad-QA (#3242 / #3243), 16 oktober

Oorspronkelijke onafhankelijke [QA #3242](https://github.com/Zennay/Supa/pull/3242) demonstreerde op eerdere ongerepareerde code twee directe JavaScript API-gevallen waar een fictieve databasebestemming met een ingebed NUL-teken een Node `TypeError` teruggeeft, inclusief het opgegeven private pad. De bestaande symlink- en non-overwrite controles waren al groen. In eigen product-code wordt een niet-toelaatbare bestemming nu **vóór resolve/lstat** geweigerd; een onverwachte native bestandsfout wordt niet meer met padinformatie naar de aanroeper doorgegeven. Daardoor blijft de foutmelding veilig en generiek.

De twee onafhankelijke oorspronkelijke QA-bestanden zijn **byte-identiek** herhaald in de productbranch: `cedb657be9a6aa62245dac76592de5ae0aaade95` (filesystemafwijzing) en `f7cf99befda6c9a316b77fd12ef843da4096f141` (zes historische bronvormen en 11×2 planner-consistentie). Extra eigen tests weigeren daarnaast newline, carriage return, DEL en te lange bestandsnamen en controleren dat **geen database of output** achterblijft.

Dit gaat om de lokale offline applicatie-API, niet om een bewezen remote aanval. Er zijn geen externe supermarktgegevens, echte tokens of gebruikersbestanden gelezen. Bronrechten en menselijke M3-studie blijven ongewijzigd HOLD.
