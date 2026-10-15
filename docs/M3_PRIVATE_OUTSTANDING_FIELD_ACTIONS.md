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

## Nog te specificeren verpakking en prijs

Voor een product dat al als **beschikbaar** is vastgelegd, specificeert de openstaande regel nu exact welke verplichte velden nog niet bruikbaar zijn: productnaam, verpakkingshoeveelheid, verpakkingseenheid, aantal per verkooppakket of prijs per verpakking. De notitie maakt bijvoorbeeld onderscheid tussen `nog nodig: Prijs per verpakking` en `nog nodig: Productnaam, Verpakkingshoeveelheid, Verpakkingseenheid, Prijs per verpakking`.

Dit zijn uitsluitend vaste Nederlandstalige labels: de daadwerkelijke productnaam, gevonden prijs en bronnotities blijven privé en worden niet herhaald. Een daadwerkelijk als **niet beschikbaar** geregistreerde regel is al afgerond voor de veldregistratie, maar vormt nooit een fictieve geprijsde regel. Niets aan het canonieke beschikbaarheidscontract of de geldigheidsbeoordeling wordt gewijzigd.

## Geen stilzwijgende broncorrectie tijdens de meting

Het gewone browserformulier kan oudere of beschadigde invoervelden herstellen om een concept weer bewerkbaar te maken. Deze **lokale operatorchecklist** trekt bij gemeten productfeiten een bewust strengere grens: een ontbrekende/ongeldige herkomst (`manual-cart`, `receipt` of `consented-export`) en een ongeldig `packCount` bij een beschikbaar product worden niet stilzwijgend als geldige feiten weergegeven. De controle stopt veilig, toont geen privégegevens en verandert het originele formulier niet. Een geregistreerd niet-verkrijgbaar product behoeft geen verzonnen verpakking of prijs. Controleer zulke gegevens in het originele formulier aan de hand van de daadwerkelijke waarneming, en voer pas daarna de checklist opnieuw uit. Een geldige operatorchecklist is nog steeds geen onafhankelijke controle van winkelprijzen of toestemming voor een besparingsclaim.

## Duidelijkheid over het 24-uursmeetvenster

Bij `--text` verschijnt naast de openstaande winkelregels voortaan een Nederlandstalige actie voor het **meetvenster**: nog geen geldige meettijd, één winkel gemeten (andere binnen 24 uur), beide meettijden binnen 24 uur (controleer overige velden) of meer dan 24 uur uit elkaar (nieuwe gekoppelde meting nodig). De JSON-waarde `observationWindowState` blijft **ongewijzigd** en geschikt voor bestaande tools. Een meetdatum uit de invoer wordt nooit letterlijk weergegeven; het formulier en de originele observatietijden blijven privé. Dit is geen toestemming om echte brondata publiek te gebruiken en geen bewijs van financiële besparing.

**Ook een onafgemaakte tweede winkel kan te laat zijn:** wanneer slechts één winkel is gemeten, controleert de actiechecklist voortaan of die ene geldige observatie inmiddels **strikt meer dan 24 uur** geleden was. Dan verschijnt `observationWindowExpired: true` in de beperkte JSON-uitvoer, en de tekst vraagt beide winkels opnieuw binnen 24 uur te meten. Precies op de 24-uursgrens is het venster nog niet verlopen; na die grens wel. De geheime exacte tijd of deadline wordt nooit uitgegeven. Een recente eerste observatie blijft de instructie geven de tweede winkel binnen 24 uur te bezoeken.

**Geen tegenstrijdige niet-beschikbaarregels:** in het Meten-formulier wist de keuze `niet beschikbaar` de product- en prijsvelden. De lokale checklist behoudt een expliciet als niet-beschikbaar gemelde regel als gemeten, maar signaleert apart dat in een concept nog tegenstrijdige product-ID-, productnaam-, verpakkings- of prijsvelden aanwezig zijn. Zulke regels tellen **niet** als klaar voor privéreview zolang die waarschuwing openstaat; oude concepten blijven bewerkbaar en de bestaande winkelstatus blijft behouden. De teller `unavailableDetailWarnings` toont alleen aantallen per winkel en de vaste herstelactie; geen product- of prijswaarden. Een persoonlijke notitie of bronlink mag blijven staan om echte onbeschikbaarheid te verklaren, maar verschijnt nooit in de uitvoer. De tool wist niets uit het bronbestand; alleen een operator kan de tegenstrijdigheid na echte controle oplossen.
