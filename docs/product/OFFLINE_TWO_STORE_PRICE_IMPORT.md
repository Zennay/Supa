# Supa · prijsdata van twee winkels lokaal in je weekmenu laden

**Beschikbaar in de bestaande navigatie: Vergelijk → Vergelijk twee winkels met eigen prijsdata.**
De import gebruikt de bestaande ingredientenaggregatie, productmatching, gehele-verpakking-berekening en mandjesvergelijking. Er wordt geen live supermarkt geraadpleegd.

## Zonder bestand: rechtstreeks twee winkels invullen

1. Plan je echte maaltijden in **Planner**. Ga naar **Vergelijk** → **Geen JSON? Vul de winkels hier in**.
2. Klik op **Open invulscherm**. SUPA toont per winkel dezelfde benodigde ingrediënten en hoeveelheden uit de actuele weekplanner.
3. Vul voor iedere winkel **zelf** de werkelijk waargenomen datum/tijd in. Geef per bekend product de naam op verpakking of bon, inhoud, eenheid (g/kg/ml/l/stuk), multipack en de werkelijk waargenomen prijs per verpakking in euro's op. Vink **Beschikbaar en prijs zelf gecontroleerd** alleen aan als dit daadwerkelijk waar is.
4. Lege productregels blijven onbekend. Onbekende of niet-beschikbare artikelen krijgen geen berekende winkelprijs; ontbrekende stukken voorkomen een volledig totaal. Onjuist ingevulde prijzen of verpakkingen worden afgewezen met een fout bij het betreffende ingrediënt.
5. Klik op **Bereken met mijn ingevoerde prijzen**. Dit gebruikt dezelfde conservatieve productmatching, mandberekening en versheidsgates als de bestaande JSON-import. Na een wijziging moet je opnieuw berekenen.
6. Wil je tijdens het invullen naar een ander Supa-scherm kunnen navigeren? Schakel expliciet **Onvoltooide invoer bewaren in deze browsertab** in. Alleen dan wordt het concept in de sessieopslag van de *huidige tab* gezet. Bij terugkeer naar dezelfde week wordt het lokaal hersteld; een concept voor een ander weekmenu of een onbekende nieuwere opslagversie wordt niet overschreven. Je kunt het bewaren met **Stop automatisch bewaren en wis concept** uitschakelen. Concepten vervallen doorgaans bij het sluiten van de browsesessie, afhankelijk van de browser. Zonder deze optie wordt niets automatisch opgeslagen.
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
