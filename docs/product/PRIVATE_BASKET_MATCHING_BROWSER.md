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

## Niet-bindende productsuggestie met bestaande Supa-matcher
Het privékoppelscherm benut nu opnieuw de al bestaande domeinengine matchIngredient uit src/domain/matching.ts, niet een eigen tweede matchingalgoritme. Per ingrediënt vergelijkt de wizard uitsluitend een begrensde selectie van reeds lokaal geopende en werkelijk prijsbare winkelartikelen met overeenkomende fysieke eenheidsfamilie. Alleen als die canonieke engine zelf een match met voldoende score en marge teruggeeft, verschijnt de SKU vooraan in de keuzelijst met een duidelijk gemarkeerde suggestiescore. De standaardkeuze blijft altijd 'Niet gekoppeld'; het script vult nooit zelfstandig een SKU in, en een menselijke wijziging van de zoekterm heeft voorrang op de suggestie. De gebruiker moet de SKU en verpakking nog expliciet aanklikken en controleren. Afgekeurde, te ambigue, niet-beschikbare of ongeprijsde kandidaten leveren geen betrouwbaar prijsvoorstel; onprijsbare producten blijven desgewenst wel handmatig zichtbaar. Geen retailer-opvraag, merklicentie of besparingsclaim.

## Lokale bron- en mandinvoersessie bewaren en heropenen

Vanuit **3 · Vergelijk direct of bewaar jouw mandje** kun je nu bewust een
`supa-private-basket-session-v1` JSON downloaden. Die bevat de bestaande,
handmatig aangeleverde `supa-offline-prices-v1` PLUS- en Deka-opnames plus de
`supa-private-basket-demand-v1` ingrediënten en per winkel handmatig gekozen
product-ID's. Het bestand bevat echte **privé winkel- en prijsgegevens**: bewaar
het zelf vertrouwelijk, deel het niet gedachteloos. Er is geen browseropslag,
netwerkaanroep, bronfetch of automatische account-sync.

Via **Open eerder opgeslagen privésessie** wordt de complete file op maximaal
256.000 bytes en strikt UTF-8 gecontroleerd, iedere opname opnieuw via dezelfde
lokale prijs-JSON-admissie geverifieerd, de mandvraag door de bestaande strikte
vraag-parser gehaald en iedere SKU op oorspronkelijke bron en fysieke maateenheid
gecontroleerd. Alleen na expliciete bevestiging wordt de huidige invoer
vervangen; bij ongeldige data of annulering blijft de huidige sessie ongewijzigd.
Oorspronkelijke observatiemomenten blijven behouden, inclusief waarschuwingen
voor ouder dan 7 dagen, toekomstige tijden en winkelopnames >24 uur uiteen.
De gebruiker moet zelf opnieuw op **Vergelijk mijn twee mandjes** klikken;
een heropend bestand is geen nieuwe waarneming, geen geldige bronlicentie,
geen bewezen actuele kassaprijs en geen hergebruik van een oude savings-claim.
Dit is een extra privéopslagmogelijkheid; zonder bronbestand blijven de
bestaande ongeprijsde Planner- en boodschappenlijstfuncties bruikbaar.

## Ongeprijsde lijst meenemen tussen apparaten

Ook als je nog geen toegelaten winkelprijzen hebt, kun je de eigen mobiele
ongeprijsde ingrediëntenlijst openen, artikelen afvinken en nu via **Bewaar
ongeprijsde afvinkstatus (JSON)** opt-in meenemen. Het bestand
`supa-private-unpriced-checklist-v1` bevat uitsluitend de actuele fysieke
ingrediënten (ID, naam, aantal, eenheid) en aangevinkte ID's; **nooit** winkel-SKU,
bronmoment, prijs of retailerproduct. **Herstel eigen ongeprijsde afvinkstatus**
vereist exact dezelfde fysieke ingrediënten, volgorde en hoeveelheden, unieke
geldige aangevinkte ID's, strict UTF-8, maximaal 256 kB, en expliciete
gebruikersbevestiging. Bij een gewijzigd weekmenu of ingrediënten faalt herstel
zonder voortgang te muteren; een bronprijsupdate alleen wijzigt geen fysieke
vraag. Er is geen automatische opslag, prijsvergelijking of synchronisatie.

## Budget-first: eigen doel naast twee complete mandjes

Op beide lokale vergelijkingpagina's kan de gebruiker **optioneel zelf** een
budget in euro's opgeven (bijvoorbeeld `50,00`). Supa rekent invoer strikt in
hele eurocenten om (maximaal € 1.000.000) en vergelijkt het uitsluitend met de
bestaande canonieke complete hele-verpakkingsmandtotalen. Per winkel verschijnt
de resterende budgetruimte of de overschrijding. Zonder twee complete én
recente winkelmanden, of met een ongeldige budgetinvoer, verschijnt **geen**
financiële budgetconclusie. Een budget wijzigen maakt nooit onbekende prijzen
bekend en voert geen nieuwe winkelprijsberekening uit. De huidige privé HTML-
momentopname kan de expliciet berekende budgetcontext meenemen, duidelijk als
historisch overzicht, en de browserprint toont de budgetuitkomst zonder het
persoonlijke invoerveld. Geen gesuggereerde, gemockte of automatisch opgehaalde
prijzen en geen kassagarantie.

### Budget bij één bekende winkel

Een bruikbaar, volledig en recent waargenomen mandje bij **één** winkel is
voldoende om dat ene eigen bedrag met jouw optionele budget te vergelijken,
ook wanneer voor de andere winkel SKU's, hoeveelheid of prijzen ontbreken, of
wanneer de twee opnames meer dan 24 uur uiteen liggen. De tweede winkel blijft
letterlijk **onbekend**: geen fictief totaal, geen laagste-winkelclaim en geen
volledige twee-winkelbesparing. Voor elke winkel geldt afzonderlijk de bestaande
compleetheid- en zeven-dagen-controle. De budgetkaart kijkt ook bij opnieuw
focussen, terugkeren naar de tab, of budgetinvoer naar ouderdom en maakt een
verlopen winkelmandje dan onbekend. De algemene twee-winkelvergelijking blijft
onverminderd onder de strikte oorspronkelijke bronpaarvoorwaarden staan.

## Eén privésessiebestand direct op de losse vergelijkpagina

De bestaande `/private-basket-compare.html` kan nu ook rechtstreeks het eerder
vanuit het koppelscherm gedownloade **supa-private-basket-session-v1** bestand
openen, in plaats van apart de PLUS-/Deka-bronnen én mandvraag te moeten
selecteren. Kies het ene lokale JSON-bestand en klik zelf op **Vergelijk mijn
twee mandjes**. Bestaande strikte bron- en mandnormalisatie blijft van kracht;
iedere herstelde originele retailer-SKU moet daadwerkelijk in de desbetreffende
bronopname staan en dezelfde fysieke eenheidsfamilie hebben. Maximaal 256 kB,
strikte UTF-8; geen opslag, automatische bronrefresh, scraping of netwerk.
Wisselen tussen volledige sessie en de bestaande losse CSV/JSON-invoer wist de
tegenstrijdige bestandsselectie en maakt eerdere prijsresultaten ongeldig.
Originele bronmomenten blijven onveranderd: een oud sessiebestand mag dus nooit
automatisch een nieuwe complete prijsvergelijking suggereren. Wanneer slechts
één winkel compleet is, blijft de eigen afvinklijst/budget van die winkel
mogelijk, maar de volledige winkelwinnaar blijft onbekend.

## Eigen Supa-recepten → dezelfde fysieke winkelmandvraag

Het koppelscherm heeft een nieuwe optie **Laad mijn eigen recepten op dit
apparaat**. Alleen na de expliciete knop leest de werkbank read-only dezelfde
bestaande `supa.recipe-library.v1` opslag als de eigen receptenbibliotheek van
Supa; er is geen API, website-fetch, server of opslagmutatie. Recepten met
onbekende porties, onvolledige metrische eenheden/hoeveelheden of actieve
reviewwaarschuwingen zijn **niet** selecteerbaar; de gebruiker corrigeert deze
eerst in `Mijn recepten`. Alle aanwezige eigen recepten worden via de bestaande
`readRecipeLibrary` en `toPlannerRecipe` grenzen genormaliseerd.

Kies één of meer volledig gecontroleerde recepten, eventueel 1–7 bereidingen
per recept, met maximaal zeven gekozen bereidingen in totaal. De bestaande
`aggregatePlanIngredients` voegt exact dezelfde ingrediënten over de gekozen
maaltijden samen als bij een Planner-weekmenu, inclusief veilige g/kg en ml/l
conversies. Bij strijdige ingrediënten, te grote fysieke aantallen, te veel
regels of tussentijds gewijzigde recepten weigert het scherm de hele selectie
zonder de huidige winkelmandvraag te vervangen. Succes verzendt alleen een
lokale `supa-private-basket-demand-v1` naar de reeds bestaande wizard met
alle retailerproduct-ID's `null`. Iedere concrete bron-SKU moet vervolgens
opnieuw bewust door de gebruiker worden gekozen. Nooit fictieve winkelprijzen,
bronlicenties of automatische productmatching. Het oorspronkelijke aantal
porties per bereiding wordt als apart, zichtbaar label getoond; dit scherm
schaalt nog niet per persoon, maar telt gekozen volledige bereidingen op.

## Mobiele tekstexport van eigen mandvergelijking

Zowel het gecombineerde koppelscherm als de losse vergelijkpagina bieden nu
**Download actuele privévergelijking als TXT** en **Selecteer tekst om zelf te
kopiëren**. Het rapport gebruikt uitsluitend de op dat moment werkelijk
zichtbare eigen manduitkomst: oorspronkelijke opname-UTC-tijden, eigen
verpakkingen, bronprijzen, bekende/onbekende verschillen, optioneel eigen
budget en nog te controleren artikelen. Er is geen automatische prijsophaling,
publicatie of klembordtoegang. De gebruiker kiest zelf of hij lokaal TXT
bewaart of de selecteerbare tekst handmatig kopieert. De report-omvang is
maximaal 256 kB. Zodra de echte prijsbron, fysieke mand of optionele
budgetinvoer verandert of een waarneming vervalt, wordt eerder geselecteerde
vergelijktekst ingetrokken. Ook volledige eigen cijfers blijven nadrukkelijk
historische privéopnames, geen gegarandeerde actuele kassaprijzen.

**Fractionele stuks zijn reviewplichtig.** Een eigen recept met bijvoorbeeld
`0,5 piece` ei, ui of andere fysieke stuks wordt niet als automatisch
mandklaar geaccepteerd, ook als de gewone recepteneditor de decimale maat
heeft bewaard. De importknop respecteert daarmee de bestaande menselijke
reviewgrens voor fractionele stuks. Een recept kan na expliciete menselijke
herziening bijvoorbeeld in een geschikte gehele stuksaankoop worden omgezet;
Supa maakt dat besluit niet zelf en claimt geen fictieve afgeronde behoefte.

## Fouttolerante bronvervanging in de gekoppelde wizard

De browserwizard laat bij een nieuwe import de eerder toegelaten PLUS- en
Deka-bronnen en menselijke productkeuzes in geheugen staan totdat het hele
nieuwe lokale bronbestand strikte CSV/JSON-admissie heeft gehaald. De vorige
getoonde vergelijking wordt **wel meteen verborgen** bij een nieuwe poging.
Daarna kan de gebruiker een echt nieuwe bron expliciet bevestigen; alle
retailer-SKU-koppelingen worden dan opnieuw ter review vrijgegeven. Exact
ongewijzigde opnamebestanden zijn een noop zonder verlies van eerdere matches.
Bij mislukte bestandslezing, verkeerde CSV-kop, ontbrekende tweede CSV of
annulering blijft de vorige geldige bron behouden, zonder verzonnen prijs of
verlengde opnametijd. Bereken opnieuw op verzoek na afloop. Bestaande
handmatige bronbewerking houdt zijn eigen strengere grens: na expliciete
wijziging zijn vroegere bronkeuzes ongeldig totdat beide echte opnames
opnieuw zijn toegelaten.

## Eerlijke één-winkelinvoer zonder fictieve tweede opname

De afzonderlijke `/private-basket-compare.html` accepteert nu ook alleen een
**eigen PLUS CSV** of alleen een **eigen DekaMarkt CSV** met de canonieke
negenkoloms kop en uitsluitend de werkelijk ingevulde winkelwaarneming.
Een bestaande gecombineerde bron met beide winkels blijft via dezelfde
bestaande strikte twee-winkel CSV converter verwerkt. Voor één winkel gebruikt
Supa de nieuwe `convertOwnStoreCsv` variant van de *bestaande* offline parser,
met onveranderde cel-, bedrag-, hoeveelheid-, beschikbaarheid-, UTC-offset-
en product-ID-controles. Het expliciete `supa-private-single-store-prices-v1`
contract bevat exact één werkelijke opname en nooit een verzonnen tweede
product, prijs, opname-UTC of winkelrecht. De andere winkel krijgt uitsluitend
zichtbare onopgeloste regels. Echte volledige winkelmandkosten, budgetruimte
en afvinklijst kunnen voor de ene winkel wel verschijnen als de opnametijd
maximaal zeven dagen oud is en alle eigen fysieke regels prijsbaar zijn;
geen twee-winkelwinnaar of prijsverschil wordt berekend. Alleen bij twee
werkelijke opnames worden de canonieke 7-dagen én 24-uurs-paarvoorwaarden
voor de volledige vergelijking toegepast. Onbevestigde/ontbrekende producten
blijven onbekend, niet nul euro.

## Eén echte winkelopname rechtstreeks in de koppelwizard

De gecombineerde `/private-basket-mapping.html` accepteert dezelfde nieuwe
expliciete `supa-private-single-store-prices-v1` bron uit de strikte
`convertOwnStoreCsv` parser. Je kunt nu alleen een eigen PLUS-CSV,
alleen DekaMarkt-CSV, of één bestaande eigen JSON/CSV-opname openen.
Er worden **geen** bronmomenten, winkels, SKU's of prijzen gefabriceerd voor
het ontbrekende tweede filiaal. De keuzelijst voor die winkel blijft leeg en
het dekkingsscherm toont de ontbrekende bron als onbekend. De bestaande
handmatige dual-store correctie-editor blijft uitsluitend beschikbaar voor
*werkelijk twee* aanwezige winkelopnames, om het ontbrekende veldbewijs niet
als een bewerkbare fictieve opname voor te vullen.

De ingeladen echte ene opname kan direct bij ingrediënten worden gematcht,
vergeleken als uitsluitend eigen winkelmand, en lokaal worden meegenomen
in één expliciet `supa-private-basket-session-v1` sessiebestand. Herstel
gebruikt opnieuw de bestaande lokale strikte bron- en SKU-validatie; een
winkel-SKU voor een winkel zonder aangeleverde opname wordt geweigerd. De
andere winkel blijft unknown totdat de gebruiker een echt tweede bestand
inlaadt. De 7-dagen-herkomstgrens voor de ene winkel blijft gelden; de
bestaande 24-uursgrens voor volledige winkelpaarvergelijking wordt
nooit verwijderd of versoepeld.

## Eén winkel handmatig invoeren, zonder CSV-voorbereiding

Dezelfde browserwizard laat de gebruiker bij **Of: voeg je eigen
prijswaarnemingen direct in** nu expliciet `PLUS en DekaMarkt`, `Alleen PLUS`
of `Alleen DekaMarkt` kiezen. Alleen de werkelijk gekozen winkels worden
gebruikt: de andere invoervelden worden verborgen, een ontbrekende
waarnemingstijd wordt **nooit** door Supa aangevuld. Het bestaande
menselijke invoerformulier vraagt nog steeds de werkelijke SKU, naam,
verpakking, hele eurocenten of expliciet onbekende prijs, beschikbaarheid
en originele geldige ISO-UTC-offset voor elke geselecteerde winkel.

Het resultaat doorloopt dezelfde strikte lokale bronconversie en wordt
zichtbaar in de *reeds aanwezige* productkiezer en volledige-mandberekening.
Een geprijsde eigen winkel kan de eigen fysieke boodschappenlijst en
budgetruimte tonen; de niet-geobserveerde winkel blijft onbekend. Bij
wisselen van winkelkeuze of handmatige invoer vervallen eerdere prijsuitkomst
en SKU-koppelingen tot de gebruiker deze echte bron expliciet opnieuw
accepteert. Het formulier verstrekt geen retailerrechten of openbaar
veldonderzoeksbewijs en haalt niets van winkelwebsites op.

## Tweede echte winkelopname toevoegen zonder bestaand matchwerk te verliezen

Wanneer de gebruiker eerst alleen PLUS- of DekaMarkt-brongegevens invoert,
later de eigen **tweede** winkel-CSV selecteert en de wijziging bevestigt,
blijft een eerder menselijk bevestigde SKU van de eerste winkel bewaard
**uitsluitend wanneer de gehele oorspronkelijke bronopname van die winkel
ongewijzigd is**, inclusief werkelijke opnametijd, productnamen, verpakking,
beschikbaarheid en prijzen. Supa vergelijkt alle daadwerkelijk ingeladen
bronvelden en behoudt geen enkele selectie voor nieuwe of gewijzigde
retailercaptures. Bij gewijzigde prijs of tijd moeten de keuzes opnieuw
worden beoordeeld. Het vorige vergelijkingresultaat wordt direct ingetrokken;
een nieuw prijsverschil vereist nog steeds zelf op Vergelijk klikken en de
volledige canonieke twee-winkelsvoorwaarden. Voor een winkel die niet door
de nieuwe bron is geleverd blijft alles onbekend.

## Oorspronkelijk losse winkelopnames samenvoegen zonder fictieve prijzen

Een bestaand in de wizard toegelaten **echte ene** PLUS- of DekaMarkt-opname
kan nu met een later geselecteerd lokaal bronbestand van **uitsluitend de
andere winkel** worden gecombineerd, ook als de eerste bron een JSON,
handmatig formulier of een andere CSV was. Beide afzonderlijke bronnen zijn
al volledig door de strikte bestaande importvalidator gegaan; het gecombineerde
bronpaar wordt opnieuw met het volledige bestaande twee-winkelschema
gevalideerd. De gebruiker bevestigt expliciet het samenvoegen voordat enige
ingelezen bron wordt vervangen. Alleen als de originele eerste opname
letterlijk onveranderd is blijven de daarbij handmatig gekozen SKU's bewaard.
Er worden geen ontbrekende tijden, producten of bedragen bedacht en de
volledige prijsvergelijking blijft onbekend bij onvolledige matches, te oude
bronnen of opnames die meer dan 24 uur uiteen liggen. Bij annulering houdt
de gebruiker zijn eerdere echte winkelgegevens.

## Echte enkele winkelopname bewerken vanuit de browser

Ook wanneer nog maar **één** PLUS- of DekaMarkt-bron is geaccepteerd, kan de
gebruiker nu **Bewerk mijn geopende eigen winkelopnames** kiezen. De bestaande
lokale menselijke correctie-editor vult uitsluitend de daadwerkelijk
waargenomen winkel, originele datum/tijd, product-ID, verpakking,
beschikbaarheid en eventueel de eerdere prijs voor. De andere winkel
krijgt géén verzonnen gegevens; die blijft verborgen en onbekend.
Pas na een daadwerkelijk opnieuw geverifieerde correctie gebruikt de gebruiker
**Neem mijn echte winkelopname(s) over**. Bewerkingen trekken vóór
heraanvaarding oudere SKU-koppelingen en eerdere berekende prijzen in; een
nieuwe tijd of prijs wordt nooit automatisch ingevuld. De bestaande limiet
van 100 artikelen per handmatig bewerkbare winkel en strikte CSV-parser
blijven van kracht.


## Gestructureerde privé CSV: bronmomenten, echte matches en onbekende prijzen

Beide lokale pagina's bieden nu **Download eigen prijzen, matching en ontbrekende regels als CSV**. Dit is een extra export van **dezelfde actuele, reeds berekende privévergelijking**; het bestand gaat nergens online naartoe en is **niet** het 9-koloms winkelaanvoerformaat. Importeer deze rapport-CSV niet opnieuw alsof het een prijsbron is.

De CSV bevat per oorspronkelijke fysieke ingrediëntbehoefte afzonderlijk de werkelijk gekoppelde PLUS- en/of DekaMarkt-SKU, oorspronkelijke opnametijd, benodigde hele verpakkingen, oorspronkelijke verpakkingsinhoud, eenheid, multipackaantal, prijs per verpakking en regelprijs in hele eurocenten. Een indicatieve €/kg, €/liter of €/stuk wordt afzonderlijk en expliciet niet als kassaprijs aangeduid. De statuskolom legt per winkel vast waarom een regel onbekend is, bijvoorbeeld ontbrekende bron, niet bevestigde SKU, onprijsbare regel of verouderde opname. Een extra **mandje_totaal**-rij gebruikt uitsluitend complete en recente eigen winkelmandjes. De kolom **verschil_cent_DekaMarkt_minus_PLUS** volgt exact de reeds gebruikte canonieke `compareFullBaskets`-richting; bij ontbreken van de complete 7-dagen-/24-uur-twee-winkelvergelijking blijft die leeg. Nul eurocent blijft alleen een echte waargenomen prijs, nooit de standaard voor een ontbrekende prijs.

De export heeft één vaste 29-koloms CSV-layout en beschermt tekstvelden conservatief tegen spreadsheetformule-interpretatie, inclusief voorvoegsels met onzichtbare Unicode of compatibiliteitsvormen. Een eigen echt negatieve centverschilwaarde blijft numeriek negatief. De CSV is maximaal 256 KB en wordt alleen aangeboden zolang de oorspronkelijke winkelopnames niet verlopen zijn; maak anders opnieuw de private berekening. Net als alle lokale exports is dit een privé-werkdocument, **geen** bewijs van winkelautorisatie, werkelijk PLUS/Deka 11×2-veldonderzoek, geverifieerde besparing of actuele prijs bij de kassa.

De implementatie hergebruikt bestaande domeinmanden in `src/privateBasketCompare.ts` met de gerichte, privacybewuste helper `src/privateBasketComparisonCsv.ts`; geen nieuwe scraper, tests, retailer-HTTP of automatische bronopslag.


## Boodschappenlijst plakken zonder bestanden of prijzen

Open de bestaande werkbank `/private-basket-mapping.html` en gebruik **Of: plak direct je eigen boodschappenlijst**. Voer het echte aantal geselecteerde maaltijden in en plak maximaal 200 metrische regels in één tekstveld, bijvoorbeeld:

```text
450 g basmati rijst
400 ml kokosmelk
2 stuks bloemkool
basmati rijst: 50 g
```

Druk **Maak van deze lijst een privémandje**. De parser ondersteunt zowel `hoeveelheid eenheid naam` als `naam: hoeveelheid eenheid`, met g/kg, ml/l en hele stuks. Alleen precies gelijk geschreven ingrediëntnamen (hoofdletterongevoelig) worden samengevoegd met de bestaande exacte `sumDecimalDemandUnits`; `450 g` + `50 g` levert één fysiek `500 g`-ingrediënt op. De parser raadt géén andere productnamen aan als gelijkwaardige ingrediënten, rondt geen onmogelijke sommen af en weigert ontbrekende/onduidelijke maten, meer dan 200 regels of fracties van fysieke stuks.

**Privacy en behoud:** ongeldige invoer verandert de huidige mand nooit. Wanneer reeds bestaande ingrediënten of bewust gekozen winkel-SKU's zouden worden vervangen, vraagt de werkbank eerst expliciete bevestiging. Eerdere handmatig gecontroleerde SKU-koppelingen worden niet overgenomen naar de nieuw ingelezen fysieke vraag. Echte reeds geopende eigen winkelopnames blijven ongemoeid, zodat de gebruiker de aanwezige winkelproducten daarna opnieuw aan de canonieke fysieke mand kan koppelen. Een onprijsbare winkel blijft eerlijk onbekend. De bestaande directe vergelijking en lokale TXT/HTML/CSV-rapporten blijven daarna beschikbaar. Er wordt niets opgehaald, opgeslagen of verstuurd door deze plakfunctie; zij is geen prijs- of winkelautorisatiebewijs.

Implementatie: `src/privateBasketQuickDemand.ts` plus de bestaande HTML-werkbank, **geen nieuwe tests, QA-rondes, scraper, API of infrastructuur**.


## Handmatige tweede winkelopname toevoegen zonder eerste winkel kwijt te raken

Een tweede **werkelijk zelf vastgelegde** winkel kan nu later via dezelfde handmatige invoer worden toegevoegd, ook als de eerste winkel uit het handmatige formulier, een eigen CSV of een Supa-prijs-JSON kwam. Dit hergebruikt de bestaande canonieke `convertOwnStoreCsv`-opname en bestaande gecombineerde `supa-offline-prices-v1`-schema; er is geen aanvullende fictieve winkel, prijs of tijdstempel.

1. Open eerst je eigen bron voor bijvoorbeeld PLUS en kies bewust bekende SKU's.
2. Kies bij het handmatige formulier **Alleen DekaMarkt**, vul originele product-ID's, volledige inhoud, werkelijke centprijzen, beschikbaarheid en oorspronkelijke ISO-waarnemingstijd in.
3. Tijdens het typen wordt de getoonde prijsuitkomst direct verborgen en de vergelijkknop uitgeschakeld. **De vorige goedgekeurde PLUS-bron en bijbehorende productkeuzes blijven intern intact**, totdat je het concept bevestigt of annuleert.
4. Druk **Neem mijn echte winkelopname(s) over** en bevestig bewust de wijziging. De nieuwe werkelijk ingevoerde winkel vervangt alleen haar eigen eventuele oude opname; een eerdere opname van de andere winkel blijft letterlijk identiek behouden. Alleen SKU-keuzes bij zo'n geheel ongewijzigde opname blijven geselecteerd. De nieuwe/gewijzigde winkel vereist menselijke productmatching.
5. Met **Annuleer bronconcept · behoud eerdere opname** maak je de oude geldige eerste winkel opnieuw beschikbaar, zonder het niet-geaccepteerde concept tot een bronprijs te promoveren.

Een geannuleerde of ongeldige broninvoer overschrijft de eerder geaccepteerde bron nooit. Tijdregels blijven onafhankelijk: een verschil van meer dan 24 uur of een toekomstig/meer dan zeven dagen oud bronmoment geeft geen volledige twee-winkelwinnaar, ook al bestaan beide echte opnames. De handmatige bron-CSV bevat uitsluitend daadwerkelijk door jou ingevoerde opnames, niet automatisch eerder ingelezen andere winkels. Geen actieve supermarktquery, nieuwe toestemming of geclaimd veldbewijs.


## Eigen Supa-TXT-boodschappenlijst weer als mandvraag openen

Naast een eigen getypte ingrediëntenlijst accepteert dezelfde lokale plakwerkbank nu ook het **eigen eerder geëxporteerde ongeprijsde Supa-TXT-overzicht**. Kies optioneel het bestaande TXT-bestand met de lokale bestandskiezer. Het bestand wordt met strikte UTF-8-decodering uitsluitend in het tekstvak geladen. Pas na de aparte knop **Maak van deze lijst een privémandje** en de bevestiging bij bestaande ingrediënten wordt de huidige mandvraag vervangen. Een ongeldig bestand verandert noch mand, noch prijsbron, noch geselecteerde SKU's.

Het oorspronkelijke Supa-tekstoverzicht heeft eigen header, moment, werkelijk geselecteerd maaltijdaantal, niet-financiële herkomstwaarschuwing, regels `[ ] rijst · 450 g` en eventueel `[x] ...`, gevolgd door een slotwaarschuwing. De parser herkent dit oorspronkelijke formaat uitsluitend met alle verwachte kop- en slotvelden, gebruikt het oorspronkelijke werkelijk opgeslagen maaltijdaantal, negeert oude afvinkstatus voor nieuwe productmatching en zet de fysieke hoeveelheden via dezelfde canonieke metrische import om. De oorspronkelijke onbekende hoeveelheden (`hoeveelheid nog controleren`) worden niet naar prijzen of 0 geconverteerd: de import stopt totdat die door een mens zijn aangevuld. Geen automatische aanname van geobserveerde winkels of winkelrechten.

Direct ingetypte tekstregels blijven ondersteund; maximaal 200 ingrediënten en 40.000 teksttekens. Een optionele TXT-upload heeft een bovengrens van 128 KB en is alleen een **lokaal concept**. Hiermee sluit de bestaande Supa-keten *ongeprijsde Planner-boodschappenlijst → later eigen werkelijk waargenomen winkels → handmatige SKU-match → private volledige vergelijking* zonder verplichte JSON-export.
