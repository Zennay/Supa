# Supa · prijsdata van twee winkels lokaal in je weekmenu laden

**Beschikbaar in de bestaande navigatie: Vergelijk → Vergelijk twee winkels met eigen prijsdata.**
De import gebruikt de bestaande ingredientenaggregatie, productmatching, gehele-verpakking-berekening en mandjesvergelijking. Er wordt geen live supermarkt geraadpleegd.

## Zonder bestand: rechtstreeks twee winkels invullen

1. Plan je echte maaltijden in **Planner**. Ga naar **Vergelijk** → **Geen JSON? Vul de winkels hier in**.
2. Klik op **Open invulscherm**. SUPA toont per winkel dezelfde benodigde ingrediënten en hoeveelheden uit de actuele weekplanner.
3. Vul voor iedere winkel **zelf** de werkelijk waargenomen datum/tijd in. Geef per bekend product de naam op verpakking of bon, inhoud, eenheid (g/kg/ml/l/stuk), multipack en de werkelijk waargenomen prijs per verpakking in euro's op. Vink **Beschikbaar en prijs zelf gecontroleerd** alleen aan als dit daadwerkelijk waar is.
4. Lege productregels blijven onbekend. Onbekende of niet-beschikbare artikelen krijgen geen berekende winkelprijs; ontbrekende stukken voorkomen een volledig totaal. Onjuist ingevulde prijzen of verpakkingen worden afgewezen met een fout bij het betreffende ingrediënt.
5. Klik op **Bereken met mijn ingevoerde prijzen**. Dit gebruikt dezelfde conservatieve productmatching, mandberekening en versheidsgates als de bestaande JSON-import. Na een wijziging moet je opnieuw berekenen.
6. Wil je tijdens het invullen naar een ander Supa-scherm kunnen navigeren? Schakel expliciet **Onvoltooide invoer bewaren in deze browsertab** in. Alleen dan wordt het concept in de sessieopslag van de *huidige tab* gezet. Bij terugkeer naar dezelfde week wordt het lokaal hersteld; een concept voor een ander weekmenu of een onbekende nieuwere opslagversie wordt niet overschreven. Je kunt het bewaren met **Stop automatisch bewaren en wis concept** uitschakelen. Concepten vervallen doorgaans bij het sluiten van de browsesessie, afhankelijk van de browser. Zonder deze optie wordt niets automatisch opgeslagen.
7. Open **Maak een lokale kopie van jouw prijsinvoer**, en gebruik **Bewaar mijn invoer als JSON** om een vrijwillige, lokale back-up te downloaden; je kunt die later weer importeren met de bestaande JSON-import. Niets gaat naar een server.

Het veld *werkelijke productnaam* biedt optionele naam-suggesties uit de bestaande historisch onderzochte, **prijsloze** PLUS/Deka-productprojectie van **4 oktober 2026**. Die historische identiteiten zijn enkel een leessteun en krijgen geen automatische verpakkingsmaten, actuele beschikbaarheid of prijzen. Je moet de werkelijk aangeboden verpakking en prijs zelf invoeren en bevestigen.

Supa vult **nooit** productnamen, winkelspecifieke verpakkingsmaten, prijzen of waarnemingstijden zelf aan. De invulregels zijn alleen suggesties voor welke *ingrediënten* je mogelijk moet kopen; ze zijn geen bewijs dat die supermarkt het artikel op voorraad heeft. De lokaal opgeslagen JSON is **geen officieel winkelbewijs** en bevat geen auteurs-, auteursrecht-, licentie- of fysieke-veldvalidatieattest. Voor deze gegevens geldt je eigen rechtmatige gebruik.

Als het Vergelijk-scherm langer open blijft staan, ververst de UI de vervaltermijn periodiek en bij terugkeer naar het tabblad. Een verlopen zeven-dagenvergelijking verliest direct zijn prijsverschil zonder dat de gebruiker opnieuw hoeft te importeren. De opgeslagen fysieke waarnemingstijd verandert niet.

## Het actieve Supa-weekmenu in de uitgebreide privévergelijker gebruiken

1. Stel je gekozen dagen en recepten in onder **Planner**. Ga in de gewone Supa-app naar **Vergelijk**.
2. Onder **Gebruik ditzelfde weekmenu met jouw eigen winkelbronbestanden**, klik **Download geselecteerd weekmenu (JSON)**. Dit exporteert uitsluitend de geselecteerde maaltijden en hun fysieke ingrediënten, niet de demonstratieprijzen, winkeltijden of productkoppelingen.
3. Klik **Open uitgebreide privévergelijker**. Open in dat scherm onder **2 · Vul de fysieke behoefte in** het bestand bij **Importeer een lokaal geselecteerd Planner-weekmenu**. De exacte fysieke behoefte wordt met de bestaande Supa-aggregatie opnieuw bepaald.
4. Voeg uitsluitend je eigen rechtmatig verkregen PLUS- en/of DekaMarkt-bronbestand toe. Kies per ingrediënt en winkel zelf de werkelijke productmatch. Bij slechts één geobserveerde winkel blijft de andere onbekend.
5. Een volledige winkelwinnaar of prijsverschil verschijnt alleen als beide echte volledige opnames en de versheid/contextvoorwaarden dat toestaan. De brongegevens worden niet automatisch gedeeld tussen tabs.

Het weekbestand gebruikt schema supa-private-planner-week-v1 (UTF-8, maximaal 256 kB, maximaal 14 geselecteerde dagen, 200 unieke fysieke ingrediënten). Ongeldige hoeveelheden of een onsamenhangend weekmenu worden geweigerd, zonder data aan een server te verzenden. Publiek gebruik wacht op de bestaande CI-, review- en mainwriter-gates.

## Importeren

1. Maak lokaal een JSON-bestand met **één** PLUS- en **één** DekaMarkt-opname. Beide opnames beschrijven de daadwerkelijk waargenomen prijscontext, met een ISO-tijd en een expliciete UTC-offset.
2. Kies de gewenste maaltijden/dagen in **Planner**. Open **Vergelijk** en importeer het bestand of plak de inhoud.
3. Controleer per winkel **gekoppeld / onbekend**, de teruggegeven productidentiteiten, verpakkingsaantallen en eenheidsprijzen.
4. Een rekenkundig prijsverschil wordt alleen getoond als alle ingrediënten gekoppeld zijn, beide tijden maximaal 24 uur uiteen liggen en geen van beide opnames ouder is dan zeven dagen. Kopieer desgewenst per winkel de private boodschappenlijst.

Schema:

```json
{
  "schema": "supa-offline-prices-v1",
  "captures": [
    {
      "retailer": "PLUS",
      "observedAt": "VUL_ECHTE_ISO_TIJD_MET_OFFSET_IN",
      "products": [
        {
          "id": "eigen-product-id-plus",
          "name": "Vul geobserveerde productnaam in",
          "packAmount": null,
          "packUnit": "g",
          "available": false,
          "priceCents": null
        }
      ]
    },
    {
      "retailer": "DekaMarkt",
      "observedAt": "VUL_ECHTE_ISO_TIJD_MET_OFFSET_IN",
      "products": [
        {
          "id": "eigen-product-id-deka",
          "name": "Vul geobserveerde productnaam in",
          "packAmount": null,
          "packUnit": "g",
          "available": false,
          "priceCents": null
        }
      ]
    }
  ]
}
```

**Let op:** dit is opzettelijk een *niet importeerbaar invulsjabloon*: de waarnemingstijden zijn nog placeholders en de pakketgegevens zijn onbekend. Neem geen voorbeeldbedragen of verzonnen tijdstippen over. Een onbekende prijs/verpakking blijft `null` en `available:false`. Zet alleen bij geobserveerde, toegestane, daadwerkelijk beschikbare producten `available:true`, een positieve `packAmount` en de werkelijke `priceCents` in hele eurocenten. `packCount` kan optioneel een positief geheel aantal multipacks vastleggen.

Alleen `g`, `kg`, `ml`, `l`, `piece` zijn ondersteund. Maximaal twee opnames, 1.000 producten per opname en 256 kB. Duplicaat-ID's en ongeldige datums worden geweigerd.

## Bronrechten en waarheidsgetrouwe presentatie

Dit is een **lokale particuliere rekenhulp, geen licentiecontrole of gegarandeerde actuele supermarktvergelijker**. Alleen gegevens gebruiken die je werkelijk rechtmatig bezit en mag verwerken. JSON, een geslaagde import, namen van PLUS/DekaMarkt of een ingevuld tijdstip bewijzen op zichzelf **nooit** toestemming van een retailer of dat een medewerker fysiek 11×2 prijzen geobserveerd heeft. De bestaande M1-bronrechten en M3-bewijspoorten blijven op HOLD en er is geen automatische live netwerkverbinding. Geen publieke besparingsclaim zolang bronrechten, echte veldobservatie en releasegates ontbreken.

Gegevens gaan niet naar een server. Ze blijven alleen in de componentgeheugenruimte, verdwijnen bij het verlaten/herladen van de pagina en kunnen met **Wis lokaal geladen data** worden verwijderd. De kopieerbare lijst is een expliciete gebruikersactie en blijft lokaal in de browser totdat je zelf kopieert.
