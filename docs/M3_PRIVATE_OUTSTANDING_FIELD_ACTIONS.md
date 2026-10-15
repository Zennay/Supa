# SUPA M3 — welke winkelregels moeten nog echt worden gemeten?

Deze kleine lokale product-corefunctie helpt de **echte** twee-winkelsmeting uit [issue #78](https://github.com/Zennay/Supa/issues/78). Hij is geen scraper, geen prijsfeed, geen bewijs dat iemand een winkel bezocht heeft en maakt geen publieke besparingsclaim.

## Gebruik

Maak of bewaar het bestaande privé-metingsformulier (`Meten` of `m3:create-observation-sheet`). Lees daarna uitsluitend lokaal:

```sh
node --experimental-strip-types scripts/m3-private-outstanding-field-actions.mjs private-sheet.json
```

De uitvoer bevat **alle nog openstaande canonieke ingredientregels**, afzonderlijk voor PLUS en DekaMarkt. Daardoor kun je in dezelfde 24-uursmeting de overgebleven regels gericht afwerken. `record-availability` betekent dat beschikbaarheid nog niet is vastgelegd; `complete-product-pack-and-price` betekent dat een als beschikbaar geregistreerd product nog niet compleet is qua product, verpakking of prijs. Een **expliciet geobserveerd niet-beschikbaar** product wordt beschouwd als ingevulde veldregel, niet als gekochte of geprijsde regel.

Alle labels en hoeveelheden zijn afkomstig uit de M2-planner, nooit uit vrije gebruikerstekst. Vrije winkelinformatie, persoonsgegevens, prijzen, productnamen, bronlinks, evidence IDs en tijdstippen worden niet uitgegeven; alleen een grove status `not-started`, `single-observation`, `within-window` of `outside-window`. Een defect formulier wordt geweigerd; er wordt geen invoerbestand geschreven of overschreven.

**Cruciaal:** `readyForPrivateReview` betekent hoogstens dat een operator privé kan nakijken; `verifiedRetailerObservations` en `publicSavingsClaimEligible` blijven ook bij complete fictieve testgegevens altijd `false`. De menselijke controle, exact 11+11 echt gemeten regels binnen 24 uur, dezelfde prijscontext en eventuele rechten op bronnen blijven verplicht. Dit vervangt noch de bestaande Meten-converter, noch de retailer-pipeline uit de concept-PR.

## Nederlandstalige checklist

Voor de operator zonder technische JSON-weergave:

```sh
node --experimental-strip-types scripts/m3-private-outstanding-field-actions.mjs private-sheet.json --text
```

Elk van beide winkels krijgt een blok met uitsluitend nog openstaande canonieke planneringrediënten. Je ziet of beschikbaarheid nog ontbreekt of dat product-/verpakkings-/prijsvelden aangevuld moeten worden. De tekst bevat nooit ingevoerde winkelprijzen, deelnemergegevens, bronlinks, klantproductnamen, bewijstijdstippen of bestandsnamen. Ook met alle 22 regels afgevinkt: géén onafhankelijk geverifieerde winkelwaarneming of openbare besparingsclaim.

Voor één bezoek aan één supermarkt kun je de tekstlijst beperken tot de **11 regels van die winkel**. Het volledige formulier, de private review-status en de normale JSON-uitvoer blijven exact hetzelfde:

```sh
node --experimental-strip-types scripts/m3-private-outstanding-field-actions.mjs private-sheet.json --text --store plus
node --experimental-strip-types scripts/m3-private-outstanding-field-actions.mjs private-sheet.json --text --store dekamarkt
```

Ook de gefilterde checklist bevat geen winkelprijzen, individuele deelnemers of echte bewijzen. Ongeldige winkelkeuzes worden zonder bestandsuitlezing geweigerd.

De tekstweergave vertaalt canonieke aantallen stuks naar natuurlijk Nederlands (`1 stuk`, `2 stuks`); de JSON-uitvoer en opgeslagen canonieke `piece`-eenheid blijven exact onveranderd.

## Veilig lokaal bestand lezen (privé M3)

De CLI leest uitsluitend een regulier **lokaal privébestand**: het bestand moet voor groep/anderen ontoegankelijk zijn (bijvoorbeeld `chmod 600 private-sheet.json`), mag geen symlink of hardlink zijn en mag maximaal 2 MiB groot zijn. Ook symbolische links in bovenliggende mappen worden geweigerd. Na openen wordt opnieuw gecontroleerd of het nog hetzelfde bestand is en niet tussentijds is gewijzigd; ongeldige UTF-8-bytes worden geweigerd in plaats van stilzwijgend gerepareerd, terwijl de leeslus zelf een harde bytegrens heeft; er wordt geen genormaliseerde/gewijzigde versie opgeslagen.

Bij weigering verschijnt alleen een vaste foutmelding, nooit een pad, deelnemercode, bon of productprijs. Gebruik bij een weigering een normale map en maak een **eigen privé-kopie** van jouw formulier met correcte bestandsrechten; zet geen persoonlijke data of bonnetjes in Git. Deze padcontroles zijn best-effort tegen een gelijktijdig veranderend lokaal bestandssysteem, **geen volledige bescherming tegen een kwaadaardig proces dat parent-mappen tijdens het lezen verwisselt**. Deze functie verandert geen M3-bewijsregels, claimbeoordeling of retailer-toestemmingen.

## Ontbrekende studie- en winkelgegevens

Dezelfde checklist laat nu niet alleen de **22 boodschapregels**, maar ook de ontbrekende **zes algemene studievelden** en **vijf bewijsvelden per winkel** zien. Een volledig ingevulde boodschappentabel kan immers nog steeds ongeldig zijn wanneer een studiecode, pseudonieme deelnemercode, weekdatum, gezamenlijke prijscontext, winkelnaam, winkelcode, bewijscode, herkomstnotitie of waarnemingstijd ontbreekt.

Ongeldige studiecodes, onmogelijke kalenderdagen, een verkeerde supermarkt, een toekomstige waarneming, dubbele winkel-/bewijscodes of een tijdsvenster van meer dan 24 uur worden als **vaste, Nederlandstalige herstelacties** getoond. Dit zijn beslisregels van het canonieke observatieformulier; er wordt niets automatisch als echt waargenomen aangemerkt.

Bij `--store plus` of `--store dekamarkt` zie je de gedeelde studietaken en alleen de gegevens van de gekozen winkel. JSON bevat uitsluitend vooraf gedefinieerde veldcodes/labels en aantallen; **geen** vrije winkel-, klant-, prijs-, bewijs- of tijdswaarden. De melding `readyForPrivateReview: true` zegt alleen dat een mens het formulier privé kan beoordelen en is nooit een bevestiging van echte winkelbewijzen, bronrechten of besparingen.

Ook na `0 van 22` openstaande boodschappen kun je dus vervolgacties zien. Rond die af op basis van **echte** metingen en gebruik de bestaande converter en assessment voor iedere financiële beoordeling.
