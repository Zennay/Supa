# Supa · Eigen winkelproducten koppelen in de browser

## Eigen bronnen, zonder winkelprijzen op te halen

Open in de Supa-site of lokale Vite-app: **/private-basket-mapping.html**. Deze statische route staat los van de huidige React-PRs #3904/#3916 en de HTML-rapportage-PR #3918. De route is pas publiek beschikbaar na een geautoriseerde merge/deploy.

1. Selecteer één gecombineerd PLUS/Deka CSV, een lokaal geconverteerde supa-offline-prices-v1 JSON of twee afzonderlijke winkel-CSV-bestanden. Alle CSV-opnames hebben de bestaande kop met negen kolommen: retailer, observedAt, id, name, packAmount, packUnit, packCount, priceCents, available. De bestaande gedeelde CSV-converter valideert de volledige gecombineerde invoer. Geen retailer-fetch.
2. Vul het echte aantal geselecteerde maaltijden en ingrediënten in, met metrische fysieke hoeveelheid of expliciet onbekend (leeg). Je kunt ook een eerder gemaakt supa-private-basket-demand-v1 JSON-ingrediëntenmandje heropenen (maximaal 200 regels); de oude winkelmatches worden dan bewust gewist, zodat andere of vernieuwde winkelbronnen niet ongemerkt dezelfde SKU-identiteit erven.
3. Kies per ingrediënt een daadwerkelijk herkenbaar winkelproduct uit de eigen bron. Elke dropdown blijft binnen dezelfde maateenheidsdimensie (gewicht, volume, stuks). Dit is geen automatische semantische productmatch: de gebruiker controleert zelf SKU en inhoud. Niet gekoppeld blijft null, nooit nul euro.
4. Download supa-private-mand-vraag.json. Het is exact het supa-private-basket-demand-v1 contract: selectedMealCount, ingredients, amount/unit en expliciete productIds voor PLUS en DekaMarkt. Er staan geen prijzen in het vraagbestand, er is geen upload of localStorage.
5. Als zelfstandige PR #3918 is geïntegreerd kan hetzelfde vraagbestand met de bestaande HTML-vergelijker worden gebruikt. Voor losse winkelbestanden: node --experimental-strip-types scripts/offline-local-basket-comparison.mjs --pair plus.csv deka.csv supa-private-mand-vraag.json mand.html. Voor gecombineerde CSV: node --experimental-strip-types scripts/offline-local-basket-comparison.mjs bronnen.csv supa-private-mand-vraag.json mand.html.

## Bronwaarheid en vrijgave

- Geen fictieve prijzen, automatische winkelscraper, verborgen productmapping of openbare besparingsclaim.
- Dezelfde fysieke ingrediëntbehoefte is voor beide winkels vastgelegd. Een gelijke eenheidsdimensie is geen bewijs van productequivalentie. De gebruiker bevestigt de afzonderlijke retailer-ID's handmatig.
- Browser-CSP sluit externe scripts, netwerkverbindingen en afbeeldingen uit; productnamen worden als tekstnodes in de DOM weergegeven.
- De gedeelde converter blijft verantwoordelijk voor strikte CSV-structuur, winkelopnamen, dubbele product-ID's en centen. Samengevoegde bron maximaal 256 KB. Het scherm laat oude, toekomstige en >24 uur gescheiden observaties zien, maar de echte tijdsprecisie- en volledige-mand-gates zijn uitsluitend in de rapportagecode.
- De statische route is geen bewijs van retailerrechten of veldonderzoek. Schriftelijke #74 rechten, echte menselijke 11×2 PLUS/Deka-bronobservaties #78, veldcode-SHA #205 en runner #2833 blijven afzonderlijke gates voor onderzoeks- en publicatieclaims.
- De twee bestanden onder public/ vormen geen nieuwe backend, nemen geen React-App.tsx of bestaande live PR-branch over en schrijven geen QA-/regressietests.

## Implementatie

Nieuwe bestanden: public/private-basket-mapping.html en public/private-basket-mapping.mjs; hergebruikt public/offline-two-store-csv.mjs. Vite neemt het statische HTML/JS-bestand bij de normale productiebuild op. Voor daadwerkelijke prijzen en hele-verpakkingbedragen wordt de bestaande lokale rapportageroute uit #3918 hergebruikt zodra die is gemerged.

## Direct vergelijken in de browser (geen CLI nodig)

Dezelfde PR levert nu ook /private-basket-compare.html als afzonderlijke Vite-pagina. Na het kiezen/downloaden van de eigen mandvraag open je de vergelijking via de knop op het koppelscherm. Kies opnieuw je eigen PLUS- en DekaMarkt-opnames (gecombineerde CSV, aparte winkel-CSV of bestaande supa-offline-prices-v1 JSON) en de gedownloade mandvraag.

De pagina verwerkt alles lokaal en roept de bestaande TypeScript-domeinfuncties calculateDecimalPackCount en compareFullBaskets aan. Per ingrediënt zie je echte eigen SKU, benodigde hele verpakkingen, centbedrag en indicatieve €/kg/liter/stuk. Alleen twee volledige fysieke mandjes met controleerbare bronmomenten (niet toekomstig, niet ouder dan 7 dagen, maximaal 24 uur uiteen, vergeleken op originele nanoseconde-instanten) tonen de winkelbedragen en het volledige verschil. Bij ontbreken of veroudering blijft winnaar/totaal onbekend. Printen kan rechtstreeks vanuit de browser, zonder automatische upload.

Dezelfde lokale gegevens kunnen na #3918 integratie ook nog via de zelfstandige HTML-CLI worden verwerkt. Browser en CLI hergebruiken dezelfde bestaande verpakkings- en mandjesdomeinlogica; de nieuwe browserprijskaart is een privéproductfunctie, niet de vrijgave van echte retailerrechten of empirisch 11×2 veldbewijs.

## Directe vergelijking in dezelfde pagina (laatste productintegratie)

De browserwizard `/private-basket-mapping.html` is nu een **gecompileerde Vite-pagina** met zowel het bestaande lokale SKU-keuzescherm als de bestaande TypeScript-domeinberekening van Supa. Er is geen tweede bestandsupload nodig: na het invoeren van eigen PLUS- en DekaMarkt-opnames en het kiezen van echte winkelproducten druk je op **Vergelijk mijn twee mandjes**. De al ingelezen brondata en het huidige mandje worden uitsluitend binnen hetzelfde document doorgegeven aan de private vergelijkingsmodule, opnieuw gevalideerd en direct zichtbaar gemaakt.

Het prijsresultaat wordt meteen onzichtbaar zodra de gebruiker de bron, ingrediëntnaam, hoeveelheid of gekozen winkelproduct wijzigt. Er is opnieuw een expliciete vergelijking nodig. Eerdere bewaarde mandvragen kunnen worden heropend; oude bronmatches worden bewust gewist zodat de gebruiker opnieuw de juiste SKU bevestigt. Een eigen vraag-JSON kan nog steeds vrijwillig worden gedownload, en de afzonderlijke `/private-basket-compare.html` pagina blijft beschikbaar als onafhankelijke bestandsroute.

Voor onvolledige mandjes verschijnt nu ook een actiegerichte **ontbrekende-winkelgegevens-lijst**. Per echt niet-geprijsd ingrediënt en per winkel wordt de ontbrekende koppeling of hoeveelheid getoond; bij te oude, toekomstige of meer dan 24 uur uiteenliggende bronopnames staat welke winkel opnieuw bezocht/gecontroleerd moet worden. Alleen deze ontbrekende punten kunnen lokaal worden gedownload als `supa-ontbrekende-winkelgegevens.txt`. Hierin staan geen verzonnen bedragen of publicatieclaims. De brondata worden nergens heen gestuurd.

De implementatie bevat geen automatische retailerscraper, QA-suites of nieuwe toestemmingstoekenning; verplichte CI, onafhankelijke review en geautoriseerde mainwriter-claim blijven releasevereisten. Geen CLI, React-app of peer-productbranches zijn overschreven.

## Prijsverschil per ingrediënt en exacte bronidentiteit

Bij twee volledig toegelaten eigen opnames wordt niet alleen het totale winkelverschil, maar ook de **goedkopere winkel per ingrediënt** weergegeven. Deze bedragen worden rechtstreeks overgenomen uit de bestaande canonieke `compareFullBaskets().lineDeltas`; bij incomplete/onbetrouwbare mandjes blijft elke rijverschilkolom onbekend. Eenzelfde winkel-SKU in twee ingrediëntregels wordt niet als twee losse aankopen gepresenteerd: de tweede keuze blijft onopgelost totdat de fysieke behoeften samengevoegd zijn.

Alle lokale CSV-/JSON-bronnen en het opgeslagen demandbestand worden nu met strikte UTF-8-decodering verwerkt: ongeldig gecodeerde bytes worden geweigerd, niet stilzwijgend in vervangtekens veranderd. De bestaande CSV- en productvalidatie blijft de bron van waarheid.

## Nieuwe directe invoermogelijkheden

**Echte winkelgegevens zonder CSV voorbereiden.** Op `/private-basket-mapping.html` staat nu een eigen invoerformulier voor PLUS en DekaMarkt. Per winkel voer je zelf het oorspronkelijke ISO-opnametijdstip met expliciete UTC-offset in. Voeg vervolgens een werkelijk gezien product toe met originele product-ID en naam, verpakking/eenheid, multipack, daadwerkelijk waargenomen prijs (bijvoorbeeld `1,49`) en expliciete beschikbaarheidsbevestiging. Lege prijs blijft onbekend. Eurobedragen worden met decimale tekstberekening in **hele centen** omgezet; er worden geen prijzen/tijden/IDs gegenereerd. De invoer gaat door de bestaande **strikte** `convertTwoStoreCsv`; een fout in bedrag, dubbele SKU, maat, tijd of beschikbaarheid blokkeert de gehele import. Geaccepteerde input kan op eigen apparaat als CSV worden bewaard. Een wijziging van de invoer maakt eerder geselecteerde SKU's en het schermresultaat ongeldig totdat de actuele winkelbron opnieuw is geaccepteerd.

**Winkelproducten sneller vinden.** Iedere ingrediëntregel heeft afzonderlijk voor PLUS en DekaMarkt een zoekvak voor de **eigen** productnaam of artikel-ID. Zoeken filtert opties op dezelfde maateenheidsfamilie en toont maximaal 80 tegelijk; verfijn de naam of ID voor meer. Een eventuele bestaande expliciete selectie blijft zichtbaar bij filtering, maar wordt nooit automatisch veranderd in een andere SKU. Bij werkelijk vervangen van de bron moeten alle winkelproducten opnieuw worden gekozen.

**Planner-weekmenu meteen omzetten.** Kies optioneel een werkelijk opgeslagen `supa-private-planner-week-v1` JSON-bestand. De pagina valideert weekdagen, maaltijd- en receptidentiteiten, metrische hoeveelheden en bestandsgrootte. Daarna gebruikt de browser **dezelfde canonieke `aggregatePlanIngredients` uit `src/domain/basket.ts`** als de onafhankelijke Planner-CLI van product-PR #3918, voor het samenvoegen van geselecteerde dagen en hoeveelheden. De werkbank opent vervolgens de samengevoegde ingrediëntbehoeften direct; `productIds.PLUS` en `productIds.DekaMarkt` blijven onbekend tot de gebruiker eigen artikelen selecteert. Bestaande losse vraag-JSON-import blijft werken. Maximaal 200 ingrediënten in dit mobiele scherm, geen winkel-fetch, geen receptscrape of fictieve prijs.

**Eigen bronintegriteit.** Ook de prijsbron die rechtstreeks uit Supa-JSON wordt geïmporteerd moet een fysiek geldig ISO 8601 tijdstip hebben, met een legale positieve/negatieve UTC-offset en geldige Gregoriaanse kalenderdatum. Dezelfde canonieke CSV-converter blijft leidend voor tekst- en productbeperkingen. Geen bronrechten of onafhankelijk veldbewijs wordt uit deze vrijwillige eigen invoer afgeleid.

Alle drie de uitbreidingen horen bij de bestaande eigen product-PR #3919, en veranderen geen actieve React-/CLI-ownerbranches of QA-suites. Merge/deploy blijft afhangen van de bestaande exacte-head CI, onafhankelijke review en geautoriseerde mainwriter-lease.

## Bruikbare lijst als slechts één winkel een echte bron heeft

De werkbank maakt nu na het berekenen een **afzonderlijke, afvinkbare winkelboodschappenlijst** met de exact benodigde hele verpakkingen, originele SKU-identiteiten en bekende centprijzen. De gebruiker kiest expliciet PLUS of DekaMarkt, kan afvinken, resetten en lokaal TXT downloaden of via de expliciete knop kopiëren. De persoonlijke gegevens worden niet opgeslagen in Supa of automatisch geüpload.

Een winkel die volledig en recent lokaal is geprijsd, mag een eigen boodschappenlijst aanbieden **zelfs wanneer de andere winkel ontbrekende of verouderde producten heeft**. De tweede winkel wordt dan niet stilzwijgend aangevuld: er is geen volledige vergelijking, winnaar of beweerde besparing. De lijst van de afzonderlijke winkel toont wel de volledige eigen waarnemingsprijs. De opname-UTC-tijd staat expliciet bij TXT-export. De prijs is niet gegarandeerd bij de kassa.

Wanneer een origineel opnamemoment ouder dan zeven dagen wordt terwijl een browser openstaat, vervalt de afhankelijke getoonde prijsuitkomst bij hernieuwde focus/zichtbaarheid of export. Voor een volledige twee-winkelsvergelijking vervalt het totaal zodra de oudste opname verloopt; voor afzonderlijke winkelboodschappen vervalt alleen de betreffende eigen winkelbron.

## Ongeprijsd weekmenu → boodschappenlijst zonder winkelonderzoek

Het Supa-weekmenu is **niet afhankelijk van PLUS/Deka-veldopnames**: importeer een eigen bestaand `supa-private-planner-week-v1` bestand, of voer rechtstreeks eigen metrische ingrediënten in. Daarna kun je zonder winkelbestanden zowel de `supa-private-basket-demand-v1` JSON als een leesbare **ongeprijsde ingrediëntenlijst** downloaden. Beide bestanden bewaren de echte fysieke behoefte; zonder waargenomen prijzen bevatten de twee winkel-ID-velden `null` en verzinnen ze geen verpakkingen of besparingen. Ook ingrediënten met een onbekende hoeveelheid blijven zichtbaar als *hoeveelheid nog controleren*. Later kunnen de daadwerkelijke winkelbronnen worden gekoppeld, maar het Planner-productwerk is zonder die data al bruikbaar.

De knop voor volledige twee-winkelsberekening blijft wél uitgeschakeld totdat de werkbank beide eigen bronopnames heeft geaccepteerd. Deze scheiding voorkomt dat veldonderzoek of winkelautorisatie de normale lokale Planner en ongeprijsde boodschappenlijst onnodig blokkeren. Er is geen impliciete lokale opslag of geautomatiseerde bronophaling.

## Lokale boodschappenlijst op je telefoon

Na een volledig met eigen waarnemingen geprijsde winkelmand verschijnt de afvinklijst voor de gekozen winkel. De oorspronkelijke geobserveerde product-ID, inhoud, benodigde hele verpakking en het bekende lijnbedrag staan per artikel. Je kunt de voortgang wissen, de lijst als lokale TXT met oorspronkelijke winkelopnametijd bewaren of de volledige tekst met een expliciete klembordactie kopiëren. Als de browser geen veilige klembordtoestemming geeft, blijft TXT-download beschikbaar. Er worden geen gegevens in een account of browseropslag bewaard.

Een winkel mag deze lijst aanbieden wanneer **alle benodigde ingrediënten voor díé winkel** een veilig berekend mandje vormen met een eigen niet-toekomstige opname van maximaal zeven dagen oud. Het ontbreken van een bruikbare tweede winkel mag dit zelfstandige boodschappenlijstje niet blokkeren, maar betekent altijd dat er **geen volledig twee-winkelsprijsverschil** is. De lijst van een inmiddels vervallen opname wordt bij focus, zichtbaarheid, afvinken of downloaden ongeldig gemaakt; als alleen één bron verlopen is, kan de andere nog geldige winkelbron bruikbaar blijven.

Voor echte fysieke ingrediënten uit de Planner is zelfs geen geprijsd winkelmandje nodig. Gebruik **Open ongeprijsde afvinklijst** om een prijsloze, eigen mobiele checklist te openen; vink ingrediënten af, reset of download ze als lokale TXT. De oorspronkelijke fysieke behoefte blijft centraal; onbekende hoeveelheden worden als *nog controleren* getoond. Deze ongeprijsde voortgang blijft aanwezig wanneer alléén nieuwe winkelprijzen of winkelartikelkeuzes worden bekeken. Bij wijzigingen van de fysieke ingrediëntbehoefte of geselecteerde maaltijden wordt die lijst terecht ongeldig gemaakt. Het opslaan van de JSON-vraag en het maken van de ongeprijsde lijst is niet meer gekoppeld aan toegang tot retailerprijsbronnen.

## Dezelfde winkel-SKU bij verschillende ingrediënten

Wanneer één daadwerkelijk winkelartikel-ID aan meerdere ingrediëntregels voor dezelfde winkel is gekoppeld, markeert de browservergelijker **alle betrokken regels voor die winkel als onopgelost**. Een eerdere rij wordt dus niet als een aparte pakketprijs in het privédeeloverzicht opgenomen. Voeg de fysieke hoeveelheden eerst samen tot één ingrediëntbehoefte en bevestig de winkel-SKU daarna opnieuw. Dit is per winkel onafhankelijk; de andere supermarkt wordt niet automatisch gelijkgesteld.

## Privéprijsvergelijking bewaren zonder terminal

Op zowel `/private-basket-mapping.html` als `/private-basket-compare.html` kun je nu **Download dit privéoverzicht als HTML** kiezen, zodra een eigen bronmand zichtbaar is. Supa neemt de op dat moment getoonde fysieke ingrediënten, volledige verpakkingen, bedragen, bronmomenten en ontbrekende-productenlijst over in één lokaal te openen **statisch en scriptvrij** HTML-bestand. Er is geen account, backend of netwerkupload nodig. Bij een inmiddels verlopen volledige vergelijking blokkeert dezelfde bestaande vervalcontrole de export.

Het bestand is nadrukkelijk een **historische momentopname**: het doet later geen nieuwe prijs- of winkelrights-check en is geen garantie voor actuele kassaprijzen, een openbare besparingsclaim of veldbewijs. Alle tekst wordt HTML-geëscapet; een strikte Content Security Policy verbiedt scripts en netwerkbronnen. De bestaande TXT-boodschappenlijst, missende-prijzenlijst en printfunctie blijven onafhankelijk beschikbaar.

## Boodschappenlijst kopiëren zonder klembordmachtiging

De bestaande beveiligingsgate laat geen ongereviewde rechtstreekse browserklembordtoegang toe. De knop **Selecteer boodschappenlijst om te kopiëren** toont daarom een strikt lokaal, alleen-lezen tekstveld met de huidige winkel, originele opnameprijzen en afvinkstatus, selecteert de tekst en laat de gebruiker zelf Ctrl+C/Cmd+C of de telefoon-kopieeractie kiezen. De knop claimt nooit zelf een kopie naar het klembord te maken. Wijzigingen van winkel, afvinkstatus of bronmand wissen de selecteerbare preview; verlopen opnames kunnen geen actuele lijst opleveren. Downloaden als TXT blijft werken zonder deze browserbevoegdheid.

## Echte dubbele ingrediënten expliciet samenvoegen

De browserwizard heeft nu de actie **Combineer herhaalde ingrediëntnamen**. Deze maakt een samengevoegde fysieke ingrediëntbehoefte voor exact dezelfde (hoofdletterongevoelige) naam en dezelfde metrische eenheidsfamilie, pas na expliciete gebruikersbevestiging. De berekening gebruikt Supa's bestaande `sumDecimalDemandUnits`, waardoor bijvoorbeeld gram en kilogram met exacte decimale rekenkunde worden samengevoegd; onbekende, onverenigbare of niet exact berekenbare hoeveelheden blijven afzonderlijk zonder gegevensverlies.

**Geen automatische winkelproductidentiteit:** de wizard wist voor alle samengevoegde ingrediëntregels de huidige PLUS-/Deka-SKU-selecties, wist eerdere prijsresultaten en afvinkingen, en vraagt de gebruiker beide winkelproducten opnieuw te controleren. Anders genoemde producten worden nooit als equivalent beschouwd. Dit herstelt het praktische vervolgpad wanneer de bestaande vergelijker dezelfde SKU voor meerdere regels terecht als onbekend markeert, zonder prijzen, bronrechten of productequivalentie te verzinnen.

## Privé boodschappenlijst meenemen en hervatten

Bij een compleet en voldoende recent eigen winkelmandje hebben beide privévergelijkpagina's nu **Bewaar afvinkstatus als JSON** en **Herstel eerder opgeslagen afvinkstatus**. Het bestand ontstaat uitsluitend na een expliciete download; geen account, localStorage, verborgen synchronisatie of retailer-API. Een opgeslagen vinkje heeft geen prijsautoriteit. Het JSON legt vast bij welk oorspronkelijk winkelmoment, bij welk gekozen winkel-ID, bij welke fysieke vraag, SKU, verpakking en volledige eurocentregel de vinkjes horen.

Na opnieuw laden van de **zelfde** eigen prijsbestanden en dezelfde mandvraag kan de gebruiker de juiste winkel kiezen en vrijwillig het lokale afvinkbestand terugzetten. Alle winkel-, prijs-, bronmoment- en ingrediëntidentiteiten moeten exact overeenkomen; de originele winkelopname moet nog geldig zijn. Bij verschil wordt de hele import geweigerd, zonder bestaande vinkjes te wissen of verouderde prijzen als actueel te presenteren. De bestaande TXT-lijst en het rechtstreeks afvinken blijven beschikbaar.

## Verpakkings- en indicatieve eenheidsprijs tijdens het matchen

Zodra de gebruiker in zijn **eigen** PLUS-/Deka-opname een artikel selecteert, toont de wizard direct de daadwerkelijk ingevoerde SKU, europrijs **per volledige verpakking** en een duidelijke **indicatieve** prijs per kg, liter of stuk, inclusief multipack-aantal. De keuze wordt nooit automatisch gemaakt of gesorteerd als een claim over de goedkoopste winkel. Eenheidsprijzen zijn uitsluitend informatie tijdens menselijke productidentiteitscontrole; de latere mandjesberekening blijft de enige autoriteit voor hele eurocenten, verpakkingafronding en de complete twee-winkelvergelijking. Bij opnieuw importeren van winkelbronnen worden SKU-keuzes nog steeds gewist.

## Kleine schermen en privé printuitvoer

Het gekoppelde twee-winkelmandjesoverzicht heeft nu een eigen horizontaal scrollgebied voor de vier fysieke/prijsverschilkolommen. De pagina zelf schuift niet langer mee met de brede tabel op telefoons. Bij **Print deze privévergelijking** worden bronkeuzeschermen, eigen invoervelden, lokale bestandsselecties, andere bedieningsknoppen en de aparte afvinklijst bewust buiten de afdruk gehouden. Alleen het werkelijk geopende prijsresultaat, originele opnametijden, bekende regels en noodzakelijke ontbrekende-productenwaarschuwingen gaan mee. Een onzichtbare/ongeldige prijsvergelijking wordt niet via print alsnog als resultaat getoond.

## Live bronmatch-dekking voor beide winkels

Onder de fysieke ingrediënten toont de wizard nu direct per winkel hoeveel regels werkelijk een handmatig gekozen, uniek bronartikel met bruikbare eigen prijs en bekende metrische hoeveelheid hebben. Regels die hetzelfde winkelartikel-ID dubbel selecteren worden zichtbaar meegeteld als **niet klaar**, zodat de gebruiker de nieuwe samenvoegactie kan gebruiken. Het paneel werkt mee bij andere hoeveelheden, bronbestanden en SKU-keuzes, maar telt alleen bronmatchdekking; dit is **geen volledige prijsclaim**. Pas de bestaande expliciete vergelijking beoordeelt de zeven-dagen-/24-uurvoorwaarden en beide volledige hele-verpakkingsmanden.

## Bekende SKU zonder prijs blijft zichtbaar (geen fictieve nul)
De winkelkeuze toont nu ook een werkelijk waargenomen SKU waarvan een bronprijs, verpakking of beschikbaarheid ontbreekt. Zo kan de gebruiker de **identiteit** vastleggen en ziet die onmiddellijk de reden waarom de winkelregel nog niet compleet is. Dit is uitdrukkelijk géén prijskoppeling: de bestaande mandjesberekening weigert die regel en laat het volledige mandverschil onbekend. Het live-dekkingspaneel onderscheidt unieke geprijsde SKU's van gekoppelde maar onprijsbare producten. De selectie verzint geen prijs, beschikbaarheid of winkelbewijs.

## Ook verschillende ingrediëntnamen bewust samenvoegen
De gebruiker kan nu expliciet twee of meer ingrediëntregels aanvinken en 'Combineer geselecteerde ingrediënten' kiezen, ook als recepten ze anders hebben genoemd (bijvoorbeeld rijst avond en rijst lunch). Supa controleert vooraf dat iedere geselecteerde hoeveelheid bekend en fysiek compatibel is, rekent de som via het bestaande exacte decimale domein uit en vraagt eenmaal expliciet om bevestiging van de behouden eerste naam. De operatie wordt uitsluitend na alle controles toegepast. Winkel-SKU's van alle samengevoegde regels worden gewist, zodat productequivalentie niet stilzwijgend wordt aangenomen; de gebruiker kiest opnieuw het daadwerkelijk gecontroleerde artikel bij beide winkels. De bestaande actie voor gelijke namen blijft beschikbaar.

## Eigen bestaande winkelopnames herzien zonder opnieuw typen
Nadat een eigen lokale PLUS-/Deka-opname is geopend, biedt de wizard **Bewerk mijn geopende eigen winkelopnames**. Die actie kopieert maximaal 100 bestaande artikelen per winkel naar de bestaande handmatige editor; het originele product-ID, verpakking, aantal, centprijs, beschikbaarheid en oorspronkelijke waarnemingstijd worden behouden. Er wordt geen nieuwe prijs, datum of retailerbron verzonnen. Grotere bestanden blijven via de bestaande CSV-route bewerkbaar.

De gebruiker bevestigt vooraf het overschrijven van eventuele handmatige concepten. De oude bron en alle prijsvergelijkingen/matches worden direct ongeldig zodra de editor wordt geopend. Alleen het daarna expliciet klikken op **Neem mijn twee winkelopnames over** gebruikt dezelfde strikte canonieke CSV-importer om de bewust gecorrigeerde eigen data opnieuw in de vergelijking toe te laten. Bronmomenten mogen uitsluitend worden gewijzigd na echte hercontrole; de pagina presenteert menselijke revisie niet als wetenschappelijk veldbewijs.

## Afvinkstatus behouden na een echte prijsverversing
De herstelinterface heeft nu een opt-in vinkje 'Hervat alleen mijn vinkjes als uitsluitend opnametijd of prijzen zijn gewijzigd'. Standaard blijft het oude strikte herstel actief. Met het extra vinkje en een aanvullende bevestiging accepteert Supa uitsluitend een niet-ouder geworden winkelbron met dezelfde winkel, geselecteerde maaltijden, fysieke ingredientidentiteiten, behoeftehoeveelheden, SKU's, verpakkingen en aantallen. Alleen verschillen in de geobserveerde tijd en werkelijke pack/regel/mandprijzen mogen voorkomen. Bij een andere verpakking, hoeveelheid, productidentiteit, ouder opnamepunt of ontbrekende huidige geldige prijs weigert Supa het volledige herstel. Prijsgegevens uit de backup worden nooit teruggezet: alleen de lokale vinkjes worden toegepast op een volledig opnieuw berekend huidig mandje. Dit lost de praktische 'vinkjes verdwijnen door prijsupdate'-situatie op voor de afzonderlijke private browserboodschappenlijst, zonder de actieve mobiele Figma-lijst te wijzigen.

## Live bronpaar-verval en ontbrekende dekking
De gekoppelde private gebruikersflow laat nu tegelijk twee waarheden zien: (1) per PLUS en DekaMarkt de aantallen fysiek gematchte, bruikbare eigen prijsregels en de expliciet onprijsbare regels en (2) de zelfstandige oorspronkelijke opnamegeldigheid voor de zeven-dagenlimiet en maximaal 24 uur onderling verschil. Verouderde of toekomstige bronnen krijgen zichtbaar een waarschuwing, ook wanneer alle productidentiteiten bekend zijn. Een geldig bronpaar vermeldt de eerstvolgende vervaltijd in lokale Nederlandse datumweergave. Dit paneel is slechts een live invoerstatus, geen kassaprijs- of publieke besparingsclaim; de canonieke volledige twee-winkelberekening blijft beslissend.

## Exacte ontbrekende bronwaarde in browser én HTML-rapport
De twee bruikbare paden (browserknop en volledig offline CLI-HTML) gebruiken nu dezelfde lokale uitleghelper uit het bestaande domein. Een niet gekoppelde SKU vraagt om een expliciete echte productkeuze; een verdwenen SKU vraagt opnieuw koppelen; een ontbrekende fysieke hoeveelheid verwijst naar het weekmenu; een ongecontroleerde beschikbaarheid, ontbrekende verpakkingsinhoud en ontbrekende werkelijk waargenomen centprijs leveren elk een specifieke aanvulactie op. Als meerdere gegevens ontbreken verschijnen de onafhankelijke redenen samen. Geen van deze gevallen krijgt een fictieve €0-regel of een winkelwinnaar. Verouderde bronmomenten blijven via de onafhankelijke bronfrisheidsgates afgekeurd.
