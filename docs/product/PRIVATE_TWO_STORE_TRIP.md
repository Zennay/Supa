# Supa · Van privéprijsvergelijking naar boodschappen doen

De geïntegreerde [Vergelijk-flow](https://github.com/Zennay/Supa/pull/3901) laat je op basis van daadwerkelijk zelf ingevoerde, rechtmatig beschikbare PLUS- en DekaMarkt-gegevens **hetzelfde actieve Planner-weekmenu bij beide winkels** matchen. De aanvullende [productwijziging](https://github.com/Zennay/Supa/pull/3902) maakt twee bruikbare privéboodschappenlijsten en een export van het volledige prijsverschil mogelijk.

## In de app

1. Plan maaltijden en dagen in **Planner** en open **Vergelijk**.
2. Vul PLUS/DekaMarkt-producten in, of importeer je eigen CSV/JSON met echte verpakkings-, prijs- en tijdsgegevens. Er wordt geen retailer aangeroepen.
3. Controleer de uitkomst voor beide winkels. Supa laat per ingrediënt zien welk product is gekoppeld, hoeveel **hele verpakkingen** nodig zijn en wat de bekende kosten zijn. Bij ontbrekende matches toont Supa nadrukkelijk **geen volledig mandtotaal**.
4. De winkelmandjes hebben nu per winkel een **afvinklijst**. Tik op een product tijdens het winkelen; de voortgang is op dat moment zichtbaar. Kies **Wis vinkjes** om helemaal opnieuw te beginnen. Voor mobiel offline gebruik kun je de lijst lokaal downloaden als TXT, of kopiëren. Vinkjes blijven standaard alleen in het actuele scherm. Optioneel kun je **Bewaar mijn vinkjes in dit browsertabblad** inschakelen: Supa onthoudt dan uitsluitend de vinkjes en een sleutel voor precies deze bronopname en dit mandje in lokale sessieopslag. Bij een ander mandje, brongegevens of onbekende opslagversie wordt niets automatisch overgenomen of overschreven. Zet de schakelaar uit om het eigen sessieconcept te wissen. Er wordt nooit automatisch naar een server geüpload of in de algemene demo-lijst opgeslagen.
5. Kies in Vergelijk **Download volledig prijs- en matchingoverzicht (CSV)** voor een spreadsheet met alle gebruikte ingrediënten, geobserveerde tijden, gekoppelde producten, verpakkingen, hele-eurocentprijzen en ontbrekende artikelen voor beide winkels. Deze export is *privé*, op basis van eigen invoer.

## Handmatig een echt product koppelen

Als de automatische matcher zich terecht onthoudt (of een onjuist product heeft gekozen), kun je onder **Vergelijk → controleer productkoppelingen** bij elk ingrediënt en elke winkel expliciet een ander product kiezen. De keuzelijst komt **uitsluitend uit de lokaal geladen PLUS- of DekaMarkt-opname** en toont enkel producten die in die eigen invoer als beschikbaar zijn gemarkeerd, een gemeten positieve verpakking, geldige gehele eurocenten en dezelfde fysieke eenheidsfamilie hebben.

1. Controleer op het echte product/bon eerst zelf of het bij het benodigde ingrediënt past. Supa kan de betekenis van een andere productnaam niet onafhankelijk bewijzen.
2. Kies de exacte reeds ingevoerde productnaam en verpakking voor die winkel, of **Geen passend product — laat onbekend** om een verkeerde automatische match af te wijzen. Kies **Automatische match / onbekend** om weer de gewone conservatieve matcher te gebruiken.
3. Supa berekent opnieuw via de bestaande hele-verpakking- en centberekeningen. Er wordt nooit een product, voorraadindicatie, prijs of tijdstip bijgemaakt. Bij onbruikbare of ontbrekende bronproducten blijft de regel onopgelost en verschijnt geen volledig winkelverschil.
4. Handmatige keuzes zijn uitsluitend tijdelijk in de huidige vergelijking en worden ongeldig als de geïmporteerde observatie of het weekmenu verandert. In het prijsrapport en de boodschappenlijst is de status **door gebruiker gekoppeld** zichtbaar; dit is geen automatisch betrouwbaarheidspercentage of onafhankelijk winkelbewijs.

Een handmatige match vervangt uitsluitend de keuze van de *bestaande* lokaal aangeleverde product-ID. Alle overige rechten-, volledigheids-, fysieke/verpakking-, tijds- en geldigheidscontroles gelden ongewijzigd. Het is een persoonlijke rekenhulp en geen wetenschappelijk gecontroleerd 11×2-veldresultaat.

## Betrouwbare prijzen zonder misleidende conclusies

- Alleen bij **volledig gekoppelde mandjes**, dezelfde daadwerkelijke ingrediëntbehoefte en **twee voldoende recente, ≤24 uur gepaarde** observaties mogen prijsverschillen in de privévergelijking en haar CSV-export staan.
- Bij incomplete, ontbrekende of verouderde bronnen blijft het prijsoverzicht bruikbaar als **onvolledig bronverslag**, maar de verschilkolom blijft leeg. Bekende regelprijzen blijven benoemd als bekende deelbedragen, niet als complete mandprijzen of bewezen besparingen.
- De CSV bevat prijzen in **gehele eurocenten** en een expliciet statusveld voor vergelijkbaarheid. De converter schermt tekstvelden af tegen spreadsheet-formules. De originele, lokaal aangeleverde observatietijden blijven zichtbaar.
- De afvinklijst voor elk winkelmandje is van de algemene Figma/demo-boodschappenlijst gescheiden. Een nieuwe invoer of ander mandje start een eigen afvinklijst. Er wordt geen prijs, voorraad of bronrecht verondersteld.
- Zelfs een volledige privévergelijking bewijst **geen onafhankelijke fysieke 11×2 PLUS/DekaMarkt-veldmeting**, geen geldige retailerlicentie en geen publieke besparingsclaim. Externe releasevoorwaarden blijven [#74](https://github.com/Zennay/Supa/issues/74), [#78](https://github.com/Zennay/Supa/issues/78), [#205](https://github.com/Zennay/Supa/issues/205) en [#2833](https://github.com/Zennay/Supa/issues/2833).

## Hoe zit het met privacy?

CSV/JSON wordt alleen in de browser verwerkt. Exporteren gebeurt bewust via een knop. De afvinkstatus blijft standaard in React-geheugen. Alleen na expliciete keuze gebruikt de afvinklijst eigen sessieopslag van het tabblad met mandgebonden identiteit; automatische back-end-/retaileruploads zijn er niet. De originele lokale invoer volgt het bestaande gedrag van de component en de expliciete opt-in voor conceptopslag van de invoerwizard. Deel exports alleen als je dat zelf wilt.
