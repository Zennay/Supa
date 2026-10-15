# SUPA · Printbare privé boodschappenchecklist (M3)

Deze offline productuitvoer vult de bestaande tekstchecklist aan met twee afzonderlijke, telefoonvriendelijke en afdrukbare boodschappenlijsten. De uitvoer gebruikt exact dezelfde renderPrivateShoppingChecklists(report) als de terminalchecklist; bedragen, hoeveelheden en het bewijs dat een gedeelde verpakking slechts eenmaal betaald is worden niet opnieuw berekend in de HTML-laag.

## Gebruik

Maak een lokaal manifest met toegestane, reeds aanwezige offline HTML-snapshots voor PLUS en DekaMarkt (zie de oorspronkelijke handleiding m3-private-shopping-checklist.md). Voer uit:

    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs pad/naar/manifest.json --output pad/naar/mijn-prive-boodschappen.html

Open het resultaat lokaal in een browser. Kies **Beide winkels**, **Alleen PLUS** of **Alleen DekaMarkt** om onderweg slechts de relevante fysieke aankopen en het bijbehorende private winkeltotaal te zien. De winkelkeuze werkt met gewone radioknoppen en browser-CSS, **zonder JavaScript of externe verbinding**; ook Afdrukken / PDF afdrukken respecteert die keuze en verbergt de keuzebalk. Vink de producten af tijdens het winkelen. Vinkjes bestaan uitsluitend in het geopende document en worden nergens opgeslagen of verzonden. Het bestand wordt via de bestaande M3 privé-outputbescherming gepubliceerd (rechten 0600, controle op symlinks, geen privépaden in foutmeldingen). Het HTML-bestand bevat geen externe CSS, fonts, JavaScript of HTTP-aanroepen; CSP blokkeert netwerk/script.

## Al opgeslagen offline vergelijking opnieuw gebruiken

Een eerder gemaakte privévergelijking kan zonder de oorspronkelijke retailer-HTML opnieuw te lezen direct naar de afdrukbare fysieke boodschappenlijst worden omgezet:

    node --experimental-strip-types scripts/retailer-compare-local-snapshots.mjs pad/naar/manifest.json --out pad/naar/opgeslagen-vergelijking.json
    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs --report pad/naar/opgeslagen-vergelijking.json --output pad/naar/print-lijst.html

De optionele **--report**-route opent uitsluitend het reeds lokaal opgeslagen vergelijking-JSON: exact de vorm `supa-local-snapshot-comparison-v1`. Geen retailer-URL, HTML of API wordt opnieuw geopend. De bestaande strikte checklistcontrole moet ook bij dit bestand complete PLUS- en DekaMarkt-gegevens, niet-claimbare herkomst, aantallen, gedeelde-pakdekking en overeenkomende winkeltotalen valideren; een onbekend bedrag blijft onbekend. Een opzettelijk gewijzigd/vals bestand kan geen volledig totaal verzinnen. Niet-JSON, verkeerde Unicode, symlinks in bestandsnaam én oudermappen, niet-reguliere bestanden en documenten boven 4 MiB worden zonder privé-inhoud in foutmeldingen geweigerd. De afgedrukte lijst wordt atomair/privé met 0600 gepubliceerd, zonder het bronrapport te overschrijven.

## Een winkelbestand zonder gegevens van de andere keten

Voor één winkel kun je een **afzonderlijk HTML-bestand** maken dat de prijzen, productnamen en regels van de andere supermarkt niet bevat:

    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs --report pad/naar/opgeslagen-vergelijking.json --output pad/naar/alleen-plus.html --store plus
    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs --report pad/naar/opgeslagen-vergelijking.json --output pad/naar/alleen-dekamarkt.html --store dekamarkt

De optionele terminalschakelaar is uitsluitend `--store plus` of `--store dekamarkt`, helemaal aan het einde. Zonder deze schakelaar blijft de bestaande keuze **Beide winkels / Alleen PLUS / Alleen DekaMarkt** binnen het HTML-bestand werken. Een verborgen winkel met de radioknoppen zit nog steeds *in het originele HTML-bestand*; **alleen een aparte --store-uitvoer** verwijdert de andere winkel daadwerkelijk uit het bestand. Het complete lokale bronrapport wordt eerst gevalideerd; de afdrukbare winkeluitvoer rekent geen nieuwe bedragen uit. Ontbrekende winkelprijzen blijven expliciet onbekend en elke aparte uitvoer heeft privé-bestandsrechten 0600. Ook in de winkel blijft actuele prijs en voorraad controleren noodzakelijk.

De optie werkt ook bij de oorspronkelijke lokale manifestmodus: `<manifest.json> --output <print.html> --store plus`. Er vindt geen winkelverkeer plaats.

## Privé boodschappenlijst als tekst (.txt)

Wie liever een eenvoudige afvinknotitie maakt in een eigen offline notitie-app, kan exact dezelfde gevalideerde fysieke boodschappenlijst **zonder HTML, opmaakcode of de andere supermarkt** als leesbaar UTF-8-tekstbestand exporteren:

    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs --report pad/naar/opgeslagen-vergelijking.json --output pad/naar/alleen-plus.txt --store plus --format text
    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs --report pad/naar/opgeslagen-vergelijking.json --output pad/naar/alleen-dekamarkt.txt --store dekamarkt --format text

De tekstexport werkt ook met de oorspronkelijke manifest-invoer. Laat `--store ...` weg voor beide winkels. Het optionele `--format text` moet **als laatste** staan en accepteert alleen een bestemming met extensie `.txt`; zonder dit argument blijft het huidige HTML-gedrag ongewijzigd. Elke afzonderlijke lijst gebruikt precies dezelfde vertrouwde fysieke verpakkings- en winkeltotaalvalidatie als de tekstchecklist en de afdrukweergave. Onbetrouwbaar of onvolledig bewijs levert géén volledig winkeltotaal op.

Zichtbare link- en e-mailadressen in product- en ingrediëntnamen worden ook in de tekstuitvoer neutraal gemaakt. Dit filter herkent niet alle persoonsgegevens; ga zorgvuldig om met de lokale bron en met het delen van het resultaat. Elke uitvoer is nieuw, niet overschrijvend, privé (bestandsmodus 0600). Er vindt geen winkelverkeer plaats en er worden geen echte besparingen bewezen.

## Extra privacy bij afdrukken

Productnamen en planneringrediënten kunnen per ongeluk een e-mailadres of webadres bevatten (bijvoorbeeld na kopiëren uit een account of winkelwagen). De **HTML-afdrukvariant** vervangt zulke adressen in de zichtbare tekst én checkbox-labels door `[privé e-mailadres verborgen]` of `[privélink verborgen]`. Dit werkt zowel voor de lijst met beide winkels als voor een afzonderlijke `--store`-export, én bij opgeslagen JSON. Het onderliggende bronbestand wordt niet gewijzigd en de al geverifieerde fysieke aantallen/winkeltotalen worden niet opnieuw berekend.

Deze begrensde tekstafscherming detecteert niet alle soorten persoonsgegevens; gebruik uitsluitend geanonimiseerde, lokale bronbestanden en controleer de uiteindelijke afdruk voordat je die deelt. Het origineel blijft privé, en de uitvoer claimt nooit live prijzen of verifieerbare besparingen.

**Niet verwarren:** --report importeert geen echte winkelwaarnemingen en is geen vergunning of besparingsbewijs. Ook een historische lokale vergelijking is nooit een actuele online prijs.

## Contract

**Verpakkingen, geen afzonderlijke ingrediënten:** een betaalde rij toont hele pakken en lokale pakprijs; een tweede ingrediënt dat al door dat fysieke pak wordt gedekt, toont Al gedekt / NIET gratis, geen tweede aankoop. Onbekende voorraad of ontbrekend bewijs blokkeert uitsluitend het volledige bedrag voor die winkel. Een complete onafhankelijke andere winkel mag wel zijn eigen offline totaal tonen.

**Releasegrens:** deze feature toont GEEN actuele winkelprijzen, legale toestemming, echte eurobesparing of echte optimalisatie. De onderliggende oorspronkelijke offline formatter moet aan de afzonderlijke product-core fix van issue #2780 voldoen voordat deze nieuwe uitvoer als vertrouwd wordt beschouwd; de HTML-laag claimt die fix niet. Publieke M3-release blijft HOLD totdat issue #78 echte identieke 11+11 veldobservaties binnen 24 uur, schriftelijke bronrechten, onafhankelijke QA, originele eigenaren, scoped zCloud SQLite lease en permanente VPS-gates voldoende bewijs geven.

## Regressies

    node --experimental-strip-types --test tests/product-m3-private-printable-shopping-checklist-20261015.test.mjs

Tests controleren fysieke aankopen, onafhankelijk winkelgedrag, radioselectie voor weergave en print, gedeelde verpakking, HTML-escaping/CSP, complete lokale fixture→vergelijker→HTML, private bestandsrechten en argumentcontroles. Aanvullende opgeslagen-JSON-regressies: node --experimental-strip-types --test tests/product-m3-private-saved-report-print-20261015.test.mjs (22 synthetische cases, waaronder aparte privacy-uitvoer per winkel en een echte fictieve HTML→offline-rapport→bronbestanden verwijderen→print via JSON). Alleen synthetische voorbeelden; geen scraping, productie of publicatie.
