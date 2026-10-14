# SUPA M3 — afdrukbare PLUS- en DekaMarkt-veldmeting

Dit offline hulpmiddel maakt twee **lege** A4-landschapbladen voor exact dezelfde elf canonieke ingrediëntenbehoeften: eerst PLUS, daarna DekaMarkt. Het gebruikt uitsluitend de bestaande SUPA M3-observatiesjabloon en doet geen netwerkverzoeken.

## Uitvoeren

Met de in het project gepinde Node-versie vanuit de repositoryroot:

    node --experimental-strip-types scripts/m3-print-field-checklist.mjs --output ./supa-m3-veldformulier.html

Open het lokale HTML-bestand en druk af op A4 **liggend**. Het script overschrijft geen bestaand bestand en maakt een nieuw document met private 0600-bestandsrechten. Zonder outputargument schrijft het alleen het lege formulier naar stdout.

## Echte observatie uitvoeren

- Vul één gedeelde geplande week in en kies **één prijscontext** (in-store of online-order) voor beide winkels.
- Meet de PLUS-baseline en de DekaMarkt-vergelijkmand met exact dezelfde elf behoeften binnen maximaal **24 uur**.
- Noteer filiaal, lokale observatietijd én tijdzone, geobserveerde bron, pseudonieme bewijsreferentie en productherkomst.
- Schrijf alleen werkelijk geobserveerde productidentiteit, packgrootte, hoeveelheid, prijs per verpakking en beschikbaarheid op. Als iets ontbreekt: laat het onbekend, nooit verzinnen.
- Neem de echte gegevens daarna over in de SUPA Meten-interface en laat de canonieke converter en assessment de structurele geldigheid beoordelen. Bewaar bronbewijs op de daarvoor toegestane private locatie.

Papier is **geen automatisch bewijs**, prijsdata, licentie/toestemming, besparingsclaim, beta- of M4/M5-go. Het formulier bevat zelf geen persoonsgegevens, echte winkelprijzen of aantoonbare besparingen. Vermijd namen, e-mails, accountgegevens en deelnemersidentiteiten. Menselijke [M3 veldtaak #78](https://github.com/Zennay/Supa/issues/78) blijft open tot echte 11 PLUS + 11 DekaMarkt waarnemingen geldig zijn gecontroleerd.
