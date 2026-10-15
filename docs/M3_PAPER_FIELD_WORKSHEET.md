# SUPA M3 — afdrukbare PLUS- en DekaMarkt-veldmeting

Dit offline hulpmiddel maakt twee **lege** A4-landschapbladen voor exact dezelfde elf canonieke ingrediëntenbehoeften: eerst PLUS, daarna DekaMarkt. Het gebruikt uitsluitend de bestaande SUPA M3-observatiesjabloon en doet geen netwerkverzoeken.

## Uitvoeren

Met de in het project gepinde Node-versie vanuit de repositoryroot:

    node --experimental-strip-types scripts/m3-print-field-checklist.mjs --output ./supa-m3-veldformulier.html

Open het lokale HTML-bestand en druk af op A4 **liggend**. De compacte printlay-out is op een lokale A4-landschap-reconstructie gecontroleerd op **één blad per supermarkt** (PLUS 1/2, DekaMarkt 2/2), met alle 11 ingrediënten en de vereiste studiegegevens per blad. Gebruik in de afdrukdialoog **A4, liggend, schaal 100%, geen browserkop-/voetteksten** en controleer in het **afdrukvoorbeeld** dat het precies twee pagina's zijn. Een printer of browser kan andere marges toepassen; als er toch extra pagina's verschijnen, druk dan niet af voordat de afdrukinstellingen kloppen. Dit is layoutcontrole, **geen daadwerkelijke supermarktmeting**. Het script overschrijft geen bestaand bestand en maakt een nieuw document met private 0600-bestandsrechten. Zowel bestaande symbolische links in bovenliggende mappen als symbolische links vóór een letterlijk `/../`-segment worden geweigerd. Dit is een statische padcontrole; bij gelijktijdige kwaadwillige mapvervanging is Node-padgebaseerde bestandstoegang geen volledige racevrije sandbox. Zonder outputargument schrijft het alleen het lege formulier naar stdout.

## Echte observatie uitvoeren

- Vul één gedeelde geplande week in en kies **één prijscontext** (in-store of online-order) voor beide winkels.
- Leg op beide bladen dezelfde **lege invulvelden voor studie-ID, pseudonieme deelnemercode, doelgroep en regio** vast. Herhaal identieke studiegegevens op beide papieren bladen (zonder namen, e-mails of echte account-ID's). Noteer `weekStart` als maandag `JJJJ-MM-DD` en hetzelfde prijscontextvakje op beide bladen.
- Vul per winkel een **eigen winkel-ID, unieke bewijs-ID, winkelnaam/filiaal, observatietijd inclusief tijdzone, bron en concrete herkomstnotitie** in. Voor beide winkels moeten de winkel-ID's en bewijs-ID's juist verschillend zijn. Deze velden sluiten aan op de bestaande verplichte M3-`observationSheetReadiness`-controle; het papieren formulier zelf blijft volledig leeg en is geen meting.
- Meet de PLUS-baseline en de DekaMarkt-vergelijkmand met exact dezelfde elf behoeften binnen maximaal **24 uur**.
- Noteer filiaal, lokale observatietijd én tijdzone, geobserveerde bron, pseudonieme bewijsreferentie en productherkomst.
- Kruis per regel precies één status aan: **ja** (werkelijk gecontroleerd en beschikbaar), **nee** (werkelijk gecontroleerd en niet verkrijgbaar), of **onbekend** (nog niet gecontroleerd). Een ongemeten regel is nooit `nee` en mag niet als volledige veldmeting worden beschouwd.
- Vul bij **nee** en **onbekend** geen product of prijs in. Bij **ja** noteer je uitsluitend daadwerkelijk geobserveerde identiteit, verpakking, hoeveelheid en de prijs van één volledige verkoopverpakking; geen aannames of geschatte kortingen.
- **Belangrijk bij multipacks:** `packAmount` is de inhoud **per los stuk** in g/kg/ml/l/stuk; `packCount` is het aantal van die stuks **binnen één verkoopverpakking** (standaard **1** bij een enkelpak). Bijvoorbeeld: een verkooppak met 6 blikjes van 200 ml wordt genoteerd als `200 ml` en `6`, met de prijs van het hele zespak. **Noteer niet hoeveel verkooppakken je moet kopen** in dit veld: de canonieke M3-berekening bepaalt dat uit de elf vaste ingrediëntenbehoeften. Raad het aantal nooit.
- Neem de echte gegevens daarna over in de SUPA Meten-interface en laat de canonieke converter en assessment de structurele geldigheid beoordelen. Bewaar bronbewijs op de daarvoor toegestane private locatie.

Papier is **geen automatisch bewijs**, prijsdata, licentie/toestemming, besparingsclaim, beta- of M4/M5-go. Het formulier bevat zelf geen persoonsgegevens, echte winkelprijzen of aantoonbare besparingen. Vermijd namen, e-mails, accountgegevens en deelnemersidentiteiten. Menselijke [M3 veldtaak #78](https://github.com/Zennay/Supa/issues/78) blijft open tot echte 11 PLUS + 11 DekaMarkt waarnemingen geldig zijn gecontroleerd.
