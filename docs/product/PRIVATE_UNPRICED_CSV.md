# Supa: privéboodschappen uitwisselen als CSV

De persoonlijke **ongeprijsde** boodschappenlijst kan als puntkomma-CSV of tab-gescheiden TSV worden gedownload en geïmporteerd. De gebruiker kan eerst een leeg invulblad ophalen. Dit staat los van de afzonderlijke import van rechtmatig verkregen supermarktprijsbladen: er wordt geen SKU, winkelprijs, productmatch of retailersource afgeleid uit een persoonlijke CSV. De volledige privélijst kan bovendien zonder opslag als Excel/Calc-tabel naar het klembord worden gekopieerd.

## Werkwijze

1. Open **Lijst → Zelf toevoegen, zonder prijs**. Download het lege Supa-CSV-invulblad of het lege **Excel/Calc-TSV-invulblad**. Bij TSV vul je in Excel/Calc de kolommen `artikel`, `winkel` en `afgevinkt` in, bewaar je het bestand als `.tsv` en kies je dat bestand daarna rechtstreeks bij de eigen boodschappenimport. De lege artikelcel moet vóór import worden ingevuld.
2. Vul per rij `eigen`, de winkel (`Algemeen`, `PLUS` of `DekaMarkt`), een eigen artikelnaam en `ja` of `nee` bij `afgevinkt` in. Houd de vier kolommen en de vaste formaatregel bovenaan ongewijzigd. Export vanuit Supa bevat alle huidige persoonlijke notities, inclusief winkel en vinkje.
3. Gebruik **Importeer eigen ongeprijsde CSV of Excel/Calc-TSV** om een lokaal `.csv`- of `.tsv`-bestand direct te kiezen. Of plak vier gekopieerde Supa-kolommen als tab-gescheiden Excel/Calc-tabel, of de complete eigen Supa-CSV-tekst, in het uitklapbare spreadsheet-invoerveld en klik **Zet mijn spreadsheet klaar voor controle**. Een `.tsv`-bestand mag de originele vier Supa-kolommen bevatten of een eenvoudige tabel met `artikel`/`winkel` en optioneel `afgevinkt`, in dezelfde strikte vorm als het plakveld. De lezer accepteert 1–100 artikelen en hoogstens 32 kB geldige UTF-8. Andere bestanden, prijs-/SKU-kolommen, dubbele artikelen, vreemde winkels, onbekende vinkjes, afwijkende kolommen en onveilige regelinhoud worden geweigerd.
4. De ingelezen regels verschijnen in de bestaande tekstinvoer. Kies daarna **Bekijk artikelen vóór toevoegen** en bevestig de voorinzage. Bestaande artikelen per winkel en bestaande vinkjes blijven behouden.

CSV- én TSV-uitvoer zetten potentieel uitvoerbare spreadsheetformules om naar letterlijke tekst met een apostrof, en maken ook oorspronkelijke apostrofs omkeerbaar. Download in de Lijst de **zichtbare winkelronde** of de **hele privélijst** als `.tsv`; beide blijven ongeprijsd. Dezelfde gedownloade TSV kan na lokaal bewerken via de bestaande bestandsimport terug naar Supa, steeds met expliciete voorinzage. Invoer voert nooit spreadsheetfuncties uit. De browser uploadt hierbij niets. Persoonlijke artikelen blijven buiten Planner-ingredientvraag, supermarktverificatie, mandprijzen en besparingsclaims.

De knop **Kopieer alle boodschappen als Excel-tabel (4 kolommen)** kopieert de complete persoonlijke lijst onafhankelijk van zichtbare filters. Als klembordrechten ontbreken verschijnt een selecteerbare tabel.

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

Je kunt via **Download zichtbare selectie als TXT** bovendien alleen de geselecteerde, op dit moment zichtbare boodschappen offline bewaren of met iemand delen. Via **Deel zichtbare selectie (mobiel)** gaat precies dezelfde geselecteerde privétekst na een bewuste tik naar het besturingssysteem-deelmenu; bij ontbrekende/weigerende Web Share-ondersteuning wordt uitsluitend deze selectie als TXT aangeboden, niet de volledige lijst. Dat bestand gebruikt hetzelfde ongeprijsde Supa-TXT-formaat en kan later via **Plak meerdere boodschappen tegelijk** weer met expliciete voorinzage worden geïmporteerd. Een verborgen selectie wordt niet onbedoeld mee geëxporteerd.

Supa weigert verplaatsen als de bestemming dezelfde persoonlijke omschrijving al heeft; de bestaande lijst wordt dan niet gedeeltelijk veranderd. De vinkjes, regel-ID's en eigen volgorde blijven behouden; **Herstel laatste groepsverplaatsing** zet een geslaagde batch terug zolang dat zonder conflicten kan. Met **Wis [winkel]-selectie** of **Wis mijn selectie** verwijder je alleen de tijdelijke schermselectie. Zoeken en de 'Alleen open'-filter bepalen welke geselecteerde regels in de huidige actie meegenomen worden. Er worden geen retailerprijzen, productmatches, SKU's of bronrechten gewijzigd.

## Herhaalronde voor vaak gekochte boodschappen

In **Lijst → Zelf toevoegen, zonder prijs** kun je onder *Mijn vaste boodschappen · herhaalronde* zelf een herbruikbaar privé-sjabloon maken. Selecteer eerst de eigen artikelen (individueel of per winkel). Geef de herhaalronde een herkenbare naam en kies **Bewaar N geselecteerde zichtbare artikelen als herhaalronde**. Deze handeling bewaart uitdrukkelijk maximaal één vervangbaar sjabloon met uitsluitend omschrijving en winkel in de eigen browser-`localStorage` (maximaal 100 regels / 32 kB). Niets wordt automatisch gesynchroniseerd of verzonden. Bij een al bestaand sjabloon wordt vervanging eerst apart bevestigd.

Bij een volgend winkelbezoek kies je **Bekijk mijn bewaarde herhaalronde**. Supa toont in een voorinzage welke artikelen nog ontbreken en slaat bestaande dubbele namen bij dezelfde winkel over. Pas met **Voeg N nieuwe artikelen toe** krijgen ontbrekende artikelen nieuwe privé-ID's met open vinkjes. Bestaande boodschappen en hun vinkjes worden niet aangepast. Met de bestaande knop *Herstel laatste import uit sjabloon* kun je de pas toegevoegde regels veilig ongedaan maken zolang ze niet gewijzigd zijn. Het opgeslagen sjabloon bevat nooit prijs, SKU, bronmoment, originele ID's of betaalde afvinkstatus.

Als je géén blijvende browseropslag wilt gebruiken, kies je **Download selectie als herhaalronde (JSON, zonder apparaatopslag)**. Dit downloadt de geselecteerde eigen artikelen direct als draagbaar sjabloon, zonder eerst iets in `localStorage` te bewaren. Bij een later geïmporteerd sjabloon toont de bevestigingsvoorinzage behalve naam en aantal ook de daadwerkelijke winkels en artikelomschrijvingen (eerste 15 regels, resterend aantal apart aangegeven).

De herhaalronde is ook **over te zetten tussen apparaten** zonder server. Kies **Download mijn herhaalronde (JSON)** om uitsluitend de opgeslagen artikelomschrijvingen en winkels als lokaal bestand te bewaren. Op een ander apparaat kies je **Importeer herhaalronde vanaf een ander apparaat (JSON)**. Supa accepteert alleen het eigen versiegebonden, streng gecontroleerde UTF-8-formaat tot 32 kB en toont een aparte voorinzage. Vervanging van een bestaande lokale herhaalronde vereist extra bevestiging. Hierna moet je **Bekijk mijn bewaarde herhaalronde** en vervolgens **Voeg N nieuwe artikelen toe** kiezen voordat de actieve lijst wijzigt. Geen cloudsync, retailerscrape, productprijs of automatisch samenvoegen.

Een sjabloon van een andere browsertab of een onbekende versie wordt niet stilzwijgend overschreven. Bij een conflict blijft de huidige lijst intact. De gebruiker kan de bewaarde sjabloonkopie desgewenst na een afzonderlijke bevestiging wissen. De bestaande JSON-/CSV-/TXT-backups en de echte twee-winkelvergelijking blijven hiervan onafhankelijk.

## Privé-herhaalronde selectief meenemen (22 oktober 2026)

In **Lijst → Eigen boodschappen** kun je vanuit een bestaande, afzonderlijk bewaarde herhaalronde uitsluitend zelf aangevinkte artikelen toevoegen. Je kunt ook alles of alleen de artikelen van **PLUS**, **DekaMarkt** of **Algemeen** kiezen. Bestaande vinkjes, persoonlijke winkeltoewijzingen en bronprijzen worden niet aangepast. Alleen toevoegen aan de actieve lijst heeft de bestaande limiet van honderd regels.

Ook als de actieve lijst vol is, kun je de expliciet geselecteerde herhaalronde als ongeprijsd privé-TXT, afdrukbaar HTML-winkelblad of overdraagbaar eigen JSON-sjabloon meenemen. Het mobiele systeemdeelmenu kan het TXT-winkelbriefje delen als de browser die functie ondersteunt. De volledige oorspronkelijke herhaalronde kan afzonderlijk worden afgedrukt, zonder bestaande afvinkstatus over te nemen. Dit zijn uitsluitend eigen boodschappenwoorden en winkelvoorkeuren: er worden geen retailer-SKU's, prijzen of besparingen verzonnen.
