# Supa · prijsdata van twee winkels lokaal in je weekmenu laden

**Beschikbaar in de bestaande navigatie: Vergelijk → Vergelijk twee winkels met eigen prijsdata.**
De import gebruikt de bestaande ingredientenaggregatie, productmatching, gehele-verpakking-berekening en mandjesvergelijking. Er wordt geen live supermarkt geraadpleegd.

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
