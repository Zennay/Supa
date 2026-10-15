# SUPA product-core — historische universele catalogus ↔ plannerbehoeften

Deze productmodule maakt een **echte, uitvoerbare koppeling** tussen de zes bestaande, beoordeelde lokale PLUS/DekaMarkt-bronadapters, de universele retailerproductregistratie en de elf canonieke behoeften uit de M3-weekplanner. De koppeling levert **suggesties voor handmatige productcontrole**, geen automatische supermarktprijs, winkelmand of besparingsbewijs.

## Direct uitvoeren, zonder websites te bezoeken

Vanaf de repository-root, met de gepinde Node-versie:

```sh
node --experimental-strip-types scripts/retailer-reviewed-planner-queue.mjs
```

De CLI opent alleen de zes meegeleverde offline snapshots via `loadReviewedRepositoryFixtures`, normaliseert ze met `buildUniversalRetailerCatalog` en vergelijkt de productnamen en verpakkingen met de **elfde plannerbehoeften voor beide winkels** via `buildReviewedCatalogPlannerQueue`. De uitvoer geeft uitsluitend **22 te beoordelen regels**, aantallen plausibele kandidaatmatches en ontbrekende regels. Er komen geen namen, prijzen, URL's, deelnemercodes, product-ID's of oude bronwaarden in stdout.

## Veilig matchingcontract

- Alleen `schemaVersion:1`, `model:universal-retailer-product-captures`, `status:private-review-only`, `productionEnabled:false`, `publicSavingsClaimEligible:false` en onveranderde, ongepubliceerde retailer-SKU-identiteiten worden geaccepteerd.
- Producten van PLUS en DekaMarkt worden **gescheiden** behandeld. Nooit retailer-SKU's op basis van alleen een naam samenvoegen.
- De bestaande `matchIngredient`-engine scoort tekst, eenheden, fysieke hoeveelheid en ambiguïteit. Een positieve score krijgt altijd status **`suggested-for-manual-review`**: dit is een historisch productidee voor een mens, geen geaccepteerde waarneming.
- Conflicterende snapshots, onbekende beschikbaarheid, onzekere verpakking, `pack`/onbekende eenheden en niet-expliciete multipacks worden niet als betrouwbaar vertaald. SUPA verzint geen `packCount` uit de historische tekst en kiest nooit stilletjes de meest recente of goedkoopste prijs.
- De rijuitvoer voor een interne privé-review bevat alleen de behoefte, kandidaatidentiteit, naam, hoeveelheid en matchscore. **Geen** prijs, aanbieding, bron-URL, bewijs-ID, deelnemersgegevens, actuele beschikbaarheidsclaim of financiële totalen.
- De output wordt niet naar `ObservationSheet`, `WeeklyBasketStudy` of `buildOneStoreBasket` gepromoveerd. Het huidige catalogusbestand bevat historische, onvergunde demo-/researchbronnen. Iedere echte invulling blijft een menselijke, gecontroleerde M3-observatie met dezelfde behoeften en meetregels.

## Waarom dit nuttig is

De planner hoeft voortaan niet per supermarkt een apart datamodel te begrijpen. Na uitbreiding van de adapters kan dezelfde universele catalogus onmiddellijk aantonen **welke behoeften een waarschijnlijke productmatch hebben en waar productreview nodig is**. Later kan een afzonderlijk geautoriseerd bron-/freshness-/retailrechtenbeleid beslissen of historische suggesties überhaupt ooit tot een actuele prijsoverzicht mogen leiden. Die productie-autorisatie is **niet** onderdeel van deze wijziging.

De releaseblokkades blijven open: echte handmatige 11 PLUS + 11 DekaMarkt ≤24 uur [#78](https://github.com/Zennay/Supa/issues/78), schriftelijke datarechten [#74](https://github.com/Zennay/Supa/issues/74), digitale broncodeprovenance [#205](https://github.com/Zennay/Supa/issues/205), self-hosted trusted workflows [#2833](https://github.com/Zennay/Supa/issues/2833). Geen live crawling, accountgegevens, proxies om blokkades te omzeilen, M4/M5-vrijgave of publieke besparingsclaims.
