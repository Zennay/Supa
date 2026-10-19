# Privé mandvergelijking met eigen PLUS- en DekaMarkt-waarnemingen

Deze route is bruikbaar **zonder live scraper, retailerlicentie of internet**. De gebruiker levert zelf twee rechtmatig verkregen winkel-CVS-bestanden, het gekozen mandje en expliciete productkoppelingen aan. De prijsbron is uitsluitend de meegegeven invoer; een ontbrekende of oude prijs blijft onbekend. Gebruik het lokaal gegenereerde HTML-rapport niet als extern onderzoek, retailer-autorisatie of openbare besparingsclaim.

## Stap 1 — eigen waarnemingen

Gebruik het bestaande Supa-prijsblad voor elk van de twee winkels. De negen kolommen moeten exact zijn:

```csv
retailer,observedAt,id,name,packAmount,packUnit,packCount,priceCents,available
```

Schrijf alleen werkelijk vastgestelde productgegevens, met oorspronkelijke ISO 8601-tijd inclusief UTC-offset, werkelijke product-ID, inhoud, verpakking en prijs in **hele eurocenten**. Voor onbekende prijzen: laat de prijs leeg en gebruik `available=false`. Eén winkelopname heeft één opnametijd. Het bestand wordt door de **bestaande** strikte `public/offline-two-store-csv.mjs`-converter verwerkt; de nieuwe rapportage creëert geen fictieve winkelprijzen.

## Stap 2 — vanuit een gekozen Planner-week (zonder handmatig optellen)

Als je al een privé-weekplan met recepten hebt, kan Supa de **bestaande canonieke ingrediëntenaggregatie** gebruiken in plaats van hoeveelheden overtypen. Maak een lokaal bestand `week.json` met exact deze structuur (onderstaande waarden zijn uitsluitend een onbeprijsd sjabloon):

```json
{
  "schema": "supa-private-planner-week-v1",
  "plan": [{ "day": "Ma", "recipeId": "eigen-recept-1" }],
  "activeDays": ["Ma"],
  "recipes": [{
    "id": "eigen-recept-1",
    "ingredients": [
      { "id": "eigen-ingredient-1", "label": "Eigen ingrediënt", "query": "Eigen ingrediënt", "amount": 500, "unit": "g" }
    ]
  }]
}
```

Vervang dit door **de werkelijk door jou geselecteerde dagen, recepten en ingrediënten**, niet door het voorbeeld. Hergebruik een ingrediënt-ID alleen bij dezelfde betekenis en fysieke eenheidsfamilie; Supa weigert strijdige definities. De parser houdt de week lokaal, laat ontbrekende hoeveelheden als `null` bestaan en genereert nooit winkelproducten of prijzen.

```sh
node --experimental-strip-types scripts/offline-planner-demand-to-json.mjs week.json vraag.json
```

Dit levert het onderstaande `supa-private-basket-demand-v1`-formaat met nauwkeurig samengevoegde behoeften, maar beide winkelproduct-ID’s bewust nog `null`. Kijk de vraag na, vul in `productIds` per winkel alleen werkelijk geobserveerde artikel-ID’s in, en ga daarna naar stap 3. Voor complexe hoeveelheden zoals dezelfde rijst in twee recepten gebruikt dit hulpmiddel `aggregatePlanIngredients` en dus Supa’s bestaande decimale maatconversie in plaats van eigen afgeronde rekensommen.

## Stap 2 alternatief — maak de eigen vraag `vraag.json`

Kopieer onderstaande structuur, vervang de inhoud door ingrediënten van het werkelijk gekozen weekmenu en neem de juiste `selectedMealCount` over. Koppel alleen handmatig gecontroleerde winkelproduct-ID's. Een onbekende koppeling blijft `null`.

```json
{
  "schema": "supa-private-basket-demand-v1",
  "selectedMealCount": 1,
  "ingredients": [
    {
      "id": "eigen-ingredient-1",
      "label": "Eigen ingrediënt",
      "amount": 500,
      "unit": "g",
      "productIds": { "PLUS": null, "DekaMarkt": null }
    }
  ]
}
```

Bovenstaande structuur is alleen een **onbeprijsd invulsjabloon**, geen aangetroffen product en geen uitgevoerde winkelvergelijking. Toegestane eenheden: `g`, `kg`, `ml`, `l`, `piece`. Gebruik dezelfde `id`, fysieke `amount` en `unit` voor beide winkels. De lokale HTML-rapportage geeft bij ontbrekende regels nu ook mogelijke productkoppelingen uit de bestaande Supa-matcher, wanneer de score en afstand voldoende zijn. **Deze suggesties worden nooit automatisch geselecteerd of meegerekend**: controleer de echte productnaam, verpakking en bron-ID en vul pas daarna zelf het passende `productIds`-veld in. Bij twijfel blijft de regel onbekend.\n\nEen winkelproduct-ID mag pas worden ingevuld nadat het voorkomt in de ingelezen eigen waarneming en bij het bedoelde ingrediënt past. Onbekende hoeveelheden mogen `null` blijven; zulke regels worden nooit op €0 geprijsd.

## Stap 3 — HTML op eigen apparaat genereren

Node 24+ aanbevolen; Node 22.22+ kan TypeScript-strip-imports ondersteunen.

```sh
node --experimental-strip-types scripts/offline-local-basket-comparison.mjs --pair plus.csv deka.csv vraag.json mand.html
```

De twee losse bestanden mogen ook een eerder door Supa bewaard éénwinkel-JSON bevatten, naast CSV/TSV. Zij kunnen verschillende correcte scheidingstekens hebben (bijvoorbeeld PLUS met puntkomma en DekaMarkt met tabs). Supa verwerkt ze eerst onafhankelijk met de bestaande negenkoloms-converter. Bij een dubbele winkelidentiteit of ongeldig bronbestand komt er geen rapport en worden geen prijzen aangevuld.

Je kunt ook een eerder door Supa gegenereerd **eigen `supa-offline-prices-v1` JSON** rechtstreeks opnieuw gebruiken in dezelfde offline rapportage. De bestaande strikte negen-koloms CSV-converter blijft de autoriteit voor beide winkels, originele opnametijden, SKU-uniciteit, hele eurocenten en verpakkingen. Onbekende JSON-prijzen blijven onbekend, nooit €0:

```sh
node --experimental-strip-types scripts/offline-local-basket-comparison.mjs --prices-json eigen-prijzen.json vraag.json mand.html
```

Heb je nog maar **één echte winkelopname**? Maak toch een lokaal HTML-overzicht met werkelijke productregels, hele verpakkingen en indicatieve eenheidsprijzen. De tweede winkel en ieder prijsverschil blijven **onbekend**:

```sh
node --experimental-strip-types scripts/offline-local-basket-comparison.mjs --single een-winkel.csv vraag.json mand-onvolledig.html
```

`--single` accepteert nu ook een reeds opgeslagen eigen éénwinkel-JSON; de originele bron wordt via de bestaande strikte converter beoordeeld.

`--prices-json` ondersteunt ook één reeds bestaande `supa-private-single-store-prices-v1`-opname. De standaard tweewinkelroute blijft strikt en verlangt twee echte opnames; er wordt geen tweede winkelbron verzonnen en niets opgehaald.

Een ongeldig of verrijkt JSON-bronbestand wordt afgewezen. Er wordt niets automatisch opgevraagd, genormaliseerd naar fictieve prijzen of geüpload.

Als de eigen opname al in één CSV met beide winkels staat:

```sh
node --experimental-strip-types scripts/offline-local-basket-comparison.mjs beide.csv vraag.json mand.html
```

Open daarna **lokaal** `mand.html` in de browser. Het rapport toont per ingrediënt de daadwerkelijke gekozen PLUS- en Deka-productnaam, benodigde volledige verpakkingen, verpakkingsprijs en indicatieve eenheidsprijs per kg/liter/stuk. Het gebruikt de bestaande decimale verpakkingsafronding en `compareFullBaskets` voor de exacte mandvergelijking in centen. De eenheidsprijs bepaalt *nooit* het mandarief.

De hoofdsom en voordeligste winkel verschijnen **alleen** als:
- alle ingrediënten in beide winkelmandjes veilig matchen en de volledige mandvergelijking sluit;
- beide werkelijke capturentijden niet in de toekomst of ouder dan zeven dagen zijn;
- de twee winkelopnames maximaal 24 uur uiteen liggen.

Anders geeft de rapportage zichtbaar **geen betrouwbaar volledig prijsverschil**, met afzonderlijke ontbrekende regels; eventueel getoonde regelprijzen zijn historische of incomplete privéwaarden. Er wordt niets naar een server gestuurd of gescrapet. Input is begrensd tot 256 kB per bestand; uitvoer is exclusief nieuw en mode `0600`, zonder actieve scripts of externe assets. De CLI schrijft geen privéprijzen of productnamen naar stdout.

## Vanuit de huidige Supa-app: Planner → bronimport → boodschappenlijst

De **ontwikkelbranch** integreert de hierboven beschreven lokale bronconverter, SKU-/verpakkingscontrole en twee-winkelberekening in de bestaande React-werkstroom (gestapelde [PR #3936](https://github.com/Zennay/Supa/pull/3936), [#3939](https://github.com/Zennay/Supa/pull/3939) en [#3941](https://github.com/Zennay/Supa/pull/3941)). Dit betekent **niet** dat de functies al op beschermd `main` of een publieke live website zijn uitgerold.

1. Open **Planner**, kies de maaltijden en fysieke hoeveelheden voor je week. Gebruik **Direct eigen winkelopname(s) openen in Vergelijk** voor één of twee bestaande, rechtmatig verkregen PLUS-/DekaMarkt-CSV/TSV/JSON-bestanden. Je kunt ze ook naar het invoervak slepen. **Vanaf Lijst kun je eveneens rechtstreeks één of twee bestaande CSV/TSV/TXT/JSON-bronbestanden kiezen**: Supa draagt de ongewijzigde lokale File-objecten over aan precies dezelfde bestaande canonieke bronimport in Vergelijk. Kies maximaal twee bestanden; beide verschillende winkels mogen ook uit één gevalideerd Supa-JSON-bestand komen.
2. In **Vergelijk** controleert de bestaande canonieke bronimport de oorspronkelijke retailer-ID, tijd, product-ID, beschikbaarheid, hele-cent-prijs en verpakkingsgegevens. Controleer voorgestelde ingredient→SKU-koppelingen zelf wanneer die niet eenduidig zijn. Een onjuiste bron vervangt geen geldige bestaande opname automatisch.
3. **Planner**, **Producten**, **Lijst** en **Vergelijk** tonen een volledig winkelmandtotaal alleen na volledige brontoelating. Met **één** volledig gecontroleerde winkel verschijnt in Planner al een bruikbaar éénwinkelmandje: open je boodschappenlijst, **download het eigen CSV-mandje**, **download een inert afdrukbaar HTML-overzicht** of **kopieer de tekstlijst voor mobiel**. Is het klembord niet beschikbaar, dan kun je dezelfde tekst lokaal selecteren.
4. Ook **vóórdat een winkelmandje compleet is** toont Planner, waar mogelijk, per winkel een duidelijk gelabeld deelbedrag voor uitsluitend de reeds persoonlijk bevestigde SKU-regels, plus het aantal nog onbevestigde ingrediënten. Dit bedrag is **geen mandtotaal, budgetadvies of winkelwinnaar** en is verborgen bij onbetrouwbare bronregels, verlopen opnames of mogelijk dubbel getelde SKU's.
   **Lijst** heeft daarnaast een aparte sectie **Neem al bevestigde winkelproducten mee** wanneer minstens één maar nog niet alle fysieke ingrediënten van die winkel zijn bevestigd. Hier kun je alleen die originele SKU's, pakprijzen, verpakkingen en indicatieve eenheidsprijzen bekijken, in deze browsersessie afvinken, als privé-TXT/CSV exporteren of naar het klembord kopiëren (met selecteerbare tekst als fallback). De resterende, nog ongeprijsde ingrediënten blijven apart zichtbaar in de gewone ongeprijsde weeklijst. Afvinkingen delen exact dezelfde fysieke SKU/hoeveelheids-identiteit met de volledige, later bevestigde winkelmand en blijven alleen voor identieke artikelen staan. Afvinken is **geen** bewijs van kassabetaling of prijsbronbevestiging.
5. Heeft eenzelfde ingrediënt bij **beide** winkels een controleerbare eigen regelprijs en liggen de bronmomenten maximaal 24 uur uiteen, dan toont Planner meteen de eerste drie oorspronkelijke SKU-/hele-pak-regelvergelijkingen, inclusief indicatieve eenheidsprijzen. Het volledige uitklapbare overzicht biedt ook een voorlopige **TXT**- en **CSV**-download met beide originele bronmomenten en afzonderlijke regelverschillen. Ontbrekende ingrediënten tellen nooit als nul en er wordt nergens een complete winkelwinnaar of besparing uit zulke onvolledige regels afgeleid.
6. Na een **tweede** complete, gecontroleerde opname van *dezelfde fysieke Planner-week* met bronmomenten maximaal 24 uur uit elkaar verschijnen het hele-verpakkingenverschil en de afzonderlijke SKU-/eenheidsprijzen in de app. De gemengde route kan afzonderlijk extra winkelbezoekkosten meenemen.
7. Ontbrekende, oudere of niet bevestigde bronprijzen blijven **onbekend**. Een incomplete tegenwinkel levert geen €0-vergelijking en geen winkelwinnaar op. Bronrechten, empirische PLUS/Deka-veldwaarnemingen en publicatiebewijs worden nergens impliciet aangenomen.

Alle genoemde gegevens blijven in de eigen lokale bron-/browserwerkstroom, zonder nieuwe live supermarktscraper, geautomatiseerde bronrechten of fictieve besparingsclaims. De bestaande officiële CI, onafhankelijke code-review, beschermde-branchrechten en exclusieve zCloud-releaselease bepalen of deze gestapelde PR-keten veilig kan worden geïntegreerd.

## Eén winkelartikel voor meerdere ingrediënten

Wanneer twee verschillende ingrediëntregels naar hetzelfde daadwerkelijke winkelproduct-ID binnen één winkel verwijzen, kan de hoeveelheid niet veilig per rij als een eigen aankoop worden opgeteld: hetzelfde pak kan immers meerdere recepten bedienen. De offline vergelijker markeert **beide regels voor die winkel als onbekend** en vermeldt dit onder ontbrekende koppelingen. Voeg de fysieke hoeveelheden eerst samen in één ingrediëntbehoefte (met consistente eenheden) en kies het bestaande artikel vervolgens opnieuw. Er wordt nooit automatisch dubbel afgerekend of zonder menselijke bevestiging een product samengevoegd; de andere winkel blijft onafhankelijk beoordeeld.
