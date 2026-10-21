# Supa: privéboodschappen uitwisselen als CSV

De persoonlijke **ongeprijsde** boodschappenlijst kan als puntkomma-CSV worden gedownload en geïmporteerd. De gebruiker kan eerst een leeg invulblad ophalen. Dit staat los van de afzonderlijke import van rechtmatig verkregen supermarktprijsbladen: er wordt geen SKU, winkelprijs, productmatch of retailersource afgeleid uit een persoonlijke CSV.

## Werkwijze

1. Open **Lijst → Zelf toevoegen, zonder prijs**. Download desgewenst het lege CSV-invulblad.
2. Vul per rij `eigen`, de winkel (`Algemeen`, `PLUS` of `DekaMarkt`), een eigen artikelnaam en `ja` of `nee` bij `afgevinkt` in. Houd de vier kolommen en de vaste formaatregel bovenaan ongewijzigd. Export vanuit Supa bevat alle huidige persoonlijke notities, inclusief winkel en vinkje.
3. Gebruik **Importeer eigen ongeprijsde Supa-CSV**, of plak vier gekopieerde Supa-kolommen als tab-gescheiden Excel/Calc-tabel, of de complete eigen Supa-CSV-tekst, in het uitklapbare spreadsheet-invoerveld en klik **Zet mijn CSV klaar voor controle**. De lokale lezer accepteert uitsluitend het eigen formaat, 1–100 artikelen en hoogstens 32 kB geldige UTF-8. Andere CSV-bestanden, prijsbestanden, dubbele artikelen, vreemde winkels, onbekende vinkjes, afwijkende kolommen en onveilige regelinhoud worden geweigerd.
4. De ingelezen regels verschijnen in de bestaande tekstinvoer. Kies daarna **Bekijk artikelen vóór toevoegen** en bevestig de voorinzage. Bestaande artikelen per winkel en bestaande vinkjes blijven behouden.

CSV-uitvoer zet potentieel uitvoerbare spreadsheetformules om naar letterlijke tekst met een apostrof, en maakt ook oorspronkelijke apostrofs omkeerbaar. Invoer voert nooit spreadsheetfuncties uit. De browser uploadt hierbij niets. Persoonlijke artikelen blijven buiten Planner-ingredientvraag, supermarktverificatie, mandprijzen en besparingsclaims.

De JSON-backup blijft de volledige private gegevensbackup. TXT, kopieertekst, mobiel delen en offline HTML-print blijven onafhankelijk beschikbaar.

**Releasegrens:** deze functionaliteit is pas op main beschikbaar na een daadwerkelijk gemergede PR; een bouw- of branch-commit op zichzelf is niet live.

## Optionele lokale bewaarmogelijkheden

Persoonlijke ongeprijsde artikelen blijven standaard alleen in de geopende app. Er zijn
nu **twee aparte, vrijwillige** keuzes: in dit browsertabblad bewaren
(`sessionStorage`) of duurzaam in dit browserprofiel op het apparaat bewaren
(`localStorage`, ook na sluiten van de tab). Beide kopieën bevatten uitsluitend
privéartikelen/winkels/vinkjes met maximaal 100 regels, geen supermarktprijzen,
bronmoment, SKU of toestemming. Er is geen server- of cloudsync.

De app controleert een bestaande kopie vóór overschrijven. Bij een wijziging vanuit
een ander tabblad of tegenstrijdige opgeslagen versies stopt automatisch bewaren
zonder de geopende lijst te vervangen. Gebruik dan de JSON-backup om artikelen
expliciet te controleren en samen te voegen. De nieuwe keuze wordt nooit stilzwijgend
ingeschakeld en uitschakelen wist alleen de gekozen bewaarde apparaatkopie.
