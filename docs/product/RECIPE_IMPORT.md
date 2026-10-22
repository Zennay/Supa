# Eigen recepten importeren in Supa

Supa kan eigen recepten lokaal bewaren en omzetten naar het interne receptformaat. Winkelprijzen worden nooit uit een receptpagina afgeleid.

## Een receptpagina importeren

1. Open **Recepten → Meerdere eigen recepten importeren**.
2. Kies **Opgeslagen HTML-webpagina met receptgegevens**.
3. Als de automatische openbare-linkimport op jouw Supa-deployment niet beschikbaar is, sla de receptpagina vanuit je browser lokaal op als HTML. Upload het opgeslagen bestand, of plak de JSON-LD-broncode rechtstreeks in het invoerveld.
4. Kies **Controleer HTML-recepten** en bekijk de afzonderlijke recepten en originele ingrediënten.
5. Controleer porties, hoeveelheden, eenheden en bereidingsstappen. Selecteer alleen de recepten die je wilt bewaren en bevestig de import.

## Welke bronformaten werken?

- **schema.org/Recipe JSON-LD** in een lokaal opgeslagen HTML-bestand.
- **schema.org Recipe-microdata** (itemscope/itemprop) wanneer de HTML geen JSON-LD-scriptblokken bevat.
- Losse JSON/JSON-LD-bestanden, arrays, @graph en schema.org ItemList → ListItem → item-wrappers met Recipe-objecten, plus gewone tekst en Markdown via de bijbehorende importkeuze.

Bij HTML met JSON-LD gebruikt Supa eerst de JSON-LD-bron. Microdata is de terugvalroute wanneer er geen JSON-LD-scriptblokken aanwezig zijn. Niet iedere website publiceert bruikbare receptmetadata; gebruik dan de gewone tekstimport of voer het recept handmatig in.

## Recepten gebruiken voor een ongeprijsde boodschappenmand

De aparte privévergelijker kan gecontroleerde eigen recepten gebruiken als fysieke boodschappenbehoefte. Dit vereist een geldig aantal porties, metrische hoeveelheden en hele fysieke stuks. Een ontbrekende of onduidelijke bereidingstijd blijft onbekend, maar blokkeert deze ingrediëntenlijst niet: bereidingstijd is geen ingrediënt en wordt niet verzonnen. Hetzelfde recept blijft voor de gewone maaltijdplanner geblokkeerd totdat de ontbrekende bereidingstijd is gecorrigeerd. Andere open ingrediënt-, hoeveelheid- of bronwaarschuwingen blijven uitgesloten en worden bij het laden concreet getoond, zodat je ze in **Mijn recepten** kunt corrigeren.

## Privacy en bronintegriteit

- HTML wordt lokaal als tekst gelezen. Supa mount of rendert de pagina niet, voert geen ingesloten scripts uit, laadt geen externe assets en doet tijdens deze lokale import geen netwerkverzoeken.
- De automatische linkroute is een afzonderlijke, expliciet door de gebruiker gestarte serveractie. Een statische deployment zonder die API kan de URL niet rechtstreeks ophalen; gebruik dan de lokale HTML- of JSON-LD-route.
- De bronpagina bewijst geen actuele winkelprijs, voorraad of toestemming voor een retailerfeed. Prijzen blijven onbekend totdat je echte, toegestane winkelbrondata afzonderlijk importeert en beoordeelt.
- Originele receptregels blijven ter controle zichtbaar. Onzekere hoeveelheden, stuks en niet-metrische eenheden worden niet stilzwijgend omgezet in bevestigde fysieke boodschappen.
- HTML-import is begrensd tot 500 kB en maximaal 15 herkende recepten. Iedere import blijft een concept dat je vóór het bewaren controleert.

