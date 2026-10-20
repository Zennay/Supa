# Supa · Eigen recepten veilig exporteren en op een ander apparaat herstellen

Via **Recepten → Mijn recepten meenemen** kun je je eigen recepten vrijwillig als JSON downloaden. Het bestand bevat je titel, porties, bereidingstijd, oorspronkelijke ingrediëntenregels, de naar g/ml/stuks omgerekende hoeveelheden en bereidingsstappen. Het bevat geen winkelprijs, supermarktcontract, accounttoken of automatisch opgehaalde gegevens.

## Exporteren

1. Open **Recepten** en zorg dat je minstens één eigen recept hebt opgeslagen.
2. Kies **Download mijn recepten (JSON)**. Supa maakt lokaal een bestand `supa-mijn-recepten.json` met schema `supa-owned-recipes-backup-v1`.
3. Bewaar dit bestand zelf veilig of zet het met een door jou gekozen methode over naar een ander apparaat. De export verstuurt niets naar een Supa-server.

## Herstellen

1. Open op het andere apparaat **Recepten → Importeer eigen receptenbackup**, selecteer het JSON-bestand (maximaal 2 MB).
2. Supa controleert de bestaande interne receptnormen en laat zien hoeveel recepten in de backup staan, hoeveel al exact aanwezig zijn en welke nieuw worden toegevoegd.
3. Controleer de lijst en klik **Importeer N nieuwe recepten**. Tot dat moment blijft de huidige collectie ongewijzigd.
4. Na bevestiging staan de nieuwe recepten in **Eigen recepten**. Recepten met complete, metrisch interpreteerbare hoeveelheden verschijnen automatisch ook in **Planner**. Niet-herkende ingrediënten behouden hun oorspronkelijke tekst; Supa verzint geen aantal of prijs.

## Recept uit JSON-LD of HTML-broncode plakken (zonder server)

Open **Recepten → Plak receptgegevens (JSON-LD)**, of kies deze optie wanneer **Importeer via link** niet beschikbaar blijkt. Vul de oorspronkelijke **openbare HTTPS-URL** uitsluitend als bronvermelding in en plak rechtstreeks de JSON-LD met `schema.org/Recipe` of de HTML-broncode met zo'n JSON-LD-script van een receptpagina die je rechtmatig hebt verkregen.

Supa **vraagt de opgegeven URL niet op**, navigeert niet naar de website en voert geen geplakte HTML/JavaScript uit. De reeds bestaande lokale parser zoekt alleen het receptobject, leest ingrediënten en bereidingsstappen en normaliseert metrische hoeveelheden naar gram, milliliter en stuks. Een niet-herkende of ambigue hoeveelheid wordt niet geraden; de originele tekst blijft staan en vraagt handmatige controle.

Na lezen verschijnt exact dezelfde bewerkbare receptformulierflow als bij een geïmporteerde link. **Controleer** titel, porties, tijd, alle ingrediënten en stappen en sla pas daarna bewust lokaal op. Het invoerveld accepteert maximaal 500 kB; een bron zonder herkenbare `schema.org/Recipe`-gegevens wordt geweigerd met de optie voor handmatige invoer. Het is geen automatische webscraper, auteursrechttoestemming of retailerbron.

## Veilig samenvoegen

- Het formaat accepteert maximaal 100 recepten, alleen bekende versies en valide eigen recept-ID's.
- Bestaat hetzelfde recept-ID al met **exact dezelfde genormaliseerde inhoud**, dan wordt dat recept niet opnieuw toegevoegd.
- Bestaat hetzelfde recept-ID met **andere inhoud**, dan wordt **de hele import geweigerd**. Er wordt niets stilzwijgend overschreven of omgenummerd: dat zou bestaande Planner-koppelingen kunnen verwisselen.
- De bestaande browseropslag gebruikt een compare-and-swap-controle: wanneer een ander tabblad de collectie inmiddels heeft gewijzigd, wordt de import geweigerd. Herlaad dan eerst de actuele collectie.
- Het bestand wordt uitsluitend lokaal in de browser gelezen. Alleen een expliciete bevestiging schrijft naar de bestaande Supa-receptenbibliotheek. Er is geen automatische synchronisatie of externe download nodig.
- Dezelfde interne metrische controle als bij handmatig opslaan blijft gelden; de backup kan geen gescrapete supermarktprijzen of ontbrekende hoeveelheden toevoegen.

Deze functionaliteit vult de bestaande **Recepten toevoegen / Importeer via link**-flows aan en vervangt deze niet. De aparte, nog niet vrijgegeven devicesync-PR [#3777](https://github.com/Zennay/Supa/pull/3777) wordt niet aangepast.
