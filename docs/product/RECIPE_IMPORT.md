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
- Bij een deployment met de beveiligde link-API: één tot acht openbare HTTPS-receptlinks per regel. Rechtstreekse URL's, Markdown-bullets/genummerde lijsten, `<https://…>`-autolinks en `[receptnaam](https://…)` werken. Iedere niet-lege regel moet precies één link bevatten; de bestaande URL-validatie en SSRF-beveiligde serverroute blijven verplicht. Alle herkende recepten blijven concepten tot je ze controleert en zelf bewaart.

Bij HTML met JSON-LD gebruikt Supa eerst de JSON-LD-bron. Microdata is de terugvalroute wanneer er geen JSON-LD-scriptblokken aanwezig zijn. Niet iedere website publiceert bruikbare receptmetadata; gebruik dan de gewone tekstimport of voer het recept handmatig in.

## Recepten gebruiken voor een ongeprijsde boodschappenmand

De aparte privévergelijker kan gecontroleerde eigen recepten gebruiken als fysieke boodschappenbehoefte. Dit vereist een geldig aantal porties, metrische hoeveelheden groter dan nul en maximaal 100.000 per ingrediënt; fysieke `piece`-hoeveelheden moeten veilige gehele aantallen zijn. De lijst toont een recept alleen als klaar wanneer dezelfde grenzen gelden als bij de uiteindelijke mandtoelating; te grote of onveilige hoeveelheden verschijnen direct als controlepunt in plaats van pas na selectie te falen. Een ontbrekende of onduidelijke bereidingstijd blijft onbekend, maar blokkeert deze ingrediëntenlijst niet: bereidingstijd is geen ingrediënt en wordt niet verzonnen. Hetzelfde recept blijft voor de gewone maaltijdplanner geblokkeerd totdat de ontbrekende bereidingstijd is gecorrigeerd. Andere open ingrediënt-, hoeveelheid- of bronwaarschuwingen blijven uitgesloten en worden bij het laden concreet getoond, zodat je ze in **Mijn recepten** kunt corrigeren.

## Privacy en bronintegriteit

- HTML wordt lokaal als tekst gelezen. Supa mount of rendert de pagina niet, voert geen ingesloten scripts uit, laadt geen externe assets en doet tijdens deze lokale import geen netwerkverzoeken.
- De automatische linkroute is een afzonderlijke, expliciet door de gebruiker gestarte serveractie. Een statische deployment zonder die API kan de URL niet rechtstreeks ophalen; gebruik dan de lokale HTML- of JSON-LD-route. De server weigert gedeclareerde requestbody's boven 4 KiB vóór parsing en controleert dezelfde grens op werkelijke UTF-8-bytes bij chunked requests. Alleen een JSON-object met één URL-string van maximaal 2048 tekens wordt geaccepteerd. De volledige requestbody moet bovendien binnen 10 seconden binnenkomen; de socket-inactiviteitstime-out alleen is hiervoor niet voldoende. Beide time-outs geven waar de verbinding nog open is een expliciete HTTP 408 met een herstelhint en sluiten daarna de trage requestsocket.
- De bronpagina bewijst geen actuele winkelprijs, voorraad of toestemming voor een retailerfeed. Prijzen blijven onbekend totdat je echte, toegestane winkelbrondata afzonderlijk importeert en beoordeelt.
- Originele receptregels blijven ter controle zichtbaar. Onzekere hoeveelheden, stuks en niet-metrische eenheden worden niet stilzwijgend omgezet in bevestigde fysieke boodschappen.
- HTML-import is begrensd tot 500 kB en maximaal 15 herkende recepten. Iedere import blijft een concept dat je vóór het bewaren controleert.

## Direct een receptenback-up als winkelmandvraag gebruiken (22 oktober 2026)

Open **Vergelijk → Hetzelfde mandje bij twee winkels samenstellen → Eigen Supa-recepten**. Kies **Of: open je eigen Supa-receptenback-up van een ander apparaat (JSON)** en klik **Controleer mijn recepten-back-up**. Dit gebruikt de bestaande strikt gecontroleerde `supa-owned-recipes-backup-v1`-import (maximaal 2 MB en 100 recepten) **uitsluitend in het geopende browsertabblad**, zonder eerdere recepten te vervangen of iets te uploaden. Selecteer de fysiek bevestigde recepten, aantallen bereidingen en porties en klik pas daarna op **Gebruik geselecteerde recepten als mandvraag**.

Een ontbrekende bereidingstijd wordt niet verzonnen en blokkeert een verder correct, ongeprijsd boodschappenmandje niet; de gewone maaltijdplanner houdt zijn strengere eisen. Andere reviewpunten, ongeldige hoeveelheden en fractionele fysieke stuks blijven uitgesloten en worden met originele ingrediënttekst getoond. Tijdens import en omzetting wordt opnieuw gecontroleerd dat de geselecteerde bestandsversie en eventuele lokale bibliotheek niet veranderd zijn. De bestaande fysieke winkelmand wordt alleen na expliciete bevestiging vervangen; SKU's en prijzen worden nooit uit recepten afgeleid.
