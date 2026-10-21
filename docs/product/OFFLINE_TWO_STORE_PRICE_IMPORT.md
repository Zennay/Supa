# Supa · prijsdata van twee winkels lokaal in je weekmenu laden

**Beschikbaar in de bestaande navigatie: Vergelijk → Vergelijk twee winkels met eigen prijsdata.**
De import gebruikt de bestaande ingredientenaggregatie, productmatching, gehele-verpakking-berekening en mandjesvergelijking. Er wordt geen live supermarkt geraadpleegd.

## Handmatige Excel/Calc-invulbladen uitwisselen

De **handmatige rekenhulp** kan nu haar huidige twee-winkelinvulblad meteen via de knop **Kopieer beide winkels als Excel-invulblad** in negen TSV-kolommen kopiëren. In de uitgebreide tabel kun je ook **alleen ingevulde PLUS- of DekaMarkt-regels** kopiëren. Bij geen klembordrechten verschijnt dezelfde inhoud in een handmatig selecteerbaar tekstvak. Importeren kan via **Geplakte tabel laden** of als `.tsv`/`.txt`-bestand; elke rij blijft gekoppeld aan dezelfde originele Planner-ingrediënt-ID, exacte hoeveelheid en eenheid. Onbekende bedragen blijven leeg en een losse winkelimport laat de andere winkel ongemoeid. Namen met een letterlijke apostrof of verborgen spreadsheetformuleprefix gaan veilig en omkeerbaar door de tabgescheiden export-/importroute. Bestanden met ongeldige UTF-8 worden geweigerd. Deze calculator kent geen oorspronkelijke retailer-SKU-identiteiten of brontijdstip: zijn rekenkundige verschil is **niet** de onafhankelijk geverifieerde bronvergelijking.

## Zonder bestand: rechtstreeks twee winkels invullen

1. Plan je echte maaltijden in **Planner**. Ga naar **Vergelijk** → **Geen JSON? Vul de winkels hier in**.
2. Klik op **Open invulscherm**. SUPA toont per winkel dezelfde benodigde ingrediënten en hoeveelheden uit de actuele weekplanner.
3. Vul voor iedere winkel **zelf** de werkelijk waargenomen datum/tijd in. Geef per bekend product de naam op verpakking of bon, inhoud, eenheid (g/kg/ml/l/stuk), multipack en de werkelijk waargenomen prijs per verpakking in euro's op. Vink **Beschikbaar en prijs zelf gecontroleerd** alleen aan als dit daadwerkelijk waar is.
4. Lege productregels blijven onbekend. Onbekende of niet-beschikbare artikelen krijgen geen berekende winkelprijs; ontbrekende stukken voorkomen een volledig totaal. Onjuist ingevulde prijzen of verpakkingen worden afgewezen met een fout bij het betreffende ingrediënt.
5. Klik op **Bereken met mijn ingevoerde prijzen**. Dit gebruikt dezelfde conservatieve productmatching, mandberekening en versheidsgates als de bestaande JSON-import. Na een wijziging moet je opnieuw berekenen.
6. **Onvoltooide broninvoer vrijwillig bewaren** heeft twee afzonderlijke opties:
   - **Deze browsertab** (`sessionStorage`) houdt de eigen conceptregels bij terugnavigeren vast; met **Stop tabopslag** wis je uitsluitend deze tijdelijke kopie.
   - **Dit apparaat** (`localStorage`) houdt de eigen conceptregels ook na het sluiten van de tab vast. Alleen na een eigen vinkje, zonder cloud of server. Uitschakelen verwijdert uitsluitend de apparaatkopie.
   Beide keuzes gebruiken hetzelfde strikte weekmenu-fingerprint, maximaal 256 kB, toegestane winkel-ingrediëntregels en controleren elke opslagwijziging vóór schrijven. Een gewijzigde Planner-week, onbekende opslagversie of tegenstrijdige tab-/apparaatkopie wordt niet overgenomen of gewist: de oorspronkelijke gegevens blijven beschermd. Een aparte verwijderknop kan alleen na bevestiging een beschermde apparaatkopie verwijderen; exporteer eerst een JSON-concept wanneer nodig. In een gedeeld browserprofiel kunnen anderen de onversleutelde lokale invoer zien. Herstelde concepten zijn nooit automatisch goedgekeurde winkelprijzen of bronrechten.
   Bewaar vóór het wissen via de zichtbare **Download beschermde apparaat-/tabkopie** eerst de oorspronkelijke, niet-gecontroleerde JSON-bytes wanneer het opgeslagen concept afwijkt. Downloaden importeert of verifieert deze inhoud niet. Een later herstel loopt altijd opnieuw via de bestaande strikte versie- en weekmenu-validatie.
7. Open **Maak een lokale kopie van jouw prijsinvoer**, en gebruik **Bewaar mijn invoer als JSON** om een vrijwillige, lokale back-up te downloaden; je kunt die later weer importeren met de bestaande JSON-import. Niets gaat naar een server.

Het veld *werkelijke productnaam* biedt optionele naam-suggesties uit de bestaande historisch onderzochte, **prijsloze** PLUS/Deka-productprojectie van **4 oktober 2026**. Die historische identiteiten zijn enkel een leessteun en krijgen geen automatische verpakkingsmaten, actuele beschikbaarheid of prijzen. Je moet de werkelijk aangeboden verpakking en prijs zelf invoeren en bevestigen.

Supa vult **nooit** productnamen, winkelspecifieke verpakkingsmaten, prijzen of waarnemingstijden zelf aan. De invulregels zijn alleen suggesties voor welke *ingrediënten* je mogelijk moet kopen; ze zijn geen bewijs dat die supermarkt het artikel op voorraad heeft. De lokaal opgeslagen JSON is **geen officieel winkelbewijs** en bevat geen auteurs-, auteursrecht-, licentie- of fysieke-veldvalidatieattest. Voor deze gegevens geldt je eigen rechtmatige gebruik.

Als het Vergelijk-scherm langer open blijft staan, ververst de UI de vervaltermijn periodiek en bij terugkeer naar het tabblad. Een verlopen zeven-dagenvergelijking verliest direct zijn prijsverschil zonder dat de gebruiker opnieuw hoeft te importeren. De opgeslagen fysieke waarnemingstijd verandert niet.

## Direct boodschappen doen zonder prijsdata

De gewone tab **Vergelijk** biedt nu ook **Mijn weekboodschappen zonder winkelprijzen**, boven de bron- en prijsinvoer. Deze lijst gebruikt direct dezelfde canonieke ingredientenaggregatie als de Planner, inclusief eigen recepten en geselecteerde dagen. Ook als helemaal geen PLUS- of DekaMarkt-bron bestaat, worden dezelfde fysieke behoeften en de werkelijk bekende metrische hoeveelheden getoond. Onbekende hoeveelheden blijven expliciet onbekend. Vink boodschappen af, filter op nog te kopen en maak een lokaal kopieerbare tekstlijst. Er wordt niets opgeslagen op een server of bij een retailer; vinkjes verdwijnen bij het verlaten van het scherm. Deze lijst is los van winkelproduct-/prijsreview, bronrechten en Figma-demoproducten.

## Het actieve Supa-weekmenu in de uitgebreide privévergelijker gebruiken

1. Stel je gekozen dagen en recepten in onder **Planner**. Ga in de gewone Supa-app naar **Vergelijk**.
2. Onder **Gebruik ditzelfde weekmenu met jouw eigen winkelbronbestanden**, klik **Download geselecteerd weekmenu (JSON)**. Dit exporteert uitsluitend de geselecteerde maaltijden en hun fysieke ingrediënten, niet de demonstratieprijzen, winkeltijden of productkoppelingen.
3. Klik **Open uitgebreide privévergelijker**. Open in dat scherm onder **2 · Vul de fysieke behoefte in** het bestand bij **Importeer een lokaal geselecteerd Planner-weekmenu**. De exacte fysieke behoefte wordt met de bestaande Supa-aggregatie opnieuw bepaald.
4. Voeg uitsluitend je eigen rechtmatig verkregen PLUS- en/of DekaMarkt-bronbestand toe. Kies per ingrediënt en winkel zelf de werkelijke productmatch. Bij slechts één geobserveerde winkel blijft de andere onbekend.
5. Een volledige winkelwinnaar of prijsverschil verschijnt alleen als beide echte volledige opnames en de versheid/contextvoorwaarden dat toestaan. De brongegevens worden niet automatisch gedeeld tussen tabs.

Het weekbestand gebruikt schema supa-private-planner-week-v1 (UTF-8, maximaal 256 kB, maximaal 14 geselecteerde dagen, 200 unieke fysieke ingrediënten). Ongeldige hoeveelheden of een onsamenhangend weekmenu worden geweigerd, zonder data aan een server te verzenden. Publiek gebruik wacht op de bestaande CI-, review- en mainwriter-gates.

Dezelfde bestaande, strikte negenkoloms-CSV-converter is nu ook rechtstreeks via **Vergelijk → Open je eigen twee-winkel CSV of JSON** bereikbaar. De hoofdapp leest maximaal 256 kB UTF-8, converteert CSV uitsluitend in de browser via de al bestaande Supa-module en weigert een ontbrekende of ongeldige tweede winkel voor een volledige vergelijking. Het oorspronkelijke CSV-bestand blijft onveranderd; in de invoer verschijnt het geconverteerde JSON. Een ongeldige import, bewerkte bron of veranderd handmatig prijsconcept trekt onmiddellijk de oude uitkomst én alle per-SKU-bevestigingen in. Bij slechts één echte winkel gebruik je de hierboven gekoppelde uitgebreide privévergelijker; Supa verzint nooit een tweede winkel.

## Nieuwe telefoonroute: oorspronkelijke winkelopname zonder spreadsheet

In **Vergelijk → Gebruik ditzelfde weekmenu met jouw eigen winkelbronbestanden** kun je na het kiezen van PLUS, DekaMarkt of beide onder **Vul zelf originele winkelproducten op je telefoon in** ook zonder Excel de oorspronkelijke bronproducten vastleggen. Gebruik eerst je echte Planner-weekmenu; dit toont per winkel de ingrediënten als rijnummergids, geen aangenomen supermarktartikelen.

1. Vul per winkel **zelf** het werkelijke opnamemoment inclusief UTC-Z of expliciete tijdzone-offset in. De datum wordt nooit door Supa voor je gezet. Kies per origineel waargenomen artikel **beschikbaar** of **niet beschikbaar**; niet waargenomen producten laat je ongemoeid. De echte SKU, winkelproductnaam en pakeenheid zijn altijd eigen invoer. Voor beschikbare producten vul je daarnaast gemeten pakinhoud, multipack-aantal en hele eurocenten in. Bij wisselen naar niet beschikbaar vraagt Supa toestemming voordat een eerder ingevulde pakprijs uit het lokale concept wordt gewist.
2. Filter zo nodig op Planner-ingrediënt. De teller per winkel toont welke fysieke regels een eigen bronartikel kregen; dat aantal is **geen bevestigde productmatch**. Het formulier weigert dubbele SKU's binnen dezelfde winkel en onvolledige beschikbare productregels. De bestaande strikte importconversie blijft verantwoordelijk voor de definitieve broncontrole, inclusief de echte timestamp-, maat- en prijsgrenzen.
3. Met **Controleer mijn echte winkelopname in Supa** maak je een of twee oorspronkelijke negenkoloms CSV/TSV-bronbestanden in het browsergeheugen en open je de **bestaande lokale voorinzage**. Er wordt nog niets geaccepteerd; SKU, verpakking, versheid en fysieke match vragen afzonderlijke controle. Je kunt de bronbestanden ook lokaal downloaden of bewust via de mobiele bestandsdeelactie versturen. Als een retailer niet werd waargenomen, verzint Supa geen tweede winkel of ontbrekende prijs.
4. Met **Bewaar ook onvolledige invoer als privéconcept (JSON)** bewaar je zelfs half ingevulde velden uitsluitend als lokaal bestand. **Herstel eerder bewaard privéconcept** staat alleen exact hetzelfde weekmenu, dezelfde winkels en dezelfde fysieke ingrediënten toe. Een andere week of opnamecontext wordt geweigerd zonder bestaande invoer te overschrijven. Het conceptbestand is **geen negenkoloms prijsbron**, retailerrecht of onafhankelijk veldbewijs; na herstel volgt altijd opnieuw de bronvoorcontrole. Er is geen automatische browser-, server- of cloudopslag voor deze telefooneditor.

Onder het afzonderlijke per-winkel vervolgformulier voor ontbrekende of verlopen producten kun je dezelfde mobiele velden invullen en downloaden; wanneer **Controleer mijn echte winkelopname in Supa** beschikbaar is, gebruikt die uitsluitend de bovenstaande bestaande strikte browserimport. Elke nieuwe waarneming vereist een echt nieuw bronmoment. Publicatie en empirische claims wachten nog op aparte rechten-, review- en veldbewijsgates.

## Leeg opnameblad invullen, nakijken en bewust importeren
1. Maak in **Planner** je echte weekmenu, kies in **Vergelijk** één of beide winkels en download het **lege prijsinvulblad (CSV)** plus de opnamegids met dezelfde regelnummers. Geen regel bevat een verzonnen productcode, moment of prijs.
2. Vul in het CSV-bestand uitsluitend daadwerkelijk geobserveerde bronvelden in: oorspronkelijke productcode, naam, verpakkingsinhoud/eenheid, multipack-aantal, prijs in hele centen, waarnemingstijd met UTC-offset en beschikbaarheid. Laat een niet-geobserveerde regel **helemaal leeg**, behalve de bestaande winkel/eindwaarde `false` en een optionele eenheidshint. Een deels ingevulde regel geeft nu expliciet het foutieve CSV-regelnummer in plaats van ongemerkt te verdwijnen.
3. Gebruik **Controleer een ingevuld CSV-prijsblad vóór import** voor één gecombineerd of één los bestand, of selecteer twee aparte één-winkel-CSV-bestanden tegelijk. De twee bestanden moeten daadwerkelijk één verschillende winkel bevatten. De lokale controle gebruikt de **bestaande strikte converter én opname-admissie**, toont per werkelijk aangeleverde winkel aantallen ingevulde bronproducten en leeg gebleven regels, en laat de eerste twaalf werkelijk ingevoerde bronartikelen met oorspronkelijke code, inhoud, pakprijs en berekende eenheidsprijs zien. Niet-beschikbare en ongeprijsde artikelen blijven expliciet onbekend. Deze inspectie wijzigt je eerdere winkelopnames niet.
4. Open desgewenst **Planner-productmatching vooraf bekijken** per winkel: Supa berekent met dezelfde bestaande conservatieve matching alvast welke echte ingevoerde bronproducten voorstelbaar zijn voor hetzelfde fysieke weekmenu, welke ingrediënten nog onbekend zijn en hoeveel hele verpakkingen een voorstel vergt. **Er is dan nog geen match geaccepteerd, winkelmandtotaal of prijsverschil bewezen.** Met **Download alleen ontbrekende winkelproducten (TXT)** kun je alle niet-gematchte fysieke ingrediënten per winkel apart meenemen, ook als de andere winkel nog geheel ontbreekt. Dit bestand bevat géén aangenomen productcodes, prijzen of toestemming. Dezelfde preview waarschuwt apart wanneer een bronmoment meer dan zeven dagen oud of toekomstig is en wanneer twee werkelijk ingevoerde winkelopnames meer dan 24 uur uit elkaar liggen; deze voorwaarden kunnen nooit met een automatisch ingevulde datum worden omzeild. Bij het openen van slechts één nieuwe winkel-CSV vergelijkt de preview ook met het **daadwerkelijk bewaarde andere winkelbronmoment** (indien aanwezig), zonder die tweede bron, identiteit, tijd of prijs te vervangen.
5. Klik pas na eigen controle op **Neem eigen brondata over**. Voor een ontbrekende tweede winkel wordt dezelfde bestaande veilige toevoegroute gebruikt; voor een al geladen winkel de **bronverschillen-preview** vóór vervanging. Wanneer je één CSV met uitsluitend **nieuwe** oorspronkelijke artikelcodes en exact hetzelfde eerdere waarnemingstijdstip aanlevert, sluit de preview nu direct aan op de bestaande **veilig aanvullen**-route: de eerdere productregels, echte prijzen en het onveranderde bronmoment blijven intact. De matching-preview gebruikt bij deze aanvulroute de gecombineerde lijst van bestaande én nieuwe originele bronproducten, zodat eerdere productmatches niet ten onrechte als ontbrekend worden weergegeven. Bij een andere opnametijd of reeds bestaande broncode gebruikt Supa uitsluitend de bestaande expliciete **winkelvervanging** met bronverschillencontrole; er worden geen oude prijzen doorgeschoven naar een nieuwer moment. Als er al bronnen en controles zijn, vraagt het tegelijk inladen van twee vervangende winkelbestanden expliciet om bevestiging, nadat beide bestanden geldig zijn verklaard. Annuleren behoudt de bestaande brongegevens en vinkjes. Geaccepteerde productcodes zijn niet automatisch met Planner-ingrediënten gematcht: elk fysieke match en de oorspronkelijke prijs moeten apart worden beoordeeld.
6. Verlopen, ontbrekende of niet-geprijsde winkelobservaties blijven **onbekend**. Een volledig prijsverschil verschijnt alleen als beide complete, brongebonden mandjes aan bestaande voorwaarden voldoen. Dit werkblad is geen toestemming van retailers en geen onafhankelijk veldbewijs.

## Originele bronmatches gericht controleren, afdrukken of meenemen

Na **Controleer beide winkels samen** toont **Zelfde Planner-vraag bij PLUS en DekaMarkt** de oorspronkelijke artikelen en verpakkingsvoorstellen naast elkaar. Een onvolledige match houdt de wel bekende bronproductnaam, SKU en oorspronkelijke verpakking zichtbaar zodat je het juiste artikel kunt terugvinden; de ontbrekende of niet-consistente hele-pak-prijs en eenheidsprijs blijven onbekend. Twee verschillende fysieke Planner-behoeften mogen niet worden vergeleken: je ziet dan afzonderlijk beide oorspronkelijke hoeveelheden en productidentiteiten, maar geen bedrag of winnaar. Een fractie van een fysiek stuk vereist menselijke review en wordt niet als complete winkelmatch behandeld.

Gebruik het **winkelgerichte filter** om alleen openstaande PLUS- of DekaMarkt-regels te bekijken. **Download openstaande ... in Excel-CSV** volgt dat filter: andere originele winkelgegevens blijven als context staan, maar de selectie gaat alleen over de ontbrekende fysieke regels van de gekozen winkel. **Deel ... via mijn telefoon** geeft na jouw klik een echt CSV/TSV-bestand aan het besturingssysteem; als bestanden delen niet kan, volgt een lokale download. De geselecteerde komma-, puntkomma- of tab-scheiding blijft behouden (bij tabs `.tsv`).

De review-CSV is **niet** het originele negenkoloms-opnamebestand en kan niet als officiële bronopname worden teruggeïmporteerd. Hij bevat referenties naar oorspronkelijke SKU's, opnametijden, voorstel-verpakkingen, eigen fysieke vraag en de specifieke volgende controleactie. De TXT-export en scriptvrije offline HTML-print gebruiken dezelfde strikte bronversheidslogica. Prijzen uit een bron ouder dan zeven dagen, met ongeldig tijdstip of uit de oudste winkel van een >24-uursverschil worden niet als bruikbare bedragen/eenheidsprijzen herhaald. Werkelijke bronwaarden blijven in de originele gebruikersopname bewaard, maar niet als actuele besparingsclaim weergegeven.

Via **Ga naar de lege PLUS-/Deka-invulbladen** kun je de ontbrekende of opnieuw te observeren winkelregels direct opnieuw opnemen. Vul een nieuw waarnemingsmoment altijd zelf in en gebruik nooit een oud tijdstip om een later geobserveerde prijs met een bestaande bron te laten samenvoegen. Pas na geldige bronimport en menselijke productcontrole kan de normale privémandjesvergelijking een prijsverschil tonen.

## Eén winkel klaar terwijl de tweede nog ontbreekt

Wanneer je wel een volledig eigen PLUS- **of** DekaMarkt-mandje
hebt gecontroleerd maar een vergelijkbare tweede bron nog ontbreekt,
biedt **Producten → Vergelijk PLUS met DekaMarkt** per beschikbare
winkel de afzonderlijke **CSV-/TXT-download**, **offline HTML-afdruk**, **handmatig kopieerbare tekst**-acties aan. De export gebruikt dezelfde oorspronkelijke
SKU's, echte bronmomenten, hele verpakkingsprijzen en de actuele
vinkjes van die winkel. De winkeltekst toont de afvinkingen; ook de
CSV bevat afzonderlijke velden voor afgevinkt. De scriptvrije offline HTML-afdruk toont
het originele complete mandje, de afzonderlijke nog te kopen regels, hun
originele eenheids- en pakprijzen en de geregistreerde brontijd. Het lokale selecteerbare tekstvak is pas na een expliciete klik zichtbaar;
je kopieert zelf via je apparaatmenu, zonder geprivilegieerde browserrechten.
Er wordt geen tweede winkelprijs of besparing verzonnen.

## Volledig prijsrapport bewaren, printen of mobiel meenemen

Op **Producten → Mijn echte bronartikelen → Open boodschappenlijst**
kiest Supa bij een volledig, vers en fysiek identiek twee-winkelmandje
de winkel met de laagste **oorspronkelijke hele-verpakkingsprijs**.
Bij gelijkstand is PLUS slechts een neutrale tie-breaker. Staat maar
één actuele eigen winkelbron klaar, dan opent uitsluitend die winkel.
Bij twee niet-vergelijkbare bronopnames wordt nooit stilzwijgend PLUS
gekozen: selecteer eerst zelf de winkel. De bronleeftijd en fysieke
vergelijkbaarheid worden op het moment van doorklikken opnieuw beoordeeld.
Dit is geen garantie van het kassabedrag of de netto ritkosten.

**Producten → Mijn echte bronartikelen** heeft voor rechtmatig ingevoerde,
door jezelf beoordeelde SKU's nu ook de winkelvloerfilters
**Alle originele artikelen**, **Alleen nog te kopen** en **Alleen
afgevinkt**. Je kunt ze combineren met de bestaande winkel-, zoek-,
eenheids- en sorteerfilters. De kaartvinkjes blijven per exact
oorspronkelijk winkelartikel bruikbaar; de complete mandprijzen,
twee-winkelvergelijking en export bevatten ongeacht de zichtfilter
altijd hun volledige oorspronkelijke fysieke vraag.

Zowel bij één beschikbare winkel als bij twee volledig vergelijkbare winkels
toont Producten nu per oorspronkelijke winkelbron het aantal afgevinkte
producten en de *nog op de lijst* openstaande hele-pakkosten. De volledige
mandtotalen blijven onveranderd: dit openstaande bedrag is geen kassabedrag
en afvinken is geen prijs- of betalingsbewijs.

Gebruik **Bewaar alleen nog te kopen (TXT)** of **Toon alleen nog te
kopen om zelf te kopiëren** voor een compacte persoonlijke winkelroute. Deze tekst bevat
alleen originele nog niet afgevinkte productregels en de prijscontext van
de oorspronkelijke complete bron. Als alles is afgevinkt meldt de lijst
expliciet dat er niets meer openstaat. De originele brondata, complete
winkelmandtotalen en bevestigde productmatching worden nooit aangepast.

Bij een volledig geaccepteerde twee-winkelvergelijking kan Producten
de eerder vastgestelde bruto productkosten van een gecombineerde route
ook **met jouw zelf ingevulde extra kosten voor de tweede winkelstop**
doorrekenen. Het bestaande strikte kostenformaat (€ 0,00–€ 1.000,00,
maximaal twee decimalen) wordt hergebruikt. Zonder geldige invoer
blijft het netto verschil onbekend, en reistijd of andere niet-opgegeven
kosten zijn nooit als nul aangenomen. De invoer geldt uitsluitend
voor precies die bronopnames en dat Planner-weekmandje: na
herimport of wijziging wordt het bedrag niet op een nieuwe bron
toegepast. Bij openen van de uitgebreide route moet je de extra kosten
zelf opnieuw bevestigen; de snelle Producten-inschatting wordt niet
als winkelprijs, kassabedrag of bewijs opgeslagen.

Ook nadat beide volledige winkelbronnen vergelijkbaar zijn, blijft in
**Producten → Zelfde weekmandje → Ik ga naar één winkel** de zelfstandige
PLUS- of DekaMarkt-weeklijst bereikbaar. Je kunt elk winkelmandje afzonderlijk
afdrukken, als CSV/TXT bewaren of als selecteerbare privétekst zelf kopiëren en delen.
Dit is handig als je voor één winkel kiest in plaats van een gecombineerde route.
De bestaande twee-winkelprijzen en andere winkelbron worden niet gewijzigd.

Wanneer alle oorspronkelijke SKU's voor **exact hetzelfde fysieke weekmandje** in
beide winkels zijn gecontroleerd, beide opnames hoogstens zeven dagen oud zijn en
hun bronmomenten maximaal 24 uur uiteen liggen, verschijnen in **Producten**
de complete PLUS/DekaMarkt-weekmandjes. Dezelfde canonieke hele-pakkenvergelijking
levert de bedragen, de goedkopere winkel en de verschillen per ingrediënt.

In de offline HTML-afdrukken toont Supa ook het ingestelde Planner-weekbudget
(alleen bij een geldig bedrag) en hoeveel het originele volledige mandje erboven
of eronder ligt. Afgevinkte bedragen zijn niet de betaalde kassasom.

De TXT-/selecteerbare kopieertekst neemt nu ook de oorspronkelijke afvinkstatus per winkel over;
de winkelprijzen blijven altijd de volledige originele fysieke mand, niet alleen de nog
open boodschappen. Afvinken is geen betalingsbewijs.

Tijdens asynchroon laden van de lokale CSV-/HTML-/TXT-export wordt de
afvinkstatus opnieuw vergeleken vlak voordat de download start.
Als iemand intussen een origineel artikel heeft afgevinkt of teruggezet,
vraagt Supa de export opnieuw aan te maken in plaats van een
verouderde boodschappenlijst stilzwijgend op te slaan.

Ook als het privacyvriendelijke tekstvak al openstaat en de
originele bron op dat moment verloopt, controleert Supa opnieuw bij
**selecteren** en bij de echte **Kopieer**-actie van de browser.
Bij een verlopen, niet langer fysiek vergelijkbare of gewijzigde
winkelopname of afvinkstatus wordt die kopieeractie gestopt; de
gebruiker kan dan uitsluitend een nieuw gecontroleerd overzicht
maken. De vaste historische onderzoeksvergelijking blijft duidelijk
een aparte niet-live bron, zonder deze persoonlijke bronclaim.

Een weergegeven selecteerbare privétekst is een momentopname van
de originele winkelbronnen én de afvinkstatus op dat moment. Zodra je
een boodschappenartikel (ook bij de andere winkel) afvinkt of terugzet,
wordt de eerder gemaakte kopieertekst verborgen totdat je deze opnieuw
opvraagt. Zo verspreid je niet ongemerkt een verouderde lijst.

Via **Bewaar printbaar volledig weekmandje (HTML)** krijg je een lokaal,
scriptvrij document met de twee bronmomenten, oorspronkelijke SKU's,
pakinhoud, pakprijzen, eenheidsprijzen, daadwerkelijke hele-pakkentotalen en
vergelijkingsregels. Open het bestand op je toestel om af te drukken; het
bestand vraagt geen internetverbinding en bevat een beperkend CSP.
**Toon complete privévergelijking om zelf te kopiëren of delen** maakt na
jouw klik een selecteerbaar tekstvak met diezelfde complete brongebonden
inhoud. Je kiest zelf Kopieer/Delen via het apparaatmenu. Supa vraagt
geen automatische klembord- of native deelrechten aan. Je kunt ook
een CSV-, TXT- of printbaar HTML-bestand lokaal bewaren.

De downloads gebruiken altijd het **oorspronkelijke complete weekmandje**,
niet alleen de huidige zoek- of winkelprijsfilter. Bij ontbrekende, gewijzigde,
verlopen of niet volledig gekoppelde bronnen ontbreekt de complete export.
Een eigen twee-winkelroute toont uitsluitend een *productverschil*: extra
reis-, parkeer- en tijdkosten blijven onbekend totdat je ze zelf invult.
Dit is een persoonlijk bewaard rapport, geen onafhankelijk veldonderzoek,
retailertoestemming, actuele kassagarantie of publiek besparingsbewijs.

## Importeren

1. Maak lokaal een JSON-bestand met **één** PLUS- en **één** DekaMarkt-opname. Beide opnames beschrijven de daadwerkelijk waargenomen prijscontext, met een ISO-tijd en een expliciete UTC-offset.
2. Kies de gewenste maaltijden/dagen in **Planner**. Open **Vergelijk** en importeer het bestand of plak de inhoud.
3. Controleer per winkel de automatisch voorgestelde **product-ID, naam, verpakking, aantal hele verpakkingen en de werkelijk aangeleverde prijs per pak** met jouw oorspronkelijke bronopname. Bevestig elke winkelregel apart met **Product, inhoud en prijs met mijn bronopname gecontroleerd**. Onbekende regels kunnen niet worden bevestigd.
4. Een volledig winkeltotaal verschijnt uitsluitend bij een volledig matched, menselijk bevestigd en actueel mandje voor die winkel. Een rekenkundig prijsverschil verschijnt alleen als alle regels voor **beide** winkels zijn bevestigd, beide tijden maximaal 24 uur uiteen liggen en geen van beide opnames ouder is dan zeven dagen. Als de bron, het weekmenu, de oorspronkelijke opnametijd, de match of de prijs verandert, geldt de oude bevestiging niet meer; de invoer opnieuw importeren wist alle bevestigingen.
5. In **Vergelijk → boodschappen** zie je per winkel de daadwerkelijk gekoppelde hele verpakkingen plus openstaande, ongeprijsde regels. Vink gekochte producten per winkel af. Kies **Toon alleen nog te kopen** of **Alle afvinkingen wissen**; de twee winkels delen geen afvinkingen. De kopieerbare lijst laat eigen vinkjes als aangevinkt zien. Afvinkingen blijven uitsluitend tijdens deze browsesessie in het scherm en verdwijnen bij een nieuwe of gewijzigde broninvoer. Het gaat nadrukkelijk **niet** om een bevestiging van bronherkomst of prijsvaliditeit; dat is de aparte matchbevestiging.
6. Ook na handmatige controle zijn deze observaties **niet onafhankelijk geverifieerd** en is dit geen publiek besparingsbewijs.

Schema:

```json
{
  "schema": "supa-offline-prices-v1",
  "captures": [
    {
      "retailer": "PLUS",
      "observedAt": "VUL_ECHTE_ISO_TIJD_MET_OFFSET_IN",
      "products": [
        {
          "id": "eigen-product-id-plus",
          "name": "Vul geobserveerde productnaam in",
          "packAmount": null,
          "packUnit": "g",
          "available": false,
          "priceCents": null
        }
      ]
    },
    {
      "retailer": "DekaMarkt",
      "observedAt": "VUL_ECHTE_ISO_TIJD_MET_OFFSET_IN",
      "products": [
        {
          "id": "eigen-product-id-deka",
          "name": "Vul geobserveerde productnaam in",
          "packAmount": null,
          "packUnit": "g",
          "available": false,
          "priceCents": null
        }
      ]
    }
  ]
}
```

**Let op:** dit is opzettelijk een *niet importeerbaar invulsjabloon*: de waarnemingstijden zijn nog placeholders en de pakketgegevens zijn onbekend. Neem geen voorbeeldbedragen of verzonnen tijdstippen over. Een onbekende prijs/verpakking blijft `null` en `available:false`. Zet alleen bij geobserveerde, toegestane, daadwerkelijk beschikbare producten `available:true`, een positieve `packAmount` en de werkelijke `priceCents` in hele eurocenten. `packCount` kan optioneel een positief geheel aantal multipacks vastleggen.

Alleen `g`, `kg`, `ml`, `l`, `piece` zijn ondersteund. Maximaal twee opnames, 1.000 producten per opname en 256 kB. Duplicaat-ID's en ongeldige datums worden geweigerd.

## Bronrechten en waarheidsgetrouwe presentatie

Dit is een **lokale particuliere rekenhulp, geen licentiecontrole of gegarandeerde actuele supermarktvergelijker**. Alleen gegevens gebruiken die je werkelijk rechtmatig bezit en mag verwerken. JSON, een geslaagde import, namen van PLUS/DekaMarkt of een ingevuld tijdstip bewijzen op zichzelf **nooit** toestemming van een retailer of dat een medewerker fysiek 11×2 prijzen geobserveerd heeft. De bestaande M1-bronrechten en M3-bewijspoorten blijven op HOLD en er is geen automatische live netwerkverbinding. Geen publieke besparingsclaim zolang bronrechten, echte veldobservatie en releasegates ontbreken.

Gegevens gaan niet naar een server. Ze blijven alleen in de componentgeheugenruimte, verdwijnen bij het verlaten/herladen van de pagina en kunnen met **Wis lokaal geladen data** worden verwijderd. De kopieerbare lijst is een expliciete gebruikersactie en blijft lokaal in de browser totdat je zelf kopieert.

## Gewone Vergelijk-tab: begin met één winkel en vul de tweede later aan

In de normale Supa-app onder **Vergelijk** kun je nu een echte bestaande
privéopname van **alleen PLUS of alleen DekaMarkt** uit JSON of de canonieke
negenkoloms-CSV openen. Voor één winkel heet het JSON-schema
`supa-private-single-store-prices-v1` en bevat `captures` precies
één opname. Twee werkelijk aanwezige winkels gebruiken onveranderd
`supa-offline-prices-v1` met twee opnames. De bestaande
`convertOwnStoreCsv` uit `public/offline-two-store-csv.mjs` verzorgt
dezelfde strikte lokale CSV-conversie als de uitgebreide privéwerkbank.

Na één import verschijnt alleen de waargenomen winkel met originele
artikel-ID's, verpakking, waarnemingstijd, eenheidsprijs en de hele
verpakkingsberekening. De tweede winkel toont expliciet **geen bronopname**.
Je moet elke bronmatch handmatig bevestigen; alleen dan kan een volledig
én recent winkelmandtotaal worden getoond. Een besparingsverschil of
winkelwinnaar blijft onbekend totdat beide originele bronnen binnen
de 24-uurscontext en zeven dagen vallen en alle regels zijn bevestigd.

Met **Voeg de echte opname van de andere winkel toe** laad je een aparte
één-winkel CSV of JSON in. Supa weigert een dubbele winkel of bestand met
twee bronnen. De oorspronkelijke opname, ook onbekende `null`-prijzen,
wordt niet uit de eerdere genormaliseerde rekensommen gereconstrueerd
maar uit de originele geaccepteerde JSON samengevoegd. De gecombineerde
bron doorloopt opnieuw de bestaande canonieke validatie. Eerder
bevestigde regels uit de ongewijzigde eerste bron behouden hun controle;
nieuwe bronproducten beginnen onbevestigd. Een afgebroken of ongeldige
toevoeging overschrijft de bestaande import niet.

Per werkelijk ingeladen winkel kun je de huidige boodschappenlijst met
afvinkingen expliciet als **TXT** downloaden of zelf uit het selecteerbare
tekstveld kopiëren. Dit is geen automatische synchronisatie, netwerkverzoek
of officiële actuele winkelprijs. Ontbrekende/verlopen/ongecontroleerde
gegevens blijven zichtbaar onzeker. Geen retailerrechten of fysiek
PLUS/Deka-veldbezoek worden uit deze software afgeleid.

### Direct invoeren in het hoofdscherm

Het bestaande onderdeel **Geen JSON? Vul de winkels hier in** heeft nu een
expliciete keuze **Alleen PLUS**, **Alleen DekaMarkt** of **PLUS en DekaMarkt**.
Alleen geselecteerde winkelvelden en opnametijden zijn verplicht. Na
**Bereken met mijn ingevoerde prijzen** wordt exact het bijpassende
bestaande één- of twee-winkelschema gegenereerd, vervolgens vóór gebruik
langs dezelfde strenge lokale importer geleid. Het private concept met
de niet-geselecteerde winkel blijft als eigen formulierinformatie staan,
maar wordt **niet** als waarneming, artikel of prijs uitgegeven.
Wijzigingen in winkelkeuze of invoer trekken eerder getoond bronresultaat
in; voor een nieuwe vergelijking moet de gebruiker opnieuw berekenen.

### Geen verzonnen bronartikel-ID in handmatige invoer

De handmatige invoer vraagt nu voor elk daadwerkelijk ingevuld artikel een
door de gebruiker geobserveerde **originele productcode** (EAN of ander
artikelnummer uit eigen bron), naast naam, verpakking, prijs en echte
opnametijd. De oude automatisch verzonnen `own-plus-N`/`own-deka-N`
product-ID's worden niet meer voor nieuwe imports gegenereerd. Als twee
ingrediënten dezelfde originele code en identieke bronfeiten hebben,
behoudt de import één werkelijk opgegeven bronproduct. Tegenstrijdige
gegevens onder dezelfde code worden expliciet geweigerd. Oude
sessionStorage-concepten zonder dit veld blijven leesbaar zodat hun
gegevens niet verloren gaan, maar vereisen menselijke aanvulling van de
echte code voordat ze tot een nieuw bronbestand worden verheven.
Een door de gebruiker getypte code blijft een privébronvermelding en
bewijst zonder onafhankelijke verificatie geen retailerautorisatie.

### Lokale overdracht zonder verlies van onbekende bedragen

Met **Download mijn originele bronopnames (JSON)** bewaart de gebruiker
expliciet de reeds toegelaten eigen één- of twee-winkelopname op het
apparaat. Dit bestand behoudt de daadwerkelijk ingelezen oorspronkelijke
artikelcodes, tijdstippen en `null` voor onbekende prijzen; het resultaat
wordt voor download opnieuw langs dezelfde lokale importer gelegd.
Na een volgende sessie kan het via de bestaande JSON-ingang terug.

Een daadwerkelijk waargenomen en expliciet ingevoerde **€0,00**-pakprijs
wordt nu als geldige gehele centprijs bewaard (mits de gebruiker de
beschikbaarheid en echte verpakking bevestigt). Een leeg prijsveld blijft
`null`, onbekend of onbeschikbaar en wordt nooit automatisch tot €0,00
gemaakt. Een prijs van nul is op zichzelf geen bewijs van promotie,
bronrechten of publieke besparing.

### Afvinkstatus tussen eigen apparaten of browsers meenemen

Voor iedere daadwerkelijk aanwezige winkel kan de gebruiker de afvinkstatus
expliciet als privé JSON downloaden en later met de lokale bestandskiezer
herstellen. De gewone Vergelijk-tab hergebruikt hiervoor de bestaande
`currentTripKey`, `saveTripProgress` en `loadTripProgress` uit
`src/privateShoppingProgress.ts`. Herstel kan alleen bij een volledig
fysiek gekoppelde winkelmand met exact dezelfde oorspronkelijke
winkelopname, prijsbedragen, bronmoment, SKU, verpakkingen en hoeveelheden.
Een verouderd of vreemd bestand doet niets; de andere winkel blijft
onaangeroerd. Vinkjes vormen nooit bewijs voor de betrouwbaarheid van
winkelprijzen. Er is geen automatische synchronisatie of netwerkrequest.

### Bevestigde volledige vergelijking downloaden

Zodra beide werkelijk aanwezige winkelopnames recent, minder dan 24 uur
uit elkaar, fysiek volledig gekoppeld en door de gebruiker op alle
bronartikelen expliciet bevestigd zijn, biedt de gewone Vergelijk-tab
**Download volledige privévergelijking (CSV)**. Dit hergebruikt de
bestaande `createPrivateBasketComparisonCsv` voor een 29-koloms lokaal
overzicht met fysieke behoefte, originele SKU's, gehele verpakkingen,
oorspronkelijke centprijzen, indicatieve eenheidsprijzen, afzonderlijke
hele-mandtotalen en rekenkundig prijsverschil per ingrediënt. Bij
ontbrekende of verlopen bron, niet-volledige matching of ontbrekende
menselijke bevestiging is deze knop afwezig. Zonder brondata zijn er
geen prijzen of winkelwinnaar te exporteren. De afgeleide CSV is een
particuliere rekentabel, **geen invoerformaat voor nieuwe bronnen** en
geen retailerautorisatie of onafhankelijk besparingsbewijs.

### Concreet vervolgstap-overzicht in de gewone Vergelijk-tab

Zodra je een bronopname laadt toont het scherm nu per winkel de eerst
uitvoerbare broncorrectie: een ontbrekende PLUS/Deka-opname, een
verouderde/toekomstige waarneming, een ongeldige Planner-vraag,
het aantal niet-koppelbare ingrediënten met één concreet voorbeeld of
het aantal nog door jou te bevestigen SKU-/verpakkings-/prijsregels.
Bij twee volledige maar meer dan 24 uur uiteenliggende waarnemingen
vraagt het scherm om twee oorspronkelijke opnames in één tijdcontext.
Bij voltooide broncontrole verdwijnt dit actieoverzicht automatisch en
verschijnt de eigen volledige mandvergelijking/CSV-export. Er worden geen
prijzen, matchingclaims of bronrechten door de instructietekst toegevoegd.

### Handmatig juiste productcode koppelen binnen bestaande bron

De gewone Vergelijk-tab toont nu naast automatische matching een keuzelijst
met **uitsluitend werkelijk in de huidige eigen winkelopname ingelezen**
beschikbare bronproducten met bekende verpakking, prijs en passende
fysieke eenheid (g/kg, ml/l of stuk). Hiermee kan de gebruiker een
abstinerende naamvergelijking oplossen of een fout automatisch voorstel
corrigeren zonder via de aparte wizard nieuwe bronnen te verzinnen.
De gekozen SKU moet exact en uniek in de geselecteerde opname staan:
verwijderde, dubbele of onbeschikbare codes vallen terug naar onbekend.
Vervolgens doorloopt het artikel ongewijzigd de echte hele-verpakkingen-
en centenberekening. Een handmatige keuze krijgt slechts de minimaal
geaccepteerde matchscore; expliciete SKU/inhoud/prijscontrole per bron is
**nog steeds verplicht** voor een totaal en winkelverschil.
Elke gewijzigde keuze trekt de eerdere reviews/afvinkingen in beide winkels
in; een ander geselecteerd artikel erft dus nooit een oude goedkeuring.
Ingevoerde SKU-keuzes leven alleen in de huidige browsercomponent en
worden gewist bij een nieuwe bronimport of het opnieuw opbouwen van
het bronbestand. Dit is geen productgelijkheidsbewijs of bronrecht.

## Eén bestand voor bronopnames, weekvraag en SKU-keuzes naar privéwizard

In de normale Supa Vergelijk-tab is **Bewaar mijn winkelmand + gekozen
producten (privésessie)** beschikbaar na een eigen bronimport en geldig
weekmenu. De download gebruikt exact het al ondersteunde
`supa-private-basket-session-v1` formaat van
`/private-basket-mapping.html` en de bestaande
`/private-basket-compare.html`-importer. Hetzelfde bestand bevat de
originele geaccepteerde één- of twee-winkelopname, de fysieke behoefte
uit geselecteerde Planner-dagen en expliciet gekozen of per bronregel
door de gebruiker bevestigde SKU's. Een nog nooit gekozen of bevestigde
automatische match wordt **niet** heimelijk als menselijke SKU-keuze
meegestuurd. Dubbele productcodes voor fysiek verschillende
ingrediënten worden niet afzonderlijk als twee aankopen toegekend:
die koppelingen blijven onbekend tot een mens de behoefte combineert.

De export valideert eerst het bestaande Planner-weekformaat, aggregeert
de canonieke ingrediënten en valideert de originele opname opnieuw.
Gekozen SKU's moeten uniek aanwezig, beschikbaar en fysiek compatibel
zijn binnen precies die eigen winkelopname. Het bestand is maximaal
256 kB. Na downloaden kun je het op de uitgebreide privéwerkbank
via **Herstel privésessie** openen. De bestaande import vraagt opnieuw
toestemming vóór het overschrijven van die eigen lokale werkbank en
rekent niet automatisch. Het bestand bewaart geen toestemming,
controle-checkboxes, onafhankelijk veldbewijs of actuele
besparingsclaim en is niet naar een server verzonden.

### Privésessie terugzetten in de gewone Supa-app

**Herstel eerdere privémand-sessie van ditzelfde weekmenu** opent
uitsluitend een lokale `supa-private-basket-session-v1` JSON. Supa
gebruikt daarvoor hetzelfde reeds ondersteunde weekmenu-exportcontract,
de originele één- of twee-winkelbronimport en de canonieke aggregatie.
De import controleert alle fysieke ingrediënten (ID, etiket, metrische
eenheid en exacte benodigde hoeveelheid), het geselecteerde aantal
maaltijden, de exacte SKU's binnen de juiste winkels, beschikbaarheid,
verpakkingsgrootte en passende eenheidsfamilie. Dezelfde bronverpakking
mag niet onterecht worden gekoppeld aan twee afzonderlijke ingrediënten.
Een groter of ongeschikt bestand en een gewijzigde Planner leveren
een foutmelding op zonder de aanwezige brondata te vervangen.

Na een volledig toegelaten sessie vraagt de browser expliciet toestemming
vóórdat Supa de eerdere werkbanksessie vervangt. Alleen oorspronkelijke
brondata en eerder gekozen SKU's gaan mee. **Alle product-/prijsreview
checkboxes, afvinkingen en eventuele financiële uitspraken beginnen opnieuw
onbevestigd**. Een oude sessie wordt niet automatisch ververst,
automatisch gepubliceerd of door het netwerk verstuurd.

### Geen dubbeltelling van één fysieke winkel-SKU

De gewone mandberekening weigert vanaf nu dezelfde echte SKU als twee
losse gekochte artikelen voor verschillende ingrediëntidentiteiten te
tellen. De getroffen regels blijven expliciet onbekend: combineer eerst
hun metrische fysieke behoefte in Planner of kies een ander werkelijk
beschikbaar artikel uit je eigen bron. Een gedeeltelijke bekende som
wordt niet als volledig mandtotaal of besparing gepresenteerd.
De volledige vergelijking blijft hierdoor eerlijk bij overlappende
ingrediënten en hergebruik van producten.

### Snel bronartikelen zoeken, ook bij grotere eigen exports

De bronkeuze heeft nu per ingrediënt en winkel een naam-/artikelcodezoeker
met maximaal veertig direct getoonde passende artikelen. De gebruiker
ziet het aantal gevonden resultaten; een eerder gekozen originele SKU
blijft zichtbaar, zelfs als de zoekterm deze verbergt. Alleen ingelezen
beschikbare producten met gemeten verpakking en fysiek compatibele
eenheid kunnen worden geselecteerd. Het filter is volledig lokaal en
wordt bij een nieuwe bronimport opnieuw leeg gemaakt. Iedere gewijzigde
bronkeuze trekt bronreviews en afvinkingen in, zodat een andere
productcode nooit een oudere goedkeuring erft.

### Afwijkende brontekst bij export naar de bestaande privéwizard

De portable sessie-export controleert bovendien het bestaande
strengere tekstcontract van de onafhankelijke privéwizard voor
oorspronkelijke artikelcodes en productnamen. Niet-toegelaten
onzichtbare control-/formattekens of formuleachtige voorlooptekens
worden niet stil aangepast en niet als een later onbruikbaar
sessiebestand geëxporteerd. De oorspronkelijke lokale winkeldata
blijven onaangetast en zijn nog afzonderlijk op te slaan; de
app toont welk contract de overdracht tegenhoudt.

### Alle ingrediëntprijzen naast elkaar in de gewone app

Wanneer exact dezelfde fysieke winkelmand bij beide winkels volledig
gekoppeld, recent en handmatig bevestigd is, verschijnt nu naast de
winnaar en grootste prijsdrijvers een uitklapbaar **alle prijsverschillen**
overzicht. Voor elk werkelijk geselecteerd ingrediënt toont dit de
gehele benodigde hoeveelheid, oorspronkelijke artikelcode en naam
per winkel, aantal en grootte van hele verpakkingen, indicatieve
€/kg, €/liter of €/stuk, het werkelijke regelbedrag voor hele
verpakkingen en het verschil DekaMarkt minus PLUS.
De regels worden op absolute bijdrage gesorteerd; een horizontaal
scrollbare tabel blijft bruikbaar op smalle telefoons. Zonder twee
volledig door de gebruiker gecontroleerde winkelbronnen bestaat dit
overzicht niet en wordt er geen fictief prijsverschil getoond.

## Eén echte, bevestigde bron door Vergelijk → Lijst → Planner

De bestaande React Vergelijk-tab publiceert vanaf nu alleen **daadwerkelijk
per bronartikel bevestigde, complete en nog geldige** eigen mandjes in een
kortlevende React-geheugenbrug. De oude voorbeelddata blijven strikt apart.
Zodra de gebruiker naar Lijst of Planner navigeert, blijft de eigen
Vergelijk-invoer gemount, zodat geïmporteerde bronprijzen en controles niet
verdwijnen door alleen van tab te wisselen. Vervangen van bron, productmatch
of fysieke weekbehoefte trekt gekoppelde mandjes onmiddellijk opnieuw in;
de bronvergelijker herberekent bij wijzigingen en veroudering.

**Lijst** toont na minstens één complete privé-opname geen
fictieve voorbeeldproducten meer, maar de daadwerkelijk geselecteerde
winkel met originele SKU, benodigde hele verpakkingen en eigen berekend
regelbedrag. Bij twee menselijke bronbevestigingen kan tussen PLUS en
DekaMarkt worden gewisseld. Een winkelprijsverschil verschijnt alleen als
beide opnamecontexten maximaal 24 uur uit elkaar liggen en de canonieke
mandvergelijking het daadwerkelijk toestaat. De lijst ondersteunt tijdelijk
afvinken, alleen nog te kopen, lokale TXT-download en kopieertekst. Geen
eigen prijzen of vinkjes worden op de server of in browseropslag bewaard.

**Planner** gebruikt voor het weekbudget hetzelfde bevestigde mandbedrag
van de gekozen winkel in Lijst, niet een eerder berekend demobedrag.
De Planner vermeldt expliciet eigen bron/winkel/tijdstip en dat dit geen
actuele kassagarantie is. Zonder volledig geverifieerde privébron wordt
de bestaande voorbeeldberekening gebruikt en duidelijk als voorbeeld
aangeduid.

Elk gepubliceerd mandje is aan de exacte Planner-vraag, receptingrediënten,
bronopnametijd en complete product- en prijsidentiteit gebonden. Wisselen
naar een ander recept, andere hoeveelheden of een niet meer geldige
bron laat in één render geen oud privébedrag opnieuw als geldig zien.
Private bedrag-/mandkeuze blijft alleen in lokaal React-geheugen;
een paginavernieuwing wist het als gebruiker geen expliciete portable
eigen bronsessie heeft gedownload.

### Lijst zonder enige winkelbron is nu volledig Planner-first

Zonder bevestigde bron toont Lijst standaard de **reeds bestaande**
`UnpricedPlannerChecklist` met uitsluitend de echte, canoniek
geaggregeerde ingrediënten uit de geselecteerde Planner-recepten en
hun fysieke hoeveelheden. Afvinken, alleen nog te kopen en een
kopieerbare tekstlijst werken zonder retailer- of prijsdata. Er wordt
geen fictief winkelartikel, EAN, totaal of prijsberekening gebruikt.

De oude Figma-productselectie en winkelvoorbeeldmand zijn voor
bestaande gebruikers bereikbaar achter een duidelijk benoemde
uitklapper **oude voorbeelden**. Zodra een eigen complete winkelbron
beschikbaar is, vervangt de eigen fysieke productenlijst die
ongeprijsde Planner-lijst. Recepten, Planner en boodschappenlijst
blijven daardoor bruikbaar zonder PLUS/Deka-veldvalidatie.

### Eigen winkel voor het Planner-weekbudget kiezen

Wanneer de gebruiker zowel een volledig bevestigde PLUS- als
DekaMarkt-opname heeft, toont Planner nu een winkelkiezer boven
het budget. Wisselen naar de andere werkelijk bevestigde bron
herberekent het getoonde volledige weekbudget direct met die
winkel, zonder een prijs te verzinnen. Dezelfde keuze geldt voor
de normale Lijst-tab: er ontstaan geen twee verschillende
'gekozen winkels' in twee schermen. Wanneer slechts één winkel
bevestigd is ontbreekt de kiezer en blijft het andere bedrag onbekend.
Brondata, review- en rechtenstatus blijven onveranderd.

### De ongeprijsde lijst behoudt vinkjes bij gewone tabnavigatie

De bestaande `UnpricedPlannerChecklist` blijft na het eerste bezoek
aan Lijst in de open React-sessie gemount wanneer je tussendoor Planner,
Recepten of Vergelijk opent. De huidige fysieke itemidentiteit houdt
afvinkingen bij tijdens die navigatie; ze worden niet in localStorage
of op een server bewaard. Bij het beschikbaar komen van een volledig
bevestigde privébron maakt de app plaats voor de gekoppelde, afzonderlijk
brongebonden winkelchecklist. De oude demonstratiecomponenten
worden niet buiten hun expliciet geopende uitklapper gemount.

### Ongeprijsde Planner-weeklijst ook offline als TXT

De al bestaande Planner-lijst kan nu naast handmatig kopiëren ook
expliciet als lokaal TXT-bestand worden gedownload, inclusief
actuele fysieke receptenbehoefte en de op dit moment afgevinkte regels.
De tekst bevat geen gekozen winkel, geclaimd artikelnummer,
fictief prijsverschil, netwerkactie of serveropslag. De knop
verschijnt alleen wanneer een geldig niet-leeg weekmenu aanwezig is.

### Extra handmatig gekozen producten blijven bereikbaar

De nieuwe ongeprijsde Planner-lijst vervangt niet meer de eerder door de
gebruiker in **Producten** geselecteerde losse productcollectie. Heeft
de gebruiker daar daadwerkelijk artikelen toegevoegd, dan toont Lijst
die selectie meteen als **aparte, expliciet als demonstratie of
historisch gemarkeerde** verzameling onder de fysieke receptboodschappen.
Een nieuwe bezoeker zonder losse productkeuzes ziet de oude voorbeelden
alleen in een optioneel details-paneel. De losse artikelen tellen nooit
mee in de eigen bronprijzen of het echte twee-winkelmandje.
Dit behoudt de Producten → Lijst gebruikersflow zonder de nieuwe
Planner-first lijst terug te veranderen in een fictieve winkelmand.

## Kosten- en runnerveiligheid: alleen self-hosted CI/preview

Op de bestaande Supa-productbranch zijn de **ongewijzigde verplichte**
`CI` en `Recipe UI preview` workflows van `ubuntu-latest` naar
`self-hosted` gerouteerd. Externe fork-PR's mogen op deze privé-VPS
geen onbetrouwbare code uitvoeren; alleen interne repo-PR's/push naar
main starten die bestaande jobs. Geen npm/audit/security/buildchecks
zijn verwijderd of verzwakt. Er is geen fallback naar hosted minuten.

**Exacte runnerblokkade 18 oktober 2026:** de bestaande systemd-unit
`actions.runner.Zennay-Supa.vps-bb300bba-supa.service` is sinds
13 oktober 19:28 UTC in `failed (oom-kill)`, met `Restart=no`.
De VPS heeft 10 GiB RAM, circa 3,5 GiB beschikbaar maar 4 GiB van
4 GiB swap benut; meerdere bestaande Firefox-processen gebruiken
veel geheugen. Sluit nooit zonder eigenaartoetsing actieve relayprocessen.

Verbonden zSSH kan de status lezen en repositorywijzigingen uitvoeren
maar kan deze systemd-rootservice niet herstarten: `sudo -n` is
uitdrukkelijk geweigerd door `no-new-privileges`. Niet omzeild.
Een bevoegde hostbeheerder moet na vrijmaken van voldoende capaciteit
via de normale hostbeheerroute deze **bestaande** unit heractiveren:

```bash
sudo systemctl reset-failed actions.runner.Zennay-Supa.vps-bb300bba-supa.service
sudo systemctl start actions.runner.Zennay-Supa.vps-bb300bba-supa.service
systemctl is-active actions.runner.Zennay-Supa.vps-bb300bba-supa.service
```

Tot de runner opnieuw online is mogen verplichte jobs veilig in de
self-hosted-queue wachten; geen main-merge of productie-deploy zonder
de nieuwe exacte-head checks/review. Gevraagde hosted-billing: €0.

### Van Home/Producten rechtstreeks naar rechtmatige eigen prijsvergelijking

Home en de Producten-tab hebben nu een duidelijke ingang naar de
normale **Vergelijk**-tab voor eigen, rechtmatig aangeleverde bronnen.
Dit pad gebruikt het bestaande geselecteerde Planner-weekmenu en de
bestaande lokale import/matching: er start geen nieuwe scraper.
Historische niet-vrijgegeven productprijzen en ontwerpvoorbeelden
blijven buiten de berekening. Door gebruikers apart gekozen
historische of voorbeeldartikelen verdwijnen niet wanneer er een
eigen winkelbron geladen wordt: de Lijst-tab toont ze dan in
een expliciet afzonderlijk blok **niet meegerekend in jouw mand**,
zonder het echte prijsverschil of boodschappenmandtotaal te wijzigen.

### Twee originele losse winkelbestanden tegelijk openen

Open de gewone **Vergelijk**-tab met een actief Planner-weekmenu.
Bij **Open één bronbestand, of selecteer tegelijk ...** kun je nu in
één selectie een PLUS- en een DekaMarkt-CSV/JSON kiezen. Dit is ook
geschikt voor twee afzonderlijke reeds bestaande exportbestanden.
Dezelfde reeds gebruikte UTF-8 converter en canonical reader
controleren **ieder** bestand; elk moet exact één echt geobserveerde
winkel bevatten. Twee bestanden voor dezelfde winkel, een reeds
twee-winkelbestand plus een tweede bestand, meer dan twee bestanden
en elk onleesbaar of te groot bronbestand worden **in hun geheel**
geweigerd. Eerdere beoordelingen en afvinkingen zijn bij nieuwe
import ongeldig. Er wordt pas een nieuw mandje getoond nadat beide
originele bestanden volledig en gezamenlijk zijn toegelaten.

Product-ID's, de geobserveerde tijd, verpakking, originele nulprijzen
en expliciete onbekende null-prijzen blijven behouden; één ontbrekende
of verouderde winkel kan geen volledig prijsverschil opleveren.
Voor controle van de bron blijft de bestaande **één winkel toevoegen**
route beschikbaar. Het importeren is volledig offline; het levert geen
retailerrechten of onafhankelijk 11×2 bewijs.

### Leesbaar privéoverzicht naast exacte CSV

Zodra **beide** volledige winkelmandjes in de gewone Vergelijk-tab
met originele, onderling maximaal 24 uur verschillende en maximaal
zeven dagen oude waarnemingen zijn geladen, én **iedere** exacte
bronmatch, verpakkingsgrootte en prijs door de gebruiker is bevestigd,
verschijnt een extra optioneel **leesbaar privéoverzicht**. De gebruiker
kan de volledige vergelijking in één lokaal TXT-bestand downloaden
of zonder klembordtoestemming selecteren/kopiëren in het scherm.
Daarin staan beide originele bronmomenten, hele-mandbedragen,
het getekende verschil (DekaMarkt minus PLUS), en per oorspronkelijk
Planner-ingrediënt de hoeveelheid, eigen broncode, productnaam,
hele verpakkingen, indicatieve eenheidsprijs en regelbedragen.

Bij ontbrekende, ongeldige, stale of incomplete input ontbreekt
deze uitvoer geheel; de reeds bestaande strikte CSV blijft een
afzonderlijke gebruikersoptie. Geen netwerk- of rechtenclaim.

### Integratie bestaande P1-bronfix: consistente shopping-root-ledger

De al eerder afzonderlijk gebouwde product-source fix van
`product/shopping-root-ledger-fail-closed-20261017-q1`
is zonder wijziging van de oorspronkelijke eigenaarbranch samengevoegd
in deze bestaande productintegratie. Voor een geldig basketKey,
Lijst-vinkje, kopie of print moeten voortaan de **eigen** root-tellers
(selectedMealCount, matched/unresolved count), het hele aantal centen
en de zichtbaar geldige winkelnaam/identiteit exact overeenkomen met
de werkelijke bronregels. Ongeldige gehele mandjes worden niet als
een nieuw leeg mandje of een geloofwaardige print getoond.

Reeds bestaande correcte v1-progress-sleutels behouden **dezelfde**
serialisatie; de bronfix wijzigt geen productprijs of retailerrecht.
De onafhankelijke verplichte officiële CI en review moeten dit op de
gecombineerde producthead nog beoordelen. Geen QA-suite gemaakt of
handmatig uitgevoerd.

### Van een oude bronopname naar een nieuwe winkelprijsopname

Wanneer een eigen PLUS- of DekaMarkt-opname lokaal in de normale
**Vergelijk**-tab staat, verschijnt per beschikbare winkel de knop
**Maak nieuw prijsinvulblad (CSV)**. Die bouwt uit uitsluitend de
daadwerkelijk door de gebruiker eerder geïmporteerde bronproducten
een nieuw negen-koloms CSV-blad; originele broncodes, productnamen,
fysieke verpakkingsinhoud, verpakkingseenheid en multipack blijven
herkenbaar. **Geen enkele oude geobserveerde prijs, waarnemingstijd
of beschikbaarheidsstatus** reist mee: observedAt en priceCents zijn
leeg, available is expliciet false. Daarmee kan het oningevulde blad
niet als een actuele winkelprijs worden geïmporteerd.

De gebruiker vult voor iedere echte opname de nieuwe werkelijke
`observedAt` (bijvoorbeeld `2026-10-18T17:30:00+02:00`) in
met de **daadwerkelijke lokale tijdzone**, vult verse prijs in
hele eurocenten in, en zet `available` uitsluitend voor werkelijk
geobserveerde verkrijgbare artikelen op `true`. Onbekend blijft
leeg/false. Verander de artikelcode als het in werkelijkheid een
ander artikel betreft. Voor elke winkel moeten alle regels één
geobserveerd bronmoment delen. Importeer één ingevulde CSV
of selecteer de twee verschillende winkelbladen tegelijk. Alle
producten moeten in de gewone Vergelijk-tab **opnieuw** expliciet
bevestigd worden voor een volledig bedrag.

Het invulblad zelf beweert geen retailertoestemming of onafhankelijke
veldopname; onveilige spreadsheet-formuleprefixen in originele
bronproductnamen of codes geven **geen export** in plaats van
onzichtbaar gewijzigde productidentiteit. Maximaal 256 kB,
alles offline en alleen expliciete lokale download.

### Fysieke 2-winkel-dekkingsmatrix voordat prijzen compleet zijn

De gewone Vergelijk-tab toont bij één of twee ingeladen echte
eigen winkelopnames altijd het complete **zelfde fysieke Planner-mandje**
als matrix: elke vereiste hoeveelheid één keer, met PLUS- en
DekaMarkt-kolommen voor de feitelijke bronstatus. De status is
onderscheiden in geen bron, geen passende SKU/verpakking, verlopen of
toekomstige observatie, nog persoonlijk te controleren product/pak/prijs
en volledig bevestigd. De matrix toont géén fictieve winkelprijs of
winnaar wanneer één van die stappen ontbreekt.

Voor ingeladen winkels leidt **Open productkeuze en controle**
rechtstreeks naar de werkelijke reviewregel, óók wanneer de gewone
boodschappenlijst gefilterd was tot alleen nog te kopen artikelen;
de filter wordt daarvoor uitgezet. **Download ontbrekende
winkelcontroles (TXT)** geeft dezelfde actuele fysieke vraag, bronmomenten
en status per winkel voor een offline inkoop-/waarnemingsbezoek.
De TXT is geen bewijs dat de producten daadwerkelijk zijn gezien of
de retailer datarechten heeft verstrekt. Een volledige vergelijking
kan pas na de ongewijzigde bestaande strengere source- en reviewgates.

### Bronartikel bij elke open controle terugvinden

De dekkingsmatrix en gedownloade veldchecklist bevatten bij een al
aan een Planner-ingrediënt gekoppelde winkelregel ook de exact
originele productnaam, winkelproductcode en bestaande
verpakkingsinhoud/eenheid/multipack. De status **persoonlijk
bevestigd** blijft onafhankelijk: een voorgestelde SKU is **geen
gecontroleerde actuele prijs**. De veldchecklist transporteert geen
bedrag en kan niet als bronopname worden geïmporteerd. Bij ontbrekende
SKU blijft het bronartikelveld leeg; er wordt geen fictieve match
ingevoerd.

### Niet-prijsklare bronartikelen blijven zichtbaar voor herstel

In de gewone Vergelijk-tab kun je de originele winkelproductnamen
en SKU's nu accent-onafhankelijk doorzoeken. Alleen daadwerkelijk
als beschikbaar met fysieke verpakking en prijs toegelaten artikelen
mogen in de productkeuze terechtkomen; ook hun exact gekozen match
vereist nog expliciete menselijke controle. Originele winkelregels
zonder bruikbare prijs, voorraadstatus of verpakking worden
**apart en uitsluitend informatief** getoond, met echte naam,
broncode en eventueel geobserveerde eenheid. Ze krijgen nooit
een automatisch matchbaar bedrag en worden niet als EUR 0 gezien.
Met het eerder toegevoegde herobservatie-CSV-blad kan de gebruiker
die ontbrekende feiten opnieuw rechtmatig opnemen; alle andere
broncontroles blijven ongewijzigd.

Het herobservatieblad bewaakt bovendien de exacte fysieke
verpakkingsprecisie: gewone decimale getallen tot zes cijfers na
de komma worden exact meegenomen. Zeer kleine/exponentiële of
numeriek instabiele hoeveelheden uit een oorspronkelijke JSON-opname
die de canonieke CSV-import niet verliesloos accepteert, worden
met een begrijpelijke melding geweigerd in plaats van afgerond.

### Alleen één winkel vervangen, zonder het andere mandje opnieuw te importeren

Onder **Vergelijk → Winkelvergelijking voor jouw huidige weekmenu**
heeft iedere werkelijk ingeladen winkel een extra bestandskeuze:
**Vervang uitsluitend de PLUS-/DekaMarkt-opname**. Laad daar een
actuele, eigen opname van **precies diezelfde winkel** als bestaand
negen-koloms CSV-bestand of de originele winkel-JSON in.

De bestaande canonieke offline CSV-converter en
`parseOfflinePriceSnapshots` beoordelen eerst het complete
vervangende bestand en de hele samengevoegde bron. Twee winkels in
een vervangbestand, een andere winkel, een ontbrekende SKU-context
of een groter/ongeldig bestand worden geweigerd; bestaande originele
bron en checks blijven dan onaangetast. Na expliciete bevestiging
wordt uitsluitend de gekozen winkelopname vervangen, inclusief zijn
echte bronmoment, prijswaarden en originele onbekende `null`-prijzen.
De oorspronkelijke opname van de andere winkel (ook zijn `null`
en tijdzone) wordt **zonder reconstructie van geldbedragen** behouden.

Alle expliciete SKU-keuzes, zoektermen, menselijke productcontroles
en winkel-afvinkingen van de **vervangen** winkel vervallen. De andere
winkel behoudt zijn eigen controlekeuzes, zolang diens oorspronkelijke
fysieke vraag niet verandert. Een nieuwe vergelijking kan alleen
na onafhankelijke persoonlijke review van nieuwe artikelen en
bestaande versheids- en volledige-mandgates. Geen scrapers,
winkelrechten of prijzen worden toegevoegd of gepromoot.

### Afdrukbaar privéoverzicht voor twee echte winkelbronopnames

Het bestaande uitvoerbestand van [product-PR #3916](https://github.com/Zennay/Supa/pull/3916)
is nu ook verbonden met de gewone **Vergelijk**-tab. Zodra de eigen
PLUS- én DekaMarkt-opname aanwezig zijn en beide basketvormen kunnen
worden gemaakt, verschijnt **Download afdrukbaar privéoverzicht
(HTML)**. In dit offline document staan dezelfde geselecteerde
fysieke Planner-ingrediënten, originele bronmomenten, beide
aangeleverde winkelproducten, gehele verpakkingen, eenheidsprijzen
en de afzonderlijk berekende bedragen naast elkaar.

Een **totaalverschil of winnaar** wordt alleen getoond wanneer de
bestaande complete mand-, verse bron-, minder-dan-24-uur-paring en
expliciete menselijke bronreviewgates samen zijn voldaan. Op het
moment van downloaden worden de actuele tijd/bronmomenten en
compleetheid opnieuw nagekeken: een inmiddels verlopen opname
wordt geen nieuwe winstclaim. Bij ontbrekende of verlopen bronnen
blijft het printbare bestand informatief zonder vergelijkbaar
prijsverschil. Geen extern script, afbeelding, analytics of
retailerverbinding; een strikte offline HTML Content Security Policy
en veilige tekstescaping gelden. De al bestaande CSV-download
blijft ongewijzigd, er is daarom geen tweede CSV-knop toegevoegd.

### Waarom matcht dit artikel? Vergelijk echte verpakkingen en eenheidsprijzen

Bij de lokale productkeuze in de gewone Vergelijk-tab staan naast
de **originele naam en productcode** nu de daadwerkelijk ingevoerde
multipack-inhoud, totale pakprijs én een indicatieve eenheidsprijs
(per kg, liter of stuk). Die weergave hergebruikt de bestaande
`privatePackUnitRate` van de afdrukbare product-PR; geen aparte
prijsformule, aangenomen korting of winkelcatalogus.

Bij iedere berekende of afgewezen ingredientmatch laat
**Waarom is dit artikel voorgesteld/nog niet gekoppeld?** de bestaande
canonieke matchingredenen in begrijpelijk Nederlands zien:
zoekwoorden, fysieke verpakking/overschot, multipacks, te veel
gelijkwaardige kandidaten, ontbrekende inhoud of onbekende prijs.
Een interne zoekscoresom is uitsluitend een zoekrangschikking,
**geen** geverifieerde gelijkheid, betrouwbaarheid in procenten of
recht op een prijs- of besparingsclaim. De gebruiker bevestigt
nog steeds ieder oorspronkelijk bronartikel en zijn werkelijk
waargenomen verpakking en prijs afzonderlijk.

### Doorloop ontbrekende bronnen en matches rechtstreeks in Vergelijk

Bestaande productbron uit [PR #3916](https://github.com/Zennay/Supa/pull/3916)
is aangesloten op de gewone Vergelijk-tab zodra twee echte
eigen winkelopnames beschikbaar zijn. Het interactieve
**Maak je winkelvergelijking compleet**-overzicht noemt beide
originele tijdstippen en de waarnemingsleeftijd, en wijst aan
welke opname ouder dan zeven dagen, in de toekomst of meer dan
24 uur verwijderd van de andere is. Knoppen springen naar de
echte bronimport of de concrete ontbrekende Planner-SKU-regel.
Niet alleen onvolledige automatische matches maar ook nog
niet persoonlijk bevestigde originele prijzen verschijnen
als uit te voeren productcontrole met een directe link naar
de eerste onafgevinkte bronregel.

Bij één winkel blijft de bestaande één-winkel-hulp zichtbaar;
bij twee winkels vervangt dit overzicht de generieke dubbele
meldingen. Dit is uitsluitend een begeleide UI bij al
geïmporteerde eigen brondata, geen crawler, waarneming of
winkelrechtenverificatie. De bestaande volledige
bron-/review-/fysieke-mandvoorwaarden blijven vereist voor
een echte rekenkundige privévergelijking.

### Bekijk de bronverschillen voordat één winkel wordt vervangen

De op [PR #3916](https://github.com/Zennay/Supa/pull/3916)
bestaande vervangpreview is nu gekoppeld aan de gewone Supa-tab.
Na een nieuwe eigen CSV/JSON-opname blijft de reeds geaccepteerde
winkelvergelijking **onveranderd** totdat je vanuit het previewpaneel
zelf op **Bevestig en vervang alleen [winkel]** klikt. Het paneel
toont de twee werkelijk aangeleverde opnamemomenten, oorspronkelijke
en nieuwe aantallen, per originele product-ID toegevoegde, verdwenen
of gewijzigde bronregels, plus maximaal acht daadwerkelijke
wijzigingen in prijs en beschikbaarheid. Onbekende oorspronkelijke
prijzen blijven in dit overzicht **onbekend**, nooit EUR 0.

**Annuleer** behoudt beide bronnen en alle vinkjes. Het daadwerkelijke
bevestigingsmoment controleert opnieuw de beide bestanden en hun
originele bronmomenten; de vervanging wordt geweigerd wanneer er
intussen een andere import of te oude/ongeldige bron tussenkwam.
Uitsluitend het aangewezen winkelgedeelte verliest zijn menselijke
SKU-review, lokale productkeuzes en boodschappenafvinkingen. De
andere winkel wordt niet opnieuw uit een genormaliseerde
nulprijsprojectie opgebouwd. Dit is een preview van eigen lokale
bronverschillen, geen extern gevalideerde retailer-prijsmutatie.

### Ongeldige nieuwe bestandsimport mag je bestaande vergelijking niet wissen

Zowel de gewone **één-bestandsimport** (eigen PLUS, Deka of gecombineerd
bestand) als het **gelijktijdig openen van twee aparte winkelbestanden**
lezen en valideren hun brondata nu volledig in tijdelijke lokale waarden.
Pas na een succesvolle canonieke CSV-omzetting, per-winkel- en
combinatiecontrole, formaat-/limietcontrole en tijdcontrole worden
de nieuwe brondata tegelijk in de Vergelijk-tab toegelaten. Dan zijn
nieuwe oorspronkelijke productmatches altijd opnieuw te beoordelen
en verliezen alle oude winkelchecks hun oude bronbetekenis.

Een ongeldige, dubbele, verkeerde of oversize winkelopname **wist
niet meer** de vorige geaccepteerde bron, de oorspronkelijke
nul-/onbekende-prijssemantiek, de zorgvuldig bevestigde
productkeuzes of de boodschappenafvinkingen. De foutmelding
vermeldt dat de vorige lokale gegevens zijn behouden. Ook de
al bestaande actie om een tweede winkel bij één bron te voegen
blijft behoudend; het gerichte **vervang één winkel**-scherm
biedt daarnaast zijn expliciete bronverschillenpreview.
Bewust handmatig wijzigen van de eigen JSON-tekst blijft een
nieuwe inhoudelijke invoer: de oude berekening wordt dan
zoals voorheen direct ingetrokken. Geen retailerrechten
of zelfstandige prijswaarneming worden hiermee toegekend.

### Geen verlopen prijsverschil bij het downloaden

De gewone app ververst zijn leesbare scherm periodiek, maar een
gebruiker kan precies aan het eind van die minuut downloaden
terwijl een waarneming net ouder dan zeven dagen werd.
De **volledige privévergelijking (CSV)**, het **leesbare
prijsverschil (TXT)** en het **afdrukbare privéoverzicht (HTML)**
gebruiken nu alle drie één gedeelde, actuele controle **op het
moment van klikken**: beide originele nanoseconde-bronmomenten
moeten binnen zeven dagen van de werkelijke apparaatklok
vallen, maximaal vijf minuten vooruit liggen, onderling
binnen 24 uur vallen én dezelfde volledige fysiek vergeleken
en afzonderlijk bevestigde winkelmandjes opleveren.

Als de browser-UI nog een oud verschil toont op basis van
de laatste minuutverversing, kan dat verschil niet als
actueel CSV/TXT worden gedownload. Het offline HTML-overzicht
kan nog steeds als **onvolledig/onactueel** werkdocument
worden bewaard, maar laat dan geen winnaar of totaaldelta
zien. Er wordt niets uit externe retailercatalogi aangevuld.

### Eén download met uitsluitend nog open winkelcontroles

Naast het volledige twee-winkeldekkingsoverzicht biedt Vergelijk
nu **Download uitsluitend open controles (TXT)**. Die lokale
lijst laat alle reeds persoonlijk bevestigde én actuele
fysieke ingrediëntregels weg. Behouden blijven de regels
waarvoor PLUS of DekaMarkt ontbreekt, de oorspronkelijke SKU
niet past, de eigen opname te oud of toekomstig is, of de
artikelidentiteit/verpakking/prijs nog niet expliciet is
bevestigd. De bestaande volledige dekking blijft daarnaast
apart downloadbaar voor eigen administratie.

De winkelopnametijden worden ook op **downloadmoment** opnieuw
beoordeeld; een intussen verlopen bron kan niet ongemerkt
als volledig bevestigd in de veldlijst verschijnen. Liggen
beide individuele winkelopnames meer dan 24 uur uiteen,
dan wordt het oudere bronmoment in de open lijst aangewezen
als opnieuw te observeren, zelfs als alle artikelen eerder
persoonlijk waren bevestigd. Er worden nooit prijzen of
nieuwe winkelproducten in het werkblad gefabriceerd.
De lijst blijft een privé werkinstructie, geen bewijs
voor daadwerkelijke veldvalidatie of retailerrechten.

### Eén winkel opnieuw opnemen vanuit de gewone invoer

De knop **Hergebruik mijn gecontroleerde bronartikelen (zonder prijzen)**
in het gewone handmatige invulscherm verschijnt uitsluitend als er al
persoonlijk gecontroleerde bronregels zijn. Pas na toestemming neemt hij
alleen de oorspronkelijke artikelcode, naam, fysieke pakinhoud,
eenheid en multipack over in een **nieuw concept**. De oude prijs,
beschikbaarheid en opnametijd worden nooit overgenomen: vul de nieuwe
werkelijk geobserveerde feiten en de tijd zelf in.

Bij één nieuwe winkel blijft een eerdere opname van de andere winkel
behouden, inclusief haar ongewijzigde productbeoordelingen en afvinkingen.
Is die winkel al ingelezen, dan toont Supa eerst het verschil tussen
oude en nieuwe oorspronkelijke bron en vraagt een aparte expliciete
vervangingsbevestiging. Ook een wijziging in het handmatige concept is
nog geen nieuwe winkelopname en trekt een oudere, afzonderlijk
geaccepteerde opname niet stilzwijgend in. Een volledige twee-winkel-
vervanging vraagt vooraf toestemming. Ongeldige invoer vervangt niets.

Als een bronartikel voor één winkel verandert, worden alleen de
beoordelingen en afvinkingen van die betreffende winkel ingetrokken.
De andere winkel blijft bruikbaar. Iedere nieuwe prijs moet opnieuw
met de oorspronkelijke, zelf verkregen bron worden bevestigd; ook
daarna geldt de bestaande zeven-dagen- en 24-uursvergelijkingsgrens.
Geen prijs, retailertoestemming of onafhankelijk veldbewijs afgeleid.

### Optioneel herstelpunt in de huidige browsertab

De gewone Vergelijk-tab heeft naast de downloadbare privésessie een
expliciet **Bewaar privéherstelpunt voor deze browsertab**. Alleen een
bewuste klik schrijft de bestaande beperkte en gevalideerde
private-basket-session-v1 (eigen originele bronopnames, dezelfde
fysieke Planner-vraag en bewust gekozen SKU-codes) in sessionStorage.
Er vindt geen serverupload of automatisch bewaren van prijsdata plaats.
Een ouder herstelpunt kan alleen na expliciete toestemming worden
vervangen.

Na herladen opent **Herstel privéherstelpunt na herladen**
opnieuw de canonieke privésessie-import voor het **huidige weekmenu**,
met dezelfde 256kB- en bronmomentcontrole. Vóór vervanging moet je weer
bevestigen. Alle oude productreviews, prijsgoedkeuringen en
boodschappenafvinkingen beginnen bewust leeg; noch een brontijd noch
een eerdere winkelmatch wordt zelfstandig opnieuw geverifieerd.
**Wis privéherstelpunt** verwijdert het opgeslagen bestand uit de
huidige tab, los van de nog open vergelijking. Gebruik JSON-download
om een herstelpunt langer dan de browsersessie zelf te bewaren.

### Per ingrediënt de goedkoopste eigen winkel kiezen

Na twee volledig geprijsde en persoonlijk gecontroleerde winkelmandjes
toont de Vergelijk-tab ook Mijn voordeligste route. Hiervoor wordt
de bestaande basketComparison gebruikt om af te dwingen dat beide
winkels exact dezelfde fysieke Planner-vraag, geldige hele verpakkingen
en consistente centbedragen vergelijken. Per ingrediënt wordt de winkel
met het kleinste benodigde regelbedrag gekozen; bij gelijk bedrag
wordt PLUS gekozen. De interface toont het gecombineerde bedrag naast
de twee volledige winkelbedragen, en de puur rekenkundige mogelijke
aanvullende besparing ten opzichte van de goedkoopste enkele winkel.

De route bevat per winkel aparte bronartikelcodes, productnamen,
benodigde hele verpakkingen, eenheidsprijzen, afvinkbare boodschappen
en een lokale kopieerbare/downloadbare TXT-lijst. Vinkjes worden niet
automatisch bewaard. Bij elke TXT-download worden de bestaande
bronleeftijd, onderlinge tijdcontext en oorspronkelijke persoonlijke
productreviews opnieuw gecontroleerd. Ontbrekende of verlopen prijzen
zijn geen nulprijs en geven dus geen gecombineerde route.
Reiskosten, tijd en actievoorwaarden zijn niet in de bedragen
meegenomen; de uitkomst is geen garantie of openbare besparingsclaim.

#### Eigen extra kosten voor een tweede winkel

Als het berekende goedkoopste artikelmandje daadwerkelijk artikelen
uit twee winkels bevat, kun je de **extra** kosten van die tweede stop
zelf invullen (nul tot duizend euro, maximaal twee decimalen).
Supa toont dan het gecombineerde bedrag inclusief die persoonlijke
extra kosten naast de goedkoopste volledige enkele winkel. Als de
extra omrij-/parkeerkosten het theoretische verschil overschrijden,
zegt de app uitdrukkelijk dat één winkel goedkoper uitkomt. Zonder
ingevuld bedrag claimt Supa geen netto besparing. Dit extra bedrag
komt uitsluitend van de gebruiker, nooit uit een verzonnen prijsbron,
en verschijnt desgewenst in de lokale TXT-download.

#### De route verandert mee met je werkelijke extra kosten

De lijst heeft drie expliciete keuzes: automatisch, de goedkoopste
producten per winkel of alle artikelen bij de goedkoopste volledige
winkel. In automatische modus blijft het gemengde mandje zichtbaar
zolang extra kosten onbekend zijn of onder het berekende maximale
verschil blijven. Zodra de door de gebruiker ingevoerde extra
bezoekkosten gelijk of hoger zijn dan dat verschil, schakelt de
lijst over naar de goedkoopste **volledige** winkel. Ook de per-winkel
artikelen, totale bedragen, vinkjesweergave en TXT-export volgen de
werkelijk geselecteerde route; niet een oude gemengde winkelroute.
Expliciet een andere strategie kiezen blijft mogelijk. Er is nooit
een fictieve schatting voor omrijden of parkeren.

#### Persoonlijke winkelkeuze per ingrediënt

In de uitgeklapte winkelroute kun je voor elk fysiek identiek
ingrediënt kiezen tussen de bevestigde PLUS- en DekaMarkt-verpakking,
of de standaard goedkoopste regel behouden. Beide keuzemogelijkheden
vertonen het *hele-verpakkingenbedrag*, met originele bronproductnaam.
De geselecteerde route wordt geheel opnieuw berekend via de al
bestaande canonieke basketvergelijking; er wordt geen nieuwe prijs of
winkel-SKU geconstrueerd. In automatische modus schakelt Supa terug
naar de goedkoopste volledige winkel wanneer handmatige voorkeuren
de gemengde route duurder maken. Expliciet een gemengde route kiezen
blijft mogelijk als de gebruiker zelf een bepaald artikel wil.
Alle keuzes en vinkjes zijn tijdelijk lokaal in de open app en de
TXT-export volgt de daadwerkelijk gekozen winkels.

#### Mobiel leesbare route

De nieuwe route gebruikt op kleine schermen één kolom voor de drie
bedragkaarten en de twee winkellijsten. Keuzemenu's, checkboxes en
exportknoppen zijn op aanraakschermen te bedienen; lange originele
bronnamen blijven binnen de kaarten en kunnen niet meer horizontaal
buiten het scherm vallen. De afzonderlijke winkelafdelingen blijven
duidelijk te onderscheiden en het volledige tekstoverzicht is lokaal
te selecteren.

#### Extra ritten na handmatige winkelvoorkeuren

Een handmatige winkelvoorkeur kan een tweede winkel introduceren zelfs
als de puur goedkoopste artikelen in één winkel verkrijgbaar zijn.
Daarom baseert Supa het tonen van het extra-kostenveld op de werkelijk
gekozen én de goedkoopste theoretische route, en berekent het
twee-winkelbedrag uit de handmatig gekozen route. De maximale
theoretische voordelige ruimte zonder voorkeuren blijft afzonderlijk
herkenbaar; er worden nooit niet-gekozen productprijzen als jouw
persoonlijke route uitgegeven.

#### Behoud je gecombineerde boodschappenroute (lokaal JSON)

De samengestelde route kan nu apart als lokale JSON worden bewaard:
geselecteerde winkelstrategie, expliciete artikelvoorkeuren, optionele
eigen omrijkosten en aangekruiste artikelen. Via **Herstel mijn
winkelroute** wordt het bestand uitsluitend op jouw apparaat geopend.
Een strikt geverifieerde exacte vingerafdruk omvat de beide originele
bronmomenten, winkelidentiteiten, geselecteerde maaltijden,
fysieke ingrediënten, originele artikelcodes, pakinhouden én
pakprijzen. Ook de gekozen winkelroute zelf moet identiek zijn.
Nieuwe of afwijkende opnames weigeren het herstel en laten de huidige
lijst staan; anders vraagt Supa eerst expliciete vervangingstoestemming.

Het bestand maakt géén nieuwe winkelprijs, bronrechten, artikelmatch
of productgoedkeuring. Je moet de huidige originele productmatches
nog altijd individueel bevestigen voordat de route of het herstel
beschikbaar komt. Oude winkelvoorkeuren van verdwenen
Planner-ingrediënten worden bij het bewaren genegeerd. Er is geen
automatische cloud- of achtergrondsynchronisatie.

#### Originele winkelartikelen met eenheidsprijzen naast elkaar

Binnen de gekozen route kun je per fysiek identiek ingrediënt nu PLUS
en DekaMarkt direct naast elkaar bekijken. Elke winkelkolom toont het
oorspronkelijke product en de broncode, de complete pakinhoud,
de eigen prijs per pak, de indicatieve prijs per kilogram/liter/stuk
en het bedrag voor alle benodigde hele verpakkingen. Het gekozen
product is duidelijk gemarkeerd. Supa vermeldt hoeveel het andere
winkelartikel voor exact diezelfde weekvraag duurder of goedkoper is.

Eenheidsprijzen zijn uitleghulp uit de al bestaande
privateUnitPrice-berekening: uitsluitend de werkelijk benodigde hele
verpakkingen bepalen de goedkoopste route. Geen ongeprijsd artikel,
fictieve hoeveelheidsmatch of onafhankelijke marktclaim toegevoegd.

#### CSV van de werkelijk gekozen winkelroute

De nieuwe knop voor een **gekozen-route-CSV** exporteert één overzicht
met hetzelfde fysieke ingrediënt, de zelf gekozen winkel en originele
bron-SKU, het benodigde aantal hele pakken, plus telkens beide
gecontroleerde winkelproducten, hun pakprijs en indicatieve
eenheidsprijs. Het per-ingrediënt verschil DekaMarkt minus PLUS en de
lokale afvinkstatus blijven apart zichtbaar. Er wordt alleen
geëxporteerd na een nieuwe klikcontrole van de bestaande
persoonlijke review en tijdvensters. De route en beide fysieke
bronmandjes worden opnieuw rekenkundig vergeleken voordat bedragen
het bestand ingaan. De cellen gebruiken exact dezelfde conservatieve
formule-injectie-afscherming als de bestaande private twee-winkel-CSV.
Deze export is uitsluitend een privéoverzicht, geen opnieuw
te importeren prijsbron, geen retailerrecht en geen live besparingsclaim.

Wanneer voor de daadwerkelijk gekozen gecombineerde route extra
tweede-bezoekkosten zijn opgegeven, bevat dezelfde CSV een afzonderlijke
rij voor die kosten en een finale rij met het door de gebruiker
berekende totaal inclusief die kosten. Onbekende extra bezoekkosten
blijven een lege cel, nooit impliciet nul. Een een-winkelroute heeft
geen extra tweede winkelbezoek. De expliciet geselecteerde
automatische, gemengde of een-winkelstrategie wordt eveneens vermeld.

#### Papier / lokaal afdrukbare route

De daadwerkelijk gekozen route (ook handmatige winkelvoorkeuren,
per-winkel afvinkstatus en optionele extra tweede-stopkosten) kan nu
als statisch HTML-document worden opgeslagen om in de browser te
printen. Beide eigen winkelopnametijden staan boven de twee
boodschappenafdelingen. Het document heeft geen scripts, netwerk-
resources of interactieve gegevensinvoer en ontsmet alle dynamische
teksten voordat zij in HTML terechtkomen. Het hergebruikt voor elke
afdruk exact dezelfde fysieke vergelijking en gekozene-route
integriteitscheck als de nieuwe CSV-uitvoer. Een verouderde bron
of onvolledige persoonlijke productreview krijgt nooit een
vergelijkbaar printdocument via deze actie.

#### Sneller laden vóór een volledige winkelopname

De omvangrijkere persoonlijke twee-winkel-boodschappenroute,
waaronder de optionele spreadsheet-, offline HTML- en JSON-backups,
wordt nu pas via een afzonderlijke clientbundle geladen als beide
eigen winkelmandjes werkelijk volledig en persoonlijk gecontroleerd
zijn. Zolang de gebruiker nog bronnen importeert, producten matcht
of zijn week plant, hoeft de browser deze export-/routecode niet
mee te downloaden of uit te voeren. De bestaande bronimport,
matching- en individuele tijd-/reviewgates zijn niet versoepeld.
De productiebuild levert nu een aparte checkoutbundle van circa
28 kB naast de gewone appbundle; de gewone appbundel is circa
26 kB kleiner dan vóór de splitsing (ongecomprimeerd).

## Nieuw weekmenu: direct een leeg CSV-prijsinvulblad downloaden

In **Vergelijk → Gebruik ditzelfde weekmenu met jouw eigen winkelbronbestanden** kun je
**Download leeg prijsinvulblad (CSV)** kiezen. Kies eerst **beide winkels**, **alleen PLUS** of **alleen DekaMarkt**. Supa neemt alleen de
*fysieke ingrediëntenbehoefte* van de geselecteerde Planner-dagen mee. Er wordt
geen winkel-SKU, productnaam, oude prijs, tijdstempel, beschikbaarheid of
retailerautorisatie aangemaakt. Het CSV-bestand heeft precies de bestaande
negen verplichte kolomkoppen. Het is expliciet een **leeg werkblad, geen brondata**.

Per ingrediënt is er één regel per gekozen winkel. Het gecombineerde werkblad
heeft eerst alle PLUS-regels en dan alle DekaMarkt-regels; een enkelwinkelblad
heeft alleen de rijen van die winkel. Je kunt na een echte PLUS-waarneming
later apart DekaMarkt invullen en toevoegen, zonder vooraf een tweede bron te
verzinnen. De
uitklapbare hulp onder de knop toont de precieze spreadsheet-rijnummers en de
gevraagde hoeveelheid. Met **Download bijhorende opnamegids (TXT)** krijg je
precies die rijnummers en hoeveelheden op papier of in een offline notitie,
passend bij de gekozen een- of tweewinkel-CSV. De gids bevat zelf geen
winkelproducten, prijzen of bewijs. Met **Download printbaar opnameformulier
(HTML)** krijg je voor dezelfde keuze een geheel offline, zelf af te drukken
winkelblad met lege schrijfvelden voor de originele productcode, naam,
verpakking, prijs, beschikbaarheid en de echte broncontext. Het formulier
draait geen scripts of netwerkverzoeken en verandert geen enkele bronopname;
na de winkeltrip zet je zelf alleen de geobserveerde feiten in het CSV-bestand. De eenheid is hooguit een bewerkbare hint; neem de
werkelijke inhoud van de aangeboden verpakking over. Vul per werkelijk gevonden
winkelproduct de originele `id`, `name`, `packAmount`, `packUnit`, `packCount`,
`priceCents` in hele centen, `observedAt` met echte tijdzone en `available` als
`true` of `false` in. Iedere ingevulde regel van dezelfde winkel moet dezelfde
echte opnametijd hebben. Gebruik alleen bronnen die je rechtmatig mag verwerken.

**Laat ontbrekende productregels helemaal leeg** (behalve hun al ingevulde
winkelnaam, eventuele eenheidshint en `available=false`). De canonieke CSV-import
slaat uitsluitend deze volledig lege bronrecords over; een half ingevuld artikel
wordt geweigerd. Als maar één winkel werkelijk is ingevuld, kun je alleen diens
gegevens importeren; een niet ingevulde tweede winkel wordt nooit gesimuleerd.
Geen enkele waarneming betekent geen geprijsd mandje. Voor een prijsverschil
blijven de bestaande 7-dagen-/24-uursgrenzen, daadwerkelijke bronproducten,
volledige fysieke dekking en menselijke bevestiging vereist.

## Herstel alleen ontbrekende winkelproducten zonder oud bronbewijs te vervalsen

Wanneer een eigen PLUS/Deka-opname is geladen toont de gewone Vergelijk-tab nu per winkel hoeveel **nieuwe of hernieuwde bronregels** nodig zijn. Naast de bestaande volledige Planner-invulbladen zijn er korte, **helemaal lege** CSV's met bijpassende TXT-regelnummergidsen voor ontbrekende, niet-koppelbare of verlopen bronproducten. Een bestaande SKU die enkel nog menselijke bevestiging nodig heeft, wordt niet automatisch een nieuw prijsverzoek. De bronvelden bevatten géén oude productcode, oude europrijs, oude beschikbaarheid of automatisch tijdstip; bronmomenten worden bij het downloaden opnieuw op leeftijd beoordeeld. Een ouder bronmoment bij een >24-uur winkelpaar betekent dat de betrokken winkel volledig opnieuw moet worden opgenomen.

**Nieuwe aanvulroute op de winkelkaart:** voor werkelijk nieuwe artikelnummers bij **exact hetzelfde oorspronkelijke winkelopnamemoment** kun je een eigen CSV/JSON met één winkel selecteren en na een expliciete bevestiging alleen nieuwe bronartikelen toevoegen. De bestaande `parseOfflinePriceSnapshots` valideert beide originele bestanden en de samengevoegde opname, inclusief maximaal 256 kB, originele SKU-uniciteit, fysieke verpakking en prijs, 7-dagenvenster en bestaande rechten-/actualiteitsgrenzen. De originele bronartikelen, tijdstempel, andere winkel en hun prijsbedragen blijven ongewijzigd. Duplicate bestaande broncodes worden geweigerd: correcties horen in **Vervang winkelopname**. Een ander (ook recenter) bronmoment wordt geweigerd: oude prijzen mogen niet stil naar een nieuwe observatie worden verplaatst. Dit vereist een volledige, nieuwe opname van die winkel, niet een prijsclaim van gemengde bronnen.

Een ongeldig of afgewezen aanvulbestand verandert helemaal niets aan al geladen brongegevens, productkeuzes of afvinkingen. Nieuw toegevoegde SKU's vereisen nog steeds de bestaande persoonlijke match-/pak-/prijsbeoordeling. Historische adapterdata blijven niet-publiceerbare research en worden niet via deze route als huidige winkelopname gepresenteerd. Geen actieve retailerscraper, fictieve prijs of onderzoeksmijlpaal geïntroduceerd.

## Start vanuit Home — eigen echte winkelprijzen

Op **Home → Vergelijk dezelfde boodschappen** zie je per winkel of er al
een volledig gecontroleerd eigen mandje beschikbaar is. Staat een opname
gedeeltelijk open, gebruik dan **Controleer volgend bronartikel** om direct
naar de bestaande originele SKU-, verpakking- en prijscontrole te gaan.

Met **Eigen PLUS/Deka-prijsbestanden meteen openen** kies je 1 of 2 lokale
CSV-, TSV-, TXT- of Supa JSON-bronnen van maximaal 256 kB per bestand.
Deze worden naar dezelfde canonieke privé-importer doorgestuurd als via
Lijst of Vergelijk: geen tweede parser, geen automatische fetch en geen
stilzwijgende vervanging van bestaande gegevens. Als er meer dan twee
bestanden gekozen zijn, of een bestand leeg/te groot is, blijft de selectie
geweigerd. Na geldige import blijven bronmomenten en oorspronkelijke
SKU-/verpakkingseenheden behouden.

Home toont een verschil in euro's uitsluitend wanneer **beide** fysieke
weekmandjes volledig persoonlijk bevestigd, canoniek consistent en actueel
zijn, en de PLUS- en DekaMarkt-bronmomenten maximaal 24 uur uiteenliggen.
Anders staat er expliciet **Volledig prijsverschil nog onbekend**.
Een bekende eigen bronprijs is nooit gelijk aan een publiek geverifieerde
winkelprijs of onafhankelijk bewezen besparing. Verouderde bronnen worden
niet automatisch ververst en er worden geen bronrechten afgeleid.

## Volledige en gedeeltelijke winkelvergelijkingen meenemen (Home)

Op **Home → Vergelijk dezelfde boodschappen** gebruikt Supa uitsluitend de lokaal geïmporteerde, daadwerkelijk bevestigde PLUS/DekaMarkt-bronopnames en de oorspronkelijke fysieke weekvraag. Zodra **beide volledige mandjes** tegelijk actueel en veilig vergelijkbaar zijn, verschijnen **Kopieer mijn volledige winkelvergelijking** en **Deel mijn privévergelijking (mobiel)**. De tekst komt uit exact dezelfde bestaande mandvergelijkings- en TXT-exportfunctie: originele bronmomenten, SKU’s, hele-pakprijzen, eenheidsprijzen en regelverschillen, inclusief duidelijke privébron-/geen-kassagarantie-vermelding. De Web Share-functie gebruikt uitsluitend een expliciete gebruikerstik; ontbrekende klembordrechten tonen een handmatig selecteerbare versie.

Als **alleen afzonderlijke ingrediënten** al gepaard en geprijsd zijn, verschijnen in plaats daarvan **Kopieer bekende PLUS/Deka-regelprijzen voor Excel** en **Deel alleen bekende winkelregels (mobiel)**. Deze acties gebruiken exact de bestaande gedeeltelijke CSV-export. Zij tonen nooit een onvolledig mandtotaal of winkelwinnaar. Verlopen prijzen, ontbrekende SKU’s en niet-gecontroleerde bronregels verschijnen niet in een nieuw kostenbedrag. De handmatig selecteerbare deeltekst is gebonden aan de actuele week, bronopname en reviewstatus; bij wijziging verdwijnt een oude kopie.

Het delen en kopiëren gebeurt uitsluitend na een gebruikersactie. Een gekozen externe app kan dan de eigen brongegevens in de tekst ontvangen: Supa uploadt deze niet zelfstandig. De oorspronkelijke PLUS/Deka-bronrechten, onafhankelijke veldvalidatie, kassaprijzen en publicatie van besparingsclaims worden hierdoor **niet** vastgesteld of versoepeld.

## Op pad met je telefoon: nog ontbrekende PLUS/Deka-velden

Open **Planner → Vul zelf originele winkelproducten op je telefoon in**. De
rijnummers en metrische hoeveelheden komen uitsluitend uit de gekozen
Planner-vraag, niet uit de supermarkt. Kies **Alleen nog niet waargenomen of
onvolledige invoerregels tonen** om de nog open punten te zien. Onder iedere
winkel staan een actuele telling, **Kopieer**, **Download TXT** en **Deel via
mijn telefoon**. De tekst noemt het oorspronkelijke Planner-rij-/artikel en de
concrete ontbrekende velden; hij is géén artikelmatch, actueel prijsbewijs of
volledig winkelmandje. Wanneer OS-delen of klembord niet beschikbaar is, blijft
de tekst in een selecteerbaar lokaal veld staan. Er is geen automatische
retailerrequest of upload.

Geobserveerde originele SKU, productnaam, verpakking, aantal, hele-pakprijs
in **eurocenten** en werkelijk ISO-bronmoment met tijdzone vul je zelf in.
Een eerdere waarneming expliciet terugzetten naar **Niet waargenomen** wist
na bevestiging de gekoppelde oude brongegevens en prijs. **Niet beschikbaar**
wist de oude pakprijs en inhoud; de werkelijk geziene artikelidentiteit mag
blijven staan. Onveilige oude JSON-concepten waarin niet-waargenomen of
niet-beschikbare regels toch verborgen prijzen hebben, worden geweigerd bij
herstel. Ongeldige of dubbel gebruikte SKU's, numerieke velden en tijdzones
worden als nog te controleren gemarkeerd; alleen voldoende ingevulde
geselecteerde waarnemingen kunnen naar de bestaande originele negenkoloms
CSV/TSV-broncontrole. Een onvolledig of verlopen winkelmandje blijft
**prijsverschil onbekend** tot beide echte bronsets afzonderlijk zijn beoordeeld.

## Vrijwillig tijdelijk hervatten na pagina verversen

Het telefoonformulier heeft nu drie expliciete acties: **Schakel tijdelijk
bewaren in dit tabblad in**, **Hervat tijdelijk concept in dit tabblad** en
**Wis tijdelijke tabopslag**. Standaard staat automatisch bewaren **uit**.
Pas na inschakelen schrijft de browser de huidige originele conceptgegevens
naar **sessionStorage** van dit tabblad, zonder HTTP, cookies, sync of server.
Als je na het verversen terugkomt, kies je zelf *Hervat*; er wordt niets
automatisch als retailerbron geopend of als prijs goedgekeurd. Een hersteld
concept moet nog de bestaande originele broncontrole doorlopen.

De aparte tijdelijke opslag is gebonden aan exact dezelfde week, fysieke
Planner-vraag en winkelkeuze als het bestaande, streng gevalideerde JSON-
concept. Concepten ouder dan twaalf uur of met afwijkende tijd-/bestands-
integriteit worden geweigerd; verlopen of corrupte exemplaren worden bij
een herstelpoging verwijderd. Bij bewust stoppen wordt de laatste invoer nog
eenmaal in dit tabblad bewaard, en via *Wis* wordt hij bewust gewist. Begin
je een nieuw opnameformulier, dan wordt de automatische opslag uitgezet om
een vorige week niet stilzwijgend te overschrijven.

Dit is een **privé gemaksfunctie**, geen duurzame of versleutelde externe
back-up. De browser kan sessieopslag wissen; op gedeelde apparaten kunnen
andere personen met toegang tot hetzelfde tabblad de inhoud zien. Download
voor bewaardoeleinden expliciet een **eigen JSON-concept**. Een prijs blijft
onbekend totdat een werkelijk waargenomen bronbestand afzonderlijk lokaal is
gecontroleerd en de match is geaccepteerd; supermarktbronrechten zijn niet
automatisch aanwezig.
