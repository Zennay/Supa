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

## Integratiepositie

Deze lokale zelfstandige route biedt alvast een **bruikbaar zichtbaar HTML-productresultaat** terwijl de bestaande React-vergelijkings-PR #3904, aanvullende UI #3916 en rechten/evidence-gates onafhankelijk worden afgerond. Het is géén claim dat deze losse tool al in de live Supa-app is geïntegreerd; de toekomstige app blijft dezelfde eigen JSON/CSV-bron en bestaande prijs-/manddomeinlogica hergebruiken.

## Eén winkelartikel voor meerdere ingrediënten

Wanneer twee verschillende ingrediëntregels naar hetzelfde daadwerkelijke winkelproduct-ID binnen één winkel verwijzen, kan de hoeveelheid niet veilig per rij als een eigen aankoop worden opgeteld: hetzelfde pak kan immers meerdere recepten bedienen. De offline vergelijker markeert **beide regels voor die winkel als onbekend** en vermeldt dit onder ontbrekende koppelingen. Voeg de fysieke hoeveelheden eerst samen in één ingrediëntbehoefte (met consistente eenheden) en kies het bestaande artikel vervolgens opnieuw. Er wordt nooit automatisch dubbel afgerekend of zonder menselijke bevestiging een product samengevoegd; de andere winkel blijft onafhankelijk beoordeeld.
