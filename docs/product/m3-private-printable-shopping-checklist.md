# SUPA · Printbare privé boodschappenchecklist (M3)

Deze offline productuitvoer vult de bestaande tekstchecklist aan met twee afzonderlijke, telefoonvriendelijke en afdrukbare boodschappenlijsten. De uitvoer gebruikt exact dezelfde renderPrivateShoppingChecklists(report) als de terminalchecklist; bedragen, hoeveelheden en het bewijs dat een gedeelde verpakking slechts eenmaal betaald is worden niet opnieuw berekend in de HTML-laag.

## Gebruik

Maak een lokaal manifest met toegestane, reeds aanwezige offline HTML-snapshots voor PLUS en DekaMarkt (zie de oorspronkelijke handleiding m3-private-shopping-checklist.md). Voer uit:

    node --experimental-strip-types scripts/retailer-private-shopping-checklist-html.mjs pad/naar/manifest.json --output pad/naar/mijn-prive-boodschappen.html

Open het resultaat lokaal in een browser, vink fysieke aankopen af en gebruik desgewenst Afdrukken / PDF afdrukken. Vinkjes bestaan uitsluitend in het geopende document en worden nergens opgeslagen of verzonden. Het bestand wordt via de bestaande M3 privé-outputbescherming gepubliceerd (rechten 0600, controle op symlinks, geen privépaden in foutmeldingen). Het HTML-bestand bevat geen externe CSS, fonts, JavaScript of HTTP-aanroepen; CSP blokkeert netwerk/script.

## Contract

**Verpakkingen, geen afzonderlijke ingrediënten:** een betaalde rij toont hele pakken en lokale pakprijs; een tweede ingrediënt dat al door dat fysieke pak wordt gedekt, toont Al gedekt / NIET gratis, geen tweede aankoop. Onbekende voorraad of ontbrekend bewijs blokkeert uitsluitend het volledige bedrag voor die winkel. Een complete onafhankelijke andere winkel mag wel zijn eigen offline totaal tonen.

**Releasegrens:** deze feature toont GEEN actuele winkelprijzen, legale toestemming, echte eurobesparing of echte optimalisatie. De onderliggende oorspronkelijke offline formatter moet aan de afzonderlijke product-core fix van issue #2780 voldoen voordat deze nieuwe uitvoer als vertrouwd wordt beschouwd; de HTML-laag claimt die fix niet. Publieke M3-release blijft HOLD totdat issue #78 echte identieke 11+11 veldobservaties binnen 24 uur, schriftelijke bronrechten, onafhankelijke QA, originele eigenaren, scoped zCloud SQLite lease en permanente VPS-gates voldoende bewijs geven.

## Regressies

    node --experimental-strip-types --test tests/product-m3-private-printable-shopping-checklist-20261015.test.mjs

Tests controleren fysieke aankopen, onafhankelijk winkelgedrag, gedeelde verpakking, HTML-escaping/CSP, complete lokale fixture→vergelijker→HTML, private bestandsrechten en argumentcontroles. Alleen synthetische voorbeelden; geen scraping, productie of publicatie.
