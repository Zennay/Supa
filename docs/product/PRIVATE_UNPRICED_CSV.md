# Supa: privéboodschappen uitwisselen als CSV

De persoonlijke **ongeprijsde** boodschappenlijst kan als puntkomma-CSV of tab-gescheiden TSV worden gedownload en geïmporteerd. De gebruiker kan eerst een leeg invulblad ophalen. Dit staat los van de afzonderlijke import van rechtmatig verkregen supermarktprijsbladen: er wordt geen SKU, winkelprijs, productmatch of retailersource afgeleid uit een persoonlijke CSV.

## Werkwijze

1. Open **Lijst → Zelf toevoegen, zonder prijs**. Download het lege Supa-CSV-invulblad of het lege **Excel/Calc-TSV-invulblad**. Bij TSV vul je in Excel/Calc de kolommen `artikel`, `winkel` en `afgevinkt` in, bewaar je het bestand als `.tsv` en kies je dat bestand daarna rechtstreeks bij de eigen boodschappenimport. De lege artikelcel moet vóór import worden ingevuld.
2. Vul per rij `eigen`, de winkel (`Algemeen`, `PLUS` of `DekaMarkt`), een eigen artikelnaam en `ja` of `nee` bij `afgevinkt` in. Houd de vier kolommen en de vaste formaatregel bovenaan ongewijzigd. Export vanuit Supa bevat alle huidige persoonlijke notities, inclusief winkel en vinkje.
3. Gebruik **Importeer eigen ongeprijsde CSV of Excel/Calc-TSV** om een lokaal `.csv`- of `.tsv`-bestand direct te kiezen. Of plak vier gekopieerde Supa-kolommen als tab-gescheiden Excel/Calc-tabel, of de complete eigen Supa-CSV-tekst, in het uitklapbare spreadsheet-invoerveld en klik **Zet mijn spreadsheet klaar voor controle**. Een `.tsv`-bestand mag de originele vier Supa-kolommen bevatten of een eenvoudige tabel met `artikel`/`winkel` en optioneel `afgevinkt`, in dezelfde strikte vorm als het plakveld. De lezer accepteert 1–100 artikelen en hoogstens 32 kB geldige UTF-8. Andere bestanden, prijs-/SKU-kolommen, dubbele artikelen, vreemde winkels, onbekende vinkjes, afwijkende kolommen en onveilige regelinhoud worden geweigerd.
4. De ingelezen regels verschijnen in de bestaande tekstinvoer. Kies daarna **Bekijk artikelen vóór toevoegen** en bevestig de voorinzage. Bestaande artikelen per winkel en bestaande vinkjes blijven behouden.

CSV- én TSV-uitvoer zetten potentieel uitvoerbare spreadsheetformules om naar letterlijke tekst met een apostrof, en maken ook oorspronkelijke apostrofs omkeerbaar. Download in de Lijst de **zichtbare winkelronde** of de **hele privélijst** als `.tsv`; beide blijven ongeprijsd. Dezelfde gedownloade TSV kan na lokaal bewerken via de bestaande bestandsimport terug naar Supa, steeds met expliciete voorinzage. Invoer voert nooit spreadsheetfuncties uit. De browser uploadt hierbij niets. Persoonlijke artikelen blijven buiten Planner-ingredientvraag, supermarktverificatie, mandprijzen en besparingsclaims.

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

### Bij een opslagconflict

De privélijst blijft in de app zichtbaar maar de conflicterende opslag wordt niet
automatisch overschreven. De gebruiker kan de oude tab-/apparaatkopie eerst lokaal
bekijken via dezelfde expliciete JSON-merge-voorinzage, of de betreffende oude
kopie na een bevestiging wissen. Wissen verandert nooit de geopende lijst, andere
opslagkopieën, prijsbronnen of handmatig gedownloade back-ups.

### Algemene Excel/Calc-tabellen

Naast het originele Supa-formaat accepteert het lokale plakveld nu een
tabel met **exact** de kopjes `artikel` en `winkel` in willekeurige volgorde,
eventueel gevolgd door `afgevinkt` (waarde `ja` of `nee`). Boodschappen
zonder afvinkkolom beginnen open. Alleen `Algemeen`, `PLUS` en `DekaMarkt`
zijn winkels; aanvullende prijs-, SKU-, hoeveelheid- of bronkolommen worden
geweigerd in plaats van stilzwijgend genegeerd. Voorbeeld:

```text
artikel	winkel	afgevinkt
Afwasmiddel	Algemeen	nee
Havermout	PLUS	ja
```

Ook als Excel op Windows de eigen tabgescheiden lijst als **Unicode Text** met een expliciete UTF-16 LE/BE-bytevolgordemarkering bewaart, kan Supa dit na keuze van een `.tsv`-bestand lokaal lezen. Zonder zo'n markering blijft het bestand verplicht UTF-8. De originele `.csv`-import accepteert uitsluitend UTF-8 en wordt niet ruimer gemaakt; bestanden zonder geldig formaat of met prijs-/SKU-kolommen blijven geweigerd.

De bestaande begrensde Supa-CSV-parser controleert vervolgens nogmaals de
artikelnamen, dubbele regels en groepscodes. Het resultaat moet altijd door
de gewone expliciete persoonlijke importvoorinzage voordat de lijst wijzigt.

**Dubbele omschrijvingen:** de persoonlijke lijst vergelijkt winkel + een Unicode-genormaliseerde identiteit (NFKC, onzichtbare default-ignorable tekens verwijderd, hoofdletterongevoelig). Dit is uitsluitend voor duplicaatdetectie; de originele omschrijving blijft zichtbaar en wordt in backups bewaard. Deze normalisatie creëert geen SKU, productmatch of prijs.

## Zelf een deel van de boodschappen verplaatsen tussen winkels

Open **Lijst → Zelf toevoegen, zonder prijs**. Kies per eigen boodschap **Kies voor winkelwissel**, of gebruik **Selecteer zichtbare PLUS-/DekaMarkt-/Algemeen-artikelen** voor één winkel. Kies bij die winkel de gewenste bestemming en klik **Verplaats N geselecteerde artikelen**. Dit verplaatst uitsluitend de geselecteerde **zichtbare** eigen items van die winkel; de afzonderlijke knop **Verplaats N zichtbare artikelen** blijft beschikbaar om de volledige gefilterde groep te verplaatsen.

Je kunt via **Download zichtbare selectie als TXT** bovendien alleen de geselecteerde, op dit moment zichtbare boodschappen offline bewaren of met iemand delen. Dat bestand gebruikt hetzelfde ongeprijsde Supa-TXT-formaat en kan later via **Plak meerdere boodschappen tegelijk** weer met expliciete voorinzage worden geïmporteerd. Een verborgen selectie wordt niet onbedoeld mee geëxporteerd.

Supa weigert verplaatsen als de bestemming dezelfde persoonlijke omschrijving al heeft; de bestaande lijst wordt dan niet gedeeltelijk veranderd. De vinkjes, regel-ID's en eigen volgorde blijven behouden; **Herstel laatste groepsverplaatsing** zet een geslaagde batch terug zolang dat zonder conflicten kan. Met **Wis [winkel]-selectie** of **Wis mijn selectie** verwijder je alleen de tijdelijke schermselectie. Zoeken en de 'Alleen open'-filter bepalen welke geselecteerde regels in de huidige actie meegenomen worden. Er worden geen retailerprijzen, productmatches, SKU's of bronrechten gewijzigd.
