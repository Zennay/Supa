# Supa: privéboodschappen uitwisselen als CSV

De persoonlijke **ongeprijsde** boodschappenlijst kan als puntkomma-CSV worden gedownload en geïmporteerd. De gebruiker kan eerst een leeg invulblad ophalen. Dit staat los van de afzonderlijke import van rechtmatig verkregen supermarktprijsbladen: er wordt geen SKU, winkelprijs, productmatch of retailersource afgeleid uit een persoonlijke CSV.

## Werkwijze

1. Open **Lijst → Zelf toevoegen, zonder prijs**. Download desgewenst het lege CSV-invulblad.
2. Vul per rij `eigen`, de winkel (`Algemeen`, `PLUS` of `DekaMarkt`), een eigen artikelnaam en `ja` of `nee` bij `afgevinkt` in. Houd de vier kolommen en de vaste formaatregel bovenaan ongewijzigd. Export vanuit Supa bevat alle huidige persoonlijke notities, inclusief winkel en vinkje.
3. Gebruik **Importeer eigen ongeprijsde Supa-CSV**. De lokale lezer accepteert uitsluitend het eigen formaat, 1–100 artikelen en hoogstens 32 kB geldige UTF-8. Andere CSV-bestanden, prijsbestanden, dubbele artikelen, vreemde winkels, onbekende vinkjes, afwijkende kolommen en onveilige regelinhoud worden geweigerd.
4. De ingelezen regels verschijnen in de bestaande tekstinvoer. Kies daarna **Bekijk artikelen vóór toevoegen** en bevestig de voorinzage. Bestaande artikelen per winkel en bestaande vinkjes blijven behouden.

CSV-uitvoer zet potentieel uitvoerbare spreadsheetformules om naar letterlijke tekst met een apostrof, en maakt ook oorspronkelijke apostrofs omkeerbaar. Invoer voert nooit spreadsheetfuncties uit. De browser uploadt hierbij niets. Persoonlijke artikelen blijven buiten Planner-ingredientvraag, supermarktverificatie, mandprijzen en besparingsclaims.

De JSON-backup blijft de volledige private gegevensbackup. TXT, kopieertekst, mobiel delen en offline HTML-print blijven onafhankelijk beschikbaar.

**Releasegrens:** deze functionaliteit is pas op main beschikbaar na een daadwerkelijk gemergede PR; een bouw- of branch-commit op zichzelf is niet live.
