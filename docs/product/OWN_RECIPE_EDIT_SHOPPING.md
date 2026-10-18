# Eigen recepten bewerken en direct een boodschappenlijst maken

Dit is een **lokale privéfunctie** van de Supa-tab **Recepten**. Er is geen supermarktprijs, product-ID, winkeltoestemming of actuele voorraad nodig.

## Recept bewaren, corrigeren of als variant opslaan

1. Ga naar **Recepten** en voeg handmatig een eigen recept toe, importeer de oorspronkelijke bron via link of plak lokaal rechtmatig verkregen Recipe JSON-LD/HTML.
2. Controleer ingrediënten, porties en bereidingsstappen. Onbekende metrische hoeveelheden worden niet als geldige prijs- of inkoophoeveelheid behandeld.
3. Open daarna je eigen recept. Via **Bewerk mijn recept** kun je meetfouten, titel, porties en bereiding herstellen; **Maak een variant** bewaart een onafhankelijke kopie.
4. Opslaan vereist expliciete gebruikersactie en het normale `saveRecipeLibrary`-revision-contract. Als een ander tabblad intussen de recepten wijzigde, wordt de wijziging geweigerd zonder die ander te overschrijven. Bewerken behoudt de oorspronkelijke recept-ID, zodat bestaande Planner-verwijzingen niet verschuiven; een variant krijgt juist een nieuwe ID. De bijbehorende `supa-recipes-changed`-notificatie werkt de lijst voor Planner bij.

## Echte, ongeprijsde vraag voor dit ene recept

1. Open je eigen recept en vul bij **Mijn boodschappen voor dit recept** tussen 1 en 100 hele porties in.
2. Supa gebruikt uitsluitend de opgeslagen, door de gebruiker bevestigde `g`, `ml` en `stuks` en schaalt de hoeveelheden op basis van oorspronkelijke porties. Identieke ingredienten en eenheden worden samengevoegd.
3. Onbekende/conversie-onzekere ingrediënten en niet-gehele stuks staan als **handmatig controleren** vermeld. Het systeem rondt geen half ei of onzekere verpakking automatisch af.
4. Kies **Boodschappenlijst selecteren** om de tekst handmatig te kopiëren, of **Download ongeprijsde lijst (TXT)** om het lokale tekstbestand te bewaren. Er is geen clipboard-permissie, upload, automatisch fetch-verzoek of cloud-opslag nodig.

Receptvarianten en handmatige hoeveelheden zijn geen bewijs van supermarktvoorraad of besparing. Gebruik voor een echte winkeltotaalvergelijking daarnaast uitsluitend eigen werkelijk waargenomen en toegestane brongegevens in de bestaande `/private-basket-mapping.html` of de Supa-tab Vergelijk. Ontbrekende/verlopen peer-winkelprijzen blijven onbekend, nooit `€0`. Externe PLUS/Deka-rechten, de echte 11×2-opname en veldcodepin blijven onafhankelijk van deze lokale receptenfunctie.


## Eén eigen recept naar de bestaande PLUS/Deka-vergelijker

1. Open **Recepten** → jouw eigen recept en kies **Gewenste porties** (1–100).
2. Kies **Gebruik dit recept in winkelvergelijker (JSON)**. Supa maakt uitsluitend de oorspronkelijke, door jou bevestigde metrische fysieke behoefte voor die porties, zonder winkelnamen, SKU's, tijdstippen of prijs.
3. Kies **Open privéwinkelvergelijker** (of ga zelf naar `/private-basket-mapping.html`). Importeer het zojuist lokaal gedownloade JSON-bestand bij **weekmenu**. Dit bestand gebruikt exact dezelfde `supa-private-planner-week-v1`-normalisatie als de geselecteerde Supa Planner-week.
4. Importeer alleen eigen werkelijk waargenomen en toegestane PLUS- en/of DekaMarkt-brongegevens, controleer de productidentiteit, inhoud én hele-verpakkingsprijs per winkel afzonderlijk en keur de voorgestelde SKU-matching handmatig goed.
5. Een volledige prijskolom/winkeltotaal ontstaat uitsluitend bij complete, recente, handmatig bevestigde oorspronkelijke brongegevens. Een echt prijsverschil voor dezelfde mand verschijnt pas als beide afzonderlijke waarnemingen ook aan de bestaande paartijdvoorwaarden voldoen. Zonder tweede winkel of bij verlopen opname blijft het prijsverschil **onbekend**, nooit nul.

Een recept met ontbrekende hoeveelheden, niet-gehele stuks of onveilige waarden kan wel een ongeprijsde checklist met waarschuwingen opleveren, maar **niet** automatisch een prijsvergelijkbaar JSON-bestand. Corrigeer het oorspronkelijke recept eerst; er is geen verborgen afronding of winkelproductgok.

## Rechtmatig verkregen receptenbestand lokaal importeren

Open **Plak receptgegevens (JSON-LD)**. Je kunt daar behalve tekst plakken ook een eigen reeds gedownload `.html`, `.htm`, `.json` of `.jsonld`-bestand (maximaal 500 kB) kiezen. Het bestand wordt als UTF-8 lokaal gelezen, zonder websitecontact of HTML/JavaScript-uitvoering. Vul zelf de oorspronkelijke openbare HTTPS-bronlink in; deze link dient uitsluitend als bronvermelding en wordt voor de lokale plak-/bestandsimport niet opgevraagd. Controleer daarna alle ingrediënten en bereidingsstappen vóór je opslaat. Ongeldig UTF-8, een onherkenbaar recept, een ontbrekende bronlink of een bestand boven de grens wordt afgewezen; eerder opgeslagen recepten blijven staan.

## Ongeprijsde TXT en afvinkstatus weer in de vergelijking gebruiken

In de receptdetailweergave kun je elke fysieke regel afvinken, **Alleen nog te kopen** kiezen of de vinkjes wissen. **Download ongeprijsde lijst (TXT)** en **Boodschappenlijst selecteren** bevatten de actuele afvinkstatus. De checkmark betekent uitsluitend een lokale gebruikersactie: geen betaalbewijs, artikelprijs of geverifieerde winkelvoorraad.

Open daarna de privévergelijker en kies onder **Of: plak direct je eigen boodschappenlijst** het eerder gedownloade TXT-bestand. De bestaande lokale snelle import herkent nu ook het receptformaat met `Mijn recept: ... — N porties`, de twee vaste waarschuwingregels en `[ ]`/`[x]`-regels; de aangevinkte regels blijven onderdeel van dezelfde fysieke behoefte en worden dus niet uit de prijsvergelijking weggelaten. Dit is één geplande bereiding, niet automatisch `N` geselecteerde maaltijden. De gebruiker bevestigt het vervangen van bestaande mandgegevens voordat productmatches vervallen. `[?]`-ingrediënten worden **geweigerd** tot de ontbrekende hoeveelheid is gecorrigeerd; er volgt geen schatting of verborgen SKU-toekenning.

De reeds bestaande private wizard kan daarnaast eigen recepten rechtstreeks vanuit de lokale browserbibliotheek laden. Deze ondersteunde route heeft nu twee aparte velden: maximaal zeven **bereidingen** in totaal en per recept 1–100 **porties per bereiding**. Supa schaalt de bekende metrische hoeveelheden per recept, weigert fractionele stuks en maakt vervolgens een identieke totale vraag voor PLUS en DekaMarkt. De velden hebben zichtbare labels, ook op mobiel.

### Favorieten ook na het heropenen van Supa

De hartjes op de receptkaarten en de filter **Favorieten** bewaren
uitsluitend de recept-ID's lokaal in de browser met een strikt versie-
formaat. Na herladen verschijnen de eerder gekozen recepten opnieuw in
het favorietenfilter; nieuwe en verwijderde eigen recepten worden niet
als inhoud gekopieerd. Bij wijzigingen in een andere browser-tab leest
Supa de nieuwe toestand. Onbekende of beschadigde bestaande favorieten
worden niet overschreven; bij een wijzigingsrace weigert de opslag
het oude tabblad totdat de actuele favorieten zijn ingelezen.
Recepttekst, bronlinks, ingrediënten, prijzen en bronrechten worden
niet door de favorietenopslag vervoerd.
