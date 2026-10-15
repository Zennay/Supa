# Quality gate: is een historische aanbieding onafhankelijk te onderbouwen?

De zes beoordeelde, offline PLUS- en DekaMarkt-adapters leveren zowel catalogusprijzen als aanbiedingen. Een aanbiedingsprijs alleen is **geen** bewijs van een besparing: Supa moet vaststellen of de normaalprijs in de catalogus van **dezelfde supermarkt en SKU**, met **dezelfde verpakking** en een nabijgelegen opnametijd, overeenkomt met de beweerde oorspronkelijke prijs.

## Uitvoerbaar (zonder internet)

```sh
node --experimental-strip-types scripts/qa-retailer-offer-baseline-corroboration.mjs
node --experimental-strip-types --test tests/qa-retailer-offer-baseline-corroboration-20261015.test.mjs
```

De CLI werkt uitsluitend met de zes historische, beoordeelde lokale M1-bronnen; de pure functie `reviewPrivateRetailerOffers(batch, { asOf, windowHours })` verwerkt alleen reeds genormaliseerde, gevalideerde private bronwaarnemingen. De standaard maximale tijd tussen een catalogusbron en een promotiebron is 24 uur en is een interne *historische bewijsafstand*, **geen** actualiteits- of publicatieregel.

Het rapport telt afzonderlijk: aanbiedingen met een concrete prijs, historisch gecorroborreerde catalogusbasis, ontbrekende basiscatalogus, afwijkende oorspronkelijke prijs, onvergelijkbare verpakking, te ver uiteen liggende opnametijden, onvoldoende promotiegeldigheidsgegevens, promoties die buiten het eigen geldigheidsvenster werden opgenomen en ongeldige kortingsclaims. Ieder onbekend of tegenstrijdig geval blijft uitdrukkelijk in menselijke review. Alle bedragen, productnamen, links en bron-SHA's zijn uitsluitend in het interne proces zichtbaar, niet in uitvoer of foutmelding.

Specifieke garanties: de aangeboden prijs mag niet verschillen van dezelfde geobserveerde `currentPriceCents`; een geldige korting moet een hogere historische oorspronkelijke prijs hebben; zonder vergelijkbare catalogus kan het systeem geen besparing bewijzen; hetzelfde SKU-nummer van een andere winkel wordt nooit als onderbouwing gekozen. De oorspronkelijke PLUS-bananenaanbieding wordt door de historische PLUS-catalogus bevestigd; de originele PLUS-aanbiedingen bevatten echter geen expliciet bewezen geldigheidsvenster en blijven daarvoor in review.

**Niet doen:** oude promoties behandelen als actueel, een discount zonder toestemming publiceren, prijsmechanieken uit tekst gokken, CAPTCHA of private API omzeilen, een live retailerrequest uitvoeren, of de volledige M3 release alvast goedkeuren. Deze controle rapporteert onvoorwaardelijk `permissionVerified:false`, `productionEnabled:false`, `publicSavingsClaimEligible:false` en `livePricesAvailable:false`.

Externe M3-gates blijven open: schriftelijke PLUS/Deka-bronrechten (#74), 11×11 werkelijk gelijktijdig gemeten producten (#78), code-/bronhashbewijs (#205), permanente betrouwbare VPS-validatie (#2833).