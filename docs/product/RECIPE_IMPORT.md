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

## Privacy en bronintegriteit

- HTML wordt lokaal als tekst gelezen. Supa mount of rendert de pagina niet, voert geen ingesloten scripts uit, laadt geen externe assets en doet tijdens deze lokale import geen netwerkverzoeken.
- De automatische linkroute is een afzonderlijke, expliciet door de gebruiker gestarte serveractie. Een statische deployment zonder die API kan de URL niet rechtstreeks ophalen; gebruik dan de lokale HTML- of JSON-LD-route.
- De bronpagina bewijst geen actuele winkelprijs, voorraad of toestemming voor een retailerfeed. Prijzen blijven onbekend totdat je echte, toegestane winkelbrondata afzonderlijk importeert en beoordeelt.
- Originele receptregels blijven ter controle zichtbaar. Onzekere hoeveelheden, stuks en niet-metrische eenheden worden niet stilzwijgend omgezet in bevestigde fysieke boodschappen.
- HTML-import is begrensd tot 500 kB en maximaal 15 herkende recepten. Iedere import blijft een concept dat je vóór het bewaren controleert.


## Eigen recepten direct naar de zelfstandige offline winkelvergelijker (22 oktober 2026)

In de aparte privévergelijker op `private-basket-mapping.html` staat **Laad mijn eigen recepten op dit apparaat**. De leesactie gebeurt pas na de expliciete knop; geen netwerkverzoek of automatische wijziging van het huidige mandje. Recepten die geen volledig bevestigde metrische fysieke vraag opleveren, verschijnen nu onder **Eigen recepten vragen eerst menselijke controle**, met hun opgeslagen reviewmelding of een concreet controleadvies. Herstel zulke recepten in Supa → Recepten en laad de lokale lijst opnieuw. Recepten die wel geschikt zijn blijven apart selecteerbaar om maximaal zeven bereidingen met gewenste gehele porties samen te stellen. Fysieke `piece`-hoeveelheden vereisen veilige gehele aantallen: bij de eerste toelating én vóór export van de definitieve fysieke vraag; halve eieren worden niet afgerond, een ontbrekende hoeveelheid krijgt geen supermarktprijs. De bestaande expliciete bevestiging voor het vervangen van een eerder ingevuld mandje blijft intact.
